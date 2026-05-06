/**
 * FK drift probe — check every user-owned table to see if its user_id FK
 * points to user_profiles (correct) or users (wrong, like closed_trades).
 *
 * Usage: node tests/probe_fk_drift.mjs
 */

import { supabase } from '../api/db.js';

const tables = [
  'positions', 'watchlist', 'futures_trades', 'portfolio_snapshots',
  'portfolio_analyses', 'agent_messages', 'agent_memory',
  'journal_notes', 'journal_sections', 'journal_entries',
  'price_alerts', 'closed_trades', 'ai_feedback', 'feedback',
  'password_reset_tokens',
];

console.log('=== Finding a real user_profiles ID to test against ===');
const { data: users } = await supabase.from('user_profiles').select('id').limit(1);
if (!users?.length) { console.log('No users — cannot test.'); process.exit(1); }
const userId = users[0].id;
console.log(`Using ${userId}\n`);

console.log('=== Per-table FK probe ===');
console.log('(testing whether a user_profiles.id is accepted by each table\'s FK)\n');

for (const table of tables) {
  // Insert a minimal probe row with just user_id and any required cols we can guess.
  // If the FK points to user_profiles, this won't fail on FK (may fail on other NOT NULLs — that's fine).
  // If the FK points to users, we get a 23503 FK violation.
  const probe = { user_id: userId };
  // Add common required cols speculatively
  if (['positions','watchlist','futures_trades','closed_trades','price_alerts','portfolio_analyses','agent_memory'].includes(table)) {
    probe.ticker = 'PROBE';
  }
  if (table === 'agent_messages') { probe.role = 'user'; probe.content = 'probe'; }
  if (table === 'futures_trades') { probe.instrument = 'PROBE'; probe.direction = 'long'; probe.outcome = 'win'; probe.date = '2026-01-01'; }
  if (table === 'portfolio_snapshots') { probe.total_value = 1; probe.date = '2026-01-01'; }
  if (table === 'portfolio_analyses') { probe.analysis_type = 'probe'; probe.analysis_text = 'probe'; probe.date = '2026-01-01'; }
  if (table === 'price_alerts') { probe.direction = 'above'; probe.threshold = 1; }
  if (table === 'journal_sections') { probe.name = 'PROBE'; }
  if (table === 'journal_entries') { probe.content = 'probe'; }
  if (table === 'journal_notes') { probe.title = 'PROBE'; probe.content = 'probe'; }
  if (table === 'ai_feedback') { probe.feature = 'probe'; probe.rating = 'up'; }
  if (table === 'feedback') { probe.type = 'bug'; probe.description = 'probe'; }
  if (table === 'password_reset_tokens') { probe.token = 'probe-' + Date.now(); probe.expires_at = new Date(Date.now() + 60000).toISOString(); }

  const { error } = await supabase.from(table).insert(probe);

  if (!error) {
    // Insert worked — clean up
    if (probe.ticker) {
      await supabase.from(table).delete().eq('user_id', userId).eq('ticker', 'PROBE');
    } else if (probe.token) {
      await supabase.from(table).delete().eq('token', probe.token);
    } else if (probe.name) {
      await supabase.from(table).delete().eq('user_id', userId).eq('name', 'PROBE');
    } else {
      // Best-effort
      await supabase.from(table).delete().eq('user_id', userId);
    }
    console.log(`  ✅ ${table.padEnd(28)} FK looks correct (insert with user_profiles.id worked)`);
  } else if (error.code === '23503' && error.message.includes('users')) {
    console.log(`  ❌ ${table.padEnd(28)} FK points to wrong table — ${error.message}`);
  } else if (error.code === '23502') {
    // NOT NULL violation on a required col we didn't supply — but FK passed, table is fine
    console.log(`  ✅ ${table.padEnd(28)} FK looks correct (insert hit NOT NULL on another col, not FK)`);
  } else {
    console.log(`  ⚠️  ${table.padEnd(28)} other error: ${error.message}`);
  }
}

console.log('\n=== Done ===');
process.exit(0);
