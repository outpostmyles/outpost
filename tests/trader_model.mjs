// Pins the per-user edge/leak model (src/lib/traderModel.js): it measures each
// dimension against the user's OWN baseline win rate, withholds on a thin record,
// and surfaces only meaningful gaps.
import assert from 'node:assert/strict';
import { buildTraderModel, formatTraderModel } from '../src/lib/traderModel.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

// A resolved buy. win/loss with a hold + pnl, plus the entry context.
const buy = (o = {}) => ({ type: 'open', outcomeStatus: 'win', outcomePnlPct: 10, outcomeHoldDays: 30, thesis: 'x', todayChangePct: 0, pctOfBook: 10, marketRegime: 'Neutral', ...o });

test('a thin record returns no model, honestly', () => {
  const m = buildTraderModel([buy(), buy()], { minSample: 4 });
  assert.equal(m.hasModel, false);
  assert.equal(m.sample, 2);
});

test('finds the edge: thesis trades beat the baseline', () => {
  // 6 thesis wins, 6 no-thesis losses. Baseline 50%. Thesis bucket 100%, +50.
  const ds = [
    ...Array.from({ length: 6 }, () => buy({ thesis: 'real', outcomeStatus: 'win' })),
    ...Array.from({ length: 6 }, () => buy({ thesis: '', outcomeStatus: 'loss', outcomePnlPct: -10 })),
  ];
  const m = buildTraderModel(ds, { minSample: 4 });
  assert.equal(m.hasModel, true);
  assert.equal(m.baselineWinRate, 50);
  assert.ok(m.edges.some(e => /write a thesis/.test(e.label) && e.delta > 0));
  assert.ok(m.leaks.some(l => /no reason/.test(l.label) && l.delta < 0));
});

test('finds the leak: chasing green days underperforms', () => {
  const ds = [
    ...Array.from({ length: 6 }, () => buy({ todayChangePct: 15, outcomeStatus: 'loss', outcomePnlPct: -12 })), // chased, lost
    ...Array.from({ length: 6 }, () => buy({ todayChangePct: 0, outcomeStatus: 'win' })),                        // calm, won
  ];
  const m = buildTraderModel(ds, { minSample: 4 });
  assert.ok(m.leaks.some(l => /chase a green day/.test(l.label)));
});

test('a dimension below the sample floor does not surface', () => {
  // Only 2 oversized trades; minSample 4 hides them even if they all lost.
  const ds = [
    ...Array.from({ length: 6 }, () => buy({ pctOfBook: 10, outcomeStatus: 'win' })),
    ...Array.from({ length: 2 }, () => buy({ pctOfBook: 50, outcomeStatus: 'loss', outcomePnlPct: -20 })),
  ];
  const m = buildTraderModel(ds, { minSample: 4 });
  assert.ok(!m.edges.concat(m.leaks).some(d => /oversized/.test(d.label)));
});

test('formatTraderModel renders a coachable block, or empty when no model', () => {
  assert.equal(formatTraderModel({ hasModel: false }), '');
  const ds = [
    ...Array.from({ length: 6 }, () => buy({ thesis: 'real', outcomeStatus: 'win' })),
    ...Array.from({ length: 6 }, () => buy({ thesis: '', outcomeStatus: 'loss', outcomePnlPct: -10 })),
  ];
  const block = formatTraderModel(buildTraderModel(ds, { minSample: 4 }));
  assert.match(block, /EDGE AND LEAK/);
  assert.match(block, /baseline win rate 50%/);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
