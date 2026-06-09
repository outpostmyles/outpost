// Pins the "think it through" trade-plan assessment: it reuses the existing
// sizing + risk/reward math, grades the six disciplines, and is honest about
// whether the user has a plan or a gut buy, always surfacing the invalidation
// (the step most people skip). Pure, no IO.
import { assessTradePlan } from '../api/services/tradePlan.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg || 'eq'}: expected ${B}, got ${A}`); }
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }
const step = (r, k) => r.steps.find(s => s.key === k);

test('a bare ticker with no stop and no invalidation is a gut buy', () => {
  const r = assessTradePlan({ entry_price: 100, thesis: 'I like it' });
  eq(r.verdict, 'gut_buy', 'verdict');
  ok(/gut buy/.test(r.headline), 'headline');
  ok(r.missing.includes('stop') && r.missing.includes('invalidation'), 'names the gaps');
});

test('a full plan grades thought_through and complete, reusing the math', () => {
  const r = assessTradePlan({
    entry_price: 100, stop_loss: 90, target_price: 130, account_size: 10000, risk_pct: 2,
    thesis: 'data-center demand keeps compounding',
    invalidation: 'two quarters of decelerating data-center revenue',
    review_in_days: 30,
  });
  eq(r.verdict, 'thought_through', 'verdict');
  eq(r.completeness, 6, 'all six');
  eq(r.missing, [], 'nothing missing');
  ok(r.sizing && r.sizing.shares_to_buy === 20, 'reuses sizing math (200 risk / 10 per share)');
  ok(r.riskReward && r.riskReward.best_risk_reward === '3.0:1', 'reuses R/R math');
});

test('hard parts present but loose ends still reads thought_through, names what is open', () => {
  const r = assessTradePlan({ entry_price: 100, stop_loss: 90, thesis: 'x', invalidation: 'y' });
  eq(r.verdict, 'thought_through', 'verdict');
  ok(/Still open/.test(r.headline), 'names the open items');
  ok(r.missing.includes('target') && r.missing.includes('sized') && r.missing.includes('review'), 'gaps');
});

test('a stop but no invalidation has gaps and names the invalidation first', () => {
  const r = assessTradePlan({ entry_price: 100, stop_loss: 90, thesis: 'x' });
  eq(r.verdict, 'has_gaps', 'verdict');
  eq(r.missing[0], 'invalidation', 'invalidation is the first gap');
  ok(/prove you wrong/.test(r.headline), 'headline teaches why');
});

test('a stop at or above entry does not count as a stop', () => {
  eq(step(assessTradePlan({ entry_price: 100, stop_loss: 100, thesis: 'x', invalidation: 'y' }), 'stop').present, false, 'equal');
  eq(step(assessTradePlan({ entry_price: 100, stop_loss: 110, thesis: 'x', invalidation: 'y' }), 'stop').present, false, 'above');
});

test('sizing warnings bubble up (over-concentration)', () => {
  const r = assessTradePlan({ entry_price: 100, stop_loss: 99, account_size: 10000, risk_pct: 5, thesis: 'x', invalidation: 'y' });
  ok(Array.isArray(r.warnings), 'array');
  ok(r.warnings.some(w => /DANGER|account/.test(w)), 'concentration warning surfaces');
});

test('the invalidation step always carries why it gets skipped', () => {
  ok(/skip/.test(step(assessTradePlan({}), 'invalidation').why), 'teaches the why');
});

test('garbage input never throws and returns the six steps', () => {
  for (const bad of [null, undefined, {}, { entry_price: 'x' }, { stop_loss: -5 }]) {
    const r = assessTradePlan(bad);
    ok(r && typeof r.verdict === 'string' && Array.isArray(r.steps) && r.steps.length === 6, 'shape holds');
  }
});

let pass = 0, fail = 0;
for (const { n, f } of tests) {
  try { f(); console.log(`ok   ${n}`); pass++; }
  catch (e) { console.log(`FAIL ${n}: ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
