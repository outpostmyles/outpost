// Unit tests for assessPositionHealth (src/lib/positionHealth.js).
// Pins the priority order (below stop > deep drawdown > at target > no thesis >
// moderate drawdown > on track) and the thesis-awareness that sets this apart
// from the price-only attention badge.
import assert from 'node:assert/strict';
import { assessPositionHealth } from '../src/lib/positionHealth.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('below the stop reads reconsider', () => {
  const h = assessPositionHealth({ entry_thesis: 'x', avg_cost: 100, price: 88, stop_loss: 90 });
  assert.equal(h.status, 'reconsider');
  assert.match(h.reason, /stop/i);
});

test('deep drawdown reads reconsider even with a thesis', () => {
  const h = assessPositionHealth({ entry_thesis: 'long-term', avg_cost: 100, price: 78 });
  assert.equal(h.status, 'reconsider');
  assert.match(h.reason, /22%/);
});

test('at or past target reads watch (a decision, not an alarm)', () => {
  const h = assessPositionHealth({ entry_thesis: 'x', avg_cost: 100, price: 152, price_target: 150 });
  assert.equal(h.status, 'watch');
  assert.match(h.reason, /target/i);
});

test('no thesis reads watch, the signal the price-only badge misses', () => {
  const h = assessPositionHealth({ avg_cost: 100, price: 105 });
  assert.equal(h.status, 'watch');
  assert.match(h.reason, /no thesis/i);
});

test('moderate drawdown with a thesis reads watch', () => {
  const h = assessPositionHealth({ entry_thesis: 'x', avg_cost: 100, price: 86 });
  assert.equal(h.status, 'watch');
  assert.match(h.reason, /14%/);
});

test('thesis on record and nothing fighting it reads on track', () => {
  const h = assessPositionHealth({ entry_thesis: 'AI demand', avg_cost: 100, price: 118 });
  assert.equal(h.status, 'on_track');
});

test('below stop beats deep drawdown (priority order)', () => {
  const h = assessPositionHealth({ entry_thesis: 'x', avg_cost: 100, price: 70, stop_loss: 95 });
  assert.equal(h.status, 'reconsider');
  assert.match(h.reason, /stop/i); // stop reason, not the drawdown reason
});

test('accepts a precomputed pnlPercent', () => {
  const h = assessPositionHealth({ entry_thesis: 'x', pnlPercent: -25 });
  assert.equal(h.status, 'reconsider');
});

test('handles an empty position without throwing', () => {
  const h = assessPositionHealth({});
  // No thesis, no data -> watch (unexamined), never crashes.
  assert.equal(h.status, 'watch');
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
