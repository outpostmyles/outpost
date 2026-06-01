// Unit tests for assessPortfolioRisk (src/lib/portfolioRisk.js).
import assert from 'node:assert/strict';
import { assessPortfolioRisk } from '../src/lib/portfolioRisk.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const pos = (ticker, currentValue) => ({ ticker, currentValue });

test('empty book is ok with no flags', () => {
  const r = assessPortfolioRisk([]);
  assert.equal(r.level, 'ok');
  assert.deepEqual(r.flags, []);
});

test('a balanced book of five names flags nothing', () => {
  const r = assessPortfolioRisk([pos('A', 2000), pos('B', 2000), pos('C', 2000), pos('D', 2000), pos('E', 2000)]);
  assert.equal(r.level, 'ok');
  assert.deepEqual(r.flags, []);
});

test('a single name over 40% is high severity', () => {
  const r = assessPortfolioRisk([pos('NVDA', 5000), pos('AAPL', 3000), pos('MSFT', 2000)]);
  // NVDA = 50%
  assert.equal(r.level, 'high');
  assert.ok(r.flags.some(f => f.kind === 'single_name' && f.severity === 'high'));
  assert.match(r.flags[0].message, /NVDA is 50%/);
});

test('one name well above equal weight is a caution', () => {
  // 5 names, one at 35% (equal weight would be 20%), disproportionate but under 40.
  const r = assessPortfolioRisk([pos('NVDA', 3500), pos('A', 1625), pos('B', 1625), pos('C', 1625), pos('D', 1625)]);
  assert.equal(r.level, 'caution');
  assert.ok(r.flags.some(f => f.kind === 'single_name' && f.severity === 'caution'));
});

test('an evenly split four-name book does NOT flag concentration', () => {
  const r = assessPortfolioRisk([pos('A', 2500), pos('B', 2500), pos('C', 2500), pos('D', 2500)]);
  assert.equal(r.level, 'ok');
  assert.ok(!r.flags.some(f => f.kind === 'single_name'));
});

test('top-heavy book of many names is flagged', () => {
  const r = assessPortfolioRisk([pos('A', 3000), pos('B', 3000), pos('C', 2000), pos('D', 500), pos('E', 500), pos('F', 500)]);
  // top 3 = 8000/9500 = ~84%, but top single = 31.6% (caution). Expect top_heavy flag present.
  assert.ok(r.flags.some(f => f.kind === 'top_heavy'));
});

test('a single position flags thin (whole book is one position)', () => {
  const r = assessPortfolioRisk([pos('TSLA', 10000)]);
  assert.ok(r.flags.some(f => f.kind === 'thin'));
  assert.match(r.flags.find(f => f.kind === 'thin').message, /one position/i);
  // no single_name flag for a lone position
  assert.ok(!r.flags.some(f => f.kind === 'single_name'));
});

test('two positions flag both single-name and thin', () => {
  const r = assessPortfolioRisk([pos('A', 6000), pos('B', 4000)]);
  assert.equal(r.level, 'high'); // A = 60%
  assert.ok(r.flags.some(f => f.kind === 'single_name'));
  assert.ok(r.flags.some(f => f.kind === 'thin'));
});

test('derives value from price and shares when currentValue is absent', () => {
  const r = assessPortfolioRisk([
    { ticker: 'A', currentPrice: 100, shares: 50 }, // 5000
    { ticker: 'B', currentPrice: 50, shares: 100 }, // 5000
    { ticker: 'C', currentPrice: 50, shares: 100 }, // 5000
  ]);
  assert.equal(r.weights[0].pct, 33.3);
  assert.equal(r.level, 'ok');
});

test('weights are sorted descending and sum near 100', () => {
  const r = assessPortfolioRisk([pos('A', 1000), pos('B', 3000), pos('C', 6000)]);
  assert.deepEqual(r.weights.map(w => w.ticker), ['C', 'B', 'A']);
  const sum = r.weights.reduce((s, w) => s + w.pct, 0);
  assert.ok(Math.abs(sum - 100) < 0.5);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
