// Pins the thesis payoff loop in the proactive digest: a hard down day on a name
// the user owns for a reason THEY wrote surfaces that reason back to them, and
// agent-drafted theses or up days fall back to the plain mover line. Pure.
import { detectSignals, composeQuietDigest } from '../api/services/proactiveDigest.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg || 'eq'}: expected ${B}, got ${A}`); }
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }

// Two positions so concentration noise does not dominate; the one under test plus a filler.
const book = (target) => [target, { ticker: 'FILL', currentPrice: 100, currentValue: 5000, shares: 50, todayChangePercent: 0.2 }];
const pos = (o) => ({ ticker: 'MU', currentPrice: 100, currentValue: 2000, shares: 20, todayChangePercent: 0, ...o });

test('hard down day on a user-thesis name becomes thesis_under_pressure', () => {
  const sigs = detectSignals({ positions: book(pos({ todayChangePercent: -8, entry_thesis: 'memory cycle turns in 2026' })) });
  const tp = sigs.find(s => s.kind === 'thesis_under_pressure');
  ok(tp, 'payoff fires');
  eq(tp.ticker, 'MU', 'ticker');
  ok(/memory cycle turns/.test(tp.detail), 'quotes the thesis back');
  ok(!sigs.some(s => s.kind === 'big_mover' && s.ticker === 'MU'), 'no duplicate big_mover for MU');
});

test('agent-authored thesis does not trigger the payoff, falls back to big_mover', () => {
  const sigs = detectSignals({ positions: book(pos({ todayChangePercent: -8, entry_thesis: 'agent words', thesis_source: 'agent' })) });
  ok(!sigs.some(s => s.kind === 'thesis_under_pressure'), 'no payoff for agent thesis');
  ok(sigs.some(s => s.kind === 'big_mover' && s.ticker === 'MU'), 'big_mover instead');
});

test('a down day with no thesis is a plain big_mover', () => {
  const sigs = detectSignals({ positions: book(pos({ todayChangePercent: -8 })) });
  ok(sigs.some(s => s.kind === 'big_mover' && s.ticker === 'MU'), 'big_mover');
  ok(!sigs.some(s => s.kind === 'thesis_under_pressure'), 'no payoff');
});

test('an up day with a thesis is a big_mover, not pressure', () => {
  const sigs = detectSignals({ positions: book(pos({ todayChangePercent: 9, entry_thesis: 'cycle' })) });
  ok(sigs.some(s => s.kind === 'big_mover' && s.ticker === 'MU'), 'big_mover up');
  ok(!sigs.some(s => s.kind === 'thesis_under_pressure'), 'no pressure on an up day');
});

test('a small down day does not trigger anything mover-related', () => {
  const sigs = detectSignals({ positions: book(pos({ todayChangePercent: -2, entry_thesis: 'cycle' })) });
  ok(!sigs.some(s => (s.kind === 'thesis_under_pressure' || s.kind === 'big_mover') && s.ticker === 'MU'), 'below the move threshold');
});

test('a long thesis is truncated with an ellipsis', () => {
  const sigs = detectSignals({ positions: book(pos({ todayChangePercent: -6, entry_thesis: 'x'.repeat(300) })) });
  const tp = sigs.find(s => s.kind === 'thesis_under_pressure');
  ok(tp && tp.detail.includes('…'), 'truncated');
});

test('quiet-day digest pushes a coaching insight when there is one', () => {
  const d = composeQuietDigest({ hasEnough: true, fix: 'You hold losers about 20 days and winners only 5.', strength: null });
  ok(/how you trade/.test(d), 'frames it as a pattern');
  ok(/hold losers about 20 days/.test(d), 'includes the insight verbatim');
});

test('quiet-day digest falls back to the plain line when the record is thin', () => {
  const d = composeQuietDigest({ hasEnough: false });
  ok(/Quiet days are fine/.test(d), 'plain line');
  ok(!/how you trade/.test(d), 'no insight framing');
});

test('quiet-day digest prefers the fix over the strength', () => {
  const d = composeQuietDigest({ hasEnough: true, fix: 'FIXLINE', strength: 'STRENGTHLINE' });
  ok(/FIXLINE/.test(d) && !/STRENGTHLINE/.test(d), 'fix wins');
});

let pass = 0, fail = 0;
for (const { n, f } of tests) {
  try { f(); console.log(`ok   ${n}`); pass++; }
  catch (e) { console.log(`FAIL ${n}: ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
