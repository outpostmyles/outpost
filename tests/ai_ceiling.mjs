// Unit test for the per-user daily AI call ceiling. Verifies:
//  1. First N-1 calls are allowed
//  2. Call N hits the cap (allowed=true at exact cap-1, then false)
//  3. Different users have independent counters
//  4. Reset helper works
import assert from 'node:assert/strict';
import { checkAndIncrementAiCall, getAiCallCount, _resetAiCallCount } from '../api/services/aiSpendCeiling.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('first call increments and allows', () => {
  _resetAiCallCount('u1');
  const r = checkAndIncrementAiCall('u1', 5);
  assert.equal(r.allowed, true);
  assert.equal(r.count, 1);
  assert.equal(r.cap, 5);
});

test('cap blocks at exactly N+1', () => {
  _resetAiCallCount('u2');
  for (let i = 1; i <= 5; i++) {
    const r = checkAndIncrementAiCall('u2', 5);
    assert.equal(r.allowed, true, `call ${i} should be allowed`);
    assert.equal(r.count, i);
  }
  const over = checkAndIncrementAiCall('u2', 5);
  assert.equal(over.allowed, false);
  assert.equal(over.count, 5); // count NOT incremented when blocked
});

test('users have independent counters', () => {
  _resetAiCallCount('u3a'); _resetAiCallCount('u3b');
  for (let i = 0; i < 3; i++) checkAndIncrementAiCall('u3a', 10);
  for (let i = 0; i < 7; i++) checkAndIncrementAiCall('u3b', 10);
  assert.equal(getAiCallCount('u3a'), 3);
  assert.equal(getAiCallCount('u3b'), 7);
});

test('anonymous (no userId) always allowed without tracking', () => {
  const r = checkAndIncrementAiCall(null, 5);
  assert.equal(r.allowed, true);
  assert.equal(r.count, 0);
});

test('blocked user stays blocked across multiple over-cap attempts', () => {
  _resetAiCallCount('u5');
  for (let i = 0; i < 3; i++) checkAndIncrementAiCall('u5', 3);
  for (let i = 0; i < 10; i++) {
    const r = checkAndIncrementAiCall('u5', 3);
    assert.equal(r.allowed, false);
  }
  assert.equal(getAiCallCount('u5'), 3); // didn't drift
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} — ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
