/**
 * Probe: confirm migration 022 (adjust_cash_balance) is live and ATOMIC, without
 * leaving any real balance changed.
 *
 *  - existence + soundness: adjust(user, 0) returns the balance unchanged (proves
 *    the function exists, reads, and writes back correctly, no FK surprises).
 *  - atomicity: fire many concurrent +d and -d adjusts that net to zero. Under the
 *    per-user advisory lock they serialize and the balance returns EXACTLY to
 *    baseline. If the lock were missing, concurrent read-modify-writes would lose
 *    updates and the net would drift off zero. This is the whole point of the RPC.
 *
 * Non-destructive: the test nets to zero, and a finally restores the exact baseline
 * regardless. Runs against the first real user (agent_memory has an FK to
 * user_profiles, so a fake uuid cannot be used). Skips cleanly if there are no users.
 *
 * Usage: node tests/_probe_cash_rpc.mjs
 */
import { supabase } from '../api/db.js';
import { getCashBalance, setCashBalance } from '../api/services/cashBalance.js';

let bad = 0;
const ok = (m) => console.log(`ok    ${m}`);
const fail = (m) => { console.log(`FAIL  ${m}`); bad++; };

const { data: anyUser } = await supabase.from('user_profiles').select('id').limit(1).maybeSingle();
if (!anyUser?.id) {
  console.log('no users in user_profiles, nothing to probe against (skipping)');
  process.exit(0);
}
const userId = anyUser.id;
const baseline = await getCashBalance(userId);
console.log(`probing against user ${userId.slice(0, 8)}..., baseline cash $${baseline}`);

try {
  // --- existence + soundness: a zero adjust must leave the balance unchanged ---
  {
    const { data, error } = await supabase.rpc('adjust_cash_balance', { p_user_id: userId, p_delta: 0 });
    if (error) {
      fail(`adjust_cash_balance RPC: ${error.message}${/does not exist|find the function/i.test(error.message) ? '  (migration 022 not run yet)' : ''}`);
    } else {
      const v = Number(data);
      if (v === baseline) ok(`RPC exists and a zero adjust preserved the balance ($${v})`);
      else fail(`zero adjust changed the balance: $${baseline} -> $${v}`);
    }
  }

  // --- atomicity: N credits + N debits of the same size, all concurrent ---
  if (!bad) {
    const N = 20, STEP = 3;
    const calls = [];
    for (let i = 0; i < N; i++) {
      calls.push(supabase.rpc('adjust_cash_balance', { p_user_id: userId, p_delta: STEP }));
      calls.push(supabase.rpc('adjust_cash_balance', { p_user_id: userId, p_delta: -STEP }));
    }
    const results = await Promise.all(calls);
    const rpcErr = results.find(r => r.error);
    if (rpcErr) {
      fail(`concurrent adjust errored: ${rpcErr.error.message}`);
    } else {
      const after = await getCashBalance(userId);
      // Net is zero, but only if no update was lost. Floor at 0 caveat: keep the
      // baseline comfortably above N*STEP so debits never clamp (which would make a
      // lost update invisible). If baseline is tiny we still expect exact baseline
      // because each -STEP is paired with a +STEP and the lock serializes them.
      if (after === baseline) ok(`${2 * N} concurrent adjusts netted to zero exactly: balance held at $${after} (advisory lock serializes, no lost updates)`);
      else fail(`balance drifted under concurrency: $${baseline} -> $${after} (expected no change; a lost update is the likely cause)`);
    }
  }
} finally {
  // Always restore the exact baseline, even if a check threw or drifted.
  const restored = await setCashBalance(userId, baseline);
  if (restored === baseline) ok(`restored baseline cash to $${restored}`);
  else fail(`could not cleanly restore baseline (set to $${restored}, wanted $${baseline}) -- check user ${userId} manually`);
}

console.log(bad ? `\n${bad} problem(s) found` : '\nall live checks passed');
process.exit(bad ? 1 : 0);
