// Pins the one place cash arithmetic lives. Cash is half the account value, it
// funds every buy and receives every sale's proceeds, so the rules are strict:
// finite always (a NaN proceeds can never poison the balance), never negative
// (you can't have less than no cash), always cents. The DB read-modify-write and
// the zero-window-free write live in cashBalance.js around this; this pins the math.
import { nextCashBalance, isMissingRpc } from '../api/services/cashBalance.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'eq'}: expected ${b}, got ${a}`); }
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }

// isMissingRpc decides whether an atomic-RPC caller falls back to its resilient JS
// path. It MUST say yes only for "function not found" (migration not applied yet)
// and no for every real error, or a genuine DB failure would silently degrade to
// the non-atomic path and hide a problem.
test('isMissingRpc: true only for a missing-function error', () => {
  ok(isMissingRpc({ code: 'PGRST202' }), 'PostgREST schema-cache miss');
  ok(isMissingRpc({ code: '42883' }), 'Postgres undefined_function');
  ok(isMissingRpc({ message: 'Could not find the function public.close_position_and_credit' }), 'PostgREST message');
  ok(isMissingRpc({ message: 'function set_cash_balance(uuid, numeric) does not exist' }), 'pg message');
});
test('isMissingRpc: false for real errors and empties', () => {
  ok(!isMissingRpc(null), 'null');
  ok(!isMissingRpc(undefined), 'undefined');
  ok(!isMissingRpc({ code: '23505', message: 'duplicate key value violates unique constraint' }), 'unique violation');
  ok(!isMissingRpc({ code: '40P01', message: 'deadlock detected' }), 'deadlock');
  ok(!isMissingRpc({ message: 'permission denied for function adjust_cash_balance' }), 'permission denied');
  ok(!isMissingRpc({ message: 'connection terminated' }), 'connection drop');
});

test('a credit adds to the balance, rounded to cents', () => {
  eq(nextCashBalance(100, 50), 150, 'credit');
  eq(nextCashBalance(100.005, 0), 100.01, 'rounds half up to cents');
  eq(nextCashBalance(0, 1234.567), 1234.57, 'proceeds rounded');
});

test('a debit subtracts, and cash never goes below zero', () => {
  eq(nextCashBalance(100, -30), 70, 'debit');
  eq(nextCashBalance(100, -250), 0, 'overspend floors at 0, never negative');
  eq(nextCashBalance(0, -10), 0, 'cannot go negative from 0');
});

test('a non-finite current or delta never poisons the balance', () => {
  eq(nextCashBalance(NaN, 50), 50, 'NaN current treated as 0');
  eq(nextCashBalance(100, NaN), 100, 'NaN delta treated as 0');
  eq(nextCashBalance(Infinity, 0), 0, 'Infinity current collapses to 0, never $Infinity');
  eq(nextCashBalance(100, Infinity), 100, 'a non-finite delta is a no-op, never wipes the balance');
  eq(nextCashBalance(undefined, undefined), 0, 'both missing = 0');
  eq(nextCashBalance(null, null), 0, 'both null = 0');
});

test('string-numeric inputs coerce (DB JSON round-trips)', () => {
  eq(nextCashBalance('100', '50'), 150, 'numeric strings coerce');
  eq(nextCashBalance('oops', 50), 50, 'garbage string current = 0');
});

test('a huge delta cannot overflow to Infinity', () => {
  const r = nextCashBalance(1e308, 1e308);
  ok(Number.isFinite(r), 'finite, not Infinity');
  eq(r, 0, 'overflow collapses to 0');
});

test('the output is always finite and >= 0 for any input pair', () => {
  const vals = [0, 1, -1, 100, -100, NaN, Infinity, -Infinity, 1e308, 'x', null, undefined, 0.001, 9.999];
  for (const a of vals) for (const b of vals) {
    const r = nextCashBalance(a, b);
    ok(Number.isFinite(r) && r >= 0, `bad output for (${String(a)},${String(b)}): ${r}`);
  }
});

let pass = 0, fail = 0;
for (const { n, f } of tests) {
  try { f(); console.log(`ok   ${n}`); pass++; }
  catch (e) { console.log(`FAIL ${n}: ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
