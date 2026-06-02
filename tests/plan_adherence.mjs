// Pins the behavioral classifier (api/services/planAdherence.js): analyzeTrade
// assigns each closed trade a category (broke_stop, held_past_target,
// early_exit, honored_stop, ...) and computeSummary aggregates them. This is the
// raw material for the coach, the scorecard, and the growth arc, so a
// misclassification would quietly corrupt every behavioral insight. The
// decision-tree order matters and is locked here.
import assert from 'node:assert/strict';
import { analyzeTrade, computeSummary } from '../api/services/planAdherence.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('no plan (no target, no stop) -> no_plan', () => {
  assert.equal(analyzeTrade({ price_target: null, stop_loss: null, sell_price: 50, pnl: 10 }).category, 'no_plan');
});

test('a plan but no sell price -> no_plan', () => {
  assert.equal(analyzeTrade({ price_target: 120, stop_loss: 90, sell_price: null, pnl: 0 }).category, 'no_plan');
});

test('sold below the stop -> broke_stop (checked first)', () => {
  const r = analyzeTrade({ price_target: 120, stop_loss: 90, sell_price: 85, pnl: -50 });
  assert.equal(r.category, 'broke_stop');
  assert.equal(r.gapPct, 5.56); // (90-85)/90*100
});

test('sold at/above target -> held_past_target', () => {
  const r = analyzeTrade({ price_target: 100, stop_loss: 90, sell_price: 110, pnl: 100 });
  assert.equal(r.category, 'held_past_target');
  assert.equal(r.gapPct, 10);
});

test('profit below target, no stop breach -> early_exit', () => {
  const r = analyzeTrade({ price_target: 100, stop_loss: 80, sell_price: 95, pnl: 50 });
  assert.equal(r.category, 'early_exit');
  assert.equal(r.gapPct, 5); // (100-95)/100*100
});

test('loss exited above the stop -> honored_stop', () => {
  const r = analyzeTrade({ stop_loss: 90, sell_price: 92, pnl: -30 });
  assert.equal(r.category, 'honored_stop');
});

test('loss with a target but no stop -> loss_no_stop', () => {
  assert.equal(analyzeTrade({ price_target: 120, sell_price: 95, pnl: -20 }).category, 'loss_no_stop');
});

test('profit with a stop but no target -> profit_no_target', () => {
  assert.equal(analyzeTrade({ stop_loss: 90, sell_price: 110, pnl: 50 }).category, 'profit_no_target');
});

test('computeSummary aggregates counts and honored-vs-violated win rates', () => {
  const withPlan = [
    analyzeTrade({ price_target: 100, stop_loss: 90, sell_price: 110, pnl: 100 }), // held_past, honored win
    analyzeTrade({ stop_loss: 90, sell_price: 92, pnl: -30 }),                      // honored_stop, honored loss
    analyzeTrade({ price_target: 100, stop_loss: 80, sell_price: 95, pnl: 50 }),    // early_exit, violated win
    analyzeTrade({ price_target: 120, stop_loss: 90, sell_price: 85, pnl: -50 }),   // broke_stop, violated loss
  ];
  const s = computeSummary(withPlan);
  assert.equal(s.tradesWithPlan, 4);
  assert.equal(s.heldPastCount, 1);
  assert.equal(s.honoredStopCount, 1);
  assert.equal(s.earlyExitCount, 1);
  assert.equal(s.stopBreachCount, 1);
  assert.equal(s.honoredWinRate, 50);   // held_past win + honored_stop loss -> 1/2
  assert.equal(s.violatedWinRate, 50);  // early_exit win + broke_stop loss -> 1/2
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
