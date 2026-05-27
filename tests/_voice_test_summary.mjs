// Voice test harness for the AI Market Summary prompt.
// Extracts the live SYSTEM prompt from api/functions/ai.js and calls Claude
// with a realistic market data snapshot.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

const src = readFileSync('/Users/mylesschenfield/Downloads/outpost_new/api/functions/ai.js', 'utf8');
// Grab the system-prompt template literal inside the /summary route claudeCall.
// It starts at `You are Outpost — the friend in someone's phone who actually knows markets.`
const startMarker = 'You are Outpost — the friend in someone';
const startIdx = src.indexOf(startMarker);
if (startIdx < 0) throw new Error('Updated SYSTEM not found');
const endIdx = src.indexOf('`,', startIdx);
let SYSTEM = src.slice(startIdx, endIdx);
// Substitute the PLAIN_TEXT_RULE placeholder — defined at top of file.
const ptrMatch = src.match(/const PLAIN_TEXT_RULE\s*=\s*['`]([^'`]+)['`]/);
const PLAIN_TEXT_RULE = ptrMatch ? ptrMatch[1] : 'CRITICAL: Respond in plain text only.';
SYSTEM = SYSTEM.replace('${PLAIN_TEXT_RULE}', PLAIN_TEXT_RULE);

// Realistic risk-on-leaning day, matches the BEFORE/AFTER example's tone.
const userMsg = `Market read: VIX 16.2 (low), Fear & Greed 65/100 (Greed), SPY RSI 58, Regime: Risk-on. Momentum: positive.
INDEX MOVES: SPY: $585.20 (+0.42%), QQQ: $510.45 (+0.71%), DIA: $445.10 (+0.18%), IWM: $230.15 (+1.12%)
TOP GAINERS: NVDA +3.2%, AMD +2.8%, AVGO +2.4%
TOP LOSERS: JNJ -1.8%, PG -1.4%, KO -1.1%
TREND: VIX has fallen from 22 to 16 over the past 5 sessions; SPY is making new 30-day highs.
HEADLINES:
- Fed signals patience on rate cuts after benign inflation print
- Tech earnings beat estimates across the board
Give me the real read — what's the STORY today, where is money flowing, and what level matters most right now?`;

console.log('=== USER MESSAGE ===');
console.log(userMsg);
console.log('');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

for (let i = 1; i <= 3; i++) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  });
  console.log(`=== SAMPLE ${i} ===`);
  console.log(msg.content[0].text.trim());
  console.log('');
}
