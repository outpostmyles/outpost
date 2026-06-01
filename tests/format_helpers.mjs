// Pins the money/percent/color formatters (src/utils/market.js) that render on
// essentially every number in the UI. A regression here (a dropped null guard,
// a sign flip) would smear "NaN" or "Infinity" across every screen, so the
// behavior is locked: null/NaN/Infinity all degrade to the em-dash placeholder,
// numeric strings still format, signs and color thresholds hold.
import assert from 'node:assert/strict';
import { fmt, fmtPct, fmtDollar, colorFor } from '../src/utils/market.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('fmt: thousands, decimals, numeric strings, and bad input', () => {
  assert.equal(fmt(1234.5), '1,234.50');
  assert.equal(fmt(0), '0.00');
  assert.equal(fmt(5, 0), '5');
  assert.equal(fmt('12.5'), '12.50');     // numeric string still formats
  assert.equal(fmt(null), '—');
  assert.equal(fmt(undefined), '—');
  assert.equal(fmt(NaN), '—');
  assert.equal(fmt(Infinity), '—');        // the tightening: no "∞"
  assert.equal(fmt(-Infinity), '—');
});

test('fmtPct: signed, two decimals, guards', () => {
  assert.equal(fmtPct(3.2), '+3.20%');
  assert.equal(fmtPct(-1.5), '-1.50%');
  assert.equal(fmtPct(0), '+0.00%');
  assert.equal(fmtPct(null), '—');
  assert.equal(fmtPct(Infinity), '—');
});

test('fmtDollar: signed dollars with abs value, guards', () => {
  assert.equal(fmtDollar(1000), '+$1,000.00');
  assert.equal(fmtDollar(-50.5), '-$50.50');
  assert.equal(fmtDollar(null), '—');
  assert.equal(fmtDollar(Infinity), '—');
});

test('colorFor: green up, red down, muted on bad input', () => {
  assert.equal(colorFor(5), 'var(--green)');
  assert.equal(colorFor(0), 'var(--green)');   // >= 0
  assert.equal(colorFor(-5), 'var(--red)');
  assert.equal(colorFor(null), 'var(--muted)');
  assert.equal(colorFor(NaN), 'var(--muted)');
  assert.equal(colorFor(Infinity), 'var(--muted)');
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
