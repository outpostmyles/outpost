// Unit tests for the Bargain Radar verdict merge (api/services/bargainVerdicts.js).
// The radar promises every surfaced name passed Claude's "real problem vs
// buyable dip" check, so the merge MUST fail closed: anything without an
// explicit "buyable" verdict is dropped, never shown as vetted.
import assert from 'node:assert/strict';
import { applyBuyableVerdicts } from '../api/services/bargainVerdicts.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const cands = [
  { ticker: 'AAPL', price: 100 },
  { ticker: 'NVDA', price: 200 },
  { ticker: 'INTC', price: 30 },
];

test('null verdicts (Claude failed) drops everything - fail closed', () => {
  assert.deepEqual(applyBuyableVerdicts(cands, null), []);
});

test('missing or malformed verdicts array drops everything', () => {
  assert.deepEqual(applyBuyableVerdicts(cands, {}), []);
  assert.deepEqual(applyBuyableVerdicts(cands, { verdicts: 'nope' }), []);
});

test('empty verdicts list keeps nothing', () => {
  assert.deepEqual(applyBuyableVerdicts(cands, { verdicts: [] }), []);
});

test('keeps only buyable, drops avoid', () => {
  const parsed = { verdicts: [
    { ticker: 'AAPL', verdict: 'buyable', thesis: 'Dragged down with the market.' },
    { ticker: 'NVDA', verdict: 'avoid', thesis: 'Business is fading.' },
  ] };
  const out = applyBuyableVerdicts(cands, parsed);
  assert.deepEqual(out.map(c => c.ticker), ['AAPL']);
  assert.equal(out[0].thesis, 'Dragged down with the market.');
  assert.equal(out[0].verdict, 'buyable');
});

test('drops candidates with no matching verdict (fail closed per name)', () => {
  const parsed = { verdicts: [{ ticker: 'AAPL', verdict: 'buyable', thesis: 'x' }] };
  // NVDA and INTC had no verdict returned -> dropped, not kept generically.
  assert.deepEqual(applyBuyableVerdicts(cands, parsed).map(c => c.ticker), ['AAPL']);
});

test('falls back to a plain thesis when Claude omits one', () => {
  const parsed = { verdicts: [
    { ticker: 'AAPL', verdict: 'buyable' },
    { ticker: 'NVDA', verdict: 'buyable', thesis: '   ' },
  ] };
  const out = applyBuyableVerdicts(cands, parsed);
  assert.equal(out.find(c => c.ticker === 'AAPL').thesis, 'Buyable dip.');
  assert.equal(out.find(c => c.ticker === 'NVDA').thesis, 'Buyable dip.');
});

test('ticker match is case-insensitive', () => {
  const parsed = { verdicts: [{ ticker: 'aapl', verdict: 'buyable', thesis: 'ok' }] };
  assert.deepEqual(applyBuyableVerdicts(cands, parsed).map(c => c.ticker), ['AAPL']);
});

test('unrecognized verdict value is dropped', () => {
  const parsed = { verdicts: [{ ticker: 'AAPL', verdict: 'maybe', thesis: 'hmm' }] };
  assert.deepEqual(applyBuyableVerdicts(cands, parsed), []);
});

test('preserves original candidate fields on survivors', () => {
  const parsed = { verdicts: [{ ticker: 'AAPL', verdict: 'buyable', thesis: 'ok' }] };
  const out = applyBuyableVerdicts(cands, parsed);
  assert.equal(out[0].price, 100);
});

test('handles empty / missing candidates', () => {
  assert.deepEqual(applyBuyableVerdicts([], { verdicts: [{ ticker: 'AAPL', verdict: 'buyable' }] }), []);
  assert.deepEqual(applyBuyableVerdicts(null, { verdicts: [] }), []);
  assert.deepEqual(applyBuyableVerdicts(undefined, null), []);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
