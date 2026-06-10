/**
 * Founder debug tool (READ-ONLY): pull the full agent conversation that produced a
 * given assistant message, so we can read how the agent behaved DURING a decision,
 * not just the recap it wrote afterward. Nothing is written.
 *
 * Usage: node tests/_review_liquidation_convo.mjs ["snippet to anchor on"]
 */
import { supabase } from '../api/db.js';

const SNIPPET = process.argv[2] || 'Well-executed risk management';

// 1) Find the assistant message that contains the writeup.
const { data: hits, error } = await supabase
  .from('agent_messages')
  .select('id, conversation_id, user_id, role, content, created_at')
  .ilike('content', `%${SNIPPET}%`)
  .order('created_at', { ascending: false })
  .limit(5);

if (error) { console.error('agent_messages query failed:', error.message); process.exit(1); }

if (!hits?.length) {
  console.log(`No agent_messages row contains "${SNIPPET}".`);
  console.log('It may be a Portfolio Explainer or analysis stored elsewhere. Tables to check next:');
  for (const t of ['ai_response_log', 'portfolio_analyses', 'decisions']) {
    const { count, error: e } = await supabase.from(t).select('*', { count: 'exact', head: true });
    console.log(`  ${t}: ${e ? 'n/a (' + e.message + ')' : (count ?? 0) + ' rows'}`);
  }
  process.exit(0);
}

const anchor = hits[0];
console.log(`Anchor message: conversation=${anchor.conversation_id ?? '(none)'}  user=${anchor.user_id?.slice(0, 8)}  at=${anchor.created_at}`);
if (hits.length > 1) console.log(`(${hits.length} messages matched; using the most recent)`);

// 2) Pull the whole thread, in order.
let thread = null;
if (anchor.conversation_id) {
  const { data } = await supabase
    .from('agent_messages')
    .select('role, content, created_at')
    .eq('conversation_id', anchor.conversation_id)
    .order('created_at', { ascending: true });
  thread = data;
} else {
  // No conversation_id on this row: fall back to the same user's surrounding messages.
  const { data } = await supabase
    .from('agent_messages')
    .select('role, content, created_at')
    .eq('user_id', anchor.user_id)
    .order('created_at', { ascending: true })
    .limit(60);
  thread = data;
  console.log('(no conversation_id; showing this user\'s recent messages in time order)');
}

console.log(`\n${'='.repeat(70)}\nFULL THREAD (${thread?.length ?? 0} messages)\n${'='.repeat(70)}`);
for (const m of thread ?? []) {
  console.log(`\n----- ${String(m.role || '?').toUpperCase()}  [${m.created_at}] -----`);
  console.log((m.content || '').trim());
}
