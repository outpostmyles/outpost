/**
 * Audit smoke tests — pure-logic verification of patches that don't need a running server.
 * Run from repo root: node tests/audit_smoke.mjs
 *
 * Covers:
 *   - isValidEmail / isStrongEnoughPassword (auth patches)
 *   - Concentration trim math (H1 patch)
 *   - Hold-days calendar diff (B3 / taxInsights patch)
 *   - sanitizeTicker / sanitizeNumber edge cases
 */

import { isValidEmail, isStrongEnoughPassword, sanitizeTicker, sanitizeNumber, sanitizeString } from '../api/middleware/validate.js';
import { analyzeTrade, computeSummary, computePatterns } from '../api/services/planAdherence.js';
import { detectSignals } from '../api/services/proactiveDigest.js';
import { bucketTrade, analyzeStyles, analyzeContribution, analyzeOpenContribution, derivePatterns } from '../api/services/performanceAttribution.js';
import { buildDailyDigestEmail, buildWeeklySummaryEmail } from '../api/services/notifications.js';
import { parseAllowList, isAdminEmail } from '../api/middleware/admin.js';
import { buildWelcomePrompt, buildWelcomeSystemPrompt, buildFallbackWelcome } from '../api/services/welcomeMoment.js';
import { bucketFor, assignVariant, getVariantById, listExperiments, aggregateFeedbackByVariant, EXPERIMENTS } from '../api/services/promptExperiments.js';

let passed = 0;
let failed = 0;
const failures = [];

function eq(name, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    console.log(`  FAIL ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function approx(name, actual, expected, tolerance = 0.01) {
  const ok = Math.abs(actual - expected) < tolerance;
  if (ok) {
    passed++;
    console.log(`  PASS ${name} (${actual.toFixed(2)} ≈ ${expected.toFixed(2)})`);
  } else {
    failed++;
    failures.push(`${name}: expected ~${expected}, got ${actual}`);
    console.log(`  FAIL ${name} — expected ~${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
  }
}

console.log('\n=== isValidEmail ===');
eq('rejects null', isValidEmail(null), false);
eq('rejects empty', isValidEmail(''), false);
eq('rejects no @', isValidEmail('notanemail'), false);
eq('rejects no TLD', isValidEmail('foo@bar'), false);
eq('rejects spaces', isValidEmail('foo @bar.com'), false);
eq('rejects > 254 chars', isValidEmail('a'.repeat(250) + '@b.co'), false);
eq('accepts simple', isValidEmail('test@example.com'), true);
eq('accepts plus', isValidEmail('test+tag@example.com'), true);
eq('accepts subdomain', isValidEmail('test@mail.example.co.uk'), true);
eq('accepts trim', isValidEmail('  test@example.com  '), true);

console.log('\n=== isStrongEnoughPassword ===');
eq('rejects null', isStrongEnoughPassword(null), false);
eq('rejects short', isStrongEnoughPassword('Pa1'), false);
eq('rejects no digit', isStrongEnoughPassword('password'), false);
eq('rejects no letter', isStrongEnoughPassword('12345678'), false);
eq('rejects all special', isStrongEnoughPassword('!!!!!!!!'), false);
eq('accepts letter+digit min', isStrongEnoughPassword('password1'), true);
eq('accepts mixed case', isStrongEnoughPassword('Password1'), true);
eq('accepts longer with special', isStrongEnoughPassword('MyP@ssw0rd'), true);

console.log('\n=== sanitizeTicker ===');
eq('null returns null', sanitizeTicker(null), null);
eq('non-string returns null', sanitizeTicker(123), null);
eq('uppercases', sanitizeTicker('aapl'), 'AAPL');
eq('strips numbers', sanitizeTicker('AAPL1'), 'AAPL');
eq('strips $ prefix', sanitizeTicker('$AAPL'), 'AAPL');
eq('rejects too long', sanitizeTicker('TOOLONG'), null);
eq('rejects empty', sanitizeTicker(''), null);
eq('rejects all-numeric', sanitizeTicker('1234'), null);

console.log('\n=== sanitizeNumber ===');
eq('parses positive', sanitizeNumber('123.45'), 123.45);
eq('rejects NaN', sanitizeNumber('abc'), null);
eq('respects min', sanitizeNumber('-5', 0, null), null);
eq('respects max', sanitizeNumber('1000000', null, 100), null);
eq('zero allowed', sanitizeNumber('0'), 0);

console.log('\n=== sanitizeString ===');
eq('truncates over max', sanitizeString('a'.repeat(100), 50).length, 50);
eq('trims whitespace', sanitizeString('  hi  '), 'hi');
eq('null returns empty', sanitizeString(null), '');

console.log('\n=== Concentration Trim Math (H1 patch) ===');
// (currentValue − targetFrac × totalValue) / (1 − targetFrac)
// Verify the post-trim ratio actually equals targetFrac
function computeTrim(currentValue, totalValue, targetPct) {
  const targetFrac = targetPct / 100;
  return Math.max(0, (currentValue - targetFrac * totalValue) / (1 - targetFrac));
}
function postTrimPct(currentValue, totalValue, trim) {
  return ((currentValue - trim) / (totalValue - trim)) * 100;
}

// Case: AAPL $30k of $100k (30%) → trim to 18%
let trim = computeTrim(30000, 100000, 18);
approx('trim($30k of $100k → 18%) = $14,634', trim, 14634.15, 1);
approx('post-trim ratio = 18%', postTrimPct(30000, 100000, trim), 18, 0.001);

// Case: NVDA $50k of $200k (25%) → trim to 18%
trim = computeTrim(50000, 200000, 18);
approx('trim($50k of $200k → 18%)', trim, 17073.17, 1);
approx('post-trim ratio = 18%', postTrimPct(50000, 200000, trim), 18, 0.001);

// Case: at exactly target — no trim needed
trim = computeTrim(18000, 100000, 18);
eq('trim at exactly 18% returns 0', trim, 0);

// Case: below target — no trim
trim = computeTrim(10000, 100000, 18);
eq('trim when below target returns 0', trim, 0);

console.log('\n=== Hold-Days Calendar Diff (B3 patch) ===');
function holdDays(startMs, endMs) {
  if (!startMs) return 0;
  const startDay = Math.floor(startMs / 86400000);
  const endDay = Math.floor(endMs / 86400000);
  return Math.max(0, endDay - startDay);
}

// Same UTC day, intraday round-trip
const start1 = Date.parse('2026-05-01T13:00:00Z'); // 1pm UTC
const end1 = Date.parse('2026-05-01T15:00:00Z');   // 3pm UTC same day
eq('same-day round trip = 0 days', holdDays(start1, end1), 0);

// Next day
const start2 = Date.parse('2026-05-01T13:00:00Z');
const end2 = Date.parse('2026-05-02T13:00:00Z');
eq('next-day = 1 day', holdDays(start2, end2), 1);

// Year over year — exactly 365 days
const start3 = Date.parse('2025-05-01T00:00:00Z');
const end3 = Date.parse('2026-05-01T00:00:00Z');
eq('1 year exact = 365 days', holdDays(start3, end3), 365);

// 1 year + 1 day — long-term threshold
const start4 = Date.parse('2025-05-01T00:00:00Z');
const end4 = Date.parse('2026-05-02T00:00:00Z');
eq('1y + 1d = 366 days', holdDays(start4, end4), 366);

// Future purchase date guard
const start5 = Date.now() + 86400000 * 10;
const end5 = Date.now();
eq('future start clamps to 0', holdDays(start5, end5), 0);

// Compare to old buggy Math.ceil approach
const oldCeil = Math.ceil((end1 - start1) / 86400000);
console.log(`  NOTE: old Math.ceil for same-day round-trip would give ${oldCeil} days (WRONG); new code gives ${holdDays(start1, end1)} (correct)`);

console.log('\n=== Plan Adherence — analyzeTrade ===');
// Trade with no plan
let r = analyzeTrade({ id: 1, ticker: 'AAPL', sell_price: 150, pnl: 100, price_target: null, stop_loss: null });
eq('no plan → category=no_plan', r.category, 'no_plan');
eq('no plan → hadPlan=false', r.hadPlan, false);

// Early exit: target=110, sold=100 with profit
r = analyzeTrade({ id: 2, ticker: 'NVDA', sell_price: 100, pnl: 50, price_target: 110, stop_loss: 90 });
eq('target=110, sold=100, profit → early_exit', r.category, 'early_exit');
approx('early exit gapPct ≈ 9.09%', r.gapPct, 9.09, 0.01);

// Held past target: target=110, sold=120
r = analyzeTrade({ id: 3, ticker: 'TSLA', sell_price: 120, pnl: 200, price_target: 110, stop_loss: 90 });
eq('target=110, sold=120 → held_past_target', r.category, 'held_past_target');
approx('overshoot gapPct ≈ 9.09%', r.gapPct, 9.09, 0.01);

// Broke stop: stop=95, sold=90
r = analyzeTrade({ id: 4, ticker: 'AMD', sell_price: 90, pnl: -100, price_target: 110, stop_loss: 95 });
eq('stop=95, sold=90 → broke_stop', r.category, 'broke_stop');
approx('breach gapPct ≈ 5.26%', r.gapPct, 5.26, 0.01);

// Honored stop: stop=95, sold exactly at 95 with loss
r = analyzeTrade({ id: 5, ticker: 'INTC', sell_price: 95, pnl: -50, price_target: null, stop_loss: 95 });
eq('stop=95, sold=95, loss → honored_stop', r.category, 'honored_stop');

// Honored stop: stop=95, sold=98 with loss (above stop)
r = analyzeTrade({ id: 6, ticker: 'F', sell_price: 98, pnl: -20, price_target: null, stop_loss: 95 });
eq('above stop with loss → honored_stop', r.category, 'honored_stop');

// Profit with no target
r = analyzeTrade({ id: 7, ticker: 'GE', sell_price: 50, pnl: 100, price_target: null, stop_loss: 40 });
eq('profit, stop only → profit_no_target', r.category, 'profit_no_target');

// Stop check happens BEFORE target check (broke stop is most actionable)
r = analyzeTrade({ id: 8, ticker: 'XYZ', sell_price: 80, pnl: -100, price_target: 120, stop_loss: 100 });
eq('below both stop and target → broke_stop wins', r.category, 'broke_stop');

console.log('\n=== Plan Adherence — computeSummary ===');
const trades = [
  analyzeTrade({ id: 1, ticker: 'A', sell_price: 100, pnl: 50, price_target: 110, stop_loss: 95 }),  // early_exit
  analyzeTrade({ id: 2, ticker: 'B', sell_price: 100, pnl: 50, price_target: 110, stop_loss: 95 }),  // early_exit
  analyzeTrade({ id: 3, ticker: 'C', sell_price: 120, pnl: 200, price_target: 110, stop_loss: 95 }), // held_past_target
  analyzeTrade({ id: 4, ticker: 'D', sell_price: 90, pnl: -50, price_target: 110, stop_loss: 95 }),  // broke_stop
  analyzeTrade({ id: 5, ticker: 'E', sell_price: 95, pnl: -25, price_target: null, stop_loss: 95 }), // honored_stop
];
const summary = computeSummary(trades, 5);
eq('totalTrades = 5', summary.totalTrades, 5);
eq('tradesWithPlan = 5', summary.tradesWithPlan, 5);
eq('earlyExitCount = 2', summary.earlyExitCount, 2);
eq('heldPastCount = 1', summary.heldPastCount, 1);
eq('stopBreachCount = 1', summary.stopBreachCount, 1);
eq('honoredStopCount = 1', summary.honoredStopCount, 1);

// Win-rate split:
//   Honored = held_past_target (win) + honored_stop (loss) → 1/2 = 50%
//   Violated = early_exit ×2 (both win) + broke_stop (loss) → 2/3 = 66.67%
approx('honoredWinRate = 50', summary.honoredWinRate, 50, 0.1);
approx('violatedWinRate ≈ 66.67', summary.violatedWinRate, 66.67, 0.1);

console.log('\n=== Plan Adherence — computePatterns ===');
const patterns = computePatterns(summary, trades);
const keys = patterns.map(p => p.key);
eq('surfaces early_exits pattern', keys.includes('early_exits'), true);
eq('surfaces held_past pattern (heldPastCount=1, threshold ≥2 → no)', keys.includes('held_past'), false);
eq('returns ≤ 3 patterns', patterns.length <= 3, true);

// Empty / single-trade — no patterns until 3+
const singleTrade = [analyzeTrade({ id: 1, ticker: 'A', sell_price: 100, pnl: 50, price_target: 110, stop_loss: 95 })];
const sumSingle = computeSummary(singleTrade, 1);
eq('1 trade → no patterns surfaced (below MIN)', computePatterns(sumSingle, singleTrade).length, 0);

console.log('\n=== Proactive Digest — detectSignals ===');

// Empty input
let sigs = detectSignals({ positions: [], watchlist: [], adherenceSummary: '' });
eq('empty input → empty signals', sigs.length, 0);

// Big mover (5%) — medium priority
sigs = detectSignals({
  positions: [{ ticker: 'AAPL', currentPrice: 150, currentValue: 1500, todayChangePercent: 6, shares: 10 }],
});
eq('big mover (6%) detected', sigs.find(s => s.kind === 'big_mover')?.priority, 'medium');

// Big mover (12%) — high priority
sigs = detectSignals({
  positions: [{ ticker: 'NVDA', currentPrice: 500, currentValue: 5000, todayChangePercent: 12, shares: 10 }],
});
eq('big mover (12%) → high priority', sigs.find(s => s.kind === 'big_mover')?.priority, 'high');

// Past target
sigs = detectSignals({
  positions: [{ ticker: 'TSLA', currentPrice: 250, currentValue: 2500, todayChangePercent: 1, price_target: 200, shares: 10 }],
});
eq('past target detected', sigs.some(s => s.kind === 'position_past_target'), true);
eq('past target → high priority', sigs.find(s => s.kind === 'position_past_target')?.priority, 'high');

// Near target (5% away)
sigs = detectSignals({
  positions: [{ ticker: 'TSLA', currentPrice: 95, currentValue: 950, todayChangePercent: 1, price_target: 100, shares: 10 }],
});
eq('near target detected', sigs.some(s => s.kind === 'position_near_target'), true);

// Below stop
sigs = detectSignals({
  positions: [{ ticker: 'AMD', currentPrice: 90, currentValue: 900, todayChangePercent: -2, stop_loss: 95, shares: 10 }],
});
eq('below stop detected', sigs.some(s => s.kind === 'position_below_stop'), true);
eq('below stop → high priority', sigs.find(s => s.kind === 'position_below_stop')?.priority, 'high');

// Near stop (within 10%)
sigs = detectSignals({
  positions: [{ ticker: 'AMD', currentPrice: 100, currentValue: 1000, todayChangePercent: -1, stop_loss: 95, shares: 10 }],
});
eq('near stop detected', sigs.some(s => s.kind === 'position_near_stop'), true);

// Concentration (>=25%)
sigs = detectSignals({
  positions: [
    { ticker: 'BIG', currentPrice: 100, currentValue: 30000, todayChangePercent: 0, shares: 300 },
    { ticker: 'SMALL', currentPrice: 100, currentValue: 70000, todayChangePercent: 0, shares: 700 },
  ],
});
eq('concentration ≥25% detected', sigs.some(s => s.kind === 'concentration_warn' && s.ticker === 'BIG'), true);
eq('SMALL (70%) also flagged', sigs.filter(s => s.kind === 'concentration_warn').length, 2);

// Watchlist alert (within 5%)
sigs = detectSignals({
  positions: [],
  watchlist: [{ ticker: 'GME', last_price: 24, alert_price: 25 }],
});
eq('watchlist near alert detected', sigs.some(s => s.kind === 'watchlist_alert'), true);

// Watchlist alert outside 5% — not detected
sigs = detectSignals({
  positions: [],
  watchlist: [{ ticker: 'GME', last_price: 18, alert_price: 25 }],
});
eq('watchlist far from alert → no signal', sigs.some(s => s.kind === 'watchlist_alert'), false);

// Adherence pattern (only when there are open positions to repeat the pattern on)
sigs = detectSignals({
  positions: [{ ticker: 'X', currentPrice: 50, currentValue: 500, todayChangePercent: 0, shares: 10 }],
  adherenceSummary: 'takes profits early on 4/6 trades',
});
eq('adherence pattern surfaces with open position', sigs.some(s => s.kind === 'adherence_pattern'), true);

// Adherence pattern with NO positions — should not surface
sigs = detectSignals({ positions: [], adherenceSummary: 'takes profits early on 4/6 trades' });
eq('adherence with no positions → no signal', sigs.some(s => s.kind === 'adherence_pattern'), false);

// Priority sort: high → medium → low
sigs = detectSignals({
  positions: [
    { ticker: 'A', currentPrice: 100, currentValue: 1000, todayChangePercent: 6, shares: 10 },               // medium
    { ticker: 'B', currentPrice: 90, currentValue: 900, todayChangePercent: 1, stop_loss: 95, shares: 10 }, // high (below_stop)
  ],
  adherenceSummary: 'pattern',
});
eq('high priority signal comes first', sigs[0].priority, 'high');
eq('low priority signal comes last', sigs[sigs.length - 1].priority, 'low');

// Stale price (currentPrice = 0) → no signals for that position
sigs = detectSignals({
  positions: [{ ticker: 'STALE', currentPrice: 0, currentValue: 0, todayChangePercent: 0, price_target: 100, stop_loss: 50, shares: 10 }],
});
eq('zero price → no signals for that position', sigs.length, 0);

console.log('\n=== Performance Attribution — bucketTrade ===');
eq('0 days = day_trade', bucketTrade(0), 'day_trade');
eq('1 day = day_trade', bucketTrade(1), 'day_trade');
eq('2 days = short_swing', bucketTrade(2), 'short_swing');
eq('7 days = short_swing', bucketTrade(7), 'short_swing');
eq('8 days = swing', bucketTrade(8), 'swing');
eq('30 days = swing', bucketTrade(30), 'swing');
eq('31 days = position', bucketTrade(31), 'position');
eq('180 days = position', bucketTrade(180), 'position');
eq('181 days = long_term', bucketTrade(181), 'long_term');
eq('365 days = long_term', bucketTrade(365), 'long_term');
eq('negative clamps to day_trade', bucketTrade(-5), 'day_trade');

console.log('\n=== Performance Attribution — analyzeStyles ===');
const tradeSet = [
  { ticker: 'A', pnl: 100, pnl_percent: 10, hold_days: 1 },   // day_trade win
  { ticker: 'B', pnl: -50, pnl_percent: -5, hold_days: 1 },   // day_trade loss
  { ticker: 'C', pnl: 200, pnl_percent: 20, hold_days: 14 },  // swing win
  { ticker: 'D', pnl: 300, pnl_percent: 25, hold_days: 21 },  // swing win
  { ticker: 'E', pnl: 150, pnl_percent: 15, hold_days: 28 },  // swing win
];
const styles = analyzeStyles(tradeSet);
const day = styles.find(s => s.key === 'day_trade');
const swing = styles.find(s => s.key === 'swing');
eq('day_trade count = 2', day.count, 2);
eq('day_trade winRate = 50', day.winRate, 50);
eq('swing count = 3', swing.count, 3);
eq('swing winRate = 100', swing.winRate, 100);
eq('swing totalPnl = 650', swing.totalPnl, 650);

console.log('\n=== Performance Attribution — analyzeContribution ===');
const tradesForPareto = [
  { ticker: 'X', pnl: 1000, pnl_percent: 50, hold_days: 14 },
  { ticker: 'Y', pnl: 200, pnl_percent: 10, hold_days: 7 },
  { ticker: 'Z', pnl: 50, pnl_percent: 5, hold_days: 21 },
  { ticker: 'W', pnl: 50, pnl_percent: 5, hold_days: 21 },
  { ticker: 'V', pnl: -300, pnl_percent: -15, hold_days: 5 },
];
const contrib = analyzeContribution(tradesForPareto);
eq('totalWinnings = 1300', contrib.totalWinnings, 1300);
eq('totalLosses = -300', contrib.totalLosses, -300);
eq('netPnl = 1000', contrib.netPnl, 1000);
eq('top1 = X', contrib.top1.ticker, 'X');
approx('top1Share ≈ 76.92%', contrib.top1Share, 76.92, 0.1);
approx('top3Share ≈ 96.15%', contrib.top3Share, 96.15, 0.1);

console.log('\n=== Performance Attribution — analyzeOpenContribution ===');
const openPositions = [
  { ticker: 'NVDA', avg_cost: 100, shares: 10, currentPrice: 200 },  // +$1000
  { ticker: 'AMD', avg_cost: 100, shares: 10, currentPrice: 90 },    // -$100
  { ticker: 'INTC', avg_cost: 100, shares: 10, currentPrice: 100 },  // 0
];
const open = analyzeOpenContribution(openPositions);
eq('open count = 3', open.count, 3);
approx('totalUnrealized = 900', open.totalUnrealized, 900);
eq('top winner = NVDA', open.topWinners[0].ticker, 'NVDA');
eq('top loser = AMD', open.topLosers[0].ticker, 'AMD');

// Empty / stale
eq('empty positions → count 0', analyzeOpenContribution([]).count, 0);
eq('zero price filtered out',
  analyzeOpenContribution([{ ticker: 'STALE', avg_cost: 100, shares: 10, currentPrice: 0 }]).count, 0);

console.log('\n=== Performance Attribution — derivePatterns ===');
// Big style edge: day trades 0% win, swings 100% win
const stylesWithEdge = analyzeStyles([
  { ticker: 'A', pnl: -50, hold_days: 1 },
  { ticker: 'B', pnl: -50, hold_days: 1 },
  { ticker: 'C', pnl: -50, hold_days: 1 },
  { ticker: 'D', pnl: 100, pnl_percent: 10, hold_days: 14 },
  { ticker: 'E', pnl: 100, pnl_percent: 10, hold_days: 14 },
  { ticker: 'F', pnl: 100, pnl_percent: 10, hold_days: 14 },
]);
const patternsEdge = derivePatterns({
  styles: stylesWithEdge,
  contribution: analyzeContribution([]),
  openContribution: { count: 0, totalUnrealized: 0, topWinners: [], topLosers: [] },
});
eq('surfaces style_edge pattern when win-rate gap ≥ 20', patternsEdge.some(p => p.key === 'style_edge'), true);
eq('surfaces style_drag for losing bucket', patternsEdge.some(p => p.key === 'style_drag'), true);

// Concentrated wins (top1 ≥ 50% of winnings)
const stylesEmpty = [];
const concentrated = analyzeContribution([
  { ticker: 'X', pnl: 1000, pnl_percent: 50, hold_days: 14 },
  { ticker: 'Y', pnl: 100, pnl_percent: 10, hold_days: 7 },
  { ticker: 'Z', pnl: 50, pnl_percent: 5, hold_days: 21 },
  { ticker: 'W', pnl: 50, pnl_percent: 5, hold_days: 21 },
  { ticker: 'V', pnl: 50, pnl_percent: 5, hold_days: 21 },
]);
const patternsConc = derivePatterns({
  styles: stylesEmpty,
  contribution: concentrated,
  openContribution: { count: 0, totalUnrealized: 0, topWinners: [], topLosers: [] },
});
eq('surfaces concentrated_wins when top3 ≥ 70%', patternsConc.some(p => p.key === 'concentrated_wins'), true);

console.log('\n=== Email — buildDailyDigestEmail ===');
eq('null when digest unavailable',
  buildDailyDigestEmail({ displayName: 'M', digest: null }), null);
eq('null when digest.available = false',
  buildDailyDigestEmail({ displayName: 'M', digest: { available: false } }), null);
eq('null on quiet day',
  buildDailyDigestEmail({ displayName: 'M', digest: { available: true, quiet: true, digest: '' } }), null);
eq('null when digest text missing',
  buildDailyDigestEmail({ displayName: 'M', digest: { available: true, quiet: false, digest: '' } }), null);

const dailyOk = buildDailyDigestEmail({
  displayName: 'Myles',
  digest: {
    available: true, quiet: false,
    generatedAt: '2026-05-01T12:00:00Z',
    digest: 'Markets opened soft, NVDA leading the watchlist.',
    signals: [
      { ticker: 'NVDA', priority: 'high', detail: 'NVDA up 6% premarket on earnings beat' },
      { ticker: 'TSLA', priority: 'medium', detail: 'TSLA approaching 200 SMA' },
    ],
  },
});
eq('daily returns subject/html/text triple', !!(dailyOk?.subject && dailyOk?.html && dailyOk?.text), true);
eq('daily subject leads with high-priority ticker', dailyOk.subject.startsWith('NVDA'), true);
eq('daily html greets by name', dailyOk.html.includes('Hey Myles'), true);
eq('daily html includes digest body', dailyOk.html.includes('NVDA leading'), true);
eq('daily html includes a signal row', dailyOk.html.includes('NVDA up 6'), true);

const dailyAnon = buildDailyDigestEmail({
  displayName: '',
  digest: {
    available: true, quiet: false,
    generatedAt: '2026-05-01T12:00:00Z',
    digest: 'Quiet morning so far.',
    signals: [{ ticker: '', priority: 'medium', detail: 'VIX flat' }],
  },
});
eq('daily falls back to generic greeting when name missing',
  dailyAnon.html.includes('Good morning'), true);
eq('daily subject falls back when no high-priority ticker',
  dailyAnon.subject.startsWith('Your morning read'), true);

eq('escapes HTML in display name',
  buildDailyDigestEmail({
    displayName: '<script>x</script>',
    digest: {
      available: true, quiet: false,
      generatedAt: '2026-05-01T12:00:00Z',
      digest: 'ok', signals: [],
    },
  }).html.includes('<script>x</script>'),
  false);

console.log('\n=== Email — buildWeeklySummaryEmail ===');
eq('null when weekly missing',
  buildWeeklySummaryEmail({ displayName: 'M', weekly: null }), null);

const weeklyOk = buildWeeklySummaryEmail({
  displayName: 'Myles',
  weekly: {
    weekStart: '2026-04-26T00:00:00Z',
    weekEnd: '2026-05-02T23:59:59Z',
    closedThisWeek: 4,
    netPnl: 425.75,
    winRate: 75,
    topWinner: { ticker: 'NVDA', pnl: 600, hold_days: 5 },
    topLoser: { ticker: 'AMD', pnl: -174.25, hold_days: 3 },
    attribution: 'Swing trades doing the heavy lifting.',
    adherence: 'You honored your stop on 3 of 4 losers.',
    openUnrealized: 1200,
  },
});
eq('weekly returns subject/html/text triple', !!(weeklyOk?.subject && weeklyOk?.html && weeklyOk?.text), true);
eq('weekly subject summarizes stats',
  weeklyOk.subject.includes('4 trades') && weeklyOk.subject.includes('75%') && weeklyOk.subject.includes('+$426'), true);
eq('weekly html shows green for positive net P&L',
  weeklyOk.html.includes('#10b981'), true);
eq('weekly html includes top winner', weeklyOk.html.includes('NVDA'), true);
eq('weekly html includes top loser', weeklyOk.html.includes('AMD'), true);
eq('weekly text fallback is plain ascii', weeklyOk.text.includes('Top winner: NVDA'), true);

const weeklyLoss = buildWeeklySummaryEmail({
  displayName: 'Myles',
  weekly: {
    weekStart: '2026-04-26T00:00:00Z',
    weekEnd: '2026-05-02T23:59:59Z',
    closedThisWeek: 2,
    netPnl: -150,
    winRate: 0,
    topWinner: null,
    topLoser: { ticker: 'AAPL', pnl: -150, hold_days: 1 },
    attribution: '',
    adherence: '',
    openUnrealized: null,
  },
});
eq('weekly subject formats negative P&L with leading -',
  weeklyLoss.subject.includes('-$150'), true);
eq('weekly html shows red on losing week',
  weeklyLoss.html.includes('#ef4444'), true);
eq('weekly omits Open Positions section when openUnrealized is null',
  weeklyLoss.html.includes('OPEN POSITIONS'), false);

console.log('\n=== Admin — parseAllowList ===');
function arrEq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); console.log(`  FAIL ${name}`); }
}
arrEq('null returns empty array', parseAllowList(null), []);
arrEq('undefined returns empty array', parseAllowList(undefined), []);
arrEq('empty string returns empty array', parseAllowList(''), []);
arrEq('whitespace-only returns empty array', parseAllowList('   ,  ,'), []);
arrEq('single email parses', parseAllowList('foo@bar.com'), ['foo@bar.com']);
arrEq('comma list parses', parseAllowList('a@x.com,b@x.com'), ['a@x.com', 'b@x.com']);
arrEq('lower-cases', parseAllowList('Foo@Bar.COM'), ['foo@bar.com']);
arrEq('trims whitespace', parseAllowList('  a@x.com ,  b@x.com  '), ['a@x.com', 'b@x.com']);
arrEq('dedupes case-insensitively', parseAllowList('a@x.com,A@X.com,b@x.com'), ['a@x.com', 'b@x.com']);
arrEq('drops empty entries', parseAllowList('a@x.com,,b@x.com'), ['a@x.com', 'b@x.com']);
arrEq('non-string returns empty array', parseAllowList(123), []);

console.log('\n=== Admin — isAdminEmail ===');
const allow = ['founder@x.com', 'a@x.com'];
eq('rejects empty allow list', isAdminEmail([], 'founder@x.com'), false);
eq('rejects non-array allow list', isAdminEmail(null, 'founder@x.com'), false);
eq('rejects null email', isAdminEmail(allow, null), false);
eq('rejects empty email', isAdminEmail(allow, ''), false);
eq('rejects non-listed email', isAdminEmail(allow, 'random@x.com'), false);
eq('accepts listed email', isAdminEmail(allow, 'founder@x.com'), true);
eq('accepts case-different email', isAdminEmail(allow, 'FOUNDER@X.com'), true);
eq('accepts whitespace-padded email', isAdminEmail(allow, '  a@x.com  '), true);

console.log('\n=== Welcome Moment — buildWelcomePrompt ===');
const sampleMarket = { vix: 18.4, fearGreed: 62, regime: 'Risk On', spyRsi: 58.2 };
const swingPrompt = buildWelcomePrompt({ style: 'swing', risk: 'moderate', assets: ['stocks','etfs'], market: sampleMarket });
eq('mentions swing trader', swingPrompt.includes('swing trader'), true);
eq('mentions moderate risk', swingPrompt.includes('moderate'), true);
eq('mentions assets list', swingPrompt.includes('stocks, etfs'), true);
eq('includes regime', swingPrompt.includes('Risk On'), true);
eq('includes VIX value', swingPrompt.includes('18.4'), true);
eq('includes Fear & Greed', swingPrompt.includes('62'), true);
eq('includes SPY RSI', swingPrompt.includes('58.2'), true);

const dayPrompt = buildWelcomePrompt({ style: 'day_trading', risk: 'aggressive', assets: ['stocks'], market: sampleMarket });
eq('day_trading maps to "day trader"', dayPrompt.includes('day trader'), true);
eq('aggressive risk shows', dayPrompt.includes('aggressive'), true);

const investorPrompt = buildWelcomePrompt({ style: 'investor', risk: 'conservative', assets: ['etfs'], market: sampleMarket });
eq('investor maps to "long-term investor"', investorPrompt.includes('long-term investor'), true);
eq('conservative risk shows', investorPrompt.includes('conservative'), true);

// Defensive defaults
const noMarket = buildWelcomePrompt({ style: 'swing', risk: 'moderate', assets: [], market: null });
eq('no market regime defaults to Neutral', noMarket.includes('Neutral'), true);
eq('empty assets defaults to "stocks"', noMarket.includes('stocks'), true);
eq('null market shows VIX em-dash', noMarket.includes('VIX —'), true);

const unknownStyle = buildWelcomePrompt({ style: 'banana', risk: 'oops', assets: ['stocks'], market: sampleMarket });
eq('unknown style falls back to "trader"', unknownStyle.includes('New trader'), true);
eq('unknown risk falls back to "moderate"', unknownStyle.includes('Risk: moderate'), true);

console.log('\n=== Welcome Moment — buildWelcomeSystemPrompt ===');
const sysPrompt = buildWelcomeSystemPrompt();
eq('system mentions Outpost', sysPrompt.includes('Outpost'), true);
eq('system enforces plain text', sysPrompt.includes('Plain text only'), true);
eq('system caps at 3 sentences', sysPrompt.includes('Maximum 3 sentences'), true);

console.log('\n=== Welcome Moment — buildFallbackWelcome ===');
const fbSwing = buildFallbackWelcome({ style: 'swing' });
const fbDay = buildFallbackWelcome({ style: 'day_trading' });
const fbInvestor = buildFallbackWelcome({ style: 'investor' });
const fbUnknown = buildFallbackWelcome({ style: undefined });
eq('swing fallback mentions swing', fbSwing.toLowerCase().includes('swing'), true);
eq('day fallback mentions day trading', fbDay.toLowerCase().includes('day trading'), true);
eq('investor fallback mentions investing', fbInvestor.toLowerCase().includes('investing'), true);
eq('unknown style defaults to swing fallback', fbUnknown === fbSwing, true);
eq('every fallback ends with the same nudge', fbSwing.endsWith('tracking it with you.') && fbDay.endsWith('tracking it with you.') && fbInvestor.endsWith('tracking it with you.'), true);

console.log('\n=== Prompt Experiments — bucketFor ===');
eq('null userId returns 0', bucketFor(null, 'k', 3), 0);
eq('undefined userId returns 0', bucketFor(undefined, 'k', 3), 0);
eq('zero buckets returns 0', bucketFor('user-1', 'k', 0), 0);
eq('negative buckets returns 0', bucketFor('user-1', 'k', -1), 0);
eq('bucket is in [0, n)', (() => { const b = bucketFor('user-1', 'k', 3); return b >= 0 && b < 3; })(), true);
eq('same input → same bucket', bucketFor('user-1', 'k', 3) === bucketFor('user-1', 'k', 3), true);
eq('different keys → independently bucketed',
  bucketFor('user-1', 'a', 1000) !== bucketFor('user-1', 'b', 1000) ||
  bucketFor('user-2', 'a', 1000) !== bucketFor('user-2', 'b', 1000), true);

// Distribution across many ids — tolerance ±15% per bucket on n=3 with 3000 ids
const counts = [0, 0, 0];
for (let i = 0; i < 3000; i++) counts[bucketFor(`u-${i}`, 'welcome_system', 3)]++;
const ratios = counts.map(c => c / 3000);
eq('bucket 0 is ~33% (±15%)', ratios[0] > 0.18 && ratios[0] < 0.48, true);
eq('bucket 1 is ~33% (±15%)', ratios[1] > 0.18 && ratios[1] < 0.48, true);
eq('bucket 2 is ~33% (±15%)', ratios[2] > 0.18 && ratios[2] < 0.48, true);

console.log('\n=== Prompt Experiments — assignVariant ===');
const v1 = assignVariant('user-1', 'welcome_system');
eq('returns object with id', typeof v1.id, 'string');
eq('returns object with build()', typeof v1.build, 'function');
eq('build() returns string', typeof v1.build(), 'string');
eq('sticky for same user', assignVariant('user-1', 'welcome_system').id, v1.id);
let threw = false; try { assignVariant('u', 'no_such_experiment'); } catch { threw = true; }
eq('throws on unknown experiment', threw, true);

console.log('\n=== Prompt Experiments — getVariantById ===');
eq('finds existing variant', getVariantById('welcome_system', 'baseline')?.id, 'baseline');
eq('returns null for missing variant', getVariantById('welcome_system', 'no_such'), null);
eq('returns null for missing experiment', getVariantById('no_such', 'baseline'), null);

console.log('\n=== Prompt Experiments — listExperiments ===');
const list = listExperiments();
eq('returns array', Array.isArray(list), true);
eq('includes welcome_system', list.some(e => e.key === 'welcome_system'), true);
eq('omits build functions', list.every(e => e.variants.every(v => !('build' in v))), true);
eq('preserves variant ids', list.find(e => e.key === 'welcome_system').variants[0].id, 'baseline');

console.log('\n=== Prompt Experiments — aggregateFeedbackByVariant ===');
const feedbackRows = [
  { feature: 'welcome_system', variant: 'baseline', rating: 'up' },
  { feature: 'welcome_system', variant: 'baseline', rating: 'up' },
  { feature: 'welcome_system', variant: 'baseline', rating: 'down' },
  { feature: 'welcome_system', variant: 'mentor', rating: 'up' },
  { feature: 'welcome_system', variant: 'mentor', rating: 'up' },
  { feature: 'welcome_system', variant: 'mentor', rating: 'up' },
  { feature: 'welcome_system', variant: null, rating: 'up' },
  { feature: 'agent', variant: 'v1', rating: 'down' },
];
const agg = aggregateFeedbackByVariant(feedbackRows);
eq('groups by feature', Object.keys(agg).sort().join(','), 'agent,welcome_system');
eq('baseline up = 2', agg.welcome_system.baseline.up, 2);
eq('baseline down = 1', agg.welcome_system.baseline.down, 1);
eq('baseline approval = 67', agg.welcome_system.baseline.approval, 67);
eq('mentor up = 3', agg.welcome_system.mentor.up, 3);
eq('mentor approval = 100', agg.welcome_system.mentor.approval, 100);
eq('null variant bucketed under untagged', agg.welcome_system.untagged.up, 1);
eq('agent feature kept separate', agg.agent.v1.down, 1);
eq('empty rows returns {}', JSON.stringify(aggregateFeedbackByVariant([])), '{}');
eq('null rows returns {}', JSON.stringify(aggregateFeedbackByVariant(null)), '{}');

// === SUMMARY ===
console.log(`\n=== Summary ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
