// Pins the counterfactual ledger (src/lib/counterfactual.js): opportunity cost of
// a sell vs holding, the missed/saved split, and the noise floor.
import assert from 'node:assert/strict';
import { oppCost, summarizeCounterfactuals, formatCounterfactual } from '../src/lib/counterfactual.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
const sell = (ticker, price, shares) => ({ ticker, price, shares, type: 'close' });

test('oppCost is positive when it ran after you sold, negative when it fell', () => {
  assert.equal(oppCost({ sellPrice: 100, shares: 10, currentPrice: 130 }), 300);  // left $300 on the table
  assert.equal(oppCost({ sellPrice: 100, shares: 10, currentPrice: 80 }), -200);  // dodged $200 of loss
  assert.equal(oppCost({ sellPrice: 0, shares: 10, currentPrice: 80 }), null);    // junk sell price
});

test('summary splits missed (winners cut) from saved (losers dodged)', () => {
  const cf = summarizeCounterfactuals(
    [sell('NVDA', 100, 10), sell('BE', 50, 20)],
    { NVDA: { price: 130 }, BE: { price: 40 } },
  );
  assert.equal(cf.counted, 2);
  assert.equal(cf.missed, 300);          // NVDA ran +30
  assert.equal(cf.saved, 200);           // BE fell, (50-40)*20 dodged
  assert.equal(cf.net, -100);            // saved - missed
  assert.equal(cf.worstMiss.ticker, 'NVDA');
  assert.equal(cf.bestDodge.ticker, 'BE');
});

test('a barely-moved sell is ignored as noise', () => {
  const cf = summarizeCounterfactuals([sell('AAPL', 200, 5)], { AAPL: { price: 202 } }, { minMovePct: 3 });
  assert.equal(cf.counted, 0); // +1% move, under the floor
});

test('a missing current price is skipped, not guessed', () => {
  const cf = summarizeCounterfactuals([sell('XYZ', 100, 10)], {});
  assert.equal(cf.counted, 0);
});

test('format stays empty until there are at least two real data points', () => {
  assert.equal(formatCounterfactual({ counted: 1, missed: 500 }), '');
  const cf = summarizeCounterfactuals(
    [sell('NVDA', 100, 10), sell('BE', 50, 20)],
    { NVDA: { price: 130 }, BE: { price: 40 } },
  );
  const block = formatCounterfactual(cf);
  assert.match(block, /left about \$300 on the table/);
  assert.match(block, /dodged about \$200/);
  assert.match(block, /Biggest miss: NVDA/);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
