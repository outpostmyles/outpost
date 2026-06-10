/**
 * Probe: confirm migration 024 (buy_position_funded) is live and behaves, against the
 * real DB, without leaving any position or balance changed.
 *
 * Verifies the four things the unit tests can't reach (the RPC's runtime behavior):
 *   1. existence
 *   2. affordability: a buy that costs more than the cash on hand is REJECTED and
 *      writes nothing (no position, no debit)
 *   3. exact debit: a new buy creates the position and debits cash by exactly cost;
 *      a merge updates to the blended shares/avg_cost and debits the added lot exactly
 *   4. rollback: a buy whose position write fails (duplicate ticker -> 23505) leaves
 *      cash UNCHANGED, proving the debit and the write are one transaction
 *
 * Non-destructive: runs against the first real user (positions/agent_memory have FKs
 * to user_profiles, so a fake uuid won't do), on a throwaway ticker the user can't
 * really hold. If a position with that ticker already exists it SKIPS rather than
 * risk touching real data. A finally removes the probe position and restores the
 * exact baseline cash no matter what.
 *
 * Usage: node tests/_probe_funded_buy.mjs   (run after applying 024)
 */
import { supabase } from '../api/db.js';
import { getCashBalance, setCashBalance } from '../api/services/cashBalance.js';

const TICKER = 'ZZPROBE'; // not a tradeable symbol; a real user never holds this
let bad = 0;
const ok = (m) => console.log(`ok    ${m}`);
const fail = (m) => { console.log(`FAIL  ${m}`); bad++; };

// Fill the 16-param signature; tests override only what they care about.
const callBuy = (over) => supabase.rpc('buy_position_funded', {
  p_user_id: null, p_position_id: null, p_cost: 0, p_shares: 1, p_avg_cost: 1,
  p_ticker: TICKER, p_company_name: null, p_purchased_at: null, p_source: null,
  p_reversal_condition: null, p_trade_notes: null, p_entry_thesis: null,
  p_thesis_written_at: null, p_thesis_source: null, p_price_target: null, p_stop_loss: null,
  ...over,
});

const { data: anyUser } = await supabase.from('user_profiles').select('id').limit(1).maybeSingle();
if (!anyUser?.id) { console.log('no users in user_profiles, nothing to probe against (skipping)'); process.exit(0); }
const userId = anyUser.id;

// Safety: never touch a real holding. If ZZPROBE somehow exists, bail untouched.
const { data: pre } = await supabase.from('positions').select('id').eq('user_id', userId).eq('ticker', TICKER).maybeSingle();
if (pre?.id) { console.log(`user already has a ${TICKER} position, skipping to avoid touching real data`); process.exit(0); }

const baseline = await getCashBalance(userId);
console.log(`probing against user ${userId.slice(0, 8)}..., baseline cash $${baseline}`);

try {
  // Existence: a zero-cost insert probe tells us if 024 is applied. Roll it back
  // immediately by deleting the row, before the real tests.
  {
    const { error } = await callBuy({ p_user_id: userId, p_cost: 0, p_shares: 1, p_avg_cost: 1 });
    if (error && /does not exist|find the function/i.test(error.message)) {
      console.log(`buy_position_funded not found, migration 024 not applied yet, nothing to verify`);
      await supabase.from('positions').delete().eq('user_id', userId).eq('ticker', TICKER);
      process.exit(0);
    }
    await supabase.from('positions').delete().eq('user_id', userId).eq('ticker', TICKER);
    if (error) { fail(`unexpected error calling RPC: ${error.message}`); }
    else ok('RPC exists');
  }

  // Known cash floor so debits are exact and assertable.
  await setCashBalance(userId, 1000);

  // 2. Affordability: cost beyond cash is rejected, and writes nothing.
  if (!bad) {
    const { data, error } = await callBuy({ p_user_id: userId, p_cost: 5000, p_shares: 100, p_avg_cost: 50 });
    const { data: created } = await supabase.from('positions').select('id').eq('user_id', userId).eq('ticker', TICKER).maybeSingle();
    const cash = await getCashBalance(userId);
    if (error) fail(`affordability call errored: ${error.message}`);
    else if (data?.ok !== false || data?.reason !== 'insufficient_cash') fail(`expected insufficient_cash rejection, got ${JSON.stringify(data)}`);
    else if (created?.id) fail('a rejected buy still created a position');
    else if (cash !== 1000) fail(`a rejected buy moved cash: $1000 -> $${cash}`);
    else ok('over-budget buy rejected, no position written, cash untouched');
  }

  // 3a. New buy: creates the position, debits exactly cost.
  let positionId = null;
  if (!bad) {
    const { data, error } = await callBuy({ p_user_id: userId, p_cost: 200, p_shares: 10, p_avg_cost: 20 });
    const cash = await getCashBalance(userId);
    if (error) fail(`new buy errored: ${error.message}`);
    else if (!data?.ok) fail(`new buy not ok: ${JSON.stringify(data)}`);
    else if (Number(data.position?.shares) !== 10 || Number(data.position?.avg_cost) !== 20) fail(`new position wrong: ${JSON.stringify(data.position)}`);
    else if (cash !== 800) fail(`new buy debit wrong: expected $800, got $${cash}`);
    else { positionId = data.position.id; ok('new buy created position (10 @ $20) and debited exactly $200'); }
  }

  // 3b. Merge: JS passes the final blended values; RPC writes them + debits the added lot.
  if (!bad && positionId) {
    // add 10 @ $40 -> blended 20 @ $30, added-lot cost $400
    const { data, error } = await callBuy({ p_user_id: userId, p_position_id: positionId, p_cost: 400, p_shares: 20, p_avg_cost: 30 });
    const cash = await getCashBalance(userId);
    if (error) fail(`merge errored: ${error.message}`);
    else if (!data?.ok) fail(`merge not ok: ${JSON.stringify(data)}`);
    else if (Number(data.position?.shares) !== 20 || Number(data.position?.avg_cost) !== 30) fail(`merge blend wrong: ${JSON.stringify(data.position)}`);
    else if (cash !== 400) fail(`merge debit wrong: expected $400, got $${cash}`);
    else ok('merge blended to 20 @ $30 and debited exactly $400');
  }

  // 4. Rollback: a duplicate-ticker INSERT fails (23505) and must NOT debit.
  if (!bad) {
    const cashBefore = await getCashBalance(userId);
    const { error } = await callBuy({ p_user_id: userId, p_position_id: null, p_cost: 100, p_shares: 1, p_avg_cost: 100 });
    const cashAfter = await getCashBalance(userId);
    if (!error) fail('a duplicate-ticker insert unexpectedly succeeded');
    else if (error.code !== '23505') fail(`duplicate insert raised ${error.code}, expected 23505`);
    else if (cashAfter !== cashBefore) fail(`a FAILED buy still debited cash: $${cashBefore} -> $${cashAfter} (write + debit are NOT atomic)`);
    else ok('a failed buy (duplicate ticker) rolled back, cash unchanged, write + debit are atomic');
  }
} finally {
  await supabase.from('positions').delete().eq('user_id', userId).eq('ticker', TICKER);
  const restored = await setCashBalance(userId, baseline);
  if (restored === baseline) ok(`cleaned up probe position and restored baseline cash to $${restored}`);
  else fail(`could not restore baseline (set $${restored}, wanted $${baseline}), check user ${userId} manually`);
}

console.log(bad ? `\n${bad} problem(s) found` : '\nall live checks passed');
process.exit(bad ? 1 : 0);
