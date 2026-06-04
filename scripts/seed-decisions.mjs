// Seed the decision ledger with synthetic but believable decisions so the
// founder Decision Intelligence dashboard, and the agent's memory, come alive.
// Every row is tagged meta.seed = true and is removable with one command.
//
//   node scripts/seed-decisions.mjs                  seed ~10 simulated traders
//   node scripts/seed-decisions.mjs --user <email>   seed YOUR account, so the
//                                                     agent coaches from "your" record
//   node scripts/seed-decisions.mjs --clean          remove ALL seeded rows
//
// Writes ONLY to the `decisions` table. Never touches real positions, cash, or
// trades. No Anthropic calls. Synthetic demo data, not real signal, wipe it once
// you have real data.
import { randomUUID } from 'node:crypto';
import { supabase } from '../api/db.js';
import { buildDecisionIntelligence } from '../api/services/decisionLedger.js';

const rnd = () => Math.random();
const pick = (a) => a[Math.floor(rnd() * a.length)];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = (n) => Math.round(n * 100) / 100;

const QUALITY = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'COST', 'V'];
const SPEC    = ['PLTR', 'SOFI', 'RIVN', 'SMR', 'EOSE', 'AMD', 'SNAP', 'U'];
const MEME    = ['GME', 'AMC', 'NIO', 'MULN', 'FFIE'];
const baseWin = (t) => QUALITY.includes(t) ? 0.58 : MEME.includes(t) ? 0.18 : 0.42;
const REGIMES = ['Risk On', 'Neutral', 'Risk Off'];
const AI_SOURCES = ['deploy_cash', 'screener', 'dossier'];
const now = Date.now();

function winProb({ ticker, thesis, chase, over, regime, ai }) {
  let p = baseWin(ticker);
  p += ai ? 0.12 : 0;
  p += thesis ? 0.10 : -0.12;
  p += chase ? -0.20 : 0;
  p += over ? -0.10 : 0;
  p += regime === 'Risk Off' ? -0.08 : regime === 'Risk On' ? 0.04 : 0;
  return clamp(p, 0.05, 0.9);
}

// Generate the decision rows (one open + one close per trade) for a trader.
function makeTrades(userId, prof, nTrades) {
  const rows = [];
  for (let i = 0; i < nTrades; i++) {
    const ticker = pick(prof.pool);
    const thesis = rnd() < prof.thesis;
    const chase = rnd() < prof.chase;
    const over = rnd() < prof.over;
    const regime = pick(REGIMES);
    const ai = rnd() < 0.25;
    const source = ai ? pick(AI_SOURCES) : 'manual';
    const price = r2(10 + rnd() * 300);
    const shares = 1 + Math.floor(rnd() * 30);
    const ctx = {
      market_regime: regime,
      vix: r2(14 + rnd() * 20),
      fear_greed: Math.floor(20 + rnd() * 60),
      today_change_pct: chase ? r2(10 + rnd() * 25) : r2(-4 + rnd() * 8),
      pct_of_book: over ? r2(36 + rnd() * 35) : r2(3 + rnd() * 25),
    };
    const win = rnd() < winProb({ ticker, thesis, chase, over, regime, ai });
    const status = win ? 'win' : 'loss';
    const pnlPct = win ? r2(4 + rnd() * 40) : r2(-(4 + rnd() * 35));
    const holdDays = win ? (2 + Math.floor(rnd() * 8)) : (8 + Math.floor(rnd() * 18)); // losers held longer
    const playedOut = win ? (thesis ? 'yes' : 'partially') : 'no';
    const ageOpen = holdDays + 1 + Math.floor(rnd() * 3);
    const openAt = new Date(now - ageOpen * 86400000);
    const closeAt = new Date(openAt.getTime() + holdDays * 86400000);
    const meta = { seed: true, profile: prof.name };
    const outcome = { outcome_status: status, outcome_pnl_pct: pnlPct, outcome_hold_days: holdDays, thesis_played_out: playedOut };
    rows.push({
      user_id: userId, type: 'open', ticker, shares, price,
      thesis: thesis ? 'seed thesis' : null, source, ...ctx, ...outcome,
      resolved_at: closeAt.toISOString(), meta, created_at: openAt.toISOString(),
    });
    rows.push({
      user_id: userId, type: 'close', ticker, shares, price: r2(price * (1 + pnlPct / 100)),
      thesis: thesis ? 'seed thesis' : null, source: 'manual', ...ctx, ...outcome,
      resolved_at: closeAt.toISOString(), meta, created_at: closeAt.toISOString(),
    });
  }
  return rows;
}

async function insertAll(rows) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase.from('decisions').insert(chunk);
    if (error) { console.error('Insert failed:', error.message); process.exit(1); }
    inserted += chunk.length;
  }
  return inserted;
}

// ── Clean ────────────────────────────────────────────────────────────────────
if (process.argv.includes('--clean')) {
  const { error } = await supabase.from('decisions').delete().filter('meta->>seed', 'eq', 'true');
  if (error) { console.error('Clean failed:', error.message); process.exit(1); }
  console.log('Removed all seeded decisions (meta.seed = true).');
  try { await buildDecisionIntelligence(); } catch {}
  process.exit(0);
}

// ── Seed YOUR account (so the agent coaches from your record) ─────────────────
const uIdx = process.argv.indexOf('--user');
if (uIdx !== -1) {
  const email = process.argv[uIdx + 1];
  if (!email) { console.error('Usage: node scripts/seed-decisions.mjs --user <email>'); process.exit(1); }
  const { data: u } = await supabase.from('user_profiles').select('id, email').eq('email', email.toLowerCase().trim()).maybeSingle();
  if (!u) { console.error(`No account for ${email}. (Run scripts/reset-password.mjs --list to see emails.)`); process.exit(1); }
  // A realistic, mildly flawed personal profile so the agent has something to coach.
  const prof = { name: 'you', thesis: 0.7, chase: 0.4, over: 0.15, pool: [...QUALITY, ...SPEC, ...MEME] };
  const inserted = await insertAll(makeTrades(u.id, prof, 14));
  console.log(`Seeded ${inserted} decisions under ${u.email}.`);
  console.log('Now open the Agent and ask "how am I trading?" or "should I buy NIO if it is up 20% today?" and it will coach from your record.');
  try { await buildDecisionIntelligence(); } catch {}
  console.log('\nRemove anytime with: node scripts/seed-decisions.mjs --clean');
  process.exit(0);
}

// ── Default: ~10 simulated traders for the founder dashboard ──────────────────
const PROFILES = [
  { name: 'disciplined', thesis: 0.95, chase: 0.05, over: 0.05, pool: [...QUALITY, ...SPEC] },
  { name: 'disciplined', thesis: 0.90, chase: 0.10, over: 0.05, pool: [...QUALITY, ...SPEC] },
  { name: 'disciplined', thesis: 0.90, chase: 0.10, over: 0.10, pool: [...QUALITY] },
  { name: 'chaser',      thesis: 0.30, chase: 0.75, over: 0.20, pool: [...MEME, ...SPEC] },
  { name: 'chaser',      thesis: 0.25, chase: 0.80, over: 0.25, pool: [...MEME, ...SPEC] },
  { name: 'chaser',      thesis: 0.30, chase: 0.70, over: 0.20, pool: [...MEME] },
  { name: 'no_thesis',   thesis: 0.10, chase: 0.30, over: 0.20, pool: [...SPEC, ...MEME] },
  { name: 'no_thesis',   thesis: 0.15, chase: 0.30, over: 0.20, pool: [...SPEC] },
  { name: 'over',        thesis: 0.60, chase: 0.20, over: 0.60, pool: [...QUALITY, ...SPEC] },
  { name: 'over',        thesis: 0.50, chase: 0.25, over: 0.65, pool: [...SPEC, ...MEME] },
];
const all = [];
for (const prof of PROFILES) all.push(...makeTrades(randomUUID(), prof, 8 + Math.floor(rnd() * 8)));
const inserted = await insertAll(all);
console.log(`Seeded ${inserted} decisions across ${PROFILES.length} simulated traders.`);

const intel = await buildDecisionIntelligence();
console.log('\nIntelligence built:');
console.log('  decisions in window:', intel.totalDecisions, '| users scored:', intel.quality?.scored, '| avg quality index:', intel.quality?.avgIndex);
console.log('  advice lift:', JSON.stringify(intel.adviceLift));
console.log('  base rates:', (intel.baseRates?.buckets || []).map(b => `${b.setup}=${b.winRate}%(${b.n})`).join('  |  '));
console.log('  top patterns:', (intel.behavior?.patterns || []).map(p => `${p.label} ${p.pctOfUsers}%`).join('  |  '));
console.log('\nRemove anytime with: node scripts/seed-decisions.mjs --clean');
process.exit(0);
