// Pins the performance-attribution math (api/services/performanceAttribution.js):
// the per-style win rates, the Pareto contribution analysis, and the "your edge
// is in X" insight generation that power the Patterns tab and the agent's
// attribution summary. All pure and exported; this locks the bucketing
// boundaries, the aggregation, and the insight thresholds.
import assert from 'node:assert/strict';
import {
  bucketTrade, analyzeStyles, analyzeContribution, derivePatterns,
} from '../api/services/performanceAttribution.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('bucketTrade maps hold days to a style, inclusive upper bounds', () => {
  assert.equal(bucketTrade(0), 'day_trade');
  assert.equal(bucketTrade(1), 'day_trade');
  assert.equal(bucketTrade(2), 'short_swing');
  assert.equal(bucketTrade(7), 'short_swing');
  assert.equal(bucketTrade(8), 'swing');
  assert.equal(bucketTrade(30), 'swing');
  assert.equal(bucketTrade(31), 'position');
  assert.equal(bucketTrade(180), 'position');
  assert.equal(bucketTrade(181), 'long_term');
  assert.equal(bucketTrade(-5), 'day_trade');   // clamped to 0
  assert.equal(bucketTrade('junk'), 'day_trade'); // NaN -> 0
});

test('analyzeStyles groups by bucket with win rate and pnl', () => {
  const styles = analyzeStyles([
    { hold_days: 0, pnl: 100, pnl_percent: 10 },
    { hold_days: 0, pnl: -50, pnl_percent: -5 },
    { hold_days: 10, pnl: 200, pnl_percent: 20 },
  ]);
  assert.equal(styles.length, 2);                 // day_trade + swing
  const day = styles.find(s => s.key === 'day_trade');
  const swing = styles.find(s => s.key === 'swing');
  assert.equal(day.count, 2);
  assert.equal(day.winRate, 50);
  assert.equal(day.totalPnl, 50);
  assert.equal(swing.count, 1);
  assert.equal(swing.winRate, 100);
  assert.equal(swing.totalPnl, 200);
});

test('analyzeContribution surfaces winner concentration (Pareto)', () => {
  const c = analyzeContribution([
    { ticker: 'A', pnl: 1000, pnl_percent: 50, hold_days: 5 },
    { ticker: 'B', pnl: 200, pnl_percent: 10 },
    { ticker: 'C', pnl: -300, pnl_percent: -15 },
  ]);
  assert.equal(c.totalWinnings, 1200);
  assert.equal(c.netPnl, 900);
  assert.equal(c.top1.ticker, 'A');
  assert.equal(c.top3Share, 100);
  assert.equal(c.top1Share, 83.3);
});

test('analyzeContribution handles an empty history', () => {
  const c = analyzeContribution([]);
  assert.equal(c.count, 0);
  assert.equal(c.netPnl, 0);
  assert.deepEqual(c.top3, []);
});

test('derivePatterns flags a win-rate edge and a losing-style drag', () => {
  const styles = [
    { key: 'swing', label: 'Swings', count: 5, winRate: 80, totalPnl: 1000 },
    { key: 'day_trade', label: 'Day Trades', count: 4, winRate: 25, totalPnl: -500 },
  ];
  const patterns = derivePatterns({
    styles,
    contribution: { count: 0, top3Share: 0, top1Share: 0, top1: null },
    openContribution: { totalUnrealized: 0, topWinners: [] },
  });
  assert.ok(patterns.some(p => p.key === 'style_edge'));
  assert.ok(patterns.some(p => p.key === 'style_drag'));
});

test('derivePatterns flags concentrated winnings when top 3 dominate', () => {
  const patterns = derivePatterns({
    styles: [],
    contribution: { count: 6, top3Share: 80, top1Share: 55, top1: { ticker: 'NVDA', pnl: 5000 } },
    openContribution: { totalUnrealized: 0, topWinners: [] },
  });
  const p = patterns.find(x => x.key === 'concentrated_wins');
  assert.ok(p);
  assert.equal(p.severity, 'warning'); // top1Share >= 50
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
