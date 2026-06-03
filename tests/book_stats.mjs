// Pins bookStats.js, the single source of truth for a position's market value
// and its weight in the book. The whole point is that one holding can no longer
// show two different weights across the app, so the market-value precedence,
// the holdings-only denominator, the 1-decimal display rounding, and the
// null-not-NaN guards are all locked here.
import assert from 'node:assert/strict';
import { marketValueOf, costBasisOf, pctOfBookOf, computeBookStats, bookStamp, mergeLots } from '../src/lib/bookStats.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('marketValueOf prefers an already-computed currentValue', () => {
  // Never recompute a second, divergent way when the value is already on hand.
  assert.equal(marketValueOf({ currentValue: 3000, currentPrice: 999, shares: 1 }), 3000);
  assert.equal(marketValueOf({ marketValue: 250 }), 250);
});

test('marketValueOf falls back to price * shares when no currentValue', () => {
  assert.equal(marketValueOf({ currentPrice: 10, shares: 5 }), 50);
  assert.equal(marketValueOf({ livePrice: 4, shares: 3 }), 12);
  assert.equal(marketValueOf({ price: 2, shares: 10 }), 20);
});

test('marketValueOf never invents value from cost basis or junk', () => {
  // A missing live price is a data gap, not a reason to count cost basis.
  assert.equal(marketValueOf({ avg_cost: 100, shares: 10 }), 0);
  assert.equal(marketValueOf({ currentPrice: 0, shares: 10 }), 0);
  assert.equal(marketValueOf({ currentPrice: 10, shares: 0 }), 0);
  assert.equal(marketValueOf({}), 0);
  assert.equal(marketValueOf(null), 0);
});

test('costBasisOf is avg cost * shares, 0 when either is missing', () => {
  assert.equal(costBasisOf({ avg_cost: 20, shares: 5 }), 100);
  assert.equal(costBasisOf({ avgCost: 20, shares: 5 }), 100); // camelCase accepted
  assert.equal(costBasisOf({ avg_cost: 20 }), 0);
  assert.equal(costBasisOf({ shares: 5 }), 0);
  assert.equal(costBasisOf(null), 0);
});

test('pctOfBookOf divides market value by the passed holdings value', () => {
  assert.equal(pctOfBookOf({ currentValue: 3000 }, 10000), 30);
  assert.equal(pctOfBookOf({ currentPrice: 10, shares: 100 }, 5000), 20);
});

test('pctOfBookOf returns null when there is no book to divide by', () => {
  // Lets callers render a dash instead of NaN% or a misleading 0%.
  assert.strictEqual(pctOfBookOf({ currentValue: 100 }, 0), null);
  assert.strictEqual(pctOfBookOf({ currentValue: 100 }, null), null);
  assert.strictEqual(pctOfBookOf({ currentValue: 100 }, -5), null);
});

test('pctOfBookOf is 0 (not null) for a zero-value position in a real book', () => {
  assert.strictEqual(pctOfBookOf({ currentPrice: 0, shares: 10 }, 10000), 0);
});

test('computeBookStats: aggregates and per-position weights from one denominator', () => {
  const { book, positions } = computeBookStats([
    { ticker: 'A', currentValue: 6000, avg_cost: 50, shares: 100 }, // cost 5000
    { ticker: 'B', currentValue: 4000, avg_cost: 50, shares: 80 },  // cost 4000
  ]);
  assert.equal(book.holdingsValue, 10000);
  assert.equal(book.totalCost, 9000);
  assert.equal(book.unrealizedPnl, 1000);
  assert.equal(book.count, 2);
  assert.equal(positions[0].pctOfBook, 60);
  assert.equal(positions[1].pctOfBook, 40);
  assert.equal(positions[0].marketValue, 6000);
  assert.equal(positions[0].costBasis, 5000);
  assert.equal(positions[0].unrealizedPnl, 1000);
  assert.equal(positions[0].unrealizedPnlPct, 20); // 1000/5000
});

test('computeBookStats: weights are rounded to one decimal (one rounding)', () => {
  const { positions } = computeBookStats([
    { ticker: 'A', currentValue: 1 },
    { ticker: 'B', currentValue: 1 },
    { ticker: 'C', currentValue: 1 },
  ]);
  // 1/3 => 33.333... => 33.3 everywhere it is shown.
  assert.equal(positions[0].pctOfBook, 33.3);
});

test('computeBookStats: weights always sum to ~100 across the book', () => {
  const { positions } = computeBookStats([
    { ticker: 'A', currentValue: 1234 },
    { ticker: 'B', currentValue: 5678 },
    { ticker: 'C', currentValue: 910 },
    { ticker: 'D', currentValue: 42 },
  ]);
  const sum = positions.reduce((s, p) => s + p.pctOfBook, 0);
  assert.ok(Math.abs(sum - 100) < 0.5, `weights summed to ${sum}, expected ~100`);
});

test('computeBookStats: empty / junk book is safe and zeroed', () => {
  const { book, positions } = computeBookStats([]);
  assert.equal(book.holdingsValue, 0);
  assert.equal(book.count, 0);
  assert.deepEqual(positions, []);
  const j = computeBookStats(null);
  assert.equal(j.book.holdingsValue, 0);
  assert.deepEqual(j.positions, []);
});

test('computeBookStats: a position with no usable price gets pctOfBook 0, not NaN', () => {
  const { positions } = computeBookStats([
    { ticker: 'A', currentValue: 9000 },
    { ticker: 'B', avg_cost: 100, shares: 10 }, // no live price => mv 0
  ]);
  assert.equal(positions[0].pctOfBook, 100);
  assert.strictEqual(positions[1].pctOfBook, 0);
  assert.equal(positions[1].marketValue, 0);
  assert.equal(positions[1].costBasis, 1000); // cost still known
});

test('computeBookStats: preserves input order and unknown fields', () => {
  const { positions } = computeBookStats([
    { ticker: 'Z', currentValue: 100, entry_thesis: 'cheap', stop_loss: 9 },
  ]);
  assert.equal(positions[0].ticker, 'Z');
  assert.equal(positions[0].entry_thesis, 'cheap');
  assert.equal(positions[0].stop_loss, 9);
});

test('computeBookStats: unrealizedPnlPct is null when there is no cost basis', () => {
  const { positions, book } = computeBookStats([{ ticker: 'A', currentValue: 100 }]);
  assert.strictEqual(positions[0].unrealizedPnlPct, null);
  assert.strictEqual(book.unrealizedPnlPct, null);
});

test('bookStamp is order-independent: same holdings, same stamp', () => {
  const a = bookStamp([{ ticker: 'AAPL', shares: 10, avg_cost: 150 }, { ticker: 'MSFT', shares: 5, avg_cost: 300 }]);
  const b = bookStamp([{ ticker: 'MSFT', shares: 5, avg_cost: 300 }, { ticker: 'AAPL', shares: 10, avg_cost: 150 }]);
  assert.equal(a, b);
});

test('bookStamp changes when you add, close, or resize a position', () => {
  const base = [{ ticker: 'AAPL', shares: 10, avg_cost: 150 }];
  assert.notEqual(bookStamp(base), bookStamp([...base, { ticker: 'NVDA', shares: 3, avg_cost: 100 }])); // add
  assert.notEqual(bookStamp(base), bookStamp([])); // close to empty
  assert.notEqual(bookStamp(base), bookStamp([{ ticker: 'AAPL', shares: 20, avg_cost: 150 }])); // added shares
  assert.notEqual(bookStamp(base), bookStamp([{ ticker: 'AAPL', shares: 10, avg_cost: 160 }])); // re-averaged cost
});

test('bookStamp ignores live price moves (not a book change)', () => {
  // Same holdings with different live prices / market values must stamp equal,
  // so a ticking quote does not thrash the synthesis cache.
  const a = bookStamp([{ ticker: 'AAPL', shares: 10, avg_cost: 150, currentValue: 1600, currentPrice: 160 }]);
  const b = bookStamp([{ ticker: 'AAPL', shares: 10, avg_cost: 150, currentValue: 1800, currentPrice: 180 }]);
  assert.equal(a, b);
});

test('bookStamp is case-insensitive on ticker and safe on junk', () => {
  assert.equal(bookStamp([{ ticker: 'aapl', shares: 10, avg_cost: 150 }]), bookStamp([{ ticker: 'AAPL', shares: 10, avg_cost: 150 }]));
  assert.equal(bookStamp(null), '');
  assert.equal(bookStamp([null, undefined]), '');
});

test('mergeLots blends a bought-more lot at the weighted-average cost', () => {
  // 10 @ $150 + 5 @ $170 => 15 @ $156.67
  assert.deepEqual(mergeLots(10, 150, 5, 170), { shares: 15, avgCost: 156.67 });
  // Adding at the same price keeps the average.
  assert.deepEqual(mergeLots(10, 150, 10, 150), { shares: 20, avgCost: 150 });
});

test('mergeLots from an empty/new position just takes the new lot', () => {
  assert.deepEqual(mergeLots(0, 0, 5, 100), { shares: 5, avgCost: 100 });
});

test('mergeLots is safe on junk inputs', () => {
  assert.deepEqual(mergeLots(null, null, 3, 50), { shares: 3, avgCost: 50 });
  assert.deepEqual(mergeLots('x', 'y', 'z', 'w'), { shares: 0, avgCost: 0 });
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
