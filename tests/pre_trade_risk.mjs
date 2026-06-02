// Pins assessPreTradeRisk (api/services/preTradeRisk.js), the verdict logic
// behind pre_trade_check, the agent's flagship safety tool. This is the
// reasoning that tells a user "ok / caution / stop" before they buy, so the
// thresholds (30%/20% concentration, 4-name sector stacking, dollar risk vs the
// tolerance cap) and the verdict escalation are locked down here.
import assert from 'node:assert/strict';
import { assessPreTradeRisk } from '../api/services/preTradeRisk.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
const has = (arr, s) => arr.some(x => x.includes(s));

test('clean, well-sized buy is ok', () => {
  const r = assessPreTradeRisk({ ticker: 'AAPL', dollars: 1000, tickerSector: 'Tech', portfolioValue: 10000, sectorCounts: { Tech: 1 }, sectorValues: { Tech: 5000 } });
  assert.equal(r.verdict, 'ok');
  assert.equal(r.warnings.length, 0);
  assert.equal(r.position_pct_after, 9.09);
  assert.ok(has(r.notes, 'No stop loss provided'));
});

test('single-name concentration >= 30% is a stop', () => {
  const r = assessPreTradeRisk({ ticker: 'NVDA', dollars: 1000, portfolioValue: 1000 });
  assert.equal(r.verdict, 'stop');
  assert.equal(r.position_pct_after, 50);
  assert.ok(has(r.warnings, 'concentrated bet'));
});

test('single-name concentration 20-30% is a caution', () => {
  const r = assessPreTradeRisk({ ticker: 'NVDA', dollars: 1000, portfolioValue: 4000 });
  assert.equal(r.verdict, 'caution');
  assert.equal(r.position_pct_after, 20);
});

test('a 4th name in the same sector is a caution', () => {
  const r = assessPreTradeRisk({ ticker: 'AMD', dollars: 1000, tickerSector: 'Tech', portfolioValue: 100000, sectorCounts: { Tech: 4 }, sectorValues: { Tech: 50000 } });
  assert.equal(r.verdict, 'caution');
  assert.ok(has(r.warnings, 'sector'));
  assert.ok(r.position_pct_after < 20); // concentration did NOT trigger; the sector rule did
});

test('dollar risk well above the tolerance cap is a stop (isolated from concentration)', () => {
  const r = assessPreTradeRisk({ ticker: 'XYZ', dollars: 10000, portfolioValue: 90000, currentPrice: 100, stopLoss: 20, riskTolerance: 'moderate' });
  assert.equal(r.position_pct_after, 10);     // under the concentration thresholds
  assert.equal(r.dollar_risk_at_stop, 8000);
  assert.equal(r.risk_pct_of_portfolio, 8);
  assert.equal(r.verdict, 'stop');
  assert.ok(has(r.warnings, 'per-trade risk budget'));
});

test('dollar risk within the tolerance cap is just a note, stays ok', () => {
  const r = assessPreTradeRisk({ ticker: 'XYZ', dollars: 10000, portfolioValue: 90000, currentPrice: 100, stopLoss: 98, riskTolerance: 'moderate' });
  assert.equal(r.verdict, 'ok');
  assert.equal(r.dollar_risk_at_stop, 200);
  assert.ok(has(r.notes, 'within a moderate risk budget'));
});

test('an existing position is surfaced as adding to it', () => {
  const r = assessPreTradeRisk({ ticker: 'AAPL', dollars: 1000, portfolioValue: 10000, existingPosition: { shares: 5, avgCost: 150, currentValue: 1000 } });
  assert.equal(r.position_pct_after, 18.18);
  assert.ok(has(r.notes, 'already hold 5 shares'));
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
