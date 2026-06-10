// Pins the trade-advice math (api/services/tradeMath.js) the agent hands a user
// directly. These produce share counts and risk/reward grades a trader can act
// on, so the validation matters as much as the arithmetic: non-finite or
// out-of-range inputs (which Claude can supply as tool args) must return a clear
// error, never an Infinity or negative share count.
import assert from 'node:assert/strict';
import { calculatePositionSize, calculateRiskReward } from '../api/services/tradeMath.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

// ---- calculatePositionSize ----

test('position size: standard 2% risk long', () => {
  const r = calculatePositionSize({ account_size: 10000, risk_pct: 2, entry_price: 100, stop_loss: 90 });
  assert.equal(r.risk_per_share, 10);
  assert.equal(r.max_risk_dollars, 200);
  assert.equal(r.shares_to_buy, 20);
  assert.equal(r.total_cost, 2000);
  assert.equal(r.portfolio_allocation_pct, 20);
});

test('position size: target adds a risk/reward read', () => {
  const r = calculatePositionSize({ account_size: 10000, risk_pct: 2, entry_price: 100, stop_loss: 90, target_price: 130 });
  assert.equal(r.risk_reward_ratio, '3.0:1');
  assert.equal(r.potential_profit, 600);
  assert.equal(r.potential_loss, -200);
  assert.match(r.trade_quality, /Excellent/);
});

test('position size: concentration and aggression warnings fire', () => {
  const r = calculatePositionSize({ account_size: 10000, risk_pct: 8, entry_price: 100, stop_loss: 99 });
  assert.ok(Array.isArray(r.warnings));
  assert.ok(r.warnings.some(w => w.includes('DANGER')));
  assert.ok(r.warnings.some(w => w.includes('aggressive')));
});

test('position size: too-small account warns of zero shares', () => {
  const r = calculatePositionSize({ account_size: 100, risk_pct: 2, entry_price: 100, stop_loss: 90 });
  assert.equal(r.shares_to_buy, 0);
  assert.ok(r.warnings.some(w => w.includes('too small') || w.includes('1 share')));
});

test('position size: NEVER recommends more shares than the account can afford', () => {
  // The dangerous case: a tight stop makes the risk-based size 100 shares ($5,000)
  // on a $1,000 account. Must cap to the affordable 20 shares ($1,000), not 500%.
  const r = calculatePositionSize({ account_size: 1000, risk_pct: 5, entry_price: 50, stop_loss: 49.5 });
  assert.ok(r.total_cost <= 1000, `total cost ${r.total_cost} must fit the account`);
  assert.equal(r.shares_to_buy, 20, 'capped to affordable (1000/50)');
  assert.ok(r.portfolio_allocation_pct <= 100, 'never over 100% of the account');
  assert.ok(r.warnings.some(w => /capped/i.test(w)), 'explains the cap to the user');
  // max_risk_dollars reflects the ACTUAL position risk, not the unaffordable budget.
  assert.equal(r.max_risk_dollars, 10, '20 shares * $0.50 stop distance');
});

test('position size: rejects bad inputs (incl. Infinity and bad risk_pct)', () => {
  assert.ok(calculatePositionSize({ account_size: 0, entry_price: 100, stop_loss: 90 }).error);
  assert.ok(calculatePositionSize({ account_size: Infinity, entry_price: 100, stop_loss: 90 }).error);
  assert.ok(calculatePositionSize({ account_size: 10000, entry_price: Infinity, stop_loss: 90 }).error);
  assert.ok(calculatePositionSize({ account_size: 10000, risk_pct: -5, entry_price: 100, stop_loss: 90 }).error);
  assert.ok(calculatePositionSize({ account_size: 10000, risk_pct: 0, entry_price: 100, stop_loss: 90 }).error);
  assert.ok(calculatePositionSize({ account_size: 10000, risk_pct: 150, entry_price: 100, stop_loss: 90 }).error);
  assert.ok(calculatePositionSize({ account_size: 10000, entry_price: 90, stop_loss: 100 }).error); // stop above entry
});

// ---- calculateRiskReward ----

test('risk/reward: long setup grades correctly', () => {
  const r = calculateRiskReward({ entry_price: 100, stop_loss: 90, targets: [130] });
  assert.equal(r.direction, 'LONG');
  assert.equal(r.risk_per_share, 10);
  assert.equal(r.best_risk_reward, '3.0:1');
  assert.match(r.overall_grade, /^A/);
  assert.equal(r.targets[0].risk_reward_ratio, '3.0:1');
});

test('risk/reward: short setup is detected', () => {
  const r = calculateRiskReward({ entry_price: 90, stop_loss: 100, targets: [70] });
  assert.equal(r.direction, 'SHORT');
  assert.equal(r.targets[0].risk_reward_ratio, '2.0:1');
});

test('risk/reward: rejects bad inputs', () => {
  assert.ok(calculateRiskReward({ entry_price: 100, stop_loss: 100, targets: [120] }).error); // equal
  assert.ok(calculateRiskReward({ entry_price: Infinity, stop_loss: 90, targets: [120] }).error);
  assert.ok(calculateRiskReward({ entry_price: 100, stop_loss: 90, targets: [] }).error);
  assert.ok(calculateRiskReward({ entry_price: 100, stop_loss: 90, targets: [Infinity, -5] }).error); // none valid
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
