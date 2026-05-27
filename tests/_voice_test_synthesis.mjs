// Ad-hoc harness for the Outpost Read voice rewrite.
// Crafts the same META+AAPL summary the /api/portfolio/synthesis route would
// produce, calls Claude with the live SYSTEM prompt, prints output.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

const src = readFileSync(
  '/Users/mylesschenfield/Downloads/outpost_new/api/services/portfolioSynthesis.js',
  'utf8'
);
const m = src.match(/const SYSTEM = `([\s\S]*?)`;/);
if (!m) throw new Error('SYSTEM constant not found');
const SYSTEM = m[1];

// META + AAPL, roughly the BEFORE/AFTER example in the brief:
// two-stock account, both up real money since entry, no plans.
const summary = {
  positionCount: 2,
  totalValue: 8200,
  totalPnl: 1900,
  todayChange: 65,
  topConcentration: [
    { ticker: 'META', pctOfBook: 51.2 },
    { ticker: 'AAPL', pctOfBook: 48.8 },
  ],
  movers: [],
  drawdowns: [],
  winners: [
    { ticker: 'META', pnlPct: 42.6 },
    { ticker: 'AAPL', pnlPct: 31.0 },
  ],
  nearTarget: [],
  belowStop: [],
  planCoveragePct: 0,
  plannedCount: 0,
};

function buildUserMessage(s) {
  const lines = [
    `POSITIONS: ${s.positionCount} | TOTAL VALUE: $${s.totalValue.toFixed(0)} | TOTAL P&L: $${s.totalPnl.toFixed(0)} | TODAY: $${s.todayChange.toFixed(0)}`,
  ];
  if (s.topConcentration.length) lines.push(`TOP CONCENTRATION: ${s.topConcentration.map(c => `${c.ticker} ${c.pctOfBook}% of book`).join(', ')}`);
  if (s.movers.length) lines.push(`BIG MOVERS TODAY: ${s.movers.map(m => `${m.ticker} ${m.changePct >= 0 ? '+' : ''}${m.changePct}%`).join(', ')}`);
  if (s.drawdowns.length) lines.push(`DRAWDOWNS FROM COST: ${s.drawdowns.map(d => `${d.ticker} ${d.pnlPct}%`).join(', ')}`);
  if (s.winners.length) lines.push(`BIG WINNERS FROM COST: ${s.winners.map(w => `${w.ticker} +${w.pnlPct}%`).join(', ')}`);
  if (s.nearTarget.length) lines.push(`NEAR PRICE TARGET: ${s.nearTarget.map(n => `${n.ticker} (target $${n.target})`).join(', ')}`);
  if (s.belowStop.length) lines.push(`BELOW STOP LOSS: ${s.belowStop.map(b => `${b.ticker} (stop $${b.stop})`).join(', ')}`);
  lines.push(`TRADE PLANS SET: ${s.plannedCount} of ${s.positionCount} (${s.planCoveragePct}%)`);
  lines.push('');
  lines.push('Write the synthesis now. 2-3 plain sentences.');
  return lines.join('\n');
}

const userMsg = buildUserMessage(summary);
console.log('=== USER MESSAGE ===');
console.log(userMsg);
console.log('');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Run 3 samples — voice consistency check, not a one-off.
for (let i = 1; i <= 3; i++) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 280,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  });
  console.log(`=== SAMPLE ${i} ===`);
  console.log(msg.content[0].text.trim());
  console.log('');
}
