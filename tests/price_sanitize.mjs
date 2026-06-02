// Pins the price-snapshot sanitizer (api/services/pricePool.js via its test
// seam). The pool feeds the pre-trade check, alerts, and the agent's context,
// so a bad changePercent from the data vendor (a stale prevClose, a divide-by-
// zero, a +7,825% glitch) must be nulled here before it reaches any of them.
import assert from 'node:assert/strict';
import { _sanitizeSnapshotForTest as sanitize } from '../api/services/pricePool.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('a normal move passes through unchanged', () => {
  const s = sanitize('AAPL', { price: 150, changePercent: 2.5, prevClose: 146 });
  assert.equal(s.changePercent, 2.5);
});

test('an absurd positive move is nulled', () => {
  assert.equal(sanitize('XYZ', { price: 100, changePercent: 600 }).changePercent, null);
});

test('a near-total drop beyond the floor is nulled', () => {
  assert.equal(sanitize('XYZ', { price: 1, changePercent: -96 }).changePercent, null);
});

test('the bounds are inclusive (500 and -95 still pass)', () => {
  assert.equal(sanitize('XYZ', { price: 100, changePercent: 500 }).changePercent, 500);
  assert.equal(sanitize('XYZ', { price: 100, changePercent: -95 }).changePercent, -95);
  assert.equal(sanitize('XYZ', { price: 100, changePercent: 501 }).changePercent, null);
});

test('non-finite changePercent is nulled (the hardening)', () => {
  assert.equal(sanitize('XYZ', { price: 100, changePercent: NaN }).changePercent, null);
  assert.equal(sanitize('XYZ', { price: 100, changePercent: Infinity }).changePercent, null);
});

test('a null changePercent is left as null, not treated as an error', () => {
  assert.equal(sanitize('XYZ', { price: 100, changePercent: null }).changePercent, null);
});

test('missing snapshot or price is returned as-is without crashing', () => {
  assert.equal(sanitize('XYZ', null), null);
  const noPrice = sanitize('XYZ', { price: null, changePercent: 9 });
  assert.equal(noPrice.changePercent, 9); // untouched: no price to anchor a sanity check
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
