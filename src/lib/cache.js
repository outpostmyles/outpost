/**
 * Simple in-memory frontend cache to reduce redundant API calls
 * on tab switches and re-renders.
 */
const store = new Map();
// Fetches currently in flight, keyed the same as the cache. Lets concurrent
// callers for the same key share one request instead of each firing their own.
const inflight = new Map();

export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

export function setCached(key, data, ttlMs = 60000) {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/**
 * Check cache before calling API. If cached, return cached value.
 * Otherwise call fetchFn, cache the result, and return it.
 */
export async function cachedFetch(key, fetchFn, ttlMs = 60000) {
  const cached = getCached(key);
  if (cached !== null) return cached;

  // Coalesce concurrent callers. A tab switch can mount several cards that all
  // ask for the same key in the same tick; without this they each miss the
  // (still empty) cache and fire a duplicate request. Sharing the promise means
  // one network call serves all of them.
  const pending = inflight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const data = await fetchFn();
      setCached(key, data, ttlMs);
      return data;
    } finally {
      // Clear on both success and failure: a failed fetch must not wedge the
      // key (every later call would inherit the rejection), and a successful
      // one is now served from the value cache, not the in-flight map.
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Clear all cached entries whose keys start with the given prefix */
export function clearCachePrefix(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Clear all cached entries */
export function clearAllCache() {
  store.clear();
}
