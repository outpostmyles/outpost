// Pins the market-regime classifier (api/services/marketData.js). The
// Risk Off / Risk On / Neutral label it produces from VIX and Fear & Greed
// feeds the agent's read of the market and the daily pulse, so the thresholds
// are locked here. Includes the exact case from a real boot (VIX 27, F&G 57).
import assert from 'node:assert/strict';
import { classifyRegime } from '../api/services/marketData.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('both feeds missing -> Unknown', () => {
  assert.equal(classifyRegime(undefined, undefined), 'Unknown');
  assert.equal(classifyRegime(null, null), 'Unknown');
});

test('high VIX with extreme fear -> Risk Off', () => {
  assert.equal(classifyRegime(30, 20), 'Risk Off');
});

test('calm VIX with greed -> Risk On', () => {
  assert.equal(classifyRegime(15, 70), 'Risk On');
  assert.equal(classifyRegime(18, 60), 'Risk On');   // inclusive boundary
});

test('elevated VIX alone -> Risk Off', () => {
  assert.equal(classifyRegime(23, 50), 'Risk Off');  // vix >= 22
});

test('extreme fear alone -> Risk Off', () => {
  assert.equal(classifyRegime(20, 30), 'Risk Off');  // fg <= 35
});

test('calm tape with middling sentiment -> Neutral', () => {
  assert.equal(classifyRegime(20, 50), 'Neutral');
  assert.equal(classifyRegime(18, 59), 'Neutral');   // just shy of Risk On
});

test('the real boot case (VIX 27, F&G 57) -> Risk Off', () => {
  assert.equal(classifyRegime(27, 57), 'Risk Off');
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
