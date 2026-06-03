// Pins the composure score (src/lib/composure.js): what the investor controls,
// scored honestly. A dimension only counts with real data, the score hides until
// there are at least two, and the bands move with behavior, not market luck.
import assert from 'node:assert/strict';
import { computeComposure, band } from '../src/lib/composure.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('cold start: open positions alone can score conviction and protection', () => {
  const c = computeComposure({
    attribution: { totalTrades: 0, patterns: {}, execution: {}, scorecard: {} },
    positions: [
      { entry_thesis: 'AI demand', stop_loss: 90 },
      { entry_thesis: '', stop_loss: 0 },
    ],
  });
  const conv = c.subs.find(s => s.key === 'conviction');
  const prot = c.subs.find(s => s.key === 'protection');
  assert.equal(conv.value, 50); // 1 of 2 has a thesis
  assert.equal(prot.value, 50); // 1 of 2 has a stop
  assert.equal(c.hasEnough, true);
  assert.equal(c.score, 50);
});

test('blends open and closed for conviction and protection', () => {
  const c = computeComposure({
    attribution: { totalTrades: 4, patterns: { thesis: { with: { count: 4 } }, stopLoss: { with: { count: 2 } } }, execution: {}, scorecard: {} },
    positions: [{ entry_thesis: 'x', stop_loss: 10 }, { entry_thesis: 'y', stop_loss: 0 }],
  });
  const conv = c.subs.find(s => s.key === 'conviction'); // (4+2)/(4+2)=100
  const prot = c.subs.find(s => s.key === 'protection'); // (2+1)/(4+2)=50
  assert.equal(conv.value, 100);
  assert.equal(prot.value, 50);
});

test('reflection, discipline and patience come from closed-trade data', () => {
  const c = computeComposure({
    attribution: {
      totalTrades: 5,
      patterns: { reflection: { with: { count: 4 } } },
      execution: { avgRating: 4, rated: 5 },
      scorecard: { avgHoldWinners: 20, avgHoldLosers: 10 },
    },
    positions: [],
  });
  assert.equal(c.subs.find(s => s.key === 'reflection').value, 80);   // 4/5
  assert.equal(c.subs.find(s => s.key === 'discipline').value, 80);   // 4/5 of 5 stars
  assert.equal(c.subs.find(s => s.key === 'patience').value, 67);     // 20/(20+10)
});

test('riding losers longer than winners tanks patience', () => {
  const c = computeComposure({
    attribution: { totalTrades: 4, patterns: {}, execution: {}, scorecard: { avgHoldWinners: 5, avgHoldLosers: 30 } },
    positions: [{ entry_thesis: 'x' }, { entry_thesis: 'y' }],
  });
  assert.equal(c.subs.find(s => s.key === 'patience').value, 14); // 5/35, ride-losers penalty
});

test('hides the score until at least two dimensions have data', () => {
  const c = computeComposure({ attribution: { totalTrades: 0, patterns: {} }, positions: [{ entry_thesis: 'only conviction', stop_loss: 0 }] });
  // one position: conviction den=1 (<2) so it does not even count; nothing qualifies
  assert.equal(c.hasEnough, false);
  assert.equal(c.score, null);
  assert.equal(c.band, null);
});

test('bands move with behavior, not P&L', () => {
  assert.equal(band(90), 'Composed');
  assert.equal(band(70), 'Steady hand');
  assert.equal(band(50), 'Building discipline');
  assert.equal(band(20), 'Finding your footing');
  assert.equal(band(null), null);
});

test('junk input never throws', () => {
  assert.doesNotThrow(() => computeComposure());
  assert.doesNotThrow(() => computeComposure({ attribution: null, positions: null }));
  const c = computeComposure({});
  assert.equal(c.hasEnough, false);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
