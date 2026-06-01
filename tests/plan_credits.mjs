// Pins the per-plan monthly credit grant. Both signup (auth.js) and the monthly
// reset (runner.js) import this one source, so they can't drift; this test makes
// any change to the numbers deliberate.
import assert from 'node:assert/strict';
import { PLAN_CREDITS } from '../api/constants/planCredits.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('every plan tier has a finite credit grant', () => {
  for (const plan of ['free', 'starter', 'pro', 'elite', 'unlimited']) {
    assert.ok(Number.isFinite(PLAN_CREDITS[plan]), `${plan} is missing a credit grant`);
  }
});

test('tiers increase, and unlimited is effectively unlimited', () => {
  assert.equal(PLAN_CREDITS.free, 50);
  assert.ok(PLAN_CREDITS.starter > PLAN_CREDITS.free);
  assert.ok(PLAN_CREDITS.pro > PLAN_CREDITS.starter);
  assert.ok(PLAN_CREDITS.elite > PLAN_CREDITS.pro);
  assert.ok(PLAN_CREDITS.unlimited >= 1_000_000);
});

test('an unknown plan is not in the map (callers must fall back)', () => {
  assert.equal(PLAN_CREDITS.bogus, undefined);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
