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
import { createHash } from 'crypto';
import { memGet, memSet, memDel } from './memoryCache.js';

const DEFAULT_TTL_MS = 10_000; // long enough for a double-click or an immediate retry

function keyOf(parts) {
  const raw = (Array.isArray(parts) ? parts : [parts]).map(p => (p == null ? '' : String(p))).join('|');
  return 'idem_' + createHash('sha256').update(raw).digest('hex');
}

/**
 * Claim the right to perform an action exactly once within the window.
 * @returns {{ fresh: true, commit: (response:any)=>void, release: ()=>void }
 *          | { fresh: false, prior: any }}
 */
export function idempotencyGuard(parts, ttlMs = DEFAULT_TTL_MS) {
  const key = keyOf(parts);
  const existing = memGet(key);
  if (existing) {
    // existing.response is null while the original is still in flight, or the
    // committed response once it finished.
    return { fresh: false, prior: existing.response ?? null };
  }
  memSet(key, { response: null }, ttlMs); // in-flight marker; synchronous, atomic gate
  return {
    fresh: true,
    commit: (response) => memSet(key, { response: response ?? null }, ttlMs),
    release: () => memDel(key),
  };
}
