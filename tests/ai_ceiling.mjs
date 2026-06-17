// Unit test for the per-user daily AI call ceiling. Verifies:
//  1. First N-1 calls are allowed
//  2. Call N hits the cap (allowed=true at exact cap-1, then false)
//  3. Different users have independent counters
//  4. Reset helper works
import assert from 'node:assert/strict';
import { checkAndIncrementAiCall, peekAiCeiling, recordAiCall, getAiCallCount, _resetAiCallCount } from '../api/services/aiSpendCeiling.js';

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

test('peekAiCeiling checks without incrementing', () => {
  _resetAiCallCount('p1');
  const a = peekAiCeiling('p1', 5);
  const b = peekAiCeiling('p1', 5);
  assert.equal(a.allowed, true);
  assert.equal(a.count, 0);
  assert.equal(b.count, 0); // peeking never advances the counter
  assert.equal(getAiCallCount('p1'), 0);
});

test('recordAiCall advances the counter (one per real model call)', () => {
  _resetAiCallCount('p2');
  for (let i = 1; i <= 7; i++) assert.equal(recordAiCall('p2'), i);
  assert.equal(getAiCallCount('p2'), 7);
});

test('gate + per-call record: one request of 7 calls counts as 7, not 1', () => {
  // The bug this split fixes: the old path incremented once per REQUEST, so a
  // 7-call agent turn registered as 1 (a ~7x undercount). Now the gate only
  // checks and each real model call records, so the daily ledger is honest.
  _resetAiCallCount('p3');
  const gate = peekAiCeiling('p3', 300); // start-of-turn gate, no increment
  assert.equal(gate.allowed, true);
  assert.equal(getAiCallCount('p3'), 0);
  for (let i = 0; i < 7; i++) recordAiCall('p3'); // initial + tool rounds + synthesis
  assert.equal(getAiCallCount('p3'), 7);
});

test('peekAiCeiling blocks at the cap, allows under it', () => {
  _resetAiCallCount('p4');
  for (let i = 0; i < 3; i++) recordAiCall('p4');
  assert.equal(peekAiCeiling('p4', 3).allowed, false); // at cap
  _resetAiCallCount('p5');
  for (let i = 0; i < 2; i++) recordAiCall('p5');
  assert.equal(peekAiCeiling('p5', 3).allowed, true); // under cap
});

test('anonymous: peek allowed, record is a no-op', () => {
  assert.equal(peekAiCeiling(null, 5).allowed, true);
  assert.equal(recordAiCall(null), 0);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} — ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
