/**
 * Probe — what's wrong with the closed_trades insert?
 * Bypasses the silent catch in portfolio.js by running the exact same insert
 * directly and printing the raw Supabase error.
 *
 * Usage: node tests/probe_closed_trades.mjs
 */

import { supabase } from '../api/db.js';

console.log('=== Step 1: List columns currently on closed_trades ===');
const { data: cols, error: colErr } = await supabase
  .rpc('exec_sql', { sql: "SELECT column_name FROM information_schema.columns WHERE table_name = 'closed_trades' ORDER BY ordinal_position" })
  .then(r => r, () => ({ data: null, error: 'no exec_sql RPC' }));

if (colErr) {
  // Fallback: insert a single row with one column to detect schema
  console.log('  (no exec_sql RPC, will detect via insert errors)');
} else if (cols) {
  console.log('  Columns:', cols.map(c => c.column_name).join(', '));
}

console.log('\n=== Step 2: Find any test user we can attach to ===');
const { data: users } = await supabase.from('user_profiles').select('id').limit(1);
if (!users?.length) {
  console.log('  No users in DB — cannot test (need at least one)');
  process.exit(1);
}
const userId = users[0].id;
console.log(`  Using user ${userId}`);

console.log('\n=== Step 3: Try minimal insert (id, user_id, ticker only) ===');
const { error: minErr } = await supabase.from('closed_trades').insert({
  user_id: userId,
  ticker: 'PROBE',
});
if (minErr) {
  console.log('  FAIL:', minErr.message);
  console.log('  Code:', minErr.code);
  console.log('  Details:', minErr.details);
} else {
  console.log('  PASS — minimal insert works. Cleaning up...');
  await supabase.from('closed_trades').delete().eq('user_id', userId).eq('ticker', 'PROBE');
}

console.log('\n=== Step 4: Try the FULL insert (matching portfolio.js close path) ===');
const fullPayload = {
  user_id: userId,
  ticker: 'PROBE2',
  company_name: 'Probe Co',
  shares: 10,
  avg_cost: 100,
  sell_price: 110,
  pnl: 100,
  pnl_percent: 10,
  entry_thesis: 'test',
  price_target: 120,
  stop_loss: 90,
  trade_notes: 'note',
  exit_reflection: 'reflection',
  exit_outcome: 'win_thesis_right',
  opened_at: new Date(Date.now() - 86400000).toISOString(),
  closed_at: new Date().toISOString(),
  hold_days: 1,
};

const { error: fullErr } = await supabase.from('closed_trades').insert(fullPayload);
if (fullErr) {
  console.log('  FAIL:', fullErr.message);
  console.log('  Code:', fullErr.code);
  console.log('  Details:', fullErr.details);
  console.log('  Hint:', fullErr.hint);
  console.log('');
  console.log('  This is what was happening when you closed positions in your app.');
  console.log('  The fix is whatever the error message points to.');
} else {
  console.log('  PASS — full insert works! Cleaning up...');
  await supabase.from('closed_trades').delete().eq('user_id', userId).eq('ticker', 'PROBE2');
  console.log('  ...so why is B.9 failing? Different cause — the test runner may have a stale TOKEN.');
}

console.log('\n=== Step 5: Field-by-field bisect (find which column is broken) ===');
const allFields = Object.keys(fullPayload);
const minimalFields = ['user_id', 'ticker'];
const optionalFields = allFields.filter(f => !minimalFields.includes(f));

for (const field of optionalFields) {
  const probe = { user_id: userId, ticker: `PRB_${field.slice(0, 8)}`, [field]: fullPayload[field] };
  const { error } = await supabase.from('closed_trades').insert(probe);
  if (error) {
    console.log(`  ❌ "${field}" — ${error.message}`);
  } else {
    await supabase.from('closed_trades').delete().eq('user_id', userId).eq('ticker', `PRB_${field.slice(0, 8)}`);
  }
}

console.log('\n=== Done ===');
process.exit(0);
