/**
 * Server-side in-memory TTL cache.
 * Replaces Supabase price_cache as the hot cache layer.
 * Supabase remains the persistence/durability layer (write-through).
 */

const store = new Map();
const MAX_CACHE_SIZE = 500; // Prevent unbounded memory growth

// Cleanup expired entries every 5 minutes. unref the timer so this background
// sweep never on its own keeps the process alive: matters for the jobs runner,
// graceful shutdown, and any one-off script that imports this module.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, 5 * 60 * 1000);
cleanupTimer.unref?.();

export function memGet(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

export function memSet(key, data, ttlMs = 60000) {
  // Evict oldest entries if cache is full (only when adding a NEW key)
  if (!store.has(key) && store.size >= MAX_CACHE_SIZE) {
    let oldest = null;
    let oldestTime = Infinity;
    for (const [k, entry] of store) {
      if (entry.expiresAt < oldestTime) { oldest = k; oldestTime = entry.expiresAt; }
    }
    if (oldest) store.delete(oldest);
  }
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function memDel(key) {
  store.delete(key);
}

export function memHas(key) {
  return memGet(key) !== null;
}

/**
 * Memory-first, then fetchFn fallback.
 * Stores result in memory cache with given TTL.
 */
export async function memCachedFetch(key, fetchFn, ttlMs = 60000) {
  const cached = memGet(key);
  if (cached !== null) return cached;
  const data = await fetchFn();
  if (data !== null && data !== undefined) {
    memSet(key, data, ttlMs);
  }
  return data;
}

export function memStats() {
  return { size: store.size, keys: [...store.keys()] };
}
