// Unit tests for the trade-plan alert evaluation (api/services/planAlerts.js).
// Pins the crossing rules (target reached, stop broken, boundaries) and the
// dedupe key behavior (fires once per level value, re-arms when edited).
import assert from 'node:assert/strict';
import { evaluatePlanAlerts, planAlertKey } from '../api/services/planAlerts.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const price = (tkr, px) => ({ [tkr]: { price: px } });

test('target reached fires a target hit', () => {
  const hits = evaluatePlanAlerts([{ id: '1', ticker: 'AAPL', price_target: 180 }], price('AAPL', 182));
  assert.deepEqual(hits, [{ positionId: '1', ticker: 'AAPL', kind: 'target', threshold: 180, price: 182 }]);
});

test('stop broken fires a stop hit', () => {
  const hits = evaluatePlanAlerts([{ id: '2', ticker: 'NVDA', stop_loss: 140 }], price('NVDA', 138));
  assert.deepEqual(hits, [{ positionId: '2', ticker: 'NVDA', kind: 'stop', threshold: 140, price: 138 }]);
});

test('price between target and stop fires nothing', () => {
  const hits = evaluatePlanAlerts([{ id: '3', ticker: 'MSFT', price_target: 200, stop_loss: 150 }], price('MSFT', 175));
  assert.deepEqual(hits, []);
});

test('boundaries are inclusive (>= target, <= stop)', () => {
  assert.equal(evaluatePlanAlerts([{ id: '4', ticker: 'A', price_target: 100 }], price('A', 100)).length, 1);
  assert.equal(evaluatePlanAlerts([{ id: '5', ticker: 'B', stop_loss: 50 }], price('B', 50)).length, 1);
});

test('missing live price skips the position', () => {
  assert.deepEqual(evaluatePlanAlerts([{ id: '6', ticker: 'AAPL', price_target: 180 }], price('NVDA', 999)), []);
});

test('null or zero levels are ignored', () => {
  assert.deepEqual(evaluatePlanAlerts([{ id: '7', ticker: 'A', price_target: null, stop_loss: 0 }], price('A', 10)), []);
});

test('string-typed levels and prices are coerced', () => {
  const hits = evaluatePlanAlerts([{ id: '8', ticker: 'A', price_target: '50' }], { A: { price: '55' } });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].threshold, 50);
  assert.equal(hits[0].price, 55);
});

test('a position can fire both target and stop only when both cross (normally just one)', () => {
  // Inverted plan (stop above target) is nonsensical but must not throw; price 100 is >= target 90 and <= stop 110.
  const hits = evaluatePlanAlerts([{ id: '9', ticker: 'X', price_target: 90, stop_loss: 110 }], price('X', 100));
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map(h => h.kind).sort(), ['stop', 'target']);
});

test('handles empty / missing inputs', () => {
  assert.deepEqual(evaluatePlanAlerts([], {}), []);
  assert.deepEqual(evaluatePlanAlerts(null, null), []);
  assert.deepEqual(evaluatePlanAlerts([null, undefined], {}), []);
});

test('dedupe key is stable and encodes position, kind, and level value', () => {
  const hit = { positionId: 'abc', ticker: 'AAPL', kind: 'stop', threshold: 140, price: 138 };
  assert.equal(planAlertKey(hit), 'planalert_abc_stop_140');
  assert.equal(planAlertKey(hit), planAlertKey(hit));
});

test('editing the level produces a new key (re-arms the alert)', () => {
  const a = planAlertKey({ positionId: 'abc', kind: 'stop', threshold: 140 });
  const b = planAlertKey({ positionId: 'abc', kind: 'stop', threshold: 135 });
  assert.notEqual(a, b);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
