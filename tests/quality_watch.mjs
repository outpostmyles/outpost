// Unit test for the QualityWatch per-feature regression detector
// (detectQualityRegressions). Verifies it fires on a real recent-vs-prior
// flag-rate jump, stays quiet below the sample floor, ignores sub-threshold
// moves, never alarms on an improvement, and sorts the worst regression first.
import assert from 'node:assert/strict';
import { detectQualityRegressions } from '../src/lib/founderBrief.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const NOW = 1_700_000_000_000;
const DAY = 86400000;
// n graded rows for `feature`; flagged => score under threshold; aged `ageDays` before NOW.
function rows(feature, n, flagged, ageDays) {
  return Array.from({ length: n }, () => ({ feature, score: flagged ? 40 : 90, created_at: new Date(NOW - ageDays * DAY).toISOString() }));
}

test('fires on a real regression (prior clean, recent flagged)', () => {
  const data = [...rows('agent_chat', 12, false, 10), ...rows('agent_chat', 12, true, 1)];
  const r = detectQualityRegressions(data, { now: NOW, windowDays: 7, minRecent: 10, deltaThreshold: 15 });
  assert.equal(r.length, 1);
  assert.equal(r[0].feature, 'agent_chat');
  assert.equal(r[0].priorPct, 0);
  assert.equal(r[0].recentPct, 100);
  assert.equal(r[0].delta, 100);
});

test('quiet below the min-sample floor (noise, not signal)', () => {
  const data = [...rows('agent_chat', 3, false, 10), ...rows('agent_chat', 3, true, 1)];
  assert.equal(detectQualityRegressions(data, { now: NOW, minRecent: 10 }).length, 0);
});

test('quiet when the delta is below threshold', () => {
  // prior 10% flagged, recent 20% flagged -> delta 10 < 15
  const prior = [...rows('agent_chat', 9, false, 10), ...rows('agent_chat', 1, true, 10)];
  const recent = [...rows('agent_chat', 8, false, 1), ...rows('agent_chat', 2, true, 1)];
  assert.equal(detectQualityRegressions([...prior, ...recent], { now: NOW, minRecent: 10, deltaThreshold: 15 }).length, 0);
});

test('an improvement never alarms (negative delta)', () => {
  const data = [...rows('agent_chat', 12, true, 10), ...rows('agent_chat', 12, false, 1)];
  assert.equal(detectQualityRegressions(data, { now: NOW, minRecent: 10, deltaThreshold: 15 }).length, 0);
});

test('worst regression sorts first across features', () => {
  const data = [
    ...rows('a', 10, false, 10), ...rows('a', 5, false, 1), ...rows('a', 5, true, 1),   // a: 0% -> 50%
    ...rows('b', 10, false, 10), ...rows('b', 2, false, 1), ...rows('b', 8, true, 1),   // b: 0% -> 80%
  ];
  const r = detectQualityRegressions(data, { now: NOW, minRecent: 10, deltaThreshold: 15 });
  assert.equal(r.length, 2);
  assert.equal(r[0].feature, 'b'); // 80pt jump beats a's 50pt jump
});

test('a low score the founder marked "fine" does not count toward a regression', () => {
  // Recent rows would be 100% flagged by raw score, but the founder cleared them all.
  const prior = rows('agent_chat', 12, false, 10);
  const recent = Array.from({ length: 12 }, () => ({ feature: 'agent_chat', score: 40, review_verdict: 'fine', created_at: new Date(NOW - DAY).toISOString() }));
  const r = detectQualityRegressions([...prior, ...recent], { now: NOW, minRecent: 10, deltaThreshold: 15 });
  assert.equal(r.length, 0); // already human-cleared, so no false alarm
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} — ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
