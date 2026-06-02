// Pins the position attention-badge logic (src/lib/positionStatus.js). These
// tiers decide what bubbles to the top of the portfolio and what badge a user
// sees, so the priority order and thresholds are locked here.
import assert from 'node:assert/strict';
import { computePositionStatus, fmtCompact } from '../src/lib/positionStatus.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('below stop is the most urgent, beats other signals', () => {
  const r = computePositionStatus({ currentPrice: 85, stop_loss: 90, avg_cost: 100, todayChangePercent: -10 }, 0);
  assert.equal(r.status, 'below_stop');
  assert.equal(r.score, 100);
  assert.equal(r.badgeLabel, 'BELOW STOP');
});

test('target hit and near target', () => {
  assert.equal(computePositionStatus({ currentPrice: 120, price_target: 115, avg_cost: 100 }, 0).status, 'target_hit');
  const near = computePositionStatus({ currentPrice: 110, price_target: 115, avg_cost: 100 }, 0);
  assert.equal(near.status, 'near_target');
  assert.equal(near.badgeLabel, '4.5% TO TARGET');
});

test('deep vs moderate drawdown thresholds', () => {
  assert.equal(computePositionStatus({ currentPrice: 75, avg_cost: 100 }, 0).status, 'deep_drawdown');   // -25%
  assert.equal(computePositionStatus({ currentPrice: 84, avg_cost: 100 }, 0).status, 'moderate_drawdown'); // -16%
});

test('big mover today, with signed badge and bounded score', () => {
  const up = computePositionStatus({ currentPrice: 100, avg_cost: 100, todayChangePercent: 7 }, 0);
  assert.equal(up.status, 'big_mover');
  assert.equal(up.score, 77);          // 70 + min(20, 7)
  assert.equal(up.badgeLabel, '+7.0% TODAY');
});

test('calm position gets no badge and zero score', () => {
  const r = computePositionStatus({ currentPrice: 101, avg_cost: 100 }, 0);
  assert.equal(r.status, 'calm');
  assert.equal(r.score, 0);
  assert.equal(r.badgeLabel, null);
});

test('concentration is the position share of total value', () => {
  const r = computePositionStatus({ currentPrice: 101, avg_cost: 100, currentValue: 3000 }, 10000);
  assert.equal(r.concentration, 30);
});

test('fmtCompact scales and guards non-finite', () => {
  assert.equal(fmtCompact(543), '543');
  assert.equal(fmtCompact(1200), '1.20K');
  assert.equal(fmtCompact(83400), '83.4K');
  assert.equal(fmtCompact(1_200_000), '1.2M');
  assert.equal(fmtCompact(null), '—');
  assert.equal(fmtCompact(NaN), '—');
  assert.equal(fmtCompact(Infinity), '—');   // hardening: was "InfinityM"
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
