// Pins behavior-outcome attribution: the readiness gate, the per-bucket sample
// floor (so seeded/thin data cannot manufacture a "without a thesis loses"
// claim), the lift math, and the execution-rating summary. Pure, no IO.
import {
  computeBehaviorPatterns, computeExecution, aggregate,
  MIN_TRADES_FOR_ATTRIBUTION, MIN_PER_BUCKET,
} from '../api/services/attributionPatterns.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg || 'eq'}: expected ${B}, got ${A}`);
}
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }

const t = (o = {}) => ({ pnl: 0, pnl_percent: 0, hold_days: 5, ...o });
const win = (o = {}) => t({ pnl: 100, pnl_percent: 10, ...o });
const loss = (o = {}) => t({ pnl: -100, pnl_percent: -10, ...o });

test('floors are the expected values', () => {
  eq(MIN_TRADES_FOR_ATTRIBUTION, 5, 'overall floor');
  eq(MIN_PER_BUCKET, 5, 'per-bucket floor');
});

test('fewer than 5 trades is not ready', () => {
  const r = computeBehaviorPatterns([win(), loss(), win()]);
  eq(r.ready, false, 'not ready');
  eq(r.totalTrades, 3, 'count');
  eq(r.minRequired, 5, 'minRequired');
  ok(!r.patterns, 'no patterns when not ready');
});

test('thesis is comparable only when both sides clear the floor, with correct lift', () => {
  const withT = [win({ entry_thesis: 'a' }), win({ entry_thesis: 'a' }), win({ entry_thesis: 'a' }), win({ entry_thesis: 'a' }), loss({ entry_thesis: 'a' }), loss({ entry_thesis: 'a' })]; // 4W/2L = 66.7
  const withoutT = [win(), loss(), loss(), loss(), loss(), loss()]; // 1W/5L = 16.7
  const r = computeBehaviorPatterns([...withT, ...withoutT]);
  eq(r.ready, true, 'ready');
  eq(r.patterns.thesis.comparable, true, 'comparable');
  eq(r.patterns.thesis.with.winRate, 66.7, 'with winRate');
  eq(r.patterns.thesis.without.winRate, 16.7, 'without winRate');
  eq(r.patterns.thesis.lift, 50, 'lift');
});

test('a thin bucket is not comparable and yields no lift', () => {
  const withT = Array.from({ length: 6 }, () => win({ entry_thesis: 'a' })); // 6 with
  const withoutT = [loss(), loss(), loss()]; // only 3 without, under the floor
  const r = computeBehaviorPatterns([...withT, ...withoutT]); // 9 total, ready
  eq(r.ready, true, 'ready');
  eq(r.patterns.thesis.comparable, false, 'not comparable');
  eq(r.patterns.thesis.lift, null, 'no lift');
  eq(r.patterns.thesis.without.count, 3, 'records the thin count honestly');
});

test('blank or whitespace thesis counts as without', () => {
  const r = computeBehaviorPatterns([
    win({ entry_thesis: '   ' }), loss({ entry_thesis: '' }), win({ entry_thesis: null }), loss(), win(),
  ]);
  eq(r.patterns.thesis.with.count, 0, 'none with');
  eq(r.patterns.thesis.without.count, 5, 'all without');
});

test('aggregate computes win rate; empty is null', () => {
  const a = aggregate([win(), win(), loss(), loss()]);
  eq(a.count, 4, 'count');
  eq(a.winRate, 50, 'winRate');
  eq(aggregate([]).winRate, null, 'empty winRate null');
});

test('execution needs 3 rated; lift needs 2 on each side', () => {
  eq(computeExecution([win({ execution_rating: 5 }), win({ execution_rating: 4 })]), null, 'fewer than 3 rated');
  const ex = computeExecution([
    win({ execution_rating: 5 }), win({ execution_rating: 5 }),
    loss({ execution_rating: 1 }), loss({ execution_rating: 1 }),
    win({ execution_rating: 3 }),
  ]);
  ok(ex && ex.rated === 5, 'rated count');
  eq(ex.whenHigh.count, 2, 'high count');
  eq(ex.whenLow.count, 2, 'low count');
  eq(ex.lift, 100, 'high 100% vs low 0% is +100');
});

test('garbage inputs never throw', () => {
  for (const bad of [null, undefined, [null, undefined], [{}], 'nope']) {
    const r = computeBehaviorPatterns(bad);
    ok(r && typeof r.ready === 'boolean', 'returns a shape');
  }
});

let pass = 0, fail = 0;
for (const { n, f } of tests) {
  try { f(); console.log(`ok   ${n}`); pass++; }
  catch (e) { console.log(`FAIL ${n}: ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
