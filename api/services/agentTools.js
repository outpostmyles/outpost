/**
 * Agent Tools — server-side functions that the AI agent can call via tool_use.
 * These give the agent real capabilities instead of just static context.
 */
import { config } from '../config.js';
import { memGet, memSet } from './memoryCache.js';
import { getFinancials, getAnalystRating } from './fmp.js';
import { getFinancialsResilient, getRatiosResilient } from './fundamentalsCache.js';
import { getEarningsForTicker, getEarningsForTickers, getEarningsCalendar } from '../utils/finnhub.js';
import { todayStr as etTodayStr } from '../utils/marketHours.js';
import { normalizeQuote } from '../utils/polygon.js';
import { filterTickerNews } from '../utils/newsHygiene.js';
import { getTaxInsights } from './taxInsights.js';
import { supabase } from '../db.js';
import { getPrice } from './pricePool.js';
import { recallHistory } from './historyAggregator.js';
import { calculatePositionSize, calculateRiskReward } from './tradeMath.js';
import { calcRSI, calcATR, calcSMA } from './indicators.js';
import { assessPreTradeRisk } from './preTradeRisk.js';
import { getCachedIntelligence, getUserDecisions } from './decisionLedger.js';
import { baseRateGuidance, setupBaseRates } from '../../src/lib/decisionLedger.js';
import { buildPositionProposal, PROPOSAL_REJECTIONS } from '../../src/lib/positionProposal.js';

const BASE = 'https://api.polygon.io';
const KEY = config.polygonKey;

const POLY_FETCH_TIMEOUT_MS = 15000;

async function polyFetch(path, ttlMs = 60000, cacheKey = null) {
  if (cacheKey) {
    const cached = memGet(`tool_${cacheKey}`);
    if (cached) return cached;
  }
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}apiKey=${KEY}`;
  // Native fetch without abort = hangs forever on a stalled connection.
  // 15s ceiling — Polygon should respond in <500ms; anything beyond is dead.
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), POLY_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Polygon timeout after ${POLY_FETCH_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(tm);
  }
  if (!res.ok) throw new Error(`Polygon ${res.status}`);
  let data;
  try {
    data = await res.json();
  } catch (parseErr) {
    throw new Error(`Polygon response parse failed: ${parseErr.message}`);
  }
  if (cacheKey) memSet(`tool_${cacheKey}`, data, ttlMs);
  return data;
}

/**
 * Tool definitions for Anthropic tool_use
 */
export const AGENT_TOOLS = [
  {
    name: 'lookup_stock',
    description: 'Get current price, daily change, volume, and key stats for any stock ticker. Use this when the user asks about a specific stock you don\'t have in context.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol (e.g. AAPL, TSLA, NVDA)' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_historical_price',
    description: 'Get a stock\'s closing price on a specific past date, or compare prices across a date range. Use this when users ask about price changes over weeks or months, or want to know where a stock was trading at a specific point in time.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol' },
        from_date: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
        to_date: { type: 'string', description: 'End date in YYYY-MM-DD format (defaults to today)' },
      },
      required: ['ticker', 'from_date'],
    },
  },
  {
    name: 'screen_stocks',
    description: 'Screen for stocks that match specific criteria. Can find stocks by price change over a period (e.g. down 30-40% in 3 months), by sector, or by volume. Also supports screening for stocks near their 52-week low (near_52w_low=true) or 52-week high (near_52w_high=true). Supports fundamental filters like max_pe, min_dividend_yield, and min_market_cap to find value stocks, dividend payers, or large caps. Use when users ask to find stocks matching conditions like "stocks down 30%", "beaten down names", "cheap stocks with good dividends", "value stocks with low P/E", or "stocks near 52-week lows."',
    input_schema: {
      type: 'object',
      properties: {
        min_change_pct: { type: 'number', description: 'Minimum price change percent (use negative for declines, e.g. -40)' },
        max_change_pct: { type: 'number', description: 'Maximum price change percent (e.g. -30)' },
        lookback_days: { type: 'number', description: 'Number of days to look back (e.g. 90 for 3 months). Default 30.' },
        min_price: { type: 'number', description: 'Minimum current stock price to filter penny stocks (default 10)' },
        max_price: { type: 'number', description: 'Maximum current stock price (e.g. 50 for "stocks under $50")' },
        min_volume: { type: 'number', description: 'Minimum average daily volume (default 500000)' },
        near_52w_low: { type: 'boolean', description: 'If true, find stocks within 15% of their 52-week low' },
        near_52w_high: { type: 'boolean', description: 'If true, find stocks within 5% of their 52-week high' },
        max_pe: { type: 'number', description: 'Maximum P/E ratio (e.g. 20 for value stocks). Fetches fundamentals to filter.' },
        min_dividend_yield: { type: 'number', description: 'Minimum dividend yield percentage (e.g. 2 for 2%+). Fetches fundamentals to filter.' },
        min_market_cap: { type: 'number', description: 'Minimum market cap in billions (e.g. 10 for $10B+).' },
      },
      required: [],
    },
  },
  {
    name: 'get_stock_news',
    description: 'Get recent news headlines for a specific stock ticker. Use when users ask about what\'s happening with a particular stock or why it moved.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol' },
        limit: { type: 'number', description: 'Number of articles to fetch (default 5, max 10)' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'compare_stocks',
    description: 'Compare two or more stocks side by side — current price, daily performance, and recent price change over a period. Use when users ask "which is better" or want to compare options.',
    input_schema: {
      type: 'object',
      properties: {
        tickers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of ticker symbols to compare (2-5 tickers)',
        },
        lookback_days: { type: 'number', description: 'Days to compare performance over (default 30)' },
      },
      required: ['tickers'],
    },
  },
  {
    name: 'get_fundamentals',
    description: 'Get fundamental financial data for a stock: P/E ratio, market cap, profit margins, revenue growth, EPS, debt levels, analyst ratings, earnings date, and more. Use when users ask about valuation ("is AAPL expensive?"), financials ("how profitable is NVDA?"), or when doing deep analysis on a stock.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol (e.g. AAPL, TSLA, NVDA)' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_technicals',
    description: 'Get technical analysis data for a stock: RSI (14-day), 50-day and 200-day moving averages, where price sits in its 52-week range, average volume, and recent price action. Use when users ask about entry/exit timing, whether something is oversold/overbought, or when you want to add technical context to a recommendation.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol (e.g. AAPL, TSLA)' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_sector_performance',
    description: 'Get ranked sector performance over multiple timeframes (1 week, 1 month, 3 months). Shows which sectors are leading and lagging. Use when users ask about sector rotation, where money is flowing, or when deciding which sectors to focus on for stock picks.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_insider_activity',
    description: 'Get recent insider buying and selling activity for a stock. Shows who is buying/selling (CEO, CFO, directors), how much, and when. Use when evaluating conviction in a stock — heavy insider buying is a strong bullish signal.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_support_resistance',
    description: 'Get key support and resistance price levels for a stock based on historical price action. Shows the nearest support zones (where price has bounced before) and resistance zones (where price has stalled). Use when users ask "where should I set my stop loss?", "where should I buy the dip?", "what are the key levels?", or when suggesting entry/exit prices for any stock.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_upcoming_earnings',
    description: 'Get a list of major stocks reporting earnings in the next 2 weeks. Also checks if any of the user\'s holdings or watchlist stocks are reporting soon. Use when users ask "what earnings are coming up?", "should I hold through earnings?", or proactively when recommending a stock that might have earnings imminent.',
    input_schema: {
      type: 'object',
      properties: {
        tickers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: specific tickers to check earnings dates for. If empty, returns broad calendar.',
        },
      },
      required: [],
    },
  },
  {
    name: 'analyze_portfolio_risk',
    description: 'Analyze the correlation and risk profile of a set of stocks. Shows which positions move together (high correlation = concentrated risk), portfolio beta vs the market, and diversification score. Use when users ask "am I diversified enough?", "what happens if tech crashes?", or "what\'s my portfolio risk?"',
    input_schema: {
      type: 'object',
      properties: {
        tickers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of ticker symbols to analyze (typically the user\'s portfolio positions)',
        },
      },
      required: ['tickers'],
    },
  },
  {
    name: 'calculate_position_size',
    description: 'Calculate exact position sizing for a trade based on risk management rules. Takes account size, risk percentage, entry price, and stop loss — returns how many shares to buy, dollar risk, and risk/reward ratio if a target is provided. Use when users mention dollar amounts ("I have $5000"), ask "how many shares should I buy?", ask about position sizing, or when giving trade setups.',
    input_schema: {
      type: 'object',
      properties: {
        account_size: { type: 'number', description: 'Total account value in dollars (e.g. 10000)' },
        risk_pct: { type: 'number', description: 'Percentage of account willing to risk on this trade (default 2). Typical range 1-5%.' },
        entry_price: { type: 'number', description: 'Planned entry price per share' },
        stop_loss: { type: 'number', description: 'Stop loss price per share' },
        target_price: { type: 'number', description: 'Optional profit target price — if provided, calculates risk/reward ratio' },
      },
      required: ['account_size', 'entry_price', 'stop_loss'],
    },
  },
  {
    name: 'calculate_risk_reward',
    description: 'Calculate risk/reward ratio and trade quality score for a trade setup with entry, stop, and one or more targets. Use when the agent is building a trade setup and wants to quantify the R/R, or when a user asks "what\'s the risk/reward on this trade?"',
    input_schema: {
      type: 'object',
      properties: {
        entry_price: { type: 'number', description: 'Entry price' },
        stop_loss: { type: 'number', description: 'Stop loss price' },
        targets: {
          type: 'array',
          items: { type: 'number' },
          description: 'Array of target prices (e.g. [155, 165, 180])',
        },
      },
      required: ['entry_price', 'stop_loss', 'targets'],
    },
  },
  {
    name: 'get_relative_strength',
    description: 'Compare a stock\'s performance against its sector ETF and SPY over 1-week, 1-month, and 3-month timeframes. Shows whether the stock is outperforming or underperforming its sector and the market. A stock up 5% while its sector is down 2% is showing real relative strength — a much better buy signal than just "it\'s up 5%." Use when recommending stocks, evaluating picks, or when users ask "is this stock actually strong?" or "how does X compare to the market?"',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'get_tax_insights',
    description: 'Analyze the user\'s portfolio and trade history for tax-relevant insights. Returns wash sale warnings, tax-loss harvesting opportunities, short-term vs long-term capital gains classification, and year-end optimization suggestions. Use this when the user asks about taxes, capital gains, tax-loss harvesting, wash sales, or when they\'re considering selling a position and tax implications matter. Also use proactively when a user has significant unrealized losses that could offset realized gains. No input required — automatically uses the current user\'s data.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'pre_trade_check',
    description: 'Run a pre-trade sanity check BEFORE the user buys a stock. Checks concentration (would this position be >25% of portfolio?), sector overlap (does the user already hold 3+ stocks in this sector?), position sizing vs their stated risk tolerance, and whether the user has enough buying power heuristically. Use this PROACTIVELY whenever the user mentions buying a stock with a dollar amount ("thinking about putting 5k into NVDA", "should I buy AMD with my 2000?"), even if they haven\'t explicitly asked for a check. Returns a verdict of "ok", "caution", or "stop" with specific reasons.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Ticker the user wants to buy' },
        dollars_to_invest: { type: 'number', description: 'Dollar amount they plan to invest' },
        stop_loss: { type: 'number', description: 'Optional planned stop loss price — used to assess dollar risk vs portfolio size' },
      },
      required: ['ticker', 'dollars_to_invest'],
    },
  },
  {
    name: 'get_closed_trade_reflection',
    description: 'Retrieve the user\'s past closed trades for a specific ticker, including their original entry thesis and their post-close reflection on what they got right or wrong. Use this PROACTIVELY when a user asks about re-entering a ticker they\'ve previously owned, or when they mention buying/researching a stock they have a history with. It lets you reference their own lessons learned ("last time you held NVDA you exited too early on fear — is this setup different?") instead of giving generic advice.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Stock ticker symbol' },
      },
      required: ['ticker'],
    },
  },
  {
    name: 'recall_history',
    description: 'Retrieve the user\'s OWN past writing and thinking across past conversations with you, their position theses (active + closed), their journal notes, and their saved reflections. Use this PROACTIVELY any time the user mentions a ticker, asks "what did I think about X", references a past decision, or asks for your opinion on a position they hold or have held. The result includes the user\'s VERBATIM writing in the `context` field. Quote it back to them with attribution ("You wrote three months ago: ...") rather than paraphrasing. This is how you make the user feel remembered. Distinct from get_closed_trade_reflection (which only sees closed trades): recall_history spans active positions, journal notes, and prior conversations too. IMPORTANT: each event has a `dateMeaning` field. For position_open events, if dateMeaning is "added_to_outpost_only" the date is when the user added the row to Outpost, NOT when they actually bought the stock. Do NOT say "you bought this N days ago" based on that date. Say "you added this to Outpost N days ago" if you mention the date at all, or ask the user when they actually bought it if hold duration matters to your answer. If dateMeaning is "actual_purchase_date" the user explicitly provided that date and you may reason about hold duration from it.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Optional. Filter to a specific ticker — also picks up free-text mentions in past conversations and journal notes.' },
        topic: { type: 'string', description: 'Optional. Free-text substring search across all stored writing (e.g. "AI spending", "earnings", "tax loss").' },
        date_from: { type: 'string', description: 'Optional. ISO date to start from (e.g. 2026-01-01).' },
        date_to: { type: 'string', description: 'Optional. ISO date to end at.' },
        limit: { type: 'number', description: 'Max entries to return. Default 10, hard cap 30.' },
      },
    },
  },
  {
    name: 'propose_position_update',
    description: 'Draft a change to a position the user ALREADY HOLDS: its thesis (why they own it), its stop loss, and/or its take profit (price target). This NEVER saves anything. It shows the user a confirm card with your draft, and the change is written only if THEY tap Apply. Use this ONLY when the user explicitly asks you to set, save, write, update, or record one of these (for example "set a thesis for my NVDA", "put a stop on AMD at 150", "what should my target be, save it"). Do NOT call it unprompted, do NOT call it for stocks they do not hold, and do NOT call it for shares or cost basis (those come from their broker). After calling it, tell the user you drafted it for them to confirm and never say you saved or set it. Outpost is long only: a stop must be below the current price and a target above it.',
    input_schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Ticker of a position the user holds' },
        thesis: { type: 'string', description: 'Optional. The thesis text to set (why they own it, what would change their mind). Draft it in the user\'s voice from the conversation.' },
        stop_loss: { type: 'number', description: 'Optional. Proposed stop loss price. Must be below the current price.' },
        take_profit: { type: 'number', description: 'Optional. Proposed take profit / price target. Must be above the current price.' },
        rationale: { type: 'string', description: 'Optional. One short line on why these levels, shown on the confirm card.' },
      },
      required: ['ticker'],
    },
  },
];

/**
 * Sanitize a ticker before tool execution. Claude can hallucinate inputs —
 * e.g. multi-word strings, lowercase, special characters, 100-char "tickers".
 * Returns null if the input can't be coerced to a valid ticker; tool returns
 * an error instead of constructing a malformed URL.
 */
function sanitizeToolTicker(t) {
  if (!t || typeof t !== 'string') return null;
  const clean = t.toUpperCase().trim().replace(/[^A-Z.]/g, '');
  if (!clean || clean.length > 6 || clean.length < 1) return null; // allow up to 6 for tickers like BRK.B
  return clean;
}

// Tools that take a primary `ticker` field — gated before dispatch.
const TICKERED_TOOLS = new Set([
  'lookup_stock', 'get_historical_price', 'get_stock_news', 'get_fundamentals',
  'get_technicals', 'get_insider_activity', 'get_support_resistance',
  'get_relative_strength', 'get_closed_trade_reflection',
]);

/**
 * Execute a tool call and return the result
 */
export async function executeTool(toolName, toolInput, context = {}) {
  try {
    // Pre-flight validation on tool inputs Claude provides. Bad inputs slip
    // through if we trust the model — e.g. ticker="AAAA...x1000". Sanitize
    // the primary ticker field for tools that take one before any side
    // effects (URL building, DB query, etc).
    if (TICKERED_TOOLS.has(toolName) && toolInput?.ticker) {
      const clean = sanitizeToolTicker(toolInput.ticker);
      if (!clean) return { error: `Invalid ticker: "${String(toolInput.ticker).slice(0, 20)}"` };
      toolInput = { ...toolInput, ticker: clean };
    }

    switch (toolName) {
      case 'lookup_stock': return await lookupStock(toolInput);
      case 'get_historical_price': return await getHistoricalPrice(toolInput);
      case 'screen_stocks': return await screenStocks(toolInput);
      case 'get_stock_news': return await getStockNews(toolInput);
      case 'compare_stocks': return await compareStocks(toolInput);
      case 'get_fundamentals': return await getFundamentals(toolInput);
      case 'get_technicals': return await getTechnicals(toolInput);
      case 'get_sector_performance': return await getSectorPerformance(toolInput);
      case 'get_insider_activity': return await getInsiderActivity(toolInput);
      case 'get_support_resistance': return await getSupportResistance(toolInput);
      case 'get_upcoming_earnings': return await getUpcomingEarnings(toolInput);
      case 'analyze_portfolio_risk': return await analyzePortfolioRisk(toolInput);
      case 'calculate_position_size': return calculatePositionSize(toolInput);
      case 'calculate_risk_reward': return calculateRiskReward(toolInput);
      case 'get_relative_strength': return await getRelativeStrength(toolInput);
      case 'get_tax_insights': return context.userId ? await getTaxInsights(context.userId) : { error: 'User context not available' };
      case 'pre_trade_check': return context.userId ? await preTradeCheck({ ...toolInput, userId: context.userId }) : { error: 'User context not available' };
      case 'get_closed_trade_reflection': return context.userId ? await getClosedTradeReflection({ ...toolInput, userId: context.userId }) : { error: 'User context not available' };
      case 'recall_history': {
        if (!context.userId) return { error: 'User context not available' };
        const entries = await recallHistory({
          userId: context.userId,
          ticker: toolInput.ticker || undefined,
          topic: toolInput.topic || undefined,
          dateFrom: toolInput.date_from || undefined,
          dateTo: toolInput.date_to || undefined,
          limit: Math.min(toolInput.limit ?? 10, 30),
        });
        if (entries.length === 0) {
          return { entries: [], note: 'No prior history found for the given filters. The user has no past writing on this — treat them as starting fresh.' };
        }
        return { entries };
      }
      case 'propose_position_update':
        return context.userId
          ? await proposePositionUpdate({ ...toolInput, userId: context.userId, sink: context.proposals })
          : { error: 'User context not available' };
      default: return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { error: `Tool failed: ${err.message}` };
  }
}

// Draft a change to a HELD position's plan fields (thesis / stop / target). This
// never writes. It checks the user actually holds the ticker, validates the
// levels against the live price (long only) via the pure builder, pushes the
// normalized proposal into the request's proposal sink (the route streams that to
// the UI as a confirm card), and returns a model-facing acknowledgement that is
// explicit that NOTHING is saved until the user taps Apply.
async function proposePositionUpdate({ ticker, thesis, stop_loss, take_profit, rationale, userId, sink }) {
  if (!ticker || typeof ticker !== 'string') return { error: 'No ticker provided' };
  const sym = ticker.toUpperCase().trim();
  const { data: position } = await supabase.from('positions')
    .select('id, ticker, entry_thesis, price_target, stop_loss')
    .eq('user_id', userId).eq('ticker', sym).maybeSingle();
  if (!position) {
    return { ok: false, proposed: false, note: `${PROPOSAL_REJECTIONS.not_held} (${sym} is not in their portfolio.)` };
  }
  const price = getPrice(sym)?.price ?? null;
  const result = buildPositionProposal({ thesis, stop_loss, take_profit, rationale }, { position, price });
  if (!result.ok) {
    return { ok: false, proposed: false, note: PROPOSAL_REJECTIONS[result.error] || 'That change could not be drafted.' };
  }
  if (Array.isArray(sink)) sink.push(result.proposal); // hand the draft to the route to surface a confirm card
  const f = result.proposal.fields;
  const parts = [];
  if (f.entryThesis != null) parts.push('a thesis');
  if (f.stopLoss != null) parts.push(`a stop at $${f.stopLoss}`);
  if (f.priceTarget != null) parts.push(`a target at $${f.priceTarget}`);
  const drafted = parts.join(', ');
  return {
    ok: true,
    proposed: true,
    ticker: sym,
    drafted,
    note: `Draft created for ${sym} (${drafted}). A confirm card is now showing for the user. Tell them you drafted it, summarize it in one line, and ask them to review and tap Apply. Do NOT claim it is saved or set; nothing is written until they confirm.`,
  };
}

export async function lookupStock({ ticker }) {
  if (!ticker || typeof ticker !== 'string') return { error: 'No ticker provided' };
  ticker = ticker.toUpperCase().trim();
  const data = await polyFetch(`/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}`, 30000, `tool_snap_${ticker}`);
  const t = data?.ticker;
  if (!t) return { error: `No data found for ${ticker}` };

  const q = normalizeQuote(t);
  if (!q) return { error: `No price data for ${ticker}` };

  return {
    ticker,
    price: q.price,
    change: q.change,
    change_percent: q.changePercent,
    volume: q.volume,
    day_high: q.dayHigh,
    day_low: q.dayLow,
    day_open: q.dayOpen,
    prev_close: q.prevClose,
    updated: t?.lastTrade?.t ? new Date(t.lastTrade.t / 1e6).toISOString() : null,
  };
}

export async function getHistoricalPrice({ ticker, from_date, to_date }) {
  ticker = ticker.toUpperCase().trim();
  const to = to_date || new Date().toISOString().split('T')[0];
  const cacheKey = `hist_${ticker}_${from_date}_${to}`;

  const data = await polyFetch(
    `/v2/aggs/ticker/${ticker}/range/1/day/${from_date}/${to}?adjusted=true&sort=asc`,
    10 * 60000,
    cacheKey
  );

  const results = data?.results ?? [];
  if (results.length === 0) return { error: `No historical data for ${ticker} from ${from_date} to ${to}` };

  const first = results[0];
  const last = results[results.length - 1];
  const changePct = first.c > 0 ? ((last.c - first.c) / first.c * 100) : 0;

  // Also find high/low in period
  let periodHigh = -Infinity, periodLow = Infinity;
  for (const bar of results) {
    if (bar.h > periodHigh) periodHigh = bar.h;
    if (bar.l < periodLow) periodLow = bar.l;
  }

  return {
    ticker,
    from_date,
    to_date: to,
    start_price: +first.c.toFixed(2),
    end_price: +last.c.toFixed(2),
    change_percent: +changePct.toFixed(2),
    period_high: +periodHigh.toFixed(2),
    period_low: +periodLow.toFixed(2),
    trading_days: results.length,
  };
}

async function screenStocks({ min_change_pct, max_change_pct, lookback_days = 30, min_price = 10, max_price, min_volume = 500000, near_52w_low, near_52w_high, max_pe, min_dividend_yield, min_market_cap }) {
  const hasFundamentalFilters = max_pe != null || min_dividend_yield != null || min_market_cap != null;
  // Use a curated list of popular/liquid stocks to screen against
  // (Polygon grouped daily would be ideal but it returns 10k+ tickers and is slow)
  const SCREEN_UNIVERSE = [
    // Mega cap tech
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'AVGO', 'ORCL', 'CRM',
    'AMD', 'INTC', 'ADBE', 'NFLX', 'CSCO', 'QCOM', 'TXN', 'AMAT', 'MU', 'LRCX',
    'PANW', 'SNPS', 'CDNS', 'KLAC', 'MRVL', 'ON', 'SMCI', 'ARM', 'PLTR', 'CRWD',
    // Finance
    'JPM', 'BAC', 'WFC', 'GS', 'MS', 'C', 'BLK', 'SCHW', 'AXP', 'V', 'MA',
    'ICE', 'CME', 'SPGI', 'MCO', 'COIN', 'HOOD',
    // Healthcare / Biotech
    'UNH', 'JNJ', 'PFE', 'ABBV', 'MRK', 'LLY', 'TMO', 'ABT', 'BMY', 'AMGN',
    'GILD', 'ISRG', 'VRTX', 'REGN', 'MRNA', 'BIIB', 'DXCM', 'IDXX', 'ZTS', 'EW',
    'HCA', 'CI', 'ELV', 'GEHC', 'BSX',
    // Consumer / Retail
    'WMT', 'COST', 'HD', 'NKE', 'SBUX', 'MCD', 'DIS', 'ABNB', 'BKNG', 'CMG',
    'TGT', 'LOW', 'LULU', 'DECK', 'ROST', 'TJX', 'ULTA', 'YUM', 'DPZ', 'CAVA',
    'WING', 'ELF', 'ONON', 'BIRD',
    // Industrial / Defense
    'BA', 'CAT', 'DE', 'UNP', 'HON', 'GE', 'RTX', 'LMT', 'NOC', 'GD',
    'FDX', 'UPS', 'WM', 'RSG', 'VRSK', 'AXON', 'TT', 'EMR', 'ETN', 'PWR',
    // Energy
    'XOM', 'CVX', 'COP', 'EOG', 'SLB', 'PSX', 'VLO', 'OKE', 'WMB', 'FANG',
    // Utilities / REITs / Dividend
    'NEE', 'SO', 'DUK', 'AEP', 'AMT', 'PLD', 'CCI', 'O', 'WELL', 'PSA',
    // Software / Cloud / Cyber
    'NOW', 'SNOW', 'DDOG', 'ZS', 'FTNT', 'NET', 'MDB', 'HUBS', 'TEAM', 'TTD',
    'BILL', 'PAYC', 'VEEV', 'WDAY',
    // EV / Growth / Speculative
    'RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'SOFI', 'SNAP', 'PINS',
    'U', 'DKNG', 'RBLX', 'ROKU', 'SQ', 'SHOP', 'SE', 'MELI',
    'DUOL', 'CELH', 'HIMS', 'IONQ', 'RKLB', 'AFRM',
    // Materials / Commodities
    'FCX', 'NEM', 'APD', 'LIN', 'ECL', 'SHW',
    // ETFs for context
    'SPY', 'QQQ', 'IWM', 'XLF', 'XLE', 'XLK', 'XLV', 'ARKK',
  ];

  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - lookback_days);
  const fromStr = fromDate.toISOString().split('T')[0];
  const toStr = today.toISOString().split('T')[0];

  // Fetch current snapshots first (batch call)
  let snapData;
  try {
    snapData = await polyFetch(
      `/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${SCREEN_UNIVERSE.join(',')}`,
      60000,
      `screen_snap_${lookback_days}`
    );
  } catch {
    return { error: 'Failed to fetch current prices for screening' };
  }

  const currentPrices = {};
  for (const t of snapData?.tickers ?? []) {
    const price = t?.day?.c || t?.lastTrade?.p || t?.prevDay?.c;
    const vol = t?.day?.v ?? 0;
    if (price && price >= min_price && vol >= min_volume) {
      if (max_price && price > max_price) continue; // filter by max price
      currentPrices[t.ticker] = { price, volume: vol };
    }
  }

  // Now fetch historical prices for candidates in parallel batches
  const candidates = Object.keys(currentPrices);
  const BATCH_SIZE = 15;
  const matches = [];

  // For 52-week screens, we need more historical data
  const needsYearData = near_52w_low || near_52w_high;
  const histFrom = needsYearData
    ? new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0]
    : fromStr;

  for (let i = 0; i < candidates.length && matches.length < 20; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (ticker) => {
        const limit = needsYearData ? 300 : 2;
        const hist = await polyFetch(
          `/v2/aggs/ticker/${ticker}/range/1/day/${histFrom}/${toStr}?adjusted=true&sort=asc&limit=${limit}`,
          10 * 60000,
          `screen_hist_${ticker}_${lookback_days}_${needsYearData ? 'yr' : 'std'}`
        );
        const bars = hist?.results ?? [];
        if (bars.length < 1) return null;

        const endPrice = currentPrices[ticker].price;

        // 52-week range calculation
        if (needsYearData && bars.length >= 20) {
          const highs = bars.map(b => b.h);
          const lows = bars.map(b => b.l);
          const yearHigh = Math.max(...highs);
          const yearLow = Math.min(...lows);
          const rangePct = yearHigh !== yearLow ? ((endPrice - yearLow) / (yearHigh - yearLow) * 100) : 50;

          if (near_52w_low && rangePct > 15) return null; // Not near low enough
          if (near_52w_high && rangePct < 95) return null; // Not near high enough

          return { ticker, endPrice, yearHigh, yearLow, rangePct, volume: currentPrices[ticker].volume };
        }

        // Standard price change screen
        const startPrice = bars[0].c;
        if (!startPrice || startPrice <= 0) return null;
        const changePct = ((endPrice - startPrice) / startPrice) * 100;
        return { ticker, startPrice, endPrice, changePct, volume: currentPrices[ticker].volume };
      })
    );

    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const v = r.value;

      if (needsYearData) {
        // 52-week screen result
        matches.push({
          ticker: v.ticker,
          current_price: +v.endPrice.toFixed(2),
          year_high: +v.yearHigh.toFixed(2),
          year_low: +v.yearLow.toFixed(2),
          range_position_pct: +v.rangePct.toFixed(1),
          avg_volume: v.volume,
        });
      } else if (min_change_pct != null && max_change_pct != null) {
        // Standard change% screen
        if (v.changePct >= min_change_pct && v.changePct <= max_change_pct) {
          matches.push({
            ticker: v.ticker,
            current_price: +v.endPrice.toFixed(2),
            price_ago: +v.startPrice.toFixed(2),
            change_percent: +v.changePct.toFixed(1),
            avg_volume: v.volume,
          });
        }
      } else {
        // No change filter — just return all (filtered by price/volume already)
        matches.push({
          ticker: v.ticker,
          current_price: +v.endPrice.toFixed(2),
          avg_volume: v.volume,
        });
      }
    }
  }

  // Sort appropriately
  if (near_52w_low) matches.sort((a, b) => a.range_position_pct - b.range_position_pct);
  else if (near_52w_high) matches.sort((a, b) => b.range_position_pct - a.range_position_pct);
  else matches.sort((a, b) => (a.change_percent ?? 0) - (b.change_percent ?? 0));

  // Apply fundamental filters if requested (fetches FMP data for matches)
  let finalMatches = matches;
  let fundamentalNote = '';
  if (hasFundamentalFilters && matches.length > 0) {
    const toCheck = matches.slice(0, 20); // limit FMP calls
    const fundResults = await Promise.allSettled(
      toCheck.map(async (m) => {
        try {
          const [profile] = await Promise.allSettled([getFinancials(m.ticker)]);
          const p = profile.status === 'fulfilled' ? profile.value : null;
          if (!p) return null;
          // Apply filters
          if (max_pe != null && (p.pe == null || p.pe <= 0 || p.pe > max_pe)) return null;
          if (min_dividend_yield != null && (!p.dividendYield || p.dividendYield < min_dividend_yield)) return null;
          if (min_market_cap != null && (!p.marketCap || p.marketCap < min_market_cap * 1e9)) return null;
          return {
            ...m,
            pe_ratio: p.pe || null,
            dividend_yield_pct: p.dividendYield || null,
            market_cap: p.marketCap || null,
            sector: p.sector || null,
          };
        } catch { return null; }
      })
    );
    finalMatches = fundResults
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);
    fundamentalNote = ` + fundamental filters (${max_pe != null ? 'P/E<' + max_pe : ''}${min_dividend_yield != null ? ' div>' + min_dividend_yield + '%' : ''}${min_market_cap != null ? ' cap>$' + min_market_cap + 'B' : ''})`;
  }

  const criteriaDesc = near_52w_low ? `Stocks near 52-week lows`
    : near_52w_high ? `Stocks near 52-week highs`
    : min_change_pct != null && max_change_pct != null ? `Stocks ${min_change_pct}% to ${max_change_pct}% over ${lookback_days} days`
    : `Stock screen`;

  return {
    criteria: `${criteriaDesc}, price $${min_price}${max_price ? '-$' + max_price : '+'}, min volume ${min_volume.toLocaleString()}${fundamentalNote}`,
    matches: finalMatches.slice(0, 15),
    universe_scanned: candidates.length,
    note: finalMatches.length === 0
      ? 'No stocks matched these exact criteria. Try widening the range or adjusting filters.'
      : `Found ${finalMatches.length} stocks matching criteria.`,
  };
}

export async function getStockNews({ ticker, limit = 5 }) {
  if (!ticker || typeof ticker !== 'string') return { error: 'No ticker provided' };
  ticker = ticker.toUpperCase().trim();
  limit = Math.min(limit, 10);

  // Over-fetch so the hygiene filter (which drops basket/listicle spam) still
  // has enough relevant articles to fill `limit`.
  const rawLimit = Math.min(limit * 3, 30);
  const data = await polyFetch(
    `/v2/reference/news?ticker=${ticker}&limit=${rawLimit}&order=desc`,
    15 * 60000,
    `tool_news_${ticker}`
  );

  const raw = (data?.results ?? []).map(a => ({
    title: a.title,
    source: a.publisher?.name || 'Unknown',
    published: a.published_utc,
    summary: a.description?.slice(0, 200) || '',
    tickers: a.tickers || [],
  }));
  // Keep only news actually about this ticker, then drop the tickers field from
  // the returned shape (it was only needed for filtering).
  const articles = filterTickerNews(raw, ticker, { max: limit })
    .map(({ tickers, ...rest }) => rest);

  return { ticker, articles, count: articles.length };
}

async function compareStocks({ tickers, lookback_days = 30 }) {
  if (!Array.isArray(tickers) || tickers.length < 2) return { error: 'Need at least 2 tickers to compare' };
  tickers = tickers.filter(t => typeof t === 'string').map(t => t.toUpperCase().trim()).slice(0, 5);

  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - lookback_days);
  const fromStr = fromDate.toISOString().split('T')[0];
  const toStr = today.toISOString().split('T')[0];

  const results = await Promise.allSettled(
    tickers.map(async (ticker) => {
      // Get current snapshot
      const snapData = await polyFetch(
        `/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}`,
        30000,
        `tool_cmp_snap_${ticker}`
      );
      const t = snapData?.ticker;
      const price = t?.day?.c || t?.lastTrade?.p || t?.prevDay?.c || null;
      const prev = t?.prevDay?.c || price;
      const todayChange = price && prev ? ((price - prev) / prev * 100) : null;

      // Get historical for period change
      const histData = await polyFetch(
        `/v2/aggs/ticker/${ticker}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=2`,
        10 * 60000,
        `tool_cmp_hist_${ticker}_${lookback_days}`
      );
      const bars = histData?.results ?? [];
      const periodStart = bars.length > 0 ? bars[0].c : null;
      const periodChange = periodStart && price ? ((price - periodStart) / periodStart * 100) : null;

      return {
        ticker,
        current_price: price ? +price.toFixed(2) : null,
        today_change_pct: todayChange ? +todayChange.toFixed(2) : null,
        period_change_pct: periodChange ? +periodChange.toFixed(2) : null,
        volume: t?.day?.v ?? null,
      };
    })
  );

  const comparison = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  return { tickers, lookback_days, comparison };
}

async function getFundamentals({ ticker }) {
  if (!ticker || typeof ticker !== 'string') return { error: 'No ticker provided' };
  ticker = ticker.toUpperCase().trim();

  const [profile, ratios, earnings, analyst] = await Promise.allSettled([
    getFinancialsResilient(ticker),
    getRatiosResilient(ticker),
    getEarningsForTicker(ticker),
    getAnalystRating(ticker),
  ]);

  const p = profile.status === 'fulfilled' ? profile.value : null;
  const r = ratios.status === 'fulfilled' ? ratios.value : null;
  const e = earnings.status === 'fulfilled' ? earnings.value : null;
  const a = analyst.status === 'fulfilled' ? analyst.value : null;

  if (!p && !r) return { error: `No fundamental data found for ${ticker}. This may not be a valid US stock ticker.` };

  const result = { ticker };

  if (p) {
    result.company = p.companyName;
    result.sector = p.sector;
    result.industry = p.industry;
    result.market_cap = p.marketCap;
    result.pe_ratio = p.pe;
    result.eps = p.eps;
    result.beta = p.beta;
    result.dividend_yield_pct = p.dividendYield;
    result.year_high = p.yearHigh;
    result.year_low = p.yearLow;
    result.avg_volume = p.avgVolume;
  }

  if (r) {
    result.gross_margin_pct = r.grossMargin;
    result.operating_margin_pct = r.operatingMargin;
    result.net_margin_pct = r.netMargin;
    result.roe_pct = r.roe;
    result.debt_to_equity = r.debtToEquity;
    result.current_ratio = r.currentRatio;
    result.peg_ratio = r.pegRatio;
    result.price_to_book = r.priceToBook;
    result.price_to_sales = r.priceToSales;
  }

  if (e) {
    result.next_earnings = e.upcoming ? e.date : null;
    result.earnings_time = e.time; // 'bmo' or 'amc'
    result.last_eps_surprise = e.epsSurprise;
  }

  if (a) {
    result.analyst_consensus = a.consensus;
    result.analyst_buy = a.buy;
    result.analyst_hold = a.hold;
    result.analyst_sell = a.sell;
    result.price_target = a.targetPrice;
    result.target_high = a.targetHigh;
    result.target_low = a.targetLow;
  }

  return result;
}

// ============ NEW TOOLS ============

/**
 * RSI, ATR, and SMA moved to ./indicators.js (imported above) so the indicator
 * math is unit-testable in isolation.
 */

async function getTechnicals({ ticker }) {
  if (!ticker) return { error: 'No ticker provided' };
  ticker = ticker.toUpperCase().trim();

  // Fetch ~250 days of daily data (enough for 200-day MA + RSI)
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 365);
  const fromStr = from.toISOString().split('T')[0];
  const toStr = today.toISOString().split('T')[0];

  const data = await polyFetch(
    `/v2/aggs/ticker/${ticker}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=300`,
    5 * 60000,
    `tech_${ticker}`
  );

  const bars = data?.results ?? [];
  if (bars.length < 20) return { error: `Not enough data for ${ticker} technical analysis` };

  const closes = bars.map(b => b.c);
  const currentPrice = closes[closes.length - 1];
  const volumes = bars.map(b => b.v);

  // RSI
  const rsi = calcRSI(closes, 14);

  // Moving averages
  const sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50);
  const sma200 = calcSMA(closes, 200);

  // 52-week range position
  const yearCloses = closes.slice(-252);
  const yearHigh = Math.max(...yearCloses);
  const yearLow = Math.min(...yearCloses);
  const rangePosition = yearHigh !== yearLow
    ? +((currentPrice - yearLow) / (yearHigh - yearLow) * 100).toFixed(1)
    : 50;

  // Recent momentum: 5-day and 20-day change
  const fiveDayAgo = closes.length > 5 ? closes[closes.length - 6] : null;
  const twentyDayAgo = closes.length > 20 ? closes[closes.length - 21] : null;
  const fiveDayChange = fiveDayAgo ? +((currentPrice - fiveDayAgo) / fiveDayAgo * 100).toFixed(2) : null;
  const twentyDayChange = twentyDayAgo ? +((currentPrice - twentyDayAgo) / twentyDayAgo * 100).toFixed(2) : null;

  // Average volume (20-day)
  const avgVol20 = volumes.length >= 20
    ? Math.round(volumes.slice(-20).reduce((a, b) => a + b, 0) / 20)
    : null;

  // Trend signals
  const signals = [];
  if (rsi !== null) {
    if (rsi < 30) signals.push('RSI oversold (<30) — potential bounce zone');
    else if (rsi > 70) signals.push('RSI overbought (>70) — potential pullback');
  }
  if (sma50 && sma200) {
    if (sma50 > sma200) signals.push('Golden cross (50MA > 200MA) — bullish trend');
    else signals.push('Death cross (50MA < 200MA) — bearish trend');
  }
  if (sma50 && currentPrice > sma50) signals.push('Price above 50-day MA — near-term uptrend');
  else if (sma50) signals.push('Price below 50-day MA — near-term downtrend');
  if (rangePosition < 20) signals.push('Near 52-week low — beaten down');
  else if (rangePosition > 80) signals.push('Near 52-week high — strong momentum');

  return {
    ticker,
    price: +currentPrice.toFixed(2),
    rsi_14: rsi,
    sma_20: sma20,
    sma_50: sma50,
    sma_200: sma200,
    year_high: +yearHigh.toFixed(2),
    year_low: +yearLow.toFixed(2),
    range_position_pct: rangePosition,
    five_day_change_pct: fiveDayChange,
    twenty_day_change_pct: twentyDayChange,
    avg_volume_20d: avgVol20,
    signals,
  };
}

/**
 * Sector performance — uses sector ETFs as proxies.
 */
async function getSectorPerformance() {
  const SECTOR_ETFS = [
    { etf: 'XLK', name: 'Technology' },
    { etf: 'XLV', name: 'Healthcare' },
    { etf: 'XLF', name: 'Financials' },
    { etf: 'XLE', name: 'Energy' },
    { etf: 'XLI', name: 'Industrials' },
    { etf: 'XLP', name: 'Consumer Staples' },
    { etf: 'XLY', name: 'Consumer Discretionary' },
    { etf: 'XLU', name: 'Utilities' },
    { etf: 'XLB', name: 'Materials' },
    { etf: 'XLRE', name: 'Real Estate' },
    { etf: 'XLC', name: 'Communication Services' },
  ];

  const today = new Date();
  const oneWeekAgo = new Date(today); oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const oneMonthAgo = new Date(today); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const threeMonthsAgo = new Date(today); threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const fmt = d => d.toISOString().split('T')[0];

  const results = await Promise.allSettled(
    SECTOR_ETFS.map(async ({ etf, name }) => {
      const data = await polyFetch(
        `/v2/aggs/ticker/${etf}/range/1/day/${fmt(threeMonthsAgo)}/${fmt(today)}?adjusted=true&sort=asc`,
        30 * 60000,
        `sector_perf_${etf}`
      );
      const bars = data?.results ?? [];
      if (bars.length < 5) return null;

      const currentPrice = bars[bars.length - 1].c;
      const findPriceNear = (targetDate) => {
        const target = targetDate.getTime();
        let closest = bars[0];
        for (const b of bars) {
          if (Math.abs(b.t - target) < Math.abs(closest.t - target)) closest = b;
        }
        return closest.c;
      };

      const weekPrice = findPriceNear(oneWeekAgo);
      const monthPrice = findPriceNear(oneMonthAgo);
      const qtrPrice = bars[0].c; // earliest bar ~3 months ago

      return {
        sector: name,
        etf,
        one_week_pct: +((currentPrice - weekPrice) / weekPrice * 100).toFixed(2),
        one_month_pct: +((currentPrice - monthPrice) / monthPrice * 100).toFixed(2),
        three_month_pct: +((currentPrice - qtrPrice) / qtrPrice * 100).toFixed(2),
      };
    })
  );

  const sectors = results
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)
    .sort((a, b) => b.one_month_pct - a.one_month_pct);

  return {
    sectors,
    strongest_1m: sectors[0]?.sector || 'Unknown',
    weakest_1m: sectors[sectors.length - 1]?.sector || 'Unknown',
    strongest_3m: [...sectors].sort((a, b) => b.three_month_pct - a.three_month_pct)[0]?.sector || 'Unknown',
    note: 'Ranked by 1-month performance. Use this to identify sector rotation trends.',
  };
}

/**
 * Insider trading activity — uses FMP API.
 */
async function getInsiderActivity({ ticker }) {
  if (!ticker) return { error: 'No ticker provided' };
  ticker = ticker.toUpperCase().trim();

  const cached = memGet(`insider_${ticker}`);
  if (cached) return cached;

  const KEY_FMP = config.fmpKey;
  if (!KEY_FMP) return { error: 'Insider data service not configured' };

  // 15s timeout on FMP fetch — without this, the call can hang indefinitely
  // and block the agent's tool round.
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 15000);
  try {
    let res;
    try {
      res = await fetch(`https://financialmodelingprep.com/stable/insider-trading?symbol=${ticker}&limit=20&apikey=${KEY_FMP}`, { signal: ctrl.signal });
    } catch (err) {
      if (err.name === 'AbortError') return { error: 'Insider data timed out' };
      throw err;
    } finally {
      clearTimeout(tm);
    }
    if (!res.ok) return { error: `Failed to fetch insider data for ${ticker}` };
    const data = await res.json();
    if (!data?.length) return { ticker, transactions: [], summary: 'No recent insider activity found.' };

    // Aggregate last 90 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const recent = data.filter(t => new Date(t.filingDate) >= cutoff);

    let totalBought = 0, totalSold = 0, buyCount = 0, sellCount = 0;
    const transactions = recent.slice(0, 10).map(t => {
      const isBuy = (t.acquistionOrDisposition || '').toUpperCase() === 'A' || (t.transactionType || '').toLowerCase().includes('purchase');
      const shares = Math.abs(t.securitiesTransacted || 0);
      const value = Math.abs(t.securitiesTransacted * (t.price || 0));
      if (isBuy) { totalBought += value; buyCount++; }
      else { totalSold += value; sellCount++; }
      return {
        date: t.filingDate,
        insider: t.reportingName || 'Unknown',
        title: t.typeOfOwner || '',
        action: isBuy ? 'BUY' : 'SELL',
        shares,
        price: t.price ? +t.price.toFixed(2) : null,
        value: value ? +value.toFixed(0) : null,
      };
    });

    const netSignal = totalBought > totalSold * 2 ? 'Strong insider buying — bullish signal'
      : totalSold > totalBought * 2 ? 'Heavy insider selling — bearish signal'
      : buyCount > sellCount ? 'Net insider buying'
      : sellCount > buyCount ? 'Net insider selling'
      : 'Mixed insider activity';

    const result = {
      ticker,
      period: 'Last 90 days',
      buy_count: buyCount,
      sell_count: sellCount,
      total_bought_value: +totalBought.toFixed(0),
      total_sold_value: +totalSold.toFixed(0),
      signal: netSignal,
      transactions,
    };

    memSet(`insider_${ticker}`, result, 6 * 60 * 60 * 1000); // 6hr cache
    return result;
  } catch (err) {
    return { error: `Insider data failed: ${err.message}` };
  }
}

// ============ SUPPORT & RESISTANCE ============

/**
 * Find support and resistance levels from historical price data.
 * Uses swing highs/lows and price clustering over 6 months of daily data.
 */
async function getSupportResistance({ ticker }) {
  if (!ticker) return { error: 'No ticker provided' };
  ticker = ticker.toUpperCase().trim();

  const today = new Date();
  const from = new Date(today);
  from.setMonth(from.getMonth() - 6);

  const data = await polyFetch(
    `/v2/aggs/ticker/${ticker}/range/1/day/${from.toISOString().split('T')[0]}/${today.toISOString().split('T')[0]}?adjusted=true&sort=asc&limit=200`,
    10 * 60000,
    `sr_${ticker}`
  );

  const bars = data?.results ?? [];
  if (bars.length < 30) return { error: `Not enough price history for ${ticker}` };

  const currentPrice = bars[bars.length - 1].c;

  // Find swing highs and lows (local extremes over 5-bar windows)
  const swingHighs = [];
  const swingLows = [];
  for (let i = 2; i < bars.length - 2; i++) {
    const h = bars[i].h;
    const l = bars[i].l;
    if (h > bars[i-1].h && h > bars[i-2].h && h > bars[i+1].h && h > bars[i+2].h) {
      swingHighs.push(h);
    }
    if (l < bars[i-1].l && l < bars[i-2].l && l < bars[i+1].l && l < bars[i+2].l) {
      swingLows.push(l);
    }
  }

  // Cluster nearby levels (within 1.5% of each other)
  function clusterLevels(levels) {
    if (!levels.length) return [];
    const sorted = [...levels].sort((a, b) => a - b);
    const clusters = [];
    let cluster = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const avg = cluster.reduce((a, b) => a + b, 0) / cluster.length;
      if (Math.abs(sorted[i] - avg) / avg < 0.015) {
        cluster.push(sorted[i]);
      } else {
        clusters.push({ price: +(cluster.reduce((a, b) => a + b, 0) / cluster.length).toFixed(2), touches: cluster.length });
        cluster = [sorted[i]];
      }
    }
    clusters.push({ price: +(cluster.reduce((a, b) => a + b, 0) / cluster.length).toFixed(2), touches: cluster.length });
    return clusters.sort((a, b) => b.touches - a.touches);
  }

  const resistanceLevels = clusterLevels(swingHighs)
    .filter(l => l.price > currentPrice)
    .sort((a, b) => a.price - b.price)
    .slice(0, 3);

  const supportLevels = clusterLevels(swingLows)
    .filter(l => l.price < currentPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3);

  // Also add key moving average levels as dynamic support/resistance
  const closes = bars.map(b => b.c);
  const sma50 = calcSMA(closes, 50);
  const sma200 = calcSMA(closes, 200);

  const keyMAs = [];
  if (sma50) keyMAs.push({ level: sma50, name: '50-day MA', type: currentPrice > sma50 ? 'support' : 'resistance' });
  if (sma200) keyMAs.push({ level: sma200, name: '200-day MA', type: currentPrice > sma200 ? 'support' : 'resistance' });

  // ATR (Average True Range) — volatility-based stop loss levels
  const atr14 = calcATR(bars, 14);
  const atrStops = {};
  if (atr14) {
    atrStops.atr_14 = +atr14.toFixed(2);
    atrStops.atr_pct_of_price = +((atr14 / currentPrice) * 100).toFixed(2);
    // Common ATR-based stop levels
    atrStops.tight_stop = +(currentPrice - 1.5 * atr14).toFixed(2);   // 1.5x ATR — tight, may get stopped on noise
    atrStops.normal_stop = +(currentPrice - 2 * atr14).toFixed(2);     // 2x ATR — standard for swing trades
    atrStops.wide_stop = +(currentPrice - 3 * atr14).toFixed(2);       // 3x ATR — gives room for volatile stocks
    atrStops.note = 'ATR-based stops account for normal price volatility. 2x ATR is standard for most swing trades.';
  }

  return {
    ticker,
    current_price: +currentPrice.toFixed(2),
    support_levels: supportLevels.map(l => ({
      price: l.price,
      strength: l.touches >= 3 ? 'strong' : l.touches >= 2 ? 'moderate' : 'weak',
      distance_pct: +((currentPrice - l.price) / currentPrice * 100).toFixed(1),
    })),
    resistance_levels: resistanceLevels.map(l => ({
      price: l.price,
      strength: l.touches >= 3 ? 'strong' : l.touches >= 2 ? 'moderate' : 'weak',
      distance_pct: +((l.price - currentPrice) / currentPrice * 100).toFixed(1),
    })),
    key_moving_averages: keyMAs,
    atr_stop_levels: atrStops,
    nearest_support: supportLevels[0]?.price || null,
    nearest_resistance: resistanceLevels[0]?.price || null,
  };
}

// ============ EARNINGS CALENDAR ============

// Compare two YYYY-MM-DD strings as days-from-today. "Today" is EASTERN TIME
// because earnings dates from Finnhub refer to the ET trading day — using UTC
// would misclassify earnings dated "today in ET" during the 8pm-midnight ET
// window when UTC has already rolled to tomorrow.
function daysFromToday(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const today = etTodayStr();
  const a = Date.parse(today + 'T00:00:00Z');
  const b = Date.parse(dateStr + 'T00:00:00Z');
  if (!Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

async function getUpcomingEarnings({ tickers = [] }) {
  // ⚠️ Earnings feature disabled (2026-04-15) — free-tier data sources are
  // unreliable for forward earnings dates. Return an explicit "unavailable"
  // result instead of an empty list so Claude doesn't confidently tell users
  // "no earnings upcoming" when we just don't have the data.
  return {
    error: 'earnings_data_unavailable',
    message: 'Upcoming earnings dates are temporarily unavailable — our data provider does not reliably serve forward earnings on our current tier. Do NOT claim there are no upcoming earnings; instead tell the user this data is currently offline and they should check a source like earningswhispers.com directly.',
    tickers_checked: tickers.length,
  };
  // eslint-disable-next-line no-unreachable
  try {
    // If specific tickers provided, check each one via the bulk Finnhub fetch
    if (tickers.length > 0) {
      const upper = tickers.slice(0, 10).map(t => t.toUpperCase().trim());
      const map = await getEarningsForTickers(upper);
      const earnings = upper.map(t => ({ ticker: t, ...(map[t] || {}) })).filter(e => e.date);

      const reporting_soon = earnings.filter(e => {
        if (!e.upcoming) return false;
        const d = daysFromToday(e.date);
        return d != null && d >= 0 && d <= 14;
      });

      return {
        tickers_checked: tickers.length,
        reporting_within_2_weeks: reporting_soon.map(e => ({
          ticker: e.ticker,
          date: e.date,
          time: e.time === 'bmo' ? 'Before market open' : e.time === 'amc' ? 'After market close' : 'TBD',
          days_away: daysFromToday(e.date),
          eps_estimate: e.epsEstimate,
        })),
        all_earnings: earnings.map(e => ({
          ticker: e.ticker,
          date: e.date,
          upcoming: !!e.upcoming,
          eps_surprise: e.epsSurprise ?? null,
        })),
        warning: reporting_soon.length > 0
          ? `${reporting_soon.length} stock(s) reporting earnings soon — consider position sizing and stop losses.`
          : 'No imminent earnings reports for these tickers.',
      };
    }

    // Broad calendar — pull next 14 days from Finnhub (cached). Anchor the
    // range to ET "today" so it matches the badge/agent comparison logic.
    const fromStr = etTodayStr();
    const toStr = new Date(Date.parse(fromStr + 'T00:00:00Z') + 14 * 86400000).toISOString().split('T')[0];
    const calendar = await getEarningsCalendar(fromStr, toStr);

    const majorEarnings = (calendar || [])
      .filter(e => e.ticker && e.date)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 30)
      .map(e => ({
        ticker: e.ticker,
        date: e.date,
        time: e.hour === 'bmo' ? 'Before open' : e.hour === 'amc' ? 'After close' : 'TBD',
        eps_estimate: e.epsEstimate,
        revenue_estimate: e.revenueEstimate,
      }));

    return {
      period: `${fromStr} to ${toStr}`,
      count: majorEarnings.length,
      earnings: majorEarnings,
      note: 'Earnings can cause 5-15% moves. Avoid entering new positions right before earnings unless you have strong conviction.',
    };
  } catch (err) {
    return { error: `Earnings calendar failed: ${err.message}` };
  }
}

// ============ PORTFOLIO RISK ANALYSIS ============

async function analyzePortfolioRisk({ tickers }) {
  if (!Array.isArray(tickers) || tickers.length < 2) return { error: 'Need at least 2 tickers to analyze' };
  tickers = tickers.map(t => t.toUpperCase().trim()).slice(0, 10);

  const today = new Date();
  const from = new Date(today);
  from.setMonth(from.getMonth() - 6);
  const fromStr = from.toISOString().split('T')[0];
  const toStr = today.toISOString().split('T')[0];

  // Fetch 6 months of daily data for all tickers + SPY as market proxy
  const allTickers = [...new Set([...tickers, 'SPY'])];
  const priceData = {};

  const results = await Promise.allSettled(
    allTickers.map(async (ticker) => {
      const data = await polyFetch(
        `/v2/aggs/ticker/${ticker}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=200`,
        10 * 60000,
        `risk_${ticker}`
      );
      const bars = data?.results ?? [];
      if (bars.length < 20) return null;
      // Calculate daily returns
      const returns = [];
      for (let i = 1; i < bars.length; i++) {
        returns.push((bars[i].c - bars[i - 1].c) / bars[i - 1].c);
      }
      return { ticker, returns, lastPrice: bars[bars.length - 1].c };
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      priceData[r.value.ticker] = r.value;
    }
  }

  if (!priceData['SPY']) return { error: 'Could not fetch market data for comparison' };
  const spyReturns = priceData['SPY'].returns;

  // Calculate correlation between each pair and beta vs SPY
  function correlation(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 10) return null;
    const aSlice = a.slice(-n), bSlice = b.slice(-n);
    const avgA = aSlice.reduce((s, v) => s + v, 0) / n;
    const avgB = bSlice.reduce((s, v) => s + v, 0) / n;
    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
      const da = aSlice[i] - avgA, db = bSlice[i] - avgB;
      num += da * db;
      denA += da * da;
      denB += db * db;
    }
    const den = Math.sqrt(denA * denB);
    return den === 0 ? 0 : +(num / den).toFixed(2);
  }

  function beta(stockReturns, marketReturns) {
    const n = Math.min(stockReturns.length, marketReturns.length);
    if (n < 10) return null;
    const sr = stockReturns.slice(-n), mr = marketReturns.slice(-n);
    const avgS = sr.reduce((s, v) => s + v, 0) / n;
    const avgM = mr.reduce((s, v) => s + v, 0) / n;
    let cov = 0, varM = 0;
    for (let i = 0; i < n; i++) {
      cov += (sr[i] - avgS) * (mr[i] - avgM);
      varM += (mr[i] - avgM) ** 2;
    }
    return varM === 0 ? 1 : +(cov / varM).toFixed(2);
  }

  // Build per-stock analysis
  const portfolioTickers = tickers.filter(t => priceData[t]);
  const stockAnalysis = portfolioTickers.map(t => ({
    ticker: t,
    beta_vs_spy: beta(priceData[t].returns, spyReturns),
    correlation_with_spy: correlation(priceData[t].returns, spyReturns),
  }));

  // Find highly correlated pairs
  const correlationPairs = [];
  for (let i = 0; i < portfolioTickers.length; i++) {
    for (let j = i + 1; j < portfolioTickers.length; j++) {
      const a = portfolioTickers[i], b = portfolioTickers[j];
      if (priceData[a] && priceData[b]) {
        const corr = correlation(priceData[a].returns, priceData[b].returns);
        if (corr !== null) {
          correlationPairs.push({ pair: `${a}/${b}`, correlation: corr });
        }
      }
    }
  }
  correlationPairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  // Portfolio-level beta (average)
  const avgBeta = stockAnalysis.length > 0
    ? +(stockAnalysis.reduce((s, st) => s + (st.beta_vs_spy || 1), 0) / stockAnalysis.length).toFixed(2)
    : 1;

  // Diversification score (1-10, based on average pairwise correlation)
  const avgCorr = correlationPairs.length > 0
    ? correlationPairs.reduce((s, p) => s + Math.abs(p.correlation), 0) / correlationPairs.length
    : 0.5;
  const diversificationScore = Math.max(1, Math.min(10, Math.round((1 - avgCorr) * 10)));

  // High correlation warning
  const highCorrelation = correlationPairs.filter(p => p.correlation > 0.7);

  // Risk interpretation
  let riskAssessment;
  if (avgBeta > 1.5) riskAssessment = 'HIGH RISK — portfolio moves 50%+ more than the market. A 10% market drop could mean 15%+ portfolio loss.';
  else if (avgBeta > 1.1) riskAssessment = 'ABOVE AVERAGE RISK — portfolio is more volatile than the market.';
  else if (avgBeta > 0.8) riskAssessment = 'MODERATE RISK — portfolio roughly tracks the market.';
  else riskAssessment = 'LOWER RISK — portfolio is less volatile than the overall market.';

  return {
    tickers_analyzed: portfolioTickers,
    portfolio_beta: avgBeta,
    diversification_score: `${diversificationScore}/10`,
    risk_assessment: riskAssessment,
    stock_betas: stockAnalysis,
    highest_correlations: highCorrelation.length > 0
      ? highCorrelation.slice(0, 5).map(p => `${p.pair}: ${p.correlation} (move together ${Math.round(p.correlation * 100)}% of the time)`)
      : ['No highly correlated pairs — good diversification'],
    all_correlations: correlationPairs.slice(0, 10),
    suggestion: highCorrelation.length > 2
      ? 'Several positions are highly correlated — consider adding exposure to uncorrelated sectors (energy, utilities, healthcare) to reduce risk.'
      : diversificationScore >= 7
      ? 'Portfolio is well-diversified. Keep it up.'
      : 'Consider spreading across more sectors to improve diversification.',
  };
}

// calculatePositionSize and calculateRiskReward moved to ./tradeMath.js
// (imported above) so the trade-advice math can be unit-tested in isolation.

// ============ RELATIVE STRENGTH ============

// Map tickers to their sector ETF for comparison
const SECTOR_MAP = {
  // Tech
  AAPL: 'XLK', MSFT: 'XLK', GOOGL: 'XLK', NVDA: 'XLK', AVGO: 'XLK', ORCL: 'XLK', CRM: 'XLK',
  AMD: 'XLK', INTC: 'XLK', ADBE: 'XLK', CSCO: 'XLK', QCOM: 'XLK', TXN: 'XLK', AMAT: 'XLK',
  MU: 'XLK', LRCX: 'XLK', SNPS: 'XLK', CDNS: 'XLK', KLAC: 'XLK', MRVL: 'XLK', ON: 'XLK',
  SMCI: 'XLK', ARM: 'XLK', PLTR: 'XLK', NOW: 'XLK', SNOW: 'XLK', DDOG: 'XLK', NET: 'XLK',
  PANW: 'XLK', ZS: 'XLK', FTNT: 'XLK', CRWD: 'XLK', MDB: 'XLK', HUBS: 'XLK',
  // Communication Services
  META: 'XLC', NFLX: 'XLC', DIS: 'XLC', SNAP: 'XLC', PINS: 'XLC', ROKU: 'XLC', TTD: 'XLC',
  // Financials
  JPM: 'XLF', BAC: 'XLF', WFC: 'XLF', GS: 'XLF', MS: 'XLF', C: 'XLF', BLK: 'XLF',
  SCHW: 'XLF', AXP: 'XLF', V: 'XLF', MA: 'XLF', ICE: 'XLF', CME: 'XLF', SPGI: 'XLF',
  COIN: 'XLF', HOOD: 'XLF', SOFI: 'XLF',
  // Healthcare
  UNH: 'XLV', JNJ: 'XLV', PFE: 'XLV', ABBV: 'XLV', MRK: 'XLV', LLY: 'XLV', TMO: 'XLV',
  ABT: 'XLV', BMY: 'XLV', AMGN: 'XLV', GILD: 'XLV', ISRG: 'XLV', VRTX: 'XLV', REGN: 'XLV',
  MRNA: 'XLV', DXCM: 'XLV', BSX: 'XLV', HCA: 'XLV', CI: 'XLV', ELV: 'XLV',
  // Consumer Discretionary
  AMZN: 'XLY', TSLA: 'XLY', HD: 'XLY', NKE: 'XLY', SBUX: 'XLY', MCD: 'XLY', ABNB: 'XLY',
  BKNG: 'XLY', CMG: 'XLY', TGT: 'XLY', LOW: 'XLY', LULU: 'XLY', DECK: 'XLY', ROST: 'XLY',
  TJX: 'XLY', ONON: 'XLY', CAVA: 'XLY',
  // Consumer Staples
  WMT: 'XLP', COST: 'XLP', PG: 'XLP', KO: 'XLP', PEP: 'XLP', ULTA: 'XLP',
  // Energy
  XOM: 'XLE', CVX: 'XLE', COP: 'XLE', EOG: 'XLE', SLB: 'XLE', FANG: 'XLE', OKE: 'XLE', WMB: 'XLE',
  // Industrials
  BA: 'XLI', CAT: 'XLI', DE: 'XLI', UNP: 'XLI', HON: 'XLI', GE: 'XLI', RTX: 'XLI',
  LMT: 'XLI', FDX: 'XLI', UPS: 'XLI', AXON: 'XLI', ETN: 'XLI', PWR: 'XLI',
  // Materials
  FCX: 'XLB', NEM: 'XLB', APD: 'XLB', LIN: 'XLB', SHW: 'XLB',
  // Utilities
  NEE: 'XLU', SO: 'XLU', DUK: 'XLU',
  // Real Estate
  AMT: 'XLRE', PLD: 'XLRE', CCI: 'XLRE', O: 'XLRE',
};

async function getRelativeStrength({ ticker }) {
  if (!ticker) return { error: 'No ticker provided' };
  ticker = ticker.toUpperCase().trim();

  const sectorETF = SECTOR_MAP[ticker] || null;
  const compareTickers = [ticker, 'SPY'];
  if (sectorETF) compareTickers.push(sectorETF);

  const today = new Date();
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const fromStr = threeMonthsAgo.toISOString().split('T')[0];
  const toStr = today.toISOString().split('T')[0];

  // Fetch all price data in parallel
  const priceResults = await Promise.allSettled(
    compareTickers.map(async (t) => {
      const data = await polyFetch(
        `/v2/aggs/ticker/${t}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=100`,
        10 * 60000,
        `rs_${t}`
      );
      return { ticker: t, bars: data?.results ?? [] };
    })
  );

  const priceData = {};
  for (const r of priceResults) {
    if (r.status === 'fulfilled' && r.value.bars.length >= 5) {
      priceData[r.value.ticker] = r.value.bars;
    }
  }

  if (!priceData[ticker]) return { error: `No price data for ${ticker}` };
  if (!priceData['SPY']) return { error: 'Could not fetch SPY data for comparison' };

  // Calculate performance over different periods
  function calcPerf(bars, days) {
    if (bars.length < days) return null;
    const recent = bars.slice(-days);
    const start = recent[0].c;
    const end = recent[recent.length - 1].c;
    return +((end - start) / start * 100).toFixed(2);
  }

  const periods = [
    { label: '1_week', days: 5 },
    { label: '1_month', days: 21 },
    { label: '3_month', days: 63 },
  ];

  const stockPerf = {};
  const spyPerf = {};
  const sectorPerf = {};

  for (const { label, days } of periods) {
    stockPerf[label] = calcPerf(priceData[ticker], days);
    spyPerf[label] = calcPerf(priceData['SPY'], days);
    if (sectorETF && priceData[sectorETF]) {
      sectorPerf[label] = calcPerf(priceData[sectorETF], days);
    }
  }

  // Calculate relative strength scores (stock perf minus benchmark perf)
  const vsMarket = {};
  const vsSector = {};
  for (const { label } of periods) {
    if (stockPerf[label] != null && spyPerf[label] != null) {
      vsMarket[label] = +(stockPerf[label] - spyPerf[label]).toFixed(2);
    }
    if (stockPerf[label] != null && sectorPerf[label] != null) {
      vsSector[label] = +(stockPerf[label] - sectorPerf[label]).toFixed(2);
    }
  }

  // Overall signal
  const monthVsMarket = vsMarket['1_month'] ?? 0;
  const monthVsSector = vsSector['1_month'] ?? 0;

  let signal;
  if (monthVsMarket > 5 && monthVsSector > 3) signal = 'Strong outperformer — beating both market and sector significantly';
  else if (monthVsMarket > 2) signal = 'Outperforming the market — showing relative strength';
  else if (monthVsMarket > -2) signal = 'Tracking the market — no strong edge either way';
  else if (monthVsMarket > -5) signal = 'Underperforming the market — relative weakness';
  else signal = 'Significant underperformer — lagging both market and sector';

  const SECTOR_NAMES = {
    XLK: 'Technology', XLV: 'Healthcare', XLF: 'Financials', XLE: 'Energy',
    XLI: 'Industrials', XLP: 'Consumer Staples', XLY: 'Consumer Discretionary',
    XLU: 'Utilities', XLB: 'Materials', XLRE: 'Real Estate', XLC: 'Communication Services',
  };

  return {
    ticker,
    sector: sectorETF ? SECTOR_NAMES[sectorETF] || sectorETF : 'Unknown',
    sector_etf: sectorETF,
    stock_performance: stockPerf,
    spy_performance: spyPerf,
    sector_performance: sectorETF ? sectorPerf : 'No sector mapping',
    vs_market: vsMarket,
    vs_sector: Object.keys(vsSector).length > 0 ? vsSector : 'No sector mapping',
    signal,
    interpretation: `Over the past month, ${ticker} is ${stockPerf['1_month'] > 0 ? 'up' : 'down'} ${Math.abs(stockPerf['1_month'] || 0)}% vs SPY ${spyPerf['1_month'] > 0 ? 'up' : 'down'} ${Math.abs(spyPerf['1_month'] || 0)}%${sectorETF && sectorPerf['1_month'] != null ? ` and ${SECTOR_NAMES[sectorETF] || sectorETF} sector ${sectorPerf['1_month'] > 0 ? 'up' : 'down'} ${Math.abs(sectorPerf['1_month'])}%` : ''}.`,
  };
}

// ============ PRE-TRADE SANITY CHECK ============

/**
 * Pre-trade check — catches concentration, sector overlap, and sizing issues
 * BEFORE the user pulls the trigger. Returns a structured verdict so the
 * agent can surface concrete warnings instead of generic advice.
 */
async function preTradeCheck({ ticker, dollars_to_invest, stop_loss, userId }) {
  if (!ticker || typeof ticker !== 'string') return { error: 'No ticker provided' };
  if (!Number.isFinite(dollars_to_invest) || dollars_to_invest <= 0) {
    return { error: 'Invalid dollar amount' };
  }
  ticker = ticker.toUpperCase().trim();
  const dollars = dollars_to_invest;

  // Pull the user's current positions + profile so we can reason about
  // concentration, sector overlap, and risk tolerance. Sector is derived
  // from SECTOR_MAP since the positions table doesn't store it natively.
  const [posResult, profileResult] = await Promise.allSettled([
    supabase.from('positions').select('ticker,shares,avg_cost').eq('user_id', userId),
    supabase.from('user_profiles').select('risk_tolerance,trading_style').eq('id', userId).maybeSingle(),
  ]);

  const positions = posResult.status === 'fulfilled' ? (posResult.value.data ?? []) : [];
  const profile = profileResult.status === 'fulfilled' ? (profileResult.value.data ?? {}) : {};
  const riskTolerance = (profile.risk_tolerance || 'moderate').toLowerCase();

  // Portfolio value from live prices (fall back to avg_cost for stale tickers)
  let portfolioValue = 0;
  const sectorCounts = {};
  const sectorValues = {};
  let existingPosition = null;

  for (const p of positions) {
    const live = getPrice(p.ticker)?.price ?? p.avg_cost ?? 0;
    const value = live * (p.shares ?? 0);
    portfolioValue += value;

    const sector = SECTOR_MAP[p.ticker] || 'Unknown';
    sectorCounts[sector] = (sectorCounts[sector] || 0) + 1;
    sectorValues[sector] = (sectorValues[sector] || 0) + value;

    if (p.ticker === ticker) existingPosition = { shares: p.shares, avgCost: p.avg_cost, currentValue: value };
  }

  // The new trade's sector and live price; the verdict reasoning itself lives in
  // assessPreTradeRisk (pure + unit-tested) so this function only gathers state.
  const tickerSector = SECTOR_MAP[ticker] || 'Unknown';
  const currentPrice = getPrice(ticker)?.price ?? null;

  const risk = assessPreTradeRisk({
    ticker,
    dollars,
    tickerSector,
    portfolioValue,
    sectorCounts,
    sectorValues,
    existingPosition,
    currentPrice,
    stopLoss: stop_loss,
    riskTolerance,
  });

  // Decision-intelligence base rates (how this KIND of trade tends to work out
  // for retail and for this user, plus the per-ticker retail-trap stats) are
  // COMPILED, FOUNDER-ONLY data. We are still collecting it and the samples are
  // tiny, so it must NOT surface in a user-facing answer yet. Gated OFF by
  // default; flip config.surfaceRetailIntel on to add it back slowly once the
  // data is concrete. The risk check above (concentration, sector, sizing) uses
  // only the user's own current book, so it always runs.
  if (config.surfaceRetailIntel) {
    try {
      const intel = await getCachedIntelligence();
      const todayChg = getPrice(ticker)?.changePercent;
      const resultingPct = (portfolioValue + dollars) > 0 ? (dollars / (portfolioValue + dollars)) * 100 : 0;
      const personal = setupBaseRates(await getUserDecisions(userId, { limit: 500 }));
      const guidance = baseRateGuidance(
        { ticker, chasing: Number.isFinite(todayChg) && todayChg >= 10, oversized: resultingPct > 35 },
        { population: intel?.baseRates, personal, retailTraps: intel?.retailTraps },
      );
      if (guidance.facts.length || guidance.verdict !== 'ok') return { ...risk, baseRates: guidance };
    } catch { /* base rates are additive; never break the check */ }
  }

  return risk;
}

// ============ CLOSED TRADE REFLECTION LOOKUP ============

/**
 * Pulls the user's closed_trades for a given ticker plus any reflection
 * they captured at close time. Lets the agent reference actual past lessons.
 */
async function getClosedTradeReflection({ ticker, userId }) {
  if (!ticker || typeof ticker !== 'string') return { error: 'No ticker provided' };
  ticker = ticker.toUpperCase().trim();

  const { data, error } = await supabase
    .from('closed_trades')
    .select('ticker, shares, avg_cost, sell_price, pnl, pnl_percent, entry_thesis, trade_notes, exit_reflection, exit_outcome, opened_at, closed_at, hold_days')
    .eq('user_id', userId)
    .eq('ticker', ticker)
    .order('closed_at', { ascending: false })
    .limit(5);

  if (error) return { error: `Failed to load closed trades: ${error.message}` };
  if (!data?.length) {
    return {
      ticker,
      prior_trades: 0,
      message: `No prior closed trades for ${ticker} in this user's history — nothing to reference from their own experience.`,
    };
  }

  // Wrap user-authored fields (entry_thesis, exit_reflection, trade_notes) in
  // <user_quoted> tags before returning to the agent loop. These come from the
  // user's own past inputs — could contain prompt-injection payloads planted
  // weeks ago. The agent's system prompt treats user_quoted as data.
  const wrap = (text, max = 600) => {
    if (!text) return null;
    const clean = String(text).slice(0, max).replace(/<\/?user_quoted>/gi, '');
    return `<user_quoted>${clean}</user_quoted>`;
  };
  const trades = data.map(t => ({
    opened: t.opened_at?.slice(0, 10) ?? null,
    closed: t.closed_at?.slice(0, 10) ?? null,
    hold_days: t.hold_days,
    avg_cost: t.avg_cost,
    sell_price: t.sell_price,
    pnl: t.pnl,
    pnl_percent: t.pnl_percent,
    entry_thesis: wrap(t.entry_thesis),
    exit_reflection: wrap(t.exit_reflection),
    exit_outcome: t.exit_outcome || null, // 'win_thesis_right' | 'win_thesis_wrong' | 'loss_thesis_right' | 'loss_thesis_wrong'
    trade_notes: wrap(t.trade_notes),
  }));

  // Build a short summary signal for the agent to reference
  const wins = trades.filter(t => (t.pnl ?? 0) > 0).length;
  const losses = trades.length - wins;
  const thesisRightWins = trades.filter(t => t.exit_outcome === 'win_thesis_right').length;
  const thesisWrongWins = trades.filter(t => t.exit_outcome === 'win_thesis_wrong').length;
  const thesisRightLosses = trades.filter(t => t.exit_outcome === 'loss_thesis_right').length;
  const thesisWrongLosses = trades.filter(t => t.exit_outcome === 'loss_thesis_wrong').length;

  return {
    ticker,
    prior_trades: trades.length,
    wins,
    losses,
    thesis_right_wins: thesisRightWins,
    thesis_wrong_wins: thesisWrongWins,
    thesis_right_losses: thesisRightLosses,
    thesis_wrong_losses: thesisWrongLosses,
    trades,
    guidance: 'Reference the user\'s own entry_thesis and exit_reflection when discussing this ticker. If their past exits had thesis_wrong outcomes (sold on fear that was unfounded, or held a broken thesis too long), mention it specifically. Do not lecture — just surface the pattern so they can decide if this time is different.',
  };
}
