// Pins deterministic price-bound enforcement for screeners
// (api/services/screenerConstraints.js). An explicit dollar limit the user typed
// is a hard fact, checked against the live price, so a screen titled "under $200"
// never shows a $269 stock. Vague words and market-cap phrasing are left alone.
import assert from 'node:assert/strict';
import { parsePriceBound, applyPriceBound } from '../api/services/screenerConstraints.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

const R = (ticker, price) => ({ ticker, price, thesis: `${ticker} fits` });

test('parses an "under $X" ceiling', () => {
  assert.deepEqual(parsePriceBound('AI infrastructure stocks under $200'), { min: null, max: 200 });
});

test('parses an "over $X" floor', () => {
  assert.deepEqual(parsePriceBound('quality names over $50'), { min: 50, max: null });
});

test('parses "below" / "less than" / "cheaper than" as a ceiling', () => {
  assert.equal(parsePriceBound('stocks below $30').max, 30);
  assert.equal(parsePriceBound('names less than $15').max, 15);
  assert.equal(parsePriceBound('something cheaper than $5').max, 5);
});

test('handles decimals and comma thousands', () => {
  assert.equal(parsePriceBound('under $12.50').max, 12.5);
  assert.equal(parsePriceBound('under $1,000').max, 1000);
});

test('a market-cap magnitude is NOT treated as a price bound', () => {
  assert.deepEqual(parsePriceBound('software under $2B market cap'), { min: null, max: null });
  assert.deepEqual(parsePriceBound('large caps over $10 billion'), { min: null, max: null });
  assert.deepEqual(parsePriceBound('small caps under $500m'), { min: null, max: null });
});

test('no bound when none is stated', () => {
  assert.deepEqual(parsePriceBound('high-growth cybersecurity'), { min: null, max: null });
});

test('a price word embedded in another word does not impose a bound', () => {
  assert.deepEqual(parsePriceBound('high turnover stocks around $50'), { min: null, max: null }); // "over" inside "turnover"
  assert.deepEqual(parsePriceBound('takeover targets near $30'), { min: null, max: null });        // "over" inside "takeover"
  assert.equal(parsePriceBound('high turnover names over $50').min, 50);                            // a real "over $50" still parses
});

test('vague "cheap" with no number sets no hard bound', () => {
  assert.deepEqual(parsePriceBound('cheap semiconductors'), { min: null, max: null });
});

test('applyPriceBound drops the over-ceiling name (the DDOG case)', () => {
  const out = applyPriceBound('AI infrastructure stocks under $200', [
    R('INTC', 107.93), R('WDAY', 148.88), R('DDOG', 269.13),
  ]);
  assert.deepEqual(out.map(r => r.ticker), ['INTC', 'WDAY']); // DDOG $269 dropped
});

test('applyPriceBound enforces a floor', () => {
  const out = applyPriceBound('stocks over $100', [R('A', 50), R('B', 150)]);
  assert.deepEqual(out.map(r => r.ticker), ['B']);
});

test('applyPriceBound is a no-op without a bound', () => {
  const rows = [R('A', 5), R('B', 999)];
  assert.deepEqual(applyPriceBound('AI stocks', rows), rows);
});

test('a result with no usable price is kept (cannot verify, do not silently drop)', () => {
  const out = applyPriceBound('under $50', [R('A', 10), { ticker: 'B', price: null, thesis: 'x' }]);
  assert.deepEqual(out.map(r => r.ticker), ['A', 'B']);
});

test('junk input does not crash', () => {
  assert.deepEqual(applyPriceBound('under $50', null), []);
  assert.deepEqual(applyPriceBound(null, [R('A', 10)]).map(r => r.ticker), ['A']);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
