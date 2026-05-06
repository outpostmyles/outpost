/**
 * Simple in-memory frontend cache to reduce redundant API calls
 * on tab switches and re-renders.
 */
const store = new Map();

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
  const data = await fetchFn();
  setCached(key, data, ttlMs);
  return data;
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
