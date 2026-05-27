// Per-user daily ceiling on AI calls. Defense in depth: the credit system
// already gates spend per call, but if a bug ever lets credits drift (negative
// balances, double-spend race, etc) we still want a hard wall that says
// "no single user can fire more than N AI calls per day." Single-process,
// in-memory — fine for a single Railway service running the API. Resets on
// restart, which means a deploy effectively gives everyone fresh budget;
// that's an acceptable trade for v1.
//
// Why not durable in Supabase: each AI call costs us roughly $0.005-$0.05.
// Even at 1000 calls per restart, the worst-case spend per user per deploy
// is ~$50. With ~10 beta users and infrequent deploys this is bounded. The
// goal here is not perfect accounting — it's preventing a runaway loop or
// abuse from costing us four figures overnight.
//
// To upgrade later: swap the in-memory Map for an atomic Supabase RPC
// (same pattern as deduct_credits). Same call signature, durable across
// restarts and multiple API instances.

const DEFAULT_DAILY_CAP = parseInt(process.env.AI_DAILY_CALL_CAP || '300', 10);

// Map<userId, { dateKey, count, alertedAt }>
const ledger = new Map();

function dateKey() {
  // YYYY-MM-DD in UTC. We don't care about TZ alignment — this is a safety
  // ceiling, not a billing window. UTC keeps the math simple.
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/**
 * Atomically increments the user's daily AI-call count and returns
 *   { allowed: boolean, count: number, cap: number }
 *
 * If the user is at or over the cap, returns allowed=false. The caller is
 * expected to respond 429 (rate-limit semantics, not 402 — credits aren't
 * the issue, the per-day ceiling is) without performing the expensive AI
 * call. Logs a single warn line the first time a user hits the cap each
 * day, so we can spot a runaway in stdout without log spam.
 */
export function checkAndIncrementAiCall(userId, cap = DEFAULT_DAILY_CAP) {
  if (!userId) return { allowed: true, count: 0, cap }; // anonymous paths — nothing to track
  const today = dateKey();
  let entry = ledger.get(userId);
  if (!entry || entry.dateKey !== today) {
    entry = { dateKey: today, count: 0, alertedAt: 0 };
    ledger.set(userId, entry);
  }
  if (entry.count >= cap) {
    if (!entry.alertedAt) {
      console.warn(`[ai-ceiling] User ${userId} hit daily cap (${cap} calls). Subsequent calls blocked until UTC midnight.`);
      entry.alertedAt = Date.now();
    }
    return { allowed: false, count: entry.count, cap };
  }
  entry.count += 1;
  return { allowed: true, count: entry.count, cap };
}

/**
 * Inspection helper — current count without incrementing. Used by admin
 * insights and unit tests.
 */
export function getAiCallCount(userId) {
  const entry = ledger.get(userId);
  if (!entry || entry.dateKey !== dateKey()) return 0;
  return entry.count;
}

/**
 * Test/admin-only: reset a single user's counter. Not exported to a route —
 * use sparingly from a Node REPL if you need to manually un-block someone.
 */
export function _resetAiCallCount(userId) {
  ledger.delete(userId);
}
