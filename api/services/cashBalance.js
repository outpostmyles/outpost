// The single source of truth for a user's cash balance.
//
// The account is cash + holdings. Cash lives in agent_memory as a per-user JSON
// singleton, the same no-migration pattern the North Star goal uses. Closing a
// position credits its proceeds here, a funded buy debits it, and the user can
// set it to match their brokerage. Never goes negative.
//
// Extracted out of the portfolio routes so every surface that needs to know the
// real account value (the /value endpoint, the agent's North Star framing, the
// daily digest email) reads cash the exact same way, instead of each re-deriving
// it or ignoring it.
import { supabase } from '../db.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Is this Supabase error "the RPC function does not exist" (migration not applied
 * yet) rather than a real failure? Lets every atomic-RPC caller fall back to its
 * resilient JS path before the migration is run, and only then. PostgREST returns
 * PGRST202 for a missing function; Postgres itself uses 42883 (undefined_function).
 */
export function isMissingRpc(error) {
  if (!error) return false;
  const code = error.code || '';
  if (code === 'PGRST202' || code === '42883') return true;
  const msg = (error.message || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('could not find the function');
}

/**
 * The new balance after applying a delta. The ONE place cash arithmetic lives:
 * finite-guard both inputs (a NaN proceeds must never poison the balance), clamp
 * at zero (cash never goes negative), round to cents. Pure and unit-tested.
 */
export function nextCashBalance(current, delta) {
  const cur = Number(current);
  const d = Number(delta);
  const base = (Number.isFinite(cur) ? cur : 0) + (Number.isFinite(d) ? d : 0);
  const rounded = Math.round(base * 100) / 100;
  if (!Number.isFinite(rounded)) return 0;          // overflow guard
  return Math.max(0, rounded);
}

export async function getCashBalance(userId) {
  try {
    const { data } = await supabase.from('agent_memory')
      .select('content').eq('user_id', userId).eq('memory_type', 'cash_balance')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!data?.content) return 0;
    const amt = Number(JSON.parse(data.content)?.amount);
    return Number.isFinite(amt) && amt >= 0 ? amt : 0;
  } catch { return 0; }
}

export async function setCashBalance(userId, amount) {
  const amt = nextCashBalance(amount, 0);
  // Prefer the atomic set (migration 023): it writes the balance under the SAME
  // per-user advisory lock adjust_cash_balance uses, so "set my cash to match my
  // brokerage" and a trade's credit/debit serialize instead of clobbering each
  // other. Only fall back to the JS insert-then-prune below if 023 is not applied
  // yet (function missing); a real RPC error still falls through to the resilient
  // path rather than throwing, same philosophy as adjustCashBalance.
  try {
    const { data, error } = await supabase.rpc('set_cash_balance', { p_user_id: userId, p_amount: amt });
    if (!error) {
      const v = Number(data);
      if (Number.isFinite(v) && v >= 0) return v;
    }
  } catch { /* fall through to the JS path */ }
  // Insert the new canonical row FIRST, then prune older ones. getCashBalance reads
  // the latest by created_at, so there is NEVER a window where the row is missing.
  // The old delete-then-insert had a gap where a concurrent read returned $0 (a
  // visible "no cash" snap) and, worse, a concurrent adjust read $0 and clobbered
  // the real balance. Insert-first closes that window; the prune converges back to
  // a single row, and `.lt(created_at)` only ever removes rows OLDER than this one,
  // so a concurrent newer write is never deleted.
  const nowIso = new Date().toISOString();
  const { error: insErr } = await supabase.from('agent_memory').insert({
    user_id: userId, memory_type: 'cash_balance',
    content: JSON.stringify({ amount: amt }), created_at: nowIso,
  });
  if (insErr) throw insErr;
  await supabase.from('agent_memory').delete()
    .eq('user_id', userId).eq('memory_type', 'cash_balance').lt('created_at', nowIso);
  return amt;
}

export async function adjustCashBalance(userId, delta) {
  // Prefer the atomic SQL RPC (migration 022): it does the read-modify-write inside
  // the database under a per-user advisory lock, so two trades crediting/debiting
  // at the same instant serialize instead of racing and losing an update. If the
  // function is not present yet (migration not run) or errors, fall back to the JS
  // read-modify-write below so cash still moves, just without cross-request
  // atomicity. Either way the app works; running the migration upgrades adjust from
  // resilient to atomic.
  const d = Number(delta);
  const safeDelta = Number.isFinite(d) ? d : 0;
  try {
    const { data, error } = await supabase.rpc('adjust_cash_balance', { p_user_id: userId, p_delta: safeDelta });
    if (!error) {
      const amt = Number(data);
      if (Number.isFinite(amt) && amt >= 0) return amt;
    }
  } catch { /* fall through to the JS path */ }

  // JS fallback: read-modify-write with a bounded retry so a transient DB blip does
  // not silently drop a credit/debit. (Pre-migration path; the residual race is two
  // concurrent adjusts for the same user, rare for one trader acting one at a time.)
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const cur = await getCashBalance(userId);
      return await setCashBalance(userId, nextCashBalance(cur, delta));
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await sleep(50 * (attempt + 1));
    }
  }
  throw lastErr;
}

/**
 * Non-throwing adjust for the trade write paths: applies the delta with retries
 * and returns { ok, cash }. ok=false means the money moved in the book (a position
 * opened or closed) but cash could not be updated, the one place cash and holdings
 * can drift. Callers log that loudly and surface it instead of swallowing it.
 */
export async function adjustCashBalanceSafe(userId, delta) {
  try {
    const cash = await adjustCashBalance(userId, delta);
    return { ok: true, cash };
  } catch {
    return { ok: false, cash: null };
  }
}
