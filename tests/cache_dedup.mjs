// Pins the client-side cache (src/lib/cache.js), which sits in front of every
// data fetch in the app. The behavior that matters: concurrent callers for the
// same key share one request, cached values are reused within their TTL,
// expired entries refetch, and a failed fetch neither caches nor wedges the key.
import assert from 'node:assert/strict';
import { cachedFetch, getCached, setCached, clearAllCache, clearCachePrefix } from '../src/lib/cache.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('concurrent calls with the same key share one fetch', async () => {
  clearAllCache();
  let calls = 0;
  const fn = async () => { calls++; await new Promise(r => setTimeout(r, 20)); return { v: 1 }; };
  const [a, b, c] = await Promise.all([
    cachedFetch('k1', fn, 1000),
    cachedFetch('k1', fn, 1000),
    cachedFetch('k1', fn, 1000),
  ]);
  assert.equal(calls, 1);            // three callers, one network call
  assert.deepEqual(a, { v: 1 });
  assert.deepEqual(b, { v: 1 });
  assert.deepEqual(c, { v: 1 });
});

test('a cached value is reused within TTL', async () => {
  clearAllCache();
  let calls = 0;
  const fn = async () => { calls++; return calls; };
  const first = await cachedFetch('k2', fn, 1000);
  const second = await cachedFetch('k2', fn, 1000);
  assert.equal(first, 1);
  assert.equal(second, 1);           // served from cache
  assert.equal(calls, 1);
});

test('an expired entry refetches', async () => {
  clearAllCache();
  let calls = 0;
  const fn = async () => { calls++; return calls; };
  await cachedFetch('k3', fn, -1);   // ttl in the past -> immediately stale
  const again = await cachedFetch('k3', fn, -1);
  assert.equal(calls, 2);            // both missed
  assert.equal(again, 2);
});

test('a failed fetch is not cached and does not wedge the key', async () => {
  clearAllCache();
  let calls = 0;
  const fn = async () => { calls++; if (calls === 1) throw new Error('boom'); return 'ok'; };
  await assert.rejects(() => cachedFetch('k4', fn, 1000));
  const recovered = await cachedFetch('k4', fn, 1000);  // in-flight cleared -> retries
  assert.equal(recovered, 'ok');
  assert.equal(calls, 2);
});

test('concurrent callers all see a rejection together, still deduped', async () => {
  clearAllCache();
  let calls = 0;
  const fn = async () => { calls++; await new Promise(r => setTimeout(r, 10)); throw new Error('fail'); };
  const results = await Promise.allSettled([
    cachedFetch('k5', fn, 1000),
    cachedFetch('k5', fn, 1000),
  ]);
  assert.equal(calls, 1);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'rejected');
});

test('getCached/setCached honor TTL and prefix clearing', () => {
  clearAllCache();
  setCached('px_a', 1, 1000);
  setCached('px_b', 2, 1000);
  setCached('other', 3, 1000);
  assert.equal(getCached('px_a'), 1);
  setCached('stale', 9, -1);
  assert.equal(getCached('stale'), null);   // expired
  clearCachePrefix('px_');
  assert.equal(getCached('px_a'), null);
  assert.equal(getCached('px_b'), null);
  assert.equal(getCached('other'), 3);       // untouched
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { await t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
