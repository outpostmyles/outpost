// Pins the technical indicators (api/services/indicators.js) the agent reports
// to a user. Uses hand-computable reference cases so a smoothing or period bug
// is caught: monotonic series drive RSI to its extremes, and the small-period
// cases are worked out by hand against Wilder's method.
import assert from 'node:assert/strict';
import { calcRSI, calcATR, calcSMA } from '../api/services/indicators.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('RSI: all gains -> 100, all losses -> 0', () => {
  const up = Array.from({ length: 20 }, (_, i) => i + 1);       // 1..20
  const down = Array.from({ length: 20 }, (_, i) => 20 - i);    // 20..1
  assert.equal(calcRSI(up, 14), 100);
  assert.equal(calcRSI(down, 14), 0);
});

test('RSI: Wilder smoothing on a hand-computed series', () => {
  // period 2, closes [10,11,10,11]:
  // seed avgGain=avgLoss=0.5; step diff +1 -> avgGain 0.75, avgLoss 0.25; rs 3 -> 75.0
  assert.equal(calcRSI([10, 11, 10, 11], 2), 75.0);
});

test('RSI: not enough data returns null', () => {
  assert.equal(calcRSI([1, 2, 3], 14), null);
  assert.equal(calcRSI(null, 14), null);
});

test('ATR: Wilder-smoothed true range, hand-computed', () => {
  // TRs work out to [2,4,6] (h-l dominates, prevClose mid-range).
  // period 2: seed (2+4)/2 = 3; step (3*1 + 6)/2 = 4.5
  const bars = [
    { h: 0, l: 0, c: 10 },
    { h: 11, l: 9, c: 10 },  // TR = max(2, 1, 1) = 2
    { h: 12, l: 8, c: 10 },  // TR = max(4, 2, 2) = 4
    { h: 13, l: 7, c: 10 },  // TR = max(6, 3, 3) = 6
  ];
  assert.equal(calcATR(bars, 2), 4.5);
});

test('ATR: not enough data returns null', () => {
  assert.equal(calcATR([{ h: 1, l: 0, c: 1 }], 14), null);
  assert.equal(calcATR(null, 14), null);
});

test('SMA: trailing average, exact', () => {
  assert.equal(calcSMA([10, 20, 30, 40], 4), 25);
  assert.equal(calcSMA([1, 2, 4, 6], 2), 5);   // last two: (4+6)/2
});

test('SMA: not enough data returns null', () => {
  assert.equal(calcSMA([1], 2), null);
  assert.equal(calcSMA(null, 2), null);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
