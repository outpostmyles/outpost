// Pins the headline money path: live portfolio value, P&L, and today's change.
// This is the most important number the app shows, so the rules are strict:
// correct on good data, and FINITE on any data. A NaN or Infinity here is a
// visible "$NaN" on the home screen. Correctness AND crash-safety, both pinned.
import { computePortfolioValue } from '../src/lib/portfolioValue.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg || 'eq'}: expected ${B}, got ${A}`); }
function close(a, b, msg, eps = 0.01) { if (!(Math.abs(a - b) <= eps)) throw new Error(`${msg || 'close'}: expected ~${b}, got ${a}`); }
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }
const finite = (n, msg) => ok(Number.isFinite(n), `${msg} not finite (got ${n})`);

const AAPL = { ticker: 'AAPL', shares: 10, avg_cost: 100 };
const MSFT = { ticker: 'MSFT', shares: 5, avg_cost: 200 };

test('a single up position computes value, P&L, and today-change correctly', () => {
  const { positions, totals } = computePortfolioValue([AAPL], { AAPL: { price: 120, changePercent: 2 } }, { marketOpen: true });
  const p = positions[0];
  eq(p.currentPrice, 120, 'currentPrice');
  eq(p.currentValue, 1200, 'currentValue');
  eq(p.pnl, 200, 'pnl');
  eq(p.pnlPercent, 20, 'pnlPercent');
  eq(p.priceStale, false, 'has a live price');
  // dollar change comes off the PREVIOUS value: 1200 - 1200/1.02 = 23.53
  close(p.todayChange, 23.53, 'todayChange');
  eq(p.todayChangePercent, 2, 'todayChangePercent');
  eq(totals.totalValue, 1200, 'totalValue');
  eq(totals.totalCost, 1000, 'totalCost');
  eq(totals.totalPnl, 200, 'totalPnl');
  eq(totals.totalPnlPercent, 20, 'totalPnlPercent');
  close(totals.totalTodayChange, 23.53, 'totalTodayChange');
  close(totals.todayChangePercent, 2, 'totals todayChangePercent matches the input move');
  eq(totals.staleCount, 0, 'nothing stale');
});

test('two positions aggregate value and blended P&L correctly', () => {
  const { totals } = computePortfolioValue([AAPL, MSFT], {
    AAPL: { price: 120, changePercent: 2 },
    MSFT: { price: 200, changePercent: 0 },
  });
  eq(totals.totalValue, 2200, 'value sums');     // 1200 + 1000
  eq(totals.totalCost, 2000, 'cost sums');       // 1000 + 1000
  eq(totals.totalPnl, 200, 'pnl sums');
  eq(totals.totalPnlPercent, 10, 'blended pnl% = 200/2000');
  close(totals.totalTodayChange, 23.53, 'only AAPL moved');
});

test('an empty book is all zeros, never NaN', () => {
  const { positions, totals } = computePortfolioValue([], {});
  eq(positions, [], 'no positions');
  for (const k of ['totalValue', 'totalCost', 'totalPnl', 'totalPnlPercent', 'totalTodayChange', 'todayChangePercent']) {
    eq(totals[k], 0, `${k} is 0`);
  }
  eq(totals.staleCount, 0, 'staleCount 0');
});

test('a missing live price falls back to cost basis and is marked stale', () => {
  const { positions, totals } = computePortfolioValue([{ ticker: 'Y', shares: 4, avg_cost: 25 }], {});
  const p = positions[0];
  eq(p.currentPrice, 25, 'falls back to avg_cost');
  eq(p.currentValue, 100, '4 * 25');
  eq(p.pnl, 0, 'no gain at cost');
  eq(p.priceStale, true, 'flagged stale');
  eq(totals.staleCount, 1, 'counted as stale');
});

test('a NaN live price is treated as no price, not as $NaN', () => {
  const { positions, totals } = computePortfolioValue([{ ticker: 'Z', shares: 2, avg_cost: 30 }], { Z: { price: NaN } });
  const p = positions[0];
  finite(p.currentValue, 'currentValue');
  eq(p.currentValue, 60, 'falls back to cost (2 * 30), not NaN');
  eq(p.priceStale, true, 'NaN price counts as stale');
  finite(totals.totalValue, 'totalValue');
});

test('changePercent of -100 cannot produce Infinity (denominator guard)', () => {
  const { positions, totals } = computePortfolioValue(
    [{ ticker: 'X', shares: 10, avg_cost: 50 }],
    { X: { price: 10, changePercent: -100 } },
  );
  finite(positions[0].todayChange, 'position todayChange');
  eq(positions[0].todayChange, 0, 'guarded to 0, not Infinity');
  finite(totals.totalTodayChange, 'totals todayChange');
  finite(totals.todayChangePercent, 'totals todayChangePercent');
});

test('one poisoned row never infects a healthy row (the snap guarantee)', () => {
  const { totals } = computePortfolioValue(
    [{ ticker: 'GOOD', shares: 10, avg_cost: 100 }, { ticker: 'BAD', shares: 'oops', avg_cost: null }],
    { GOOD: { price: 120, changePercent: 1 }, BAD: { price: NaN, changePercent: NaN } },
  );
  finite(totals.totalValue, 'totalValue');
  finite(totals.totalPnl, 'totalPnl');
  eq(totals.totalValue, 1200, 'good row stands alone; bad row contributes 0');
});

test('bad shares sanitize to 0, never NaN', () => {
  const { positions } = computePortfolioValue([{ ticker: 'Q', shares: 'abc', avg_cost: 10 }], { Q: { price: 20 } });
  eq(positions[0].shares, 0, 'NaN shares -> 0');
  eq(positions[0].currentValue, 0, '0 shares -> 0 value');
});

test('a negative avg_cost is floored to 0 cost basis', () => {
  const { positions } = computePortfolioValue([{ ticker: 'R', shares: 5, avg_cost: -10 }], { R: { price: 20 } });
  const p = positions[0];
  eq(p.currentValue, 100, '5 * 20');
  finite(p.pnl, 'pnl');
  eq(p.pnlPercent, 0, 'no cost basis -> 0%, never divide-by-zero');
});

test('garbage top-level input never throws and returns a sane empty shape', () => {
  for (const bad of [null, undefined, 42, 'x', {}, [null], [undefined]]) {
    const { positions, totals } = computePortfolioValue(bad, bad);
    ok(Array.isArray(positions), 'positions is an array');
    for (const k of ['totalValue', 'totalCost', 'totalPnl', 'totalPnlPercent', 'totalTodayChange', 'todayChangePercent']) {
      finite(totals[k], `totals.${k}`);
    }
  }
});

let pass = 0, fail = 0;
for (const { n, f } of tests) {
  try { f(); console.log(`ok   ${n}`); pass++; }
  catch (e) { console.log(`FAIL ${n}: ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
