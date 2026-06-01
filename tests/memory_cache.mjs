// Pins the server-side TTL cache (api/services/memoryCache.js) that backs the
// auth-token check and the AI caches. The properties that matter: values expire,
// memCachedFetch caches real results but not null/undefined (so a failed lookup
// retries), and the store stays bounded under heavy insertion so it can't grow
// without limit.
import assert from 'node:assert/strict';
import { memGet, memSet, memDel, memHas, memCachedFetch, memStats } from '../api/services/memoryCache.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('set/get returns the value, expired entries return null', () => {
  memSet('a', 123, 10000);
  assert.equal(memGet('a'), 123);
  memSet('b', 'x', -1);            // ttl in the past -> already expired
  assert.equal(memGet('b'), null);
});

test('memHas reflects presence and expiry', () => {
  memSet('h', 1, 10000);
  assert.equal(memHas('h'), true);
  memSet('h2', 1, -1);
  assert.equal(memHas('h2'), false);
});

test('memDel removes a key', () => {
  memSet('d', 1, 10000);
  memDel('d');
  assert.equal(memGet('d'), null);
});

test('memCachedFetch caches real results but not null', async () => {
  let calls = 0;
  const v = await memCachedFetch('mc', async () => { calls++; return { ok: 1 }; }, 10000);
  assert.deepEqual(v, { ok: 1 });
  await memCachedFetch('mc', async () => { calls++; return { ok: 2 }; }, 10000);
  assert.equal(calls, 1);          // second call served from cache

  let ncalls = 0;
  await memCachedFetch('mcnull', async () => { ncalls++; return null; }, 10000);
  await memCachedFetch('mcnull', async () => { ncalls++; return null; }, 10000);
  assert.equal(ncalls, 2);         // null is never cached, so it refetches
});

test('the store stays bounded under heavy insertion', () => {
  for (let i = 0; i < 600; i++) memSet(`bulk_${i}`, i, 10000);
  assert.ok(memStats().size <= 500, `size ${memStats().size} should be <= 500`);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { await t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
