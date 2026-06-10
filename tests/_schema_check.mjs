/**
 * Founder deploy tool (READ-ONLY): verify the live DB has every table and RPC the
 * code depends on, so "did I run all the migrations" is a check, not a memory.
 * Run this against prod (with prod creds in .env) right after wiring the deploy.
 *
 * Usage: node tests/_schema_check.mjs
 * Nothing is written: RPCs are called with all-zero uuids so atomic functions
 * return NULL / no-op before touching a row.
 */
import { supabase } from '../api/db.js';

const ZERO = '00000000-0000-0000-0000-000000000000';

// Every table the code reads or writes. A missing one means a feature 500s in prod.
const TABLES = [
  'user_profiles', 'positions', 'closed_trades', 'watchlist', 'agent_messages',
  'agent_memory', 'decisions', 'price_alerts', 'journal_notes', 'portfolio_snapshots',
  'screeners', 'deploy_cash_sessions', 'portfolio_analyses', 'research_status',
  'ai_feedback', 'ai_cache', 'ai_usage', 'ai_response_log', 'error_log',
  'analytics_daily', 'password_reset_tokens', 'market_summary', 'beta_allowlist',
];

// Every RPC the code calls. A missing one means trades/cash/credits break (some have
// JS fallbacks, e.g. adjust_cash_balance and the *_and_credit wrappers; close/
// partial_close do NOT). The migration-023 atomic wrappers are listed so a partial
// 023 apply is caught here instead of silently running the non-atomic fallback.
const RPCS = [
  { name: 'close_position', args: { p_position_id: ZERO, p_user_id: ZERO, p_sell_price: 1, p_pnl: 0, p_pnl_percent: 0, p_hold_days: 0, p_reflection_what_happened: null, p_reflection_lesson: null, p_thesis_played_out: null, p_exit_reflection: null, p_exit_outcome: null } },
  { name: 'partial_close_position', args: { p_position_id: ZERO, p_user_id: ZERO, p_sell_shares: 1, p_sell_price: 1, p_pnl: 0, p_pnl_percent: 0, p_hold_days: 0 } },
  { name: 'close_position_and_credit', args: { p_position_id: ZERO, p_user_id: ZERO, p_sell_price: 1, p_pnl: 0, p_pnl_percent: 0, p_hold_days: 0, p_reflection_what_happened: null, p_reflection_lesson: null, p_thesis_played_out: null, p_exit_reflection: null, p_exit_outcome: null, p_proceeds: 0 } },
  { name: 'partial_close_position_and_credit', args: { p_position_id: ZERO, p_user_id: ZERO, p_sell_shares: 1, p_sell_price: 1, p_pnl: 0, p_pnl_percent: 0, p_hold_days: 0, p_proceeds: 0 } },
  { name: 'adjust_cash_balance', args: { p_user_id: ZERO, p_delta: 0 } },
  { name: 'set_cash_balance', args: { p_user_id: ZERO, p_amount: 0 } },
  { name: 'deduct_credits', args: { p_user_id: ZERO, p_amount: 0 } },
  { name: 'refund_credits', args: { p_user_id: ZERO, p_amount: 0 } },
];

const missingFn = (msg) => /could not find the function|does not exist|no function matches/i.test(msg || '');

let problems = 0;
const ok = (m) => console.log(`ok    ${m}`);
const bad = (m) => { console.log(`MISSING  ${m}`); problems++; };

console.log('Tables:');
for (const t of TABLES) {
  const { error } = await supabase.from(t).select('*', { count: 'exact', head: true });
  if (error) bad(`table ${t}: ${error.message}`);
  else ok(`table ${t}`);
}

console.log('\nRPCs:');
for (const { name, args } of RPCS) {
  const { error } = await supabase.rpc(name, args);
  if (error && missingFn(error.message)) bad(`rpc ${name}: not defined (run its migration)`);
  else ok(`rpc ${name}${error ? ' (exists; no-op errored as expected on zero ids)' : ''}`);
}

console.log(problems
  ? `\n${problems} missing object(s). Apply the migration(s) that create them before going live.`
  : '\nAll ' + (TABLES.length + RPCS.length) + ' tables and RPCs the code needs are present.');
process.exit(problems ? 1 : 0);
