// Unit tests for detectRecurring (src/lib/recurringPatterns.js).
import assert from 'node:assert/strict';
import { detectRecurring } from '../src/lib/recurringPatterns.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const t = (category, closedAt) => ({ category, closedAt });

test('no trades, no pattern', () => {
  assert.equal(detectRecurring([]), null);
  assert.equal(detectRecurring(null), null);
});

test('a behavior across 2+ months and 3+ times is recurring', () => {
  const r = detectRecurring([
    t('broke_stop', '2026-01-10'),
    t('broke_stop', '2026-02-12'),
    t('broke_stop', '2026-03-05'),
  ]);
  assert.equal(r.kind, 'broke_stop');
  assert.equal(r.count, 3);
  assert.equal(r.months, 3);
  assert.match(r.message, /habit/i);
});

test('three times in ONE month is not recurring (one bad month is noise)', () => {
  const r = detectRecurring([
    t('broke_stop', '2026-01-03'),
    t('broke_stop', '2026-01-14'),
    t('broke_stop', '2026-01-28'),
  ]);
  assert.equal(r, null);
});

test('twice across two months is not enough (needs 3+ total)', () => {
  const r = detectRecurring([t('early_exit', '2026-01-10'), t('early_exit', '2026-02-10')]);
  assert.equal(r, null);
});

test('early exits recurring produces the let-them-run message', () => {
  const r = detectRecurring([
    t('early_exit', '2026-01-10'),
    t('early_exit', '2026-02-10'),
    t('early_exit', '2026-02-20'),
  ]);
  assert.equal(r.kind, 'early_exit');
  assert.match(r.message, /run/i);
});

test('ignores positive and neutral categories', () => {
  const r = detectRecurring([
    t('held_past_target', '2026-01-10'),
    t('honored_stop', '2026-02-10'),
    t('held_past_target', '2026-03-10'),
  ]);
  assert.equal(r, null);
});

test('picks the more frequent recurring behavior', () => {
  const r = detectRecurring([
    t('early_exit', '2026-01-10'), t('early_exit', '2026-02-10'), t('early_exit', '2026-03-10'),
    t('broke_stop', '2026-01-11'), t('broke_stop', '2026-02-11'), t('broke_stop', '2026-03-11'), t('broke_stop', '2026-04-11'),
  ]);
  assert.equal(r.kind, 'broke_stop'); // 4 > 3
});

let pass = 0, fail = 0;
for (const x of tests) {
  try { x.fn(); console.log(`ok    ${x.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${x.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
