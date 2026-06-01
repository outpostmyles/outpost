// Unit tests for projectGoal (src/lib/goalProjection.js).
import assert from 'node:assert/strict';
import { projectGoal } from '../src/lib/goalProjection.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const NOW = Date.parse('2026-06-01T00:00:00Z');
const dayStr = (offsetDays) => new Date(NOW + offsetDays * 86400000).toISOString().slice(0, 10);

test('no valid target means no data', () => {
  assert.deepEqual(projectGoal({ target: 0 }), { enoughData: false });
  assert.deepEqual(projectGoal({ target: null }), { enoughData: false });
});

test('already at or above target reads as reached', () => {
  const p = projectGoal({ snapshots: [], current: 600000, target: 500000 });
  assert.equal(p.reached, true);
});

test('fewer than two snapshots is not enough data', () => {
  assert.equal(projectGoal({ snapshots: [{ date: dayStr(-30), total_value: 100000 }], current: 100000, target: 500000 }).enoughData, false);
});

test('a short history (under three weeks) is not enough data', () => {
  const p = projectGoal({
    snapshots: [{ date: dayStr(-10), total_value: 100000 }, { date: dayStr(0), total_value: 110000 }],
    current: 110000, target: 500000, nowMs: NOW,
  });
  assert.equal(p.enoughData, false);
});

test('a positive pace projects a years-away estimate', () => {
  // 100k -> 130k over 90 days = 333.33/day. From 130k to 500k = 370k / 333.33 = ~1110 days = ~3.0y.
  const p = projectGoal({
    snapshots: [{ date: dayStr(-90), total_value: 100000 }, { date: dayStr(0), total_value: 130000 }],
    current: 130000, target: 500000, nowMs: NOW,
  });
  assert.equal(p.onTrack, true);
  assert.equal(p.yearsAway, 3);
  assert.equal(p.perMonth, 10000);
});

test('a flat or declining book is honestly not on track', () => {
  const p = projectGoal({
    snapshots: [{ date: dayStr(-60), total_value: 120000 }, { date: dayStr(0), total_value: 110000 }],
    current: 110000, target: 500000, nowMs: NOW,
  });
  assert.equal(p.enoughData, true);
  assert.equal(p.onTrack, false);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
