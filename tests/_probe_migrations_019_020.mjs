/**
 * Probe: confirm migrations 019 (ai_usage) and 020 (partial_close_position)
 * are live and SOUND, without mutating any real data.
 *
 *  - 019: the ai_usage table exists and is queryable (cost tracking can write).
 *  - 020: the partial_close_position RPC exists, AND closed_trades has every
 *         column the RPC's INSERT references (the column-mismatch risk I flagged).
 *
 * Read-only. The RPC call uses random uuids, so its internal UPDATE finds no row
 * and it returns NULL before ever inserting. Nothing is written.
 *
 * Usage: node tests/_probe_migrations_019_020.mjs
 */
import { supabase } from '../api/db.js';

let bad = 0;
const ok = (m) => console.log(`ok    ${m}`);
const fail = (m) => { console.log(`FAIL  ${m}`); bad++; };

// --- 019: ai_usage exists + readable ---
{
  const { error, count } = await supabase.from('ai_usage').select('*', { count: 'exact', head: true });
  if (error) fail(`ai_usage table: ${error.message}`);
  else ok(`ai_usage table is live (${count ?? 0} rows recorded so far)`);
}

// --- 020a: the RPC exists (random ids => returns NULL, writes nothing) ---
{
  const ZERO = '00000000-0000-0000-0000-000000000000';
  const { error } = await supabase.rpc('partial_close_position', {
    p_position_id: ZERO, p_user_id: ZERO, p_sell_shares: 1, p_sell_price: 1,
    p_pnl: 0, p_pnl_percent: 0, p_hold_days: 0,
  });
  if (error) fail(`partial_close_position RPC: ${error.message}`);
  else ok('partial_close_position RPC exists and returns cleanly (no-op on a missing position)');
}

// --- 020b: closed_trades has EVERY column the RPC inserts into ---
{
  const needed = ['user_id','ticker','company_name','shares','avg_cost','sell_price','pnl','pnl_percent','entry_thesis','price_target','stop_loss','trade_notes','opened_at','closed_at','hold_days'];
  const { error } = await supabase.from('closed_trades').select(needed.join(',')).limit(0);
  if (error) fail(`closed_trades schema: ${error.message} (the trim INSERT would 500 on this)`);
  else ok(`closed_trades has all ${needed.length} columns the trim RPC writes`);
}

console.log(bad ? `\n${bad} problem(s) found` : '\nall live checks passed');
process.exit(bad ? 1 : 0);
