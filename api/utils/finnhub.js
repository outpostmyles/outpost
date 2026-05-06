/**
 * Finnhub API integration — breaking market news and ticker news.
 * Free tier: 60 calls/minute. We use ~10-15 calls/hour.
 */
import { config } from '../config.js';
import { memGet, memSet } from '../services/memoryCache.js';
import { todayStr as etTodayStr } from './marketHours.js';

const BASE = 'https://finnhub.io/api/v1';
const KEY = config.finnhubKey;

// Track endpoints that are returning 403 (free-tier restriction) so we stop
// hammering them. Keyed by the first path segment (e.g. "/stock/upgrade-downgrade").
const deadEndpoints = new Set();
// Track rate-limit backoff — if we get 429'd, pause ALL calls for a minute.
let rateLimitedUntil = 0;

function endpointKey(path) {
  // Strip query params and extract base endpoint
  const base = path.split('?')[0];
  return base;
}

async function finnhubCall(path, ttlMs = 5 * 60000, cacheKey = null) {
  if (!KEY) return null; // Graceful fallback if no key

  const epKey = endpointKey(path);
  if (deadEndpoints.has(epKey)) return null; // endpoint 403'd earlier this session
  if (Date.now() < rateLimitedUntil) return null; // backing off from a 429

  if (cacheKey) {
    const cached = memGet(`fh_${cacheKey}`);
    if (cached) return cached;
  }

  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}token=${KEY}`;
  // 15s timeout — without this, a hung Finnhub response cascades into hung callers
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.status === 403) {
      // Premium endpoint — mark dead so we don't retry this session
      if (!deadEndpoints.has(epKey)) {
        console.warn(`[Finnhub] 403 on ${epKey} — marking endpoint unavailable (likely premium-only)`);
        deadEndpoints.add(epKey);
      }
      return null;
    }
    if (res.status === 429) {
      rateLimitedUntil = Date.now() + 60000; // 1-minute backoff
      console.warn(`[Finnhub] 429 rate limit hit — backing off all calls for 60s`);
      return null;
    }
    if (!res.ok) {
      console.warn(`[Finnhub] ${res.status}: ${path}`);
      return null;
    }
    const data = await res.json();
    if (cacheKey) memSet(`fh_${cacheKey}`, data, ttlMs);
    return data;
  } catch (err) {
    clearTimeout(timeout);
    console.warn(`[Finnhub] fetch failed: ${err.message}`);
    return null;
  }
}

/**
 * Get general market news (politics, macro, breaking events).
 * This is the fast news source — catches presidential addresses, Fed decisions, etc.
 */
export async function getBreakingNews(limit = 10) {
  try {
    const data = await finnhubCall('/news?category=general', 5 * 60000, 'breaking_news');
    if (!Array.isArray(data)) return [];
    return data.slice(0, limit).map(a => ({
      title: a.headline || '',
      summary: a.summary || '',
      source: a.source || 'Unknown',
      url: a.url || '',
      publishedAt: a.datetime ? new Date(a.datetime * 1000).toISOString() : null,
      category: a.category || 'general',
      image: a.image || null,
    }));
  } catch (err) {
    console.error('[Finnhub] Breaking news fetch failed:', err.message);
    return [];
  }
}

/**
 * Get company-specific news for a ticker.
 * Great for figuring out WHY a stock is buzzing.
 */
export async function getTickerNews(ticker, daysBack = 3) {
  try {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];
    const data = await finnhubCall(
      `/company-news?symbol=${ticker}&from=${from}&to=${to}`,
      10 * 60000,
      `ticker_news_${ticker}`
    );
    if (!Array.isArray(data)) return [];
    return data.slice(0, 5).map(a => ({
      title: a.headline || '',
      summary: a.summary || '',
      source: a.source || 'Unknown',
      url: a.url || '',
      publishedAt: a.datetime ? new Date(a.datetime * 1000).toISOString() : null,
    }));
  } catch (err) {
    console.error(`[Finnhub] Ticker news failed for ${ticker}:`, err.message);
    return [];
  }
}

/**
 * ⚠️ EARNINGS DISABLED (2026-04-15)
 *
 * Finnhub's free-tier /calendar/earnings endpoint silently returns HTTP 200
 * with an empty payload (diagnostic in scripts/check-earnings.js confirmed
 * zero entries across a 90-day forward window during peak Q1 earnings
 * season — that's a paywall, not a data gap). FMP Starter's per-symbol
 * earnings endpoint is also broken (returns unfiltered global data).
 *
 * Until we upgrade to a paid tier that reliably serves forward earnings
 * dates, ALL earnings functions below short-circuit to empty results.
 * This keeps the portfolio value endpoint fast (no useless network calls),
 * prevents misleading "no earnings upcoming" claims in the agent, and
 * keeps the Portfolio tab's earnings badge from rendering.
 *
 * To re-enable: remove the early-return in each function. The filtering
 * logic below still works — it's just the data source that's unreliable.
 */
export async function getEarningsCalendar(fromDate = null, toDate = null) {
  return []; // disabled — see note above
}

// ---------- Per-portfolio earnings lookups (replaces broken FMP path) ----------
//
// Strategy: piggyback on the globally-cached getEarningsCalendar() above so we
// pay for ONE Finnhub call per 30 minutes for the entire user base instead of
// per-ticker per-user. Filtering happens in memory after the cached fetch.
//
// Shape returned matches the legacy FMP getEarningsDate() so consumers don't
// need to change. Each upcoming entry:
//   { ticker, date, time: 'bmo'|'amc'|null, upcoming: true, epsEstimate, revenueEstimate }
// Each past entry:
//   { ticker, date, time, upcoming: false, epsActual, epsEstimate, epsSurprise, revenueActual }

const FORWARD_DAYS = 90;  // look out 90d for upcoming earnings (covers full quarter cycle)
const BACKWARD_DAYS = 100; // look back ~quarter for last reported earnings

function mapHourToTime(hour) {
  // Finnhub uses 'bmo'/'amc'/'dmh'. Existing UI expects 'bmo' or 'amc' (or empty).
  if (hour === 'bmo' || hour === 'amc') return hour;
  return null;
}

// "Today" is always EASTERN TIME for earnings comparisons. Finnhub dates
// refer to the trading day in ET — if we used UTC we'd misclassify any
// earnings dated "today in ET" as past/future during the 4-hour window
// after 8pm ET when UTC has already rolled to tomorrow.
function todayISO() {
  return etTodayStr();
}

function offsetISO(days) {
  // Anchor the offset to ET "today" so range queries don't shift across the
  // UTC midnight boundary differently than the badge's "today" comparison.
  const base = Date.parse(etTodayStr() + 'T00:00:00Z');
  return new Date(base + days * 86400000).toISOString().split('T')[0];
}

/**
 * Bulk fetch upcoming earnings for a list of tickers. One Finnhub call (cached
 * globally), filtered in-memory. Returns map { ticker -> earnings | undefined }.
 *
 * If a ticker has no upcoming earnings in the next FORWARD_DAYS, it falls back
 * to the most recent past earnings so the UI can still render context.
 */
export async function getEarningsForTickers(tickers) {
  return {}; // disabled — see note above getEarningsCalendar
  // eslint-disable-next-line no-unreachable
  if (!tickers?.length) return {};
  const wanted = new Set(tickers.map(t => t.toUpperCase().trim()));

  // Forward window — anything reporting in next 90 days
  const forward = await getEarningsCalendar(todayISO(), offsetISO(FORWARD_DAYS));
  // Backward window — for tickers with no upcoming, surface their last report
  const backward = await getEarningsCalendar(offsetISO(-BACKWARD_DAYS), todayISO());

  const today = todayISO();

  // Build: ticker -> earliest upcoming entry
  const upcomingByTicker = {};
  for (const e of forward) {
    if (!wanted.has(e.ticker)) continue;
    if (!e.date || e.date < today) continue;
    const existing = upcomingByTicker[e.ticker];
    if (!existing || e.date < existing.date) upcomingByTicker[e.ticker] = e;
  }

  // Build: ticker -> most recent past entry (only for tickers without upcoming)
  const pastByTicker = {};
  for (const e of backward) {
    if (!wanted.has(e.ticker)) continue;
    if (upcomingByTicker[e.ticker]) continue; // prefer upcoming
    if (!e.date || e.date >= today) continue;
    const existing = pastByTicker[e.ticker];
    if (!existing || e.date > existing.date) pastByTicker[e.ticker] = e;
  }

  // Shape into legacy-compatible objects
  const out = {};
  for (const ticker of wanted) {
    const up = upcomingByTicker[ticker];
    if (up) {
      out[ticker] = {
        ticker,
        date: up.date,
        time: mapHourToTime(up.hour),
        upcoming: true,
        epsEstimate: up.epsEstimate ?? null,
        revenueEstimate: up.revenueEstimate ?? null,
      };
      continue;
    }
    const past = pastByTicker[ticker];
    if (past) {
      const surprise = (past.epsActual != null && past.epsEstimate != null)
        ? +(past.epsActual - past.epsEstimate).toFixed(3)
        : null;
      out[ticker] = {
        ticker,
        date: past.date,
        time: mapHourToTime(past.hour),
        upcoming: false,
        epsActual: past.epsActual ?? null,
        epsEstimate: past.epsEstimate ?? null,
        epsSurprise: surprise,
        revenueActual: past.revenueActual ?? null,
      };
    }
  }
  return out;
}

/**
 * Single-ticker convenience wrapper. Reuses the globally-cached batch fetch so
 * calling this 10 times in quick succession costs zero extra API calls.
 */
export async function getEarningsForTicker(ticker) {
  return null; // disabled — see note above getEarningsCalendar
}

/**
 * Get analyst upgrades/downgrades for a ticker.
 * These are major catalysts — Goldman upgrade, etc.
 */
export async function getUpgradeDowngrade(ticker) {
  try {
    const data = await finnhubCall(
      `/stock/upgrade-downgrade?symbol=${ticker}`,
      60 * 60000, // cache 1 hour
      `upgrade_${ticker}`
    );
    if (!Array.isArray(data)) return [];
    // Only return recent ones (last 7 days)
    const weekAgo = Date.now() - 7 * 86400000;
    return data
      .filter(u => new Date(u.gradeDate).getTime() > weekAgo)
      .slice(0, 5)
      .map(u => ({
        ticker: u.symbol || ticker,
        company: u.company, // the analyst firm
        action: u.action, // 'upgrade', 'downgrade', 'init', 'reiterated'
        fromGrade: u.fromGrade,
        toGrade: u.toGrade,
        date: u.gradeDate,
      }));
  } catch (err) {
    console.error(`[Finnhub] Upgrade/downgrade failed for ${ticker}:`, err.message);
    return [];
  }
}

/**
 * Get recent analyst upgrades/downgrades across the whole market.
 * Useful for the catalyst watch to find stocks with fresh analyst action.
 */
export async function getRecentUpgrades(limit = 20) {
  try {
    // Finnhub doesn't have a "all upgrades" endpoint, so we use a workaround:
    // Check breaking news for analyst-related headlines
    const news = await getBreakingNews(30);
    const analystNews = news.filter(n => {
      const t = (n.title + ' ' + n.summary).toLowerCase();
      return t.includes('upgrade') || t.includes('downgrade') || t.includes('price target') ||
             t.includes('initiates') || t.includes('outperform') || t.includes('overweight') ||
             t.includes('buy rating') || t.includes('sell rating');
    });
    return analystNews.slice(0, limit);
  } catch (err) {
    console.error('[Finnhub] Recent upgrades scan failed:', err.message);
    return [];
  }
}

/**
 * Get analyst recommendation consensus for a ticker.
 * Finnhub returns an array of trends with buy/hold/sell counts.
 * Returns { score, total, buy, hold, sell, strongBuy, strongSell, period } where
 * score is 1-5 (5 = strong buy, 1 = strong sell), or null.
 */
export async function getAnalystRecommendation(ticker) {
  try {
    const data = await finnhubCall(
      `/stock/recommendation?symbol=${ticker}`,
      12 * 60 * 60 * 1000, // cache 12 hours — analyst data moves slowly
      `reco_${ticker}`
    );
    if (!Array.isArray(data) || data.length === 0) return null;
    // Most recent entry first
    const latest = data[0];
    const strongBuy = latest.strongBuy || 0;
    const buy = latest.buy || 0;
    const hold = latest.hold || 0;
    const sell = latest.sell || 0;
    const strongSell = latest.strongSell || 0;
    const total = strongBuy + buy + hold + sell + strongSell;
    if (total === 0) return null;
    // Weighted score 1-5
    const score = (strongBuy * 5 + buy * 4 + hold * 3 + sell * 2 + strongSell * 1) / total;
    return {
      ticker,
      score: parseFloat(score.toFixed(2)),
      total,
      strongBuy, buy, hold, sell, strongSell,
      period: latest.period || null,
    };
  } catch (err) {
    console.error(`[Finnhub] Recommendation failed for ${ticker}:`, err.message);
    return null;
  }
}

/**
 * Get analyst price target for a ticker.
 * Returns { targetMean, targetHigh, targetLow, lastUpdated, numberAnalysts } or null.
 */
export async function getPriceTarget(ticker) {
  try {
    const data = await finnhubCall(
      `/stock/price-target?symbol=${ticker}`,
      12 * 60 * 60 * 1000,
      `pt_${ticker}`
    );
    if (!data || !data.targetMean) return null;
    return {
      ticker,
      targetMean: data.targetMean,
      targetHigh: data.targetHigh,
      targetLow: data.targetLow,
      targetMedian: data.targetMedian,
      numberAnalysts: data.numberOfAnalysts,
      lastUpdated: data.lastUpdated,
    };
  } catch (err) {
    console.error(`[Finnhub] Price target failed for ${ticker}:`, err.message);
    return null;
  }
}

/**
 * Get company basic financials — market cap, PE, etc.
 * Used to filter out micro-caps and confirm stocks are above size thresholds.
 */
export async function getBasicFinancials(ticker) {
  try {
    const data = await finnhubCall(
      `/stock/metric?symbol=${ticker}&metric=all`,
      12 * 60 * 60 * 1000,
      `fin_${ticker}`
    );
    const m = data?.metric;
    if (!m) return null;
    return {
      ticker,
      marketCap: m.marketCapitalization ?? null, // in millions
      peRatio: m.peNormalizedAnnual ?? m.peBasicExclExtraTTM ?? null,
      pegRatio: m.pegRatio ?? null,
      fiftyTwoWeekHigh: m['52WeekHigh'] ?? null,
      fiftyTwoWeekLow: m['52WeekLow'] ?? null,
      dividendYield: m.dividendYieldIndicatedAnnual ?? null,
      epsGrowth5Y: m.epsGrowth5Y ?? null,
      revenueGrowth5Y: m.revenueGrowth5Y ?? null,
    };
  } catch (err) {
    console.error(`[Finnhub] Basic financials failed for ${ticker}:`, err.message);
    return null;
  }
}

/**
 * Check if Finnhub is configured and available.
 */
export function isFinnhubAvailable() {
  return !!KEY;
}
