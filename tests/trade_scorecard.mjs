// Unit tests for the Trading Scorecard math (api/services/tradeScorecard.js).
// Pins win rate, realized P&L, average win/loss, profit factor, hold-time
// split, and best/worst selection so the "Your track record" card on the
// Patterns tab can trust the numbers.
import assert from 'node:assert/strict';
import { computeScorecard } from '../api/services/tradeScorecard.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// 5 trades: 3 winners, 2 losers. Hand-computed expectations below.
const sample = [
  { ticker: 'AAPL', pnl: 300,  pnl_percent: 12, hold_days: 40 },
  { ticker: 'NVDA', pnl: 700,  pnl_percent: 25, hold_days: 60 },
  { ticker: 'MSFT', pnl: 200,  pnl_percent: 8,  hold_days: 20 },
  { ticker: 'INTC', pnl: -100, pnl_percent: -5, hold_days: 90 },
  { ticker: 'PYPL', pnl: -300, pnl_percent: -15, hold_days: 120 },
];

test('returns null for empty / missing input', () => {
  assert.equal(computeScorecard([]), null);
  assert.equal(computeScorecard(null), null);
  assert.equal(computeScorecard(undefined), null);
});

test('counts wins, losses, total and win rate', () => {
  const s = computeScorecard(sample);
  assert.equal(s.totalTrades, 5);
  assert.equal(s.wins, 3);
  assert.equal(s.losses, 2);
  assert.equal(s.breakeven, 0);
  assert.equal(s.winRate, 60); // 3/5
});

test('sums realized dollar P&L', () => {
  // 300 + 700 + 200 - 100 - 300 = 800
  assert.equal(computeScorecard(sample).totalPnl, 800);
});

test('average win and average loss', () => {
  const s = computeScorecard(sample);
  assert.equal(s.avgWin, 400);   // (300+700+200)/3
  assert.equal(s.avgLoss, -200); // (-100-300)/2, kept negative
});

test('profit factor = gross profit / gross loss', () => {
  // gross profit 1200, gross loss 400 -> 3.0
  assert.equal(computeScorecard(sample).profitFactor, 3);
});

test('expectancy is average realized dollars per trade', () => {
  assert.equal(computeScorecard(sample).expectancy, 160); // 800/5
});

test('average hold time split by winners vs losers', () => {
  const s = computeScorecard(sample);
  assert.equal(s.avgHoldWinners, 40); // (40+60+20)/3
  assert.equal(s.avgHoldLosers, 105); // (90+120)/2
});

test('best and worst by dollar P&L, with ticker and percent', () => {
  const s = computeScorecard(sample);
  assert.deepEqual(s.best, { ticker: 'NVDA', pnl: 700, pnlPercent: 25 });
  assert.deepEqual(s.worst, { ticker: 'PYPL', pnl: -300, pnlPercent: -15 });
});

test('profit factor is null when there are no losses', () => {
  const s = computeScorecard([
    { ticker: 'A', pnl: 100, pnl_percent: 5, hold_days: 10 },
    { ticker: 'B', pnl: 50, pnl_percent: 2, hold_days: 5 },
  ]);
  assert.equal(s.profitFactor, null);
  assert.equal(s.avgLoss, null);
  assert.equal(s.winRate, 100);
});

test('breakeven trades (pnl exactly 0) count as neither win nor loss', () => {
  const s = computeScorecard([
    { ticker: 'A', pnl: 100, pnl_percent: 5 },
    { ticker: 'B', pnl: 0, pnl_percent: 0 },
    { ticker: 'C', pnl: -50, pnl_percent: -3 },
  ]);
  assert.equal(s.wins, 1);
  assert.equal(s.losses, 1);
  assert.equal(s.breakeven, 1);
  assert.equal(s.winRate, round1Helper(1 / 3 * 100));
});

test('tolerates missing hold_days and string-typed pnl', () => {
  const s = computeScorecard([
    { ticker: 'A', pnl: '250', pnl_percent: '10' },          // strings
    { ticker: 'B', pnl: -75, pnl_percent: -4, hold_days: 30 },
  ]);
  assert.equal(s.totalPnl, 175);
  assert.equal(s.avgWin, 250);
  assert.equal(s.avgHoldWinners, null); // winner had no hold_days
  assert.equal(s.avgHoldLosers, 30);
});

function round1Helper(n) { return Math.round(n * 10) / 10; }

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
