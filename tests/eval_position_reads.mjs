/**
 * AI position-read evaluation harness.
 *
 * Runs the QUICK analysis prompt against current real market data for a list
 * of tickers + simulated positions. Prints the EXACT prompt sent and the
 * EXACT response received, so we can read them side-by-side and decide
 * whether the AI is actually being accurate and useful.
 *
 * Usage:
 *   node tests/eval_position_reads.mjs
 *
 * Costs: one Haiku call per ticker (~$0.0005 each). Default 5 tickers = ~$0.003.
 *
 * Edit SCENARIOS below to add your own tickers / position simulations. Each
 * scenario is a (ticker, sharesOwned, avgCost, optional plan) tuple — the
 * harness fetches everything else (today's price, change%, news, market data).
 */

import '../api/config.js';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../api/config.js';
import { getSnapshot, getNews } from '../api/utils/polygon.js';
import { initPricePool, getPrices } from '../api/services/pricePool.js';
import { initMarketDataService } from '../api/services/marketData.js';
import { getMarketData } from '../api/services/marketData.js';

// ===================== CONFIGURE HERE =====================
// Diverse coverage — make sure the AI handles real holdings, not just mega-cap tech.
// Edit the avgCost field on any row to simulate different P&L scenarios.
const SCENARIOS = [
  // Blue-chip with rich news coverage (control)
  { ticker: 'AAPL', shares: 50,  avgCost: 195,  label: 'AAPL — blue-chip winner with rich news' },

  // Deep drawdown — the genuine "should I worry?" case
  { ticker: 'NVDA', shares: 20,  avgCost: 720,  label: 'NVDA — deep drawdown, real damage' },

  // ETF — should be treated as basket, not single-name; "news" is mostly noise
  { ticker: 'SPY',  shares: 10,  avgCost: 580,  label: 'SPY — ETF (basket exposure)' },

  // Defensive / dividend name — low news intensity, slow mover
  { ticker: 'KO',   shares: 80,  avgCost: 60,   label: 'KO — defensive blue-chip, low drama' },

  // Energy/value name (different sector)
  { ticker: 'XOM',  shares: 40,  avgCost: 110,  label: 'XOM — energy, oil-price sensitive' },

  // Mid-cap volatile retail favorite
  { ticker: 'PLTR', shares: 200, avgCost: 18,   label: 'PLTR — mid-cap retail favorite' },

  // Recently bought — P&L near 0
  { ticker: 'GOOGL',shares: 30,  avgCost: 0,    label: 'GOOGL — just bought, P&L ~ 0% (avgCost set at runtime)' },

  // Penny / lower-coverage stock — may have no news at all
  { ticker: 'F',    shares: 500, avgCost: 12,   label: 'F — Ford, broad coverage but slow news' },

  // Tiny position
  { ticker: 'BRK.B',shares: 1,   avgCost: 410,  label: 'BRK.B — tiny single-share position' },

  // Foreign ADR — different reporting cycle, often news-light
  { ticker: 'BABA', shares: 25,  avgCost: 95,   label: 'BABA — foreign ADR' },
];
// ==========================================================

const anthropic = new Anthropic({ apiKey: config.anthropicKey });
const PLAIN_TEXT_RULE = 'CRITICAL: Respond in plain text only. No markdown, no asterisks, no bold, no italic, no headers, no bullet dashes.';

const QUICK_SYSTEM = `You write quick reads on positions for a retail investor — buy-and-hold, sells only on real damage (~20% drawdown) or macro events. Your job is to answer "should I worry?" honestly in 2-3 short sentences.

OUTPUT — exactly three sentences, plain prose, no labels, no headers, no numbered list. Just three sentences.

The three sentences in order:
- First sentence: state whether today's move is broad-market or stock-specific. Use the MARKET-RELATIVE line — if the ticker is moving with SPY, say so plainly ("moving with the broader tape"). If it's diverging, lead with why: news, sector rotation, earnings reaction.
- Second sentence: tie it to their position. If they're holding through ordinary noise, affirm that. If there's a SIGNIFICANT DRAWDOWN flag, address it honestly. If a trade plan target/stop is within 10%, mention it.
- Third sentence: what to do. "No action needed." is a valid and often correct answer. Only suggest a real action when something has actually changed.

ABSOLUTE RULES:
- Three sentences. NEVER four. NEVER two. Three.
- "No action needed" beats inventing fake action items.
- Don't restate P&L just to fill space. Reference it ONLY when it's load-bearing context — a SIGNIFICANT/MODERATE DRAWDOWN, near a round-number milestone, or genuinely necessary for the read to make sense.
- Match the magnitude of the MARKET-RELATIVE label exactly. "Slightly ahead" / "slightly behind" means small — never inflate a 1% delta into "meaningful margin" or "lagging by 130 basis points". Use the actual percentage if you cite a number.
- DO NOT INVENT DETAILS THAT AREN'T IN THE INPUT. You don't know how long the position has been held. You don't know the user's age, intent, or other holdings. You don't know prior catalysts that aren't in the headlines. If you find yourself writing "on a 2-year hold" or "after weathering X" without that being in the input — STOP and rewrite without it.
- Don't say "be cautious" without naming WHAT to be cautious of.
- Don't manufacture catalysts. If NEWS says "no recent company-specific headlines", say so plainly — don't invent reasons.
- Don't recommend SELL or TRIM on macro fear alone.
- For ETFs (SPY, QQQ, sector ETFs, etc.): treat them as basket exposure, not a single company. "News" sections are usually noise for ETFs — focus on the broader regime.
- Tone: steady friend, not active coach. Calm during noise, sharp when something is genuinely broken.
${PLAIN_TEXT_RULE}`;

function pad(s, n) { return (s + ' '.repeat(n)).slice(0, n); }
function divider() { console.log('─'.repeat(78)); }

async function buildScenario(s) {
  const [snap, news] = await Promise.all([
    getSnapshot(s.ticker).catch(() => null),
    getNews(s.ticker, 3).catch(() => []),
  ]);

  // Auto-fill avgCost when 0 — useful for "just bought" scenarios where we
  // want P&L ~ 0% regardless of where the ticker is trading today.
  const effectiveAvgCost = (s.avgCost === 0 && snap?.price) ? snap.price : s.avgCost;

  const market = getMarketData();
  const benchmarks = getPrices(['SPY', 'QQQ']);
  const spyChange = benchmarks?.SPY?.changePercent;
  const qqqChange = benchmarks?.QQQ?.changePercent;

  // P&L
  const pnlPct = snap?.price && effectiveAvgCost ? ((snap.price - effectiveAvgCost) / effectiveAvgCost) * 100 : 0;
  const pnlDollar = snap?.price ? (snap.price - effectiveAvgCost) * s.shares : 0;
  const posContext = `${s.ticker}: ${s.shares} shares @ $${effectiveAvgCost.toFixed(2)} avg, current $${snap?.price ?? 'N/A'}, P&L ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% (${pnlDollar >= 0 ? '+' : ''}$${pnlDollar.toFixed(0)})`;

  // Market relative
  let moveContext = '';
  if (typeof snap?.changePercent === 'number' && typeof spyChange === 'number') {
    const tickerMove = snap.changePercent;
    const delta = tickerMove - spyChange;
    let relative;
    if (Math.abs(delta) <= 1) relative = 'moving WITH the broad market';
    else if (delta > 2) relative = 'OUTPERFORMING the market by ' + delta.toFixed(1) + '%';
    else if (delta < -2) relative = 'UNDERPERFORMING the market by ' + Math.abs(delta).toFixed(1) + '%';
    else relative = delta > 0 ? 'slightly ahead of the market' : 'slightly behind the market';
    moveContext = `\nMARKET-RELATIVE: ${s.ticker} is ${tickerMove >= 0 ? '+' : ''}${tickerMove.toFixed(1)}% today vs SPY ${spyChange >= 0 ? '+' : ''}${spyChange.toFixed(1)}%${qqqChange != null ? ', QQQ ' + (qqqChange >= 0 ? '+' : '') + qqqChange.toFixed(1) + '%' : ''} → ${relative}.`;
  }

  // Drawdown
  let drawdownContext = '';
  if (pnlPct <= -20) drawdownContext = `\nSIGNIFICANT DRAWDOWN: this position is ${pnlPct.toFixed(0)}% below cost basis — an actual sell-trigger zone for many holders.`;
  else if (pnlPct <= -15) drawdownContext = `\nMODERATE DRAWDOWN: this position is ${pnlPct.toFixed(0)}% below cost basis — worth flagging if there's a real reason behind it.`;

  const tickerHeadlines = news.length > 0
    ? news.slice(0, 3).map(a => `${a.source}: ${a.title}`).join('\n')
    : 'No recent ticker-specific news';

  const userMsg = `Quick read on ${s.ticker}: ${posContext}${drawdownContext}
Today: ${snap?.changePercent ?? 'N/A'}% move${moveContext}
Market: ${market.regime || 'Neutral'}, VIX ${market.vix?.value ?? 'N/A'}.
${tickerHeadlines !== 'No recent ticker-specific news' ? `NEWS:\n${tickerHeadlines}` : 'NEWS: no recent company-specific headlines'}

Answer "should they worry?" — calmly when calm is correct, plainly when it's not.`;

  return { scenario: s, userMsg, snap, pnlPct };
}

async function runOne(s) {
  const built = await buildScenario(s);

  divider();
  console.log(`\x1b[1;36m▌ ${s.label}\x1b[0m`);
  console.log(`\x1b[90m  ${s.ticker} · ${s.shares} sh @ $${s.avgCost} · today ${built.snap?.changePercent != null ? (built.snap.changePercent >= 0 ? '+' : '') + built.snap.changePercent.toFixed(2) + '%' : 'N/A'} · P&L ${built.pnlPct >= 0 ? '+' : ''}${built.pnlPct.toFixed(1)}%\x1b[0m`);
  divider();

  console.log('\x1b[90m── INPUT TO CLAUDE ──\x1b[0m');
  console.log(built.userMsg);
  console.log();

  try {
    const t0 = Date.now();
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: QUICK_SYSTEM,
      messages: [{ role: 'user', content: built.userMsg }],
    });
    const ms = Date.now() - t0;
    const text = msg.content?.[0]?.text?.trim() ?? '(no output)';

    console.log('\x1b[1;32m── CLAUDE OUTPUT ──\x1b[0m');
    console.log(text);
    console.log(`\x1b[90m  (${ms}ms · ${msg.usage?.input_tokens ?? '?'} in / ${msg.usage?.output_tokens ?? '?'} out)\x1b[0m\n`);
  } catch (err) {
    console.log(`\x1b[1;31m  Claude call failed: ${err.message}\x1b[0m\n`);
  }
}

async function main() {
  console.log('\x1b[1;33m\nAI Position-Read Evaluation\x1b[0m');
  console.log('\x1b[90mUsing the same prompt + context the production /analysis endpoint uses.\x1b[0m');
  console.log('\x1b[90mEdit SCENARIOS at the top of this file to test different tickers / positions.\x1b[0m\n');

  // Boot the price pool + market data service so we have SPY/QQQ + regime data
  console.log('\x1b[90mWarming caches (market data, price pool)...\x1b[0m');
  await initMarketDataService();
  await initPricePool();
  console.log('\x1b[90mReady.\x1b[0m\n');

  for (const s of SCENARIOS) {
    await runOne(s);
  }

  divider();
  console.log('\x1b[1;33mDone.\x1b[0m Read each output above and ask:');
  console.log('  1. Is the WHAT line accurate? (broad vs stock-specific)');
  console.log('  2. Does the MEANING line earn its place? Does it manufacture an action?');
  console.log('  3. When the answer is "no action", does it say so plainly?');
  console.log('  4. When there is a real issue (drawdown, broken thesis), does it flag it sharply?\n');
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
