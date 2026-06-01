// Unit tests for shouldFire (api/services/alertRules.js), the alert-firing
// decision behind every price-alert email. Pins all three directions and the
// guard conditions.
import assert from 'node:assert/strict';
import { shouldFire } from '../api/services/alertRules.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('above fires at or past the threshold, not below', () => {
  assert.equal(shouldFire({ direction: 'above', threshold: 100 }, { price: 101 }), true);
  assert.equal(shouldFire({ direction: 'above', threshold: 100 }, { price: 100 }), true); // inclusive
  assert.equal(shouldFire({ direction: 'above', threshold: 100 }, { price: 99 }), false);
});

test('below fires at or under the threshold, not above', () => {
  assert.equal(shouldFire({ direction: 'below', threshold: 50 }, { price: 49 }), true);
  assert.equal(shouldFire({ direction: 'below', threshold: 50 }, { price: 50 }), true); // inclusive
  assert.equal(shouldFire({ direction: 'below', threshold: 50 }, { price: 51 }), false);
});

test('percent_change with a positive threshold fires on a big gain', () => {
  assert.equal(shouldFire({ direction: 'percent_change', threshold: 5 }, { price: 10, changePercent: 6 }), true);
  assert.equal(shouldFire({ direction: 'percent_change', threshold: 5 }, { price: 10, changePercent: 4 }), false);
});

test('percent_change with a negative threshold fires on a big drop', () => {
  assert.equal(shouldFire({ direction: 'percent_change', threshold: -5 }, { price: 10, changePercent: -6 }), true);
  assert.equal(shouldFire({ direction: 'percent_change', threshold: -5 }, { price: 10, changePercent: -4 }), false);
});

test('percent_change does not fire when the day change is unknown', () => {
  assert.equal(shouldFire({ direction: 'percent_change', threshold: 5 }, { price: 10, changePercent: null }), false);
});

test('no live price never fires', () => {
  assert.equal(shouldFire({ direction: 'above', threshold: 100 }, {}), false);
  assert.equal(shouldFire({ direction: 'above', threshold: 100 }, null), false);
});

test('a non-numeric or unknown alert never fires', () => {
  assert.equal(shouldFire({ direction: 'above', threshold: 'abc' }, { price: 100 }), false);
  assert.equal(shouldFire({ direction: 'sideways', threshold: 100 }, { price: 100 }), false);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
