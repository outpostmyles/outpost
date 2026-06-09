// Pins the double-submit guard for money writes: the first claim wins, a repeat
// while in flight is rejected, a repeat after the response committed REPLAYS that
// response (so a retried request is not double-charged and not shown an error), a
// released claim can be made again, and different actions never collide.
import { idempotencyGuard } from '../api/services/idempotency.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg || 'eq'}: expected ${B}, got ${A}`); }
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }

test('the first claim is fresh; a concurrent repeat is rejected with no prior', () => {
  const parts = ['u1', 'open', 'AAPL', 5, 100, true];
  const a = idempotencyGuard(parts);
  ok(a.fresh, 'first claim is fresh');
  const b = idempotencyGuard(parts);
  ok(!b.fresh, 'second claim is not fresh');
  eq(b.prior, null, 'no prior yet (original still in flight)');
  a.release();
});

test('after the original commits, a repeat replays the exact response', () => {
  const parts = ['u2', 'open', 'MSFT', 2, 200, false];
  const a = idempotencyGuard(parts);
  ok(a.fresh, 'fresh');
  const payload = { success: true, position: { ticker: 'MSFT' }, cash: 800, cashSynced: true };
  a.commit(payload);
  const b = idempotencyGuard(parts);
  ok(!b.fresh, 'repeat is not fresh');
  eq(b.prior, payload, 'repeat gets the original response back, byte for byte');
});

test('a released claim (the original failed) can be made fresh again', () => {
  const parts = ['u3', 'sell', 'pos-123', 'full'];
  const a = idempotencyGuard(parts);
  ok(a.fresh, 'fresh');
  a.release(); // simulate the operation failing -> let a retry through
  const b = idempotencyGuard(parts);
  ok(b.fresh, 'after release the next claim is fresh again (retry works)');
  b.release();
});

test('different actions never collide', () => {
  const buy = idempotencyGuard(['u4', 'open', 'NVDA', 1, 500, true]);
  const trimSame = idempotencyGuard(['u4', 'sell', 'NVDA', 1, 500]);   // different verb
  const buyOther = idempotencyGuard(['u4', 'open', 'NVDA', 2, 500, true]); // different size
  ok(buy.fresh && trimSame.fresh && buyOther.fresh, 'distinct fingerprints are independent');
  buy.release(); trimSame.release(); buyOther.release();
});

test('a different user with an identical trade is independent', () => {
  const a = idempotencyGuard(['alice', 'open', 'TSLA', 3, 250, true]);
  const b = idempotencyGuard(['bob', 'open', 'TSLA', 3, 250, true]);
  ok(a.fresh && b.fresh, 'same trade, different user, both fresh');
  a.release(); b.release();
});

test('null/undefined parts are handled without throwing', () => {
  const a = idempotencyGuard(['u6', 'open', null, undefined, 0, false]);
  ok(a.fresh, 'fresh with nullish parts');
  const b = idempotencyGuard(['u6', 'open', null, undefined, 0, false]);
  ok(!b.fresh, 'same nullish fingerprint dedupes');
  a.release();
});

let pass = 0, fail = 0;
for (const { n, f } of tests) {
  try { f(); console.log(`ok   ${n}`); pass++; }
  catch (e) { console.log(`FAIL ${n}: ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
