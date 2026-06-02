// Pins the fail-closed merge behind custom screeners (api/services/
// screenerVerdicts.js): a screener only shows names Claude explicitly confirmed
// fit the query, with a reason. No verdicts -> nothing, never a wall of unvetted
// picks.
import assert from 'node:assert/strict';
import { applyScreenerVerdicts } from '../api/services/screenerVerdicts.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

const cands = [{ ticker: 'NVDA', price: 120 }, { ticker: 'AAPL', price: 200 }, { ticker: 'AVGO', price: 1700 }];

test('keeps only confirmed fits, attaches the thesis', () => {
  const r = applyScreenerVerdicts(cands, { results: [
    { ticker: 'NVDA', fits: true, thesis: 'Core AI accelerator vendor.' },
    { ticker: 'AAPL', fits: false },
    { ticker: 'AVGO', fits: true, thesis: 'Custom AI silicon + networking.' },
  ]});
  assert.deepEqual(r.map(x => x.ticker), ['NVDA', 'AVGO']);
  assert.equal(r[0].thesis, 'Core AI accelerator vendor.');
  assert.equal(r[0].price, 120); // candidate fields preserved
});

test('a fit with no thesis is dropped (a reason is required)', () => {
  const r = applyScreenerVerdicts(cands, { results: [{ ticker: 'NVDA', fits: true, thesis: '  ' }] });
  assert.deepEqual(r, []);
});

test('no usable verdicts surfaces nothing, not everything', () => {
  assert.deepEqual(applyScreenerVerdicts(cands, null), []);
  assert.deepEqual(applyScreenerVerdicts(cands, {}), []);
  assert.deepEqual(applyScreenerVerdicts(cands, { results: 'oops' }), []);
});

test('verdicts for tickers not among candidates are ignored', () => {
  const r = applyScreenerVerdicts(cands, { results: [{ ticker: 'TSLA', fits: true, thesis: 'not a candidate' }] });
  assert.deepEqual(r, []);
});

test('accepts a bare array of verdicts too', () => {
  const r = applyScreenerVerdicts(cands, [{ ticker: 'nvda', fits: true, thesis: 'lowercase ticker ok' }]);
  assert.deepEqual(r.map(x => x.ticker), ['NVDA']);
});

test('hostile inputs do not throw', () => {
  assert.deepEqual(applyScreenerVerdicts(null, null), []);
  assert.deepEqual(applyScreenerVerdicts('x', { results: [{ ticker: 'NVDA', fits: true, thesis: 'y' }] }), []);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
