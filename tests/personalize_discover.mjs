// Unit tests for personalizeDiscover (src/components/social/personalizeDiscover.js).
import assert from 'node:assert/strict';
import { personalizeDiscover } from '../src/components/social/personalizeDiscover.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const item = (ticker, priority) => ({ id: `x:${ticker}`, ticker, priority, title: `${ticker} thing` });

test('drops ideas for tickers already held', () => {
  const out = personalizeDiscover([item('AAPL', 80), item('NVDA', 70)], { held: ['AAPL'] });
  assert.deepEqual(out.map(i => i.ticker), ['NVDA']);
});

test('floats watchlist names to the top and tags them', () => {
  const out = personalizeDiscover(
    [item('AAPL', 90), item('SOFI', 50)],
    { watch: ['SOFI'] },
  );
  assert.deepEqual(out.map(i => i.ticker), ['SOFI', 'AAPL']); // SOFI boosted despite lower priority
  assert.equal(out[0].onWatch, true);
  assert.equal(out[0].forYou, 'On your watchlist');
  assert.equal(out[1].onWatch, false);
  assert.equal(out[1].forYou, null);
});

test('within a group, existing priority order is preserved', () => {
  const out = personalizeDiscover([item('A', 40), item('B', 90), item('C', 60)], {});
  assert.deepEqual(out.map(i => i.ticker), ['B', 'C', 'A']);
});

test('held wins over watch (you own it, so it is not a discovery)', () => {
  const out = personalizeDiscover([item('AAPL', 80)], { held: ['AAPL'], watch: ['AAPL'] });
  assert.deepEqual(out, []);
});

test('keeps tickerless items (e.g. a sector theme) and is case-insensitive', () => {
  const out = personalizeDiscover(
    [{ id: 's1', ticker: null, priority: 30, title: 'Energy heating up' }, item('nvda', 50)],
    { watch: ['NVDA'] },
  );
  assert.equal(out.find(i => i.id === 's1') != null, true);
  assert.equal(out[0].ticker, 'nvda'); // watchlist match is case-insensitive, floated up
  assert.equal(out[0].onWatch, true);
});

test('handles empty / missing inputs', () => {
  assert.deepEqual(personalizeDiscover([], {}), []);
  assert.deepEqual(personalizeDiscover(null), []);
  assert.deepEqual(personalizeDiscover(undefined, { held: ['X'] }), []);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
