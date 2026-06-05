// Pins the realized-sale math (src/lib/saleMath.js). Money-critical: it decides
// proceeds, realized P&L, and the remaining position on a full close or a trim.
import assert from 'node:assert/strict';
import { computeSale } from '../src/lib/saleMath.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
const NOW = Date.parse('2026-06-15T00:00:00Z');

test('selling everything is a full close, realizes the whole P&L, leaves nothing', () => {
  const s = computeSale({ avgCost: 100, shares: 10, sellShares: 10, sellPrice: 130, nowMs: NOW });
  assert.equal(s.ok, true);
  assert.equal(s.isFullClose, true);
  assert.equal(s.sharesSold, 10);
  assert.equal(s.remaining, 0);
  assert.equal(s.proceeds, 1300);
  assert.equal(s.pnl, 300);          // (130-100)*10
  assert.equal(s.pnlPercent, 30);
});

test('selling some realizes P&L only on the shares sold, leaves the rest at the same cost', () => {
  const s = computeSale({ avgCost: 100, shares: 10, sellShares: 4, sellPrice: 130, nowMs: NOW });
  assert.equal(s.isFullClose, false);
  assert.equal(s.sharesSold, 4);
  assert.equal(s.remaining, 6);
  assert.equal(s.proceeds, 520);     // 130*4
  assert.equal(s.pnl, 120);          // (130-100)*4
  assert.equal(s.pnlPercent, 30);    // per-share gain is the same, so the % matches
});

test('a trim at a loss is negative P&L', () => {
  const s = computeSale({ avgCost: 200, shares: 5, sellShares: 2, sellPrice: 150, nowMs: NOW });
  assert.equal(s.pnl, -100);         // (150-200)*2
  assert.equal(s.pnlPercent, -25);
  assert.equal(s.remaining, 3);
});

test('selling slightly more than held, within epsilon, counts as a full close', () => {
  const s = computeSale({ avgCost: 100, shares: 10, sellShares: 10.0000000001, sellPrice: 110, nowMs: NOW });
  assert.equal(s.isFullClose, true);
  assert.equal(s.sharesSold, 10);
});

test('selling more than held is rejected', () => {
  assert.equal(computeSale({ avgCost: 100, shares: 10, sellShares: 11, sellPrice: 110 }).error, 'exceeds_held');
});

test('zero, negative, or junk share counts are rejected', () => {
  assert.equal(computeSale({ avgCost: 100, shares: 10, sellShares: 0, sellPrice: 110 }).error, 'invalid_shares');
  assert.equal(computeSale({ avgCost: 100, shares: 10, sellShares: -3, sellPrice: 110 }).error, 'invalid_shares');
  assert.equal(computeSale({ avgCost: 100, shares: 10, sellShares: 'abc', sellPrice: 110 }).error, 'invalid_shares');
});

test('an empty position cannot be sold', () => {
  assert.equal(computeSale({ avgCost: 100, shares: 0, sellShares: 1, sellPrice: 110 }).error, 'no_shares');
});

test('fractional shares are supported', () => {
  const s = computeSale({ avgCost: 50, shares: 2.5, sellShares: 1.5, sellPrice: 60, nowMs: NOW });
  assert.equal(s.sharesSold, 1.5);
  assert.equal(s.remaining, 1);
  assert.equal(s.proceeds, 90);      // 60*1.5
  assert.equal(s.pnl, 15);           // (60-50)*1.5
});

test('hold days count UTC calendar days from the purchase date; null when unknown', () => {
  const s = computeSale({ avgCost: 100, shares: 1, sellShares: 1, sellPrice: 100, purchasedAt: '2026-06-05T00:00:00Z', nowMs: NOW });
  assert.equal(s.holdDays, 10);
  assert.equal(computeSale({ avgCost: 100, shares: 1, sellShares: 1, sellPrice: 100, nowMs: NOW }).holdDays, null);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
