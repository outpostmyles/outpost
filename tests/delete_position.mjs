// Pins the cash side of a TRUE position delete (src/lib/buyMath.js
// cashToRestoreOnDelete): deleting a position restores its original cost basis to
// cash IFF the buy debited cash, and never for a recorded holding. This is the exact
// inverse of a funded buy; a wrong answer here silently mis-states the account total.
import assert from 'node:assert/strict';
import { cashToRestoreOnDelete } from '../src/lib/buyMath.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('a recorded holding (funded_from_cash false) restores nothing', () => {
  assert.equal(cashToRestoreOnDelete({ funded_from_cash: false, avg_cost: 100, shares: 5 }), 0);
});

test('a funded buy restores the original cost basis, not proceeds', () => {
  // avg_cost * shares = what was paid; a delete erases the buy, so cash returns to pre-buy.
  assert.ok(close(cashToRestoreOnDelete({ funded_from_cash: true, avg_cost: 100, shares: 5 }), 500));
});

test('legacy null funded_from_cash is treated as funded (matches the close path)', () => {
  assert.ok(close(cashToRestoreOnDelete({ funded_from_cash: null, avg_cost: 50, shares: 2 }), 100));
});

test('a missing funded flag defaults to funded (restores basis)', () => {
  assert.ok(close(cashToRestoreOnDelete({ avg_cost: 10, shares: 3 }), 30));
});

test('zero or missing price/shares restores nothing, never NaN', () => {
  assert.equal(cashToRestoreOnDelete({ funded_from_cash: true, avg_cost: 0, shares: 5 }), 0);
  assert.equal(cashToRestoreOnDelete({ funded_from_cash: true, shares: 5 }), 0);
  assert.equal(cashToRestoreOnDelete({ funded_from_cash: true, avg_cost: 10 }), 0);
  assert.equal(cashToRestoreOnDelete({}), 0);
  assert.equal(cashToRestoreOnDelete(), 0);
});

test('non-finite / junk inputs restore nothing', () => {
  assert.equal(cashToRestoreOnDelete({ funded_from_cash: true, avg_cost: 'abc', shares: 5 }), 0);
  assert.equal(cashToRestoreOnDelete({ funded_from_cash: true, avg_cost: Infinity, shares: 5 }), 0);
});

test('rounds the restored amount to whole cents', () => {
  // 33.333 * 3 = 99.999 -> 100.00
  assert.ok(close(cashToRestoreOnDelete({ funded_from_cash: true, avg_cost: 33.333, shares: 3 }), 100));
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
