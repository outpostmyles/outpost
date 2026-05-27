// Voice test for the position GET AI READ (deep + quick).
// Two scenarios:
//   A) AAPL — quiet day, up moderately, moving with market
//   B) META — down a lot from cost, diverging from market
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

const src = readFileSync('/Users/mylesschenfield/Downloads/outpost_new/api/functions/ai.js', 'utf8');
const ptrMatch = src.match(/const PLAIN_TEXT_RULE\s*=\s*['`]([^'`]+)['`]/);
const PLAIN_TEXT_RULE = ptrMatch ? ptrMatch[1] : '';

function extractSystem(startMarker) {
  const startIdx = src.indexOf(startMarker);
  if (startIdx < 0) throw new Error(`Marker not found: ${startMarker}`);
  // Find the closing backtick — walk forward until we hit `,` outside the string.
  // Simpler heuristic: find the next ${PLAIN_TEXT_RULE}\`, that's the closer.
  const endIdx = src.indexOf('${PLAIN_TEXT_RULE}`', startIdx);
  if (endIdx < 0) throw new Error(`Closer not found from ${startMarker}`);
  let s = src.slice(startIdx, endIdx + '${PLAIN_TEXT_RULE}'.length);
  return s.replace('${PLAIN_TEXT_RULE}', PLAIN_TEXT_RULE);
}

// Both routes use unique opening lines I just inserted.
const SYSTEM_DEEP = extractSystem('You are Outpost — the friend in someone\'s phone who actually knows finance. They tapped to read one of their stocks');
const SYSTEM_QUICK = extractSystem('You are Outpost — the friend in someone\'s phone who actually knows finance. The user tapped GET AI READ');

// Scenario A — AAPL, up 20%, moving with market
const aaplUserMsg = (deep) => deep ? `Read AAPL for this user:
POSITION: AAPL: 30 shares @ $180 avg, current $216, P&L +20.0% (+$1080)
TODAY: 0.4% move, volume 48,210,000
MARKET-RELATIVE: AAPL is +0.4% today vs SPY +0.42%, QQQ +0.71% → moving WITH the broad market.
USER PROFILE: swing trader, moderate risk tolerance
CURRENT MARKET: Regime Risk-on, VIX 16.2 (low), F&G 65 (Greed), SPY RSI 58
TREND: VIX has fallen from 22 to 16 over the past 5 sessions; SPY is making new 30-day highs.
AAPL NEWS:
No recent ticker-specific news
BROAD MARKET HEADLINES:
- Fed signals patience on rate cuts after benign inflation print
- Tech earnings beat estimates across the board
PORTFOLIO CONTEXT: META 51%, AAPL 49% of book

Use the MARKET-RELATIVE line to decide: is this stock-specific or moving with the tape? That's the single most important question for whether the user should care.` : `Quick read on AAPL: AAPL: 30 shares @ $180 avg, current $216, P&L +20.0% (+$1080)
Today: 0.4% move
MARKET-RELATIVE: AAPL is +0.4% today vs SPY +0.42%, QQQ +0.71% → moving WITH the broad market.
Market: Risk-on, VIX 16.2.
NEWS: no recent company-specific headlines

Answer "should they worry?" — calmly when calm is correct, plainly when it's not.`;

// Scenario B — META, down 20% from cost, diverging
const metaUserMsg = (deep) => deep ? `Read META for this user:
POSITION: META: 8 shares @ $580 avg, current $463, P&L -20.2% (-$936)
TODAY: -3.2% move, volume 18,500,000
MARKET-RELATIVE: META is -3.2% today vs SPY +0.42%, QQQ +0.71% → UNDERPERFORMING the market by 3.6%.
SIGNIFICANT DRAWDOWN: this position is -20% below cost basis — an actual sell-trigger zone for many holders.
USER PROFILE: swing trader, moderate risk tolerance
CURRENT MARKET: Regime Risk-on, VIX 16.2 (low), F&G 65 (Greed), SPY RSI 58
TREND: VIX has fallen from 22 to 16 over the past 5 sessions; SPY is making new 30-day highs.
META NEWS:
Reuters: Meta reportedly cuts 2026 capex guidance after AI infrastructure overspend concerns
Bloomberg: Analysts question Meta's AI ROI timeline; downgrades from two firms today
BROAD MARKET HEADLINES:
- Fed signals patience on rate cuts after benign inflation print
- Tech earnings beat estimates across the board
PORTFOLIO CONTEXT: META 51%, AAPL 49% of book

Use the MARKET-RELATIVE line to decide: is this stock-specific or moving with the tape? That's the single most important question for whether the user should care.` : `Quick read on META: META: 8 shares @ $580 avg, current $463, P&L -20.2% (-$936)
Today: -3.2% move
MARKET-RELATIVE: META is -3.2% today vs SPY +0.42%, QQQ +0.71% → UNDERPERFORMING the market by 3.6%.
SIGNIFICANT DRAWDOWN: this position is -20% below cost basis — an actual sell-trigger zone for many holders.
Market: Risk-on, VIX 16.2.
NEWS:
Reuters: Meta reportedly cuts 2026 capex guidance after AI infrastructure overspend concerns
Bloomberg: Analysts question Meta's AI ROI timeline; downgrades from two firms today

Answer "should they worry?" — calmly when calm is correct, plainly when it's not.`;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function run(label, system, userMsg, model, maxTokens) {
  const msg = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: userMsg }],
  });
  console.log(`=== ${label} ===`);
  console.log(msg.content[0].text.trim());
  console.log('');
}

const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const MODEL_SONNET = 'claude-sonnet-4-20250514';

await run('QUICK · AAPL · quiet/with-market · sample 1', SYSTEM_QUICK, aaplUserMsg(false), MODEL_HAIKU, 200);
await run('QUICK · AAPL · quiet/with-market · sample 2', SYSTEM_QUICK, aaplUserMsg(false), MODEL_HAIKU, 200);
await run('QUICK · META · -20% drawdown + diverging · sample 1', SYSTEM_QUICK, metaUserMsg(false), MODEL_HAIKU, 200);
await run('QUICK · META · -20% drawdown + diverging · sample 2', SYSTEM_QUICK, metaUserMsg(false), MODEL_HAIKU, 200);
await run('DEEP · META · -20% drawdown + diverging', SYSTEM_DEEP, metaUserMsg(true), MODEL_SONNET, 400);
