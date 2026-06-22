// Probe (NOT in the deterministic suite, reads the real DB via .env). Exercises
// the full propose_position_update tool path end to end: holdings lookup, the
// validator, and the proposal sink the route streams to the UI. It NEVER writes
// (the tool only drafts; a write would need PATCH /positions/:id on Apply).
//
//   node tests/_propose_probe.mjs <email>
//
import { supabase } from '../api/db.js';
import { executeTool } from '../api/services/agentTools.js';

const email = (process.argv[2] || 'you@example.com').toLowerCase().trim();
const { data: u } = await supabase.from('user_profiles').select('id, email').eq('email', email).maybeSingle();
if (!u) { console.error(`No account for ${email}`); process.exit(1); }

const { data: positions } = await supabase.from('positions').select('ticker').eq('user_id', u.id).limit(10);
const held = (positions ?? []).map(p => p.ticker);
console.log(`\nAccount: ${u.email}`);
console.log(`Holdings: ${held.length ? held.join(', ') : '(none)'}`);

const sink = [];

if (held[0]) {
  const r = await executeTool('propose_position_update',
    { ticker: held[0], thesis: 'probe draft thesis', stop_loss: 1, take_profit: 999999 },
    { userId: u.id, proposals: sink });
  console.log(`\n[held ${held[0]}] tool returned: ${JSON.stringify(r)}`);
  console.log(`[held ${held[0]}] proposal pushed to sink: ${JSON.stringify(sink[sink.length - 1] ?? null)}`);

  const empty = await executeTool('propose_position_update', { ticker: held[0] }, { userId: u.id, proposals: [] });
  console.log(`[held ${held[0]}, empty draft] tool returned: ${JSON.stringify(empty)}`);
} else {
  console.log('\n(no holdings to test the accepted path; the unit test covers it)');
}

const notHeld = await executeTool('propose_position_update', { ticker: 'ZZZZ', thesis: 'x' }, { userId: u.id, proposals: [] });
console.log(`\n[not held ZZZZ] tool returned: ${JSON.stringify(notHeld)}`);

console.log(`\nProposals that would surface as confirm cards: ${sink.length}`);
console.log('');
process.exit(0);
