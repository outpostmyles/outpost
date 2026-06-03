// Pins the brokerage reconciliation engine (src/lib/brokerageSync.js), the hard,
// provider-free core of auto-syncing a connected brokerage. Proves the holdings
// diff (buys, sells, sold-out, unchanged), lot-merging, cash summing, and junk
// safety BEFORE any live API key exists, so finishing the HTTP adapter later is
// low-risk.
import assert from 'node:assert/strict';
import {
  normalizeHolding, normalizeHoldings, reconcileHoldings, buildSyncState, totalCashFromBalances,
} from '../src/lib/brokerageSync.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('normalizeHolding accepts common field aliases and rounds', () => {
  assert.deepEqual(normalizeHolding({ symbol: 'aapl', units: 10, average_purchase_price: 150.123 }), { ticker: 'AAPL', shares: 10, avgCost: 150.12 });
  assert.deepEqual(normalizeHolding({ ticker: 'MSFT', shares: 5, avgCost: 300 }), { ticker: 'MSFT', shares: 5, avgCost: 300 });
  assert.deepEqual(normalizeHolding({ ticker: 'F', quantity: 2.5 }), { ticker: 'F', shares: 2.5, avgCost: null }); // no cost known
});

test('normalizeHolding rejects junk and non-positive shares', () => {
  assert.strictEqual(normalizeHolding({ ticker: 'AAPL', shares: 0 }), null);
  assert.strictEqual(normalizeHolding({ ticker: 'AAPL', shares: -3 }), null);
  assert.strictEqual(normalizeHolding({ shares: 10 }), null); // no ticker
  assert.strictEqual(normalizeHolding(null), null);
  assert.strictEqual(normalizeHolding('AAPL'), null);
});

test('normalizeHoldings merges repeated tickers share-weighted', () => {
  const out = normalizeHoldings([
    { ticker: 'AAPL', shares: 10, avgCost: 100 },
    { ticker: 'AAPL', shares: 10, avgCost: 200 }, // second lot
    { ticker: 'MSFT', shares: 5, avgCost: 300 },
  ]);
  assert.equal(out.length, 2);
  const aapl = out.find(h => h.ticker === 'AAPL');
  assert.equal(aapl.shares, 20);
  assert.equal(aapl.avgCost, 150); // (100*10 + 200*10)/20
});

test('reconcile: first sync opens every holding as a buy, nothing to close', () => {
  const { upserts, closes, trades } = reconcileHoldings([], [
    { ticker: 'AAPL', shares: 10, avgCost: 150 },
    { ticker: 'NVDA', shares: 3, avgCost: 100 },
  ]);
  assert.equal(upserts.length, 2);
  assert.deepEqual(closes, []);
  assert.equal(trades.length, 2);
  assert.ok(trades.every(t => t.action === 'buy'));
});

test('reconcile: a grown position is a buy for the delta', () => {
  const prev = [{ ticker: 'AAPL', shares: 10, avgCost: 150 }];
  const { trades, upserts } = reconcileHoldings(prev, [{ ticker: 'AAPL', shares: 15, avgCost: 160 }]);
  const t = trades.find(x => x.ticker === 'AAPL');
  assert.equal(t.action, 'buy');
  assert.equal(t.sharesDelta, 5);
  assert.equal(upserts[0].shares, 15);
  assert.equal(upserts[0].avgCost, 160); // broker is source of truth
});

test('reconcile: a trimmed position is a sell for the delta', () => {
  const prev = [{ ticker: 'AAPL', shares: 10, avgCost: 150 }];
  const { trades } = reconcileHoldings(prev, [{ ticker: 'AAPL', shares: 4, avgCost: 150 }]);
  const t = trades.find(x => x.ticker === 'AAPL');
  assert.equal(t.action, 'sell');
  assert.equal(t.sharesDelta, 6);
  assert.equal(t.shares, 4);
});

test('reconcile: a position the broker no longer holds is closed and sold', () => {
  const prev = [{ ticker: 'AAPL', shares: 10, avgCost: 150 }, { ticker: 'NVDA', shares: 3, avgCost: 100 }];
  const { closes, trades, upserts } = reconcileHoldings(prev, [{ ticker: 'AAPL', shares: 10, avgCost: 150 }]);
  assert.deepEqual(closes, ['NVDA']);
  assert.ok(!upserts.find(u => u.ticker === 'NVDA')); // not upserted
  const t = trades.find(x => x.ticker === 'NVDA');
  assert.equal(t.action, 'sell');
  assert.equal(t.shares, 0);
});

test('reconcile: an unchanged position produces no trade', () => {
  const prev = [{ ticker: 'AAPL', shares: 10, avgCost: 150 }];
  const { trades, upserts } = reconcileHoldings(prev, [{ ticker: 'AAPL', shares: 10, avgCost: 150 }]);
  assert.equal(trades.length, 0);
  assert.equal(upserts.length, 1); // still upserted (source of truth), just no trade
});

test('reconcile: an avg-cost-only change updates the position but is not a trade', () => {
  // Same shares, different avg cost (a broker correction): write it, but do not
  // fabricate a buy/sell since the share count did not move.
  const prev = [{ ticker: 'AAPL', shares: 10, avgCost: 150 }];
  const { trades, upserts } = reconcileHoldings(prev, [{ ticker: 'AAPL', shares: 10, avgCost: 148 }]);
  assert.equal(trades.length, 0);
  assert.equal(upserts[0].avgCost, 148);
});

test('reconcile: fractional-share noise under tolerance is not a trade', () => {
  const prev = [{ ticker: 'AAPL', shares: 10, avgCost: 150 }];
  const { trades } = reconcileHoldings(prev, [{ ticker: 'AAPL', shares: 10.0000001, avgCost: 150 }]);
  assert.equal(trades.length, 0);
});

test('reconcile is safe on junk broker payloads', () => {
  const prev = [{ ticker: 'AAPL', shares: 10, avgCost: 150 }];
  const r = reconcileHoldings(prev, null);
  // null broker holdings: nothing current, so the prior AAPL reads as sold out.
  assert.deepEqual(r.closes, ['AAPL']);
  assert.deepEqual(r.upserts, []);
  assert.doesNotThrow(() => reconcileHoldings(null, undefined));
});

test('buildSyncState captures account, timestamp, and normalized holdings', () => {
  const s = buildSyncState([{ ticker: 'aapl', shares: 10, avgCost: 150 }], { accountId: 'acct_1', at: '2026-06-03T20:00:00Z' });
  assert.equal(s.accountId, 'acct_1');
  assert.equal(s.lastSyncedAt, '2026-06-03T20:00:00Z');
  assert.deepEqual(s.holdings, [{ ticker: 'AAPL', shares: 10, avgCost: 150 }]);
});

test('totalCashFromBalances sums positive cash and ignores junk', () => {
  assert.equal(totalCashFromBalances([{ cash: 100.5 }, { amount: 50 }]), 150.5);
  assert.equal(totalCashFromBalances([{ cash: 100 }, { cash: -20 }, { cash: NaN }, {}]), 100);
  assert.equal(totalCashFromBalances(null), 0);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
