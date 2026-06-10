// Double-submit protection for the money write paths. A user double-clicks Buy, or
// their client retries a request whose response was lost to a flaky connection, and
// the same trade arrives twice within seconds. Without a guard the second one runs
// again: a funded buy debits cash a second time, a trim sells twice. (A full close
// is already safe via the RPC's DELETE...RETURNING; this covers the rest.)
//
// The guard is a short-window, single-process claim keyed on a fingerprint of the
// action (user + what + ticker + size + price). The check-and-mark is synchronous,
// so it is atomic in Node's single thread: two truly concurrent requests cannot
// both pass it. Behaviour on a repeat:
//   - while the first is still in flight  -> { fresh:false, prior:null }  (caller 409s)
//   - after the first committed a response -> { fresh:false, prior:<that response> }
//     so a retry REPLAYS the original result instead of erroring or double-charging.
//   - if the first failed and released     -> the next claim is fresh again (retry works)
//
// In-memory by design: the realistic case is the same user hitting the same instance
// within seconds. A multi-instance deploy would need a shared store (DB/Redis); noted
// here so it is not mistaken for cross-instance protection.
//
// Its OWN store, deliberately NOT the shared price cache. The double-submit marker has
// a short 10s TTL, so in the shared 500-entry cache it was the soonest-to-expire entry
// and therefore the preferred eviction victim: a market-open price refresh could fill
// the cache and evict a still-fresh in-flight marker, silently re-opening the very
// double-submit window this guards. In a dedicated map every entry is a short-lived
// marker, so eviction (only a pathological-growth backstop) can only ever drop a
// near-expired one, never a live claim out from under its retry.
import { createHash } from 'crypto';

const DEFAULT_TTL_MS = 10_000; // long enough for a double-click or an immediate retry
const MAX_MARKERS = 5000;      // backstop; real concurrent in-flight count is tiny

const store = new Map(); // key -> { response, expiresAt }

// Periodic sweep of expired markers, unref'd so it never keeps the process alive.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, e] of store) if (now > e.expiresAt) store.delete(k);
}, 30_000);
sweep.unref?.();

function keyOf(parts) {
  const raw = (Array.isArray(parts) ? parts : [parts]).map(p => (p == null ? '' : String(p))).join('|');
  return 'idem_' + createHash('sha256').update(raw).digest('hex');
}

function getLive(key) {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { store.delete(key); return null; } // lazy expiry
  return e;
}

function put(key, response, ttlMs) {
  if (!store.has(key) && store.size >= MAX_MARKERS) {
    // Backstop only. Every entry shares the same short TTL band, so evicting the
    // soonest-to-expire drops a near-dead marker, never preferentially a fresh one.
    let oldest = null, oldestTime = Infinity;
    for (const [k, e] of store) if (e.expiresAt < oldestTime) { oldest = k; oldestTime = e.expiresAt; }
    if (oldest) store.delete(oldest);
  }
  store.set(key, { response, expiresAt: Date.now() + ttlMs });
}

/**
 * Claim the right to perform an action exactly once within the window.
 * @returns {{ fresh: true, commit: (response:any)=>void, release: ()=>void }
 *          | { fresh: false, prior: any }}
 */
export function idempotencyGuard(parts, ttlMs = DEFAULT_TTL_MS) {
  const key = keyOf(parts);
  const existing = getLive(key);
  if (existing) {
    // existing.response is null while the original is still in flight, or the
    // committed response once it finished.
    return { fresh: false, prior: existing.response ?? null };
  }
  put(key, null, ttlMs); // in-flight marker; synchronous, atomic gate
  return {
    fresh: true,
    commit: (response) => put(key, response ?? null, ttlMs),
    release: () => store.delete(key),
  };
}
