// Probe (NOT in the deterministic suite, reads the real DB via .env). Prints
// exactly what the agent's two memory layers resolve to for one account, so we
// can confirm memory is live end to end. Read-only: SELECTs only, no writes.
//
//   node tests/_agent_memory_probe.mjs <email>
//
import { supabase } from '../api/db.js';
import { getMemories, formatMemories, extractMemories } from '../api/services/agentMemory.js';
import { getUserPatternBlock } from '../api/services/decisionLedger.js';

const email = (process.argv[2] || 'mylesschen@gmail.com').toLowerCase().trim();
const { data: u } = await supabase.from('user_profiles').select('id, email, display_name').eq('email', email).maybeSingle();
if (!u) { console.error(`No account for ${email}. Try: node scripts/reset-password.mjs --list`); process.exit(1); }
console.log(`\nAccount: ${u.email} (${u.display_name || 'no name'})  id=${u.id}`);

// Layer 1, the facts memory (agent_memory), extracted from past conversations.
const mems = await getMemories(u.id, 50);
const byType = {};
for (const m of mems) byType[m.memory_type] = (byType[m.memory_type] || 0) + 1;
console.log(`\n[Layer 1] agent_memory rows: ${mems.length}  by type: ${JSON.stringify(byType)}`);
console.log('--- AGENT MEMORY block (verbatim, what the agent reads) ---');
console.log(formatMemories(mems));

// Layer 2, the decision-pattern memory, computed from the graded ledger.
console.log('\n[Layer 2] decisionPatterns block (from the decision ledger):');
const block = await getUserPatternBlock(u.id);
console.log(block && block.trim() ? block : '(empty: no graded decision history for this user)');

// Diagnostic: is Layer 1 empty because of a save bug, or because the trader
// only ever asked questions (which the extractor deliberately skips)? Replay the
// real extractor over their actual user messages and report how many it WOULD
// produce. If that count is > 0 but Layer 1 above is empty, the save path is
// broken; if it is ~0, the empty state is correct and expected.
const { data: userMsgs } = await supabase.from('agent_messages')
  .select('content, created_at').eq('user_id', u.id).eq('role', 'user')
  .order('created_at', { ascending: false }).limit(200);
let wouldExtract = 0;
const samples = [];
for (const m of userMsgs ?? []) {
  const got = extractMemories(m.content || '');
  if (got.length) { wouldExtract += got.length; if (samples.length < 6) samples.push({ said: (m.content || '').slice(0, 70), got }); }
}
console.log(`\n[Diagnostic] user messages scanned: ${userMsgs?.length ?? 0}  extractable memories the parser would produce: ${wouldExtract}`);
for (const s of samples) console.log(`  "${s.said}..." -> ${s.got.map(g => `${g.type}:${g.content}`).join(' ; ')}`);
if ((userMsgs?.length ?? 0) > 0 && wouldExtract === 0) {
  console.log('  (so Layer 1 is correctly empty: the trader has been asking questions, not stating intents/preferences the parser captures.)');
}

// Proof the Layer 1 round-trip works when a trader DOES state something concrete.
const demo = extractMemories("I'm going to sell NVDA at $180, and I prefer swing trading over day trading. I'm bullish on PLTR.");
console.log(`\n[Round-trip proof] a concrete statement extracts ${demo.length}:`);
console.log(formatMemories(demo.map((d, i) => ({ memory_type: d.type, content: d.content, ticker: d.ticker ?? null, created_at: new Date().toISOString() }))));

console.log('');
process.exit(0);
