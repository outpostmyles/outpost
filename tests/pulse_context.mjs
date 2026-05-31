// Unit tests for the PULSE emotional-register helpers
// (api/services/pulseContext.js). Pins the storm thresholds, the calm default,
// the prompt directive, and the register-aware deterministic fallback.
import assert from 'node:assert/strict';
import { assessRegister, moodDirective, pickPulseFallback } from '../api/services/pulseContext.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('benign signals stay calm', () => {
  const { register, reasons } = assessRegister({ pnlPercent: 12, dayMovePercent: -1, vix: 16, fearGreed: 55 });
  assert.equal(register, 'calm');
  assert.deepEqual(reasons, []);
});

test('a broken stop flips to storm', () => {
  assert.equal(assessRegister({ brokenStop: true }).register, 'storm');
});

test('a hard daily drop flips to storm', () => {
  assert.equal(assessRegister({ dayMovePercent: -7 }).register, 'storm');
  // a mild dip does not
  assert.equal(assessRegister({ dayMovePercent: -3 }).register, 'calm');
});

test('a deeply underwater book flips to storm', () => {
  assert.equal(assessRegister({ pnlPercent: -20 }).register, 'storm');
  assert.equal(assessRegister({ pnlPercent: -5 }).register, 'calm');
});

test('elevated volatility and extreme fear each flip to storm', () => {
  assert.equal(assessRegister({ vix: 30 }).register, 'storm');
  assert.equal(assessRegister({ fearGreed: 15 }).register, 'storm');
  assert.equal(assessRegister({ vix: 18, fearGreed: 50 }).register, 'calm');
});

test('reasons accumulate and are human-readable', () => {
  const { reasons } = assessRegister({ brokenStop: true, vix: 35 });
  assert.equal(reasons.length, 2);
  assert.ok(reasons.some(r => r.includes('stop')));
  assert.ok(reasons.some(r => r.includes('volatility')));
});

test('missing / null inputs never throw and read calm', () => {
  assert.equal(assessRegister().register, 'calm');
  assert.equal(assessRegister({ pnlPercent: null, vix: undefined }).register, 'calm');
  assert.equal(assessRegister({ vix: 'n/a' }).register, 'calm');
});

test('moodDirective is set only in a storm', () => {
  assert.equal(moodDirective('calm'), '');
  const storm = moodDirective('storm');
  assert.ok(storm.includes('calm voice'));
  assert.ok(/do NOT cheerlead/i.test(storm));
});

test('fallback pool is register-aware', () => {
  const storm = pickPulseFallback('storm', 0);
  const calm = pickPulseFallback('calm', 0);
  assert.ok(/breathe|plan|do not have to/i.test(storm.toLowerCase()));
  assert.ok(/coffee|markets|fires|silence|steady/i.test(calm.toLowerCase()));
});

test('fallback is deterministic by seed and stays in bounds', () => {
  assert.equal(pickPulseFallback('calm', 7), pickPulseFallback('calm', 7));
  for (const seed of [0, 1, 2, 99, 1000, -3]) {
    assert.equal(typeof pickPulseFallback('storm', seed), 'string');
    assert.ok(pickPulseFallback('storm', seed).length > 0);
  }
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
