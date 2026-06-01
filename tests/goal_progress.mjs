// Unit tests for goalProgress (src/lib/goalProgress.js).
import assert from 'node:assert/strict';
import { goalProgress } from '../src/lib/goalProgress.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('returns null for a missing or non-positive target', () => {
  assert.equal(goalProgress(100, 0), null);
  assert.equal(goalProgress(100, null), null);
  assert.equal(goalProgress(100, -5), null);
  assert.equal(goalProgress(100, 'nope'), null);
});

test('computes percent and remaining at the halfway point', () => {
  const p = goalProgress(50000, 100000);
  assert.equal(p.pct, 50);
  assert.equal(p.remaining, 50000);
  assert.equal(p.reached, false);
});

test('caps percent at 100 and flags reached when at or over target', () => {
  const p = goalProgress(120000, 100000);
  assert.equal(p.pct, 100);
  assert.equal(p.remaining, 0);
  assert.equal(p.reached, true);
  const exact = goalProgress(100000, 100000);
  assert.equal(exact.reached, true);
});

test('treats missing or negative current as zero', () => {
  const p = goalProgress(undefined, 100000);
  assert.equal(p.pct, 0);
  assert.equal(p.remaining, 100000);
  assert.equal(p.current, 0);
});

test('rounds percent to one decimal', () => {
  assert.equal(goalProgress(33333, 100000).pct, 33.3);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
