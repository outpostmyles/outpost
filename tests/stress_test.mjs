// Unit tests for buildStressTests (src/lib/stressTest.js).
import assert from 'node:assert/strict';
import { buildStressTests } from '../src/lib/stressTest.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const pos = (ticker, currentValue) => ({ ticker, currentValue });

test('empty book returns no scenarios', () => {
  assert.deepEqual(buildStressTests([]), []);
  assert.deepEqual(buildStressTests(null), []);
});

test('market scenarios are a flat percent of total value', () => {
  const s = buildStressTests([pos('A', 6000), pos('B', 4000)]); // total 10000
  const m10 = s.find(x => x.key === 'market_10');
  const m25 = s.find(x => x.key === 'market_25');
  assert.equal(m10.impact, -1000);
  assert.equal(m10.pct, -10);
  assert.equal(m25.impact, -2500);
  assert.equal(m25.pct, -25);
});

test('single-name shock hits the biggest holding, exact', () => {
  const s = buildStressTests([pos('NVDA', 5000), pos('AAPL', 3000), pos('MSFT', 2000)]); // total 10000
  const top = s.find(x => x.key === 'top_25');
  assert.match(top.label, /NVDA falls 25%/);
  assert.equal(top.impact, -1250);       // 5000 * 0.25
  assert.equal(top.pct, -12.5);          // 1250 / 10000
  assert.match(top.note, /NVDA is 50%/);
});

test('derives value from price and shares', () => {
  const s = buildStressTests([
    { ticker: 'A', currentPrice: 100, shares: 50 }, // 5000
    { ticker: 'B', currentPrice: 100, shares: 50 }, // 5000
  ]);
  assert.equal(s.find(x => x.key === 'market_10').impact, -1000);
});

test('every scenario impact is a loss (negative)', () => {
  const s = buildStressTests([pos('A', 8000), pos('B', 2000)]);
  assert.ok(s.length === 3);
  for (const sc of s) assert.ok(sc.impact < 0);
});

test('market scenarios scale by portfolio beta; single-name shock does not', () => {
  const s = buildStressTests([pos('A', 6000), pos('B', 4000)], { portfolioBeta: 1.5 }); // total 10000
  const m10 = s.find(x => x.key === 'market_10');
  assert.equal(m10.impact, -1500); // 10000 * 0.10 * 1.5
  assert.equal(m10.pct, -15);
  assert.match(m10.note, /hotter than the market/);
  const top = s.find(x => x.key === 'top_25');
  assert.equal(top.impact, -1500); // A is 6000, *0.25 = 1500, unaffected by beta
});

test('a steadier (low-beta) book shows smaller market hits', () => {
  const s = buildStressTests([pos('A', 10000)], { portfolioBeta: 0.6 });
  assert.equal(s.find(x => x.key === 'market_10').impact, -600); // 10000*0.10*0.6
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
