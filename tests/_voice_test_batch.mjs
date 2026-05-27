// One-shot voice check for the 4 remaining generation prompts.
// Bargain Radar, Sector Radar, Portfolio Explainer, Pre-market Brief.
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const HAIKU = 'claude-haiku-4-5-20251001';

function extractTemplate(file, startMarker, closer = '`;') {
  const src = readFileSync(file, 'utf8');
  const s = src.indexOf(startMarker);
  if (s < 0) throw new Error(`Marker not found in ${file}: ${startMarker}`);
  const e = src.indexOf(closer, s);
  let t = src.slice(s, e);
  // Substitute PLAIN_TEXT_RULE if present
  const ptr = src.match(/const PLAIN_TEXT_RULE\s*=\s*['`]([^'`]+)['`]/);
  if (ptr) t = t.replaceAll('${PLAIN_TEXT_RULE}', ptr[1]);
  return t;
}

async function callOnce(system, userMsg, max = 600) {
  const m = await anthropic.messages.create({
    model: HAIKU, max_tokens: max, system, messages: [{ role: 'user', content: userMsg }],
  });
  return m.content[0].text.trim();
}

// ---- BARGAIN RADAR ----
const bargainSys = extractTemplate(
  '/Users/mylesschenfield/Downloads/outpost_new/api/functions/bargainRadar.js',
  "You are Outpost — the friend in someone's phone who actually knows finance. You're looking at stocks that have dropped"
);
const bargainUser = `Evaluate these oversold large-caps. Which are buyable dips and which are real problems?

1. PFE — price $24.10, 28.4% off 52w high ($33.65), RSI 32.1, analyst 3.6/5 (22 analysts), PT $32.50 (+34.9% upside)
2. INTC — price $19.80, 51.2% off 52w high ($40.55), RSI 28.4, analyst 2.9/5 (28 analysts), PT $25.10 (+26.8% upside)
3. BABA — price $82.40, 18.6% off 52w high ($101.30), RSI 34.7, analyst 4.1/5 (35 analysts), PT $110.00 (+33.5% upside)

Return JSON:
{
  "verdicts": [
    { "ticker": "XYZ", "verdict": "buyable" | "avoid", "thesis": "one sentence" }
  ]
}`;

// ---- SECTOR RADAR ----
const sectorSys = extractTemplate(
  '/Users/mylesschenfield/Downloads/outpost_new/api/functions/sectorRadar.js',
  "You are Outpost — the friend in someone's phone who actually knows finance. You're watching which parts"
);
const sectorUser = `SPY is +0.42% today. Analyze these sector signals and identify where money is rotating:

XLK (Technology): +1.20% today, +0.78% vs SPY, 4 news mentions (themes: AI capex, semiconductor demand)
XLF (Financials): +0.92% today, +0.50% vs SPY, 2 news mentions (themes: rate cuts)
XLE (Energy): -1.40% today, -1.82% vs SPY, 3 news mentions (themes: demand worries, OPEC supply)
XLV (Healthcare): -0.30% today, -0.72% vs SPY, no notable news clustering
XLY (Consumer Discretionary): +0.55% today, +0.13% vs SPY, no notable news clustering
XLP (Consumer Staples): -0.60% today, -1.02% vs SPY, no notable news clustering
XLI (Industrials): +0.10% today, -0.32% vs SPY, no notable news clustering
XLB (Materials): +0.20% today, -0.22% vs SPY, no notable news clustering
XLU (Utilities): -0.45% today, -0.87% vs SPY, no notable news clustering
XLRE (Real Estate): +0.30% today, -0.12% vs SPY, no notable news clustering

Return JSON with:
{
  "heating": [{ "ticker": "XLK", "name": "Technology", "signal": "strong" or "early", "thesis": "one sentence why", "relativeStrength": number }],
  "cooling": [{ "ticker": "XLE", "name": "Energy", "signal": "warning" or "risk", "thesis": "one sentence why", "relativeStrength": number }],
  "themeWatch": { "name": "theme name", "thesis": "one sentence on an emerging theme to watch", "ticker": "ETF ticker" } or null
}`;

// ---- PORTFOLIO EXPLAINER ----
const explainerSys = extractTemplate(
  '/Users/mylesschenfield/Downloads/outpost_new/api/functions/portfolioExplainer.js',
  "You are Outpost — the friend in someone's phone who actually knows finance. You're telling them WHY"
);
const explainerUser = `Today's portfolio recap inputs:

Portfolio: -1.42% (-$117.00) across 2 positions
SPY: +0.42% today

MOVERS (ranked by dollar impact):

META: down -3.20% (-$118.92 dollar impact, 8 shares)
Headlines:
- Reuters: Meta reportedly cuts 2026 capex guidance after AI infrastructure overspend concerns
- Bloomberg: Analysts question Meta's AI ROI timeline; downgrades from two firms today

AAPL: up +0.40% (+$2.59 dollar impact, 30 shares)
Headlines:
- No recent ticker-specific news

Return JSON in this exact shape:
{
  "summary": "one sentence summarizing the day in context",
  "explanations": [
    { "ticker": "XYZ", "why": "one sentence why it moved" }
  ]
}`;

// ---- PRE-MARKET BRIEF ----
const briefSys = extractTemplate(
  '/Users/mylesschenfield/Downloads/outpost_new/api/jobs/runner.js',
  "You are Outpost — the friend in someone's phone who actually knows finance. You're writing the morning brief"
);
const briefUser = `Trader: Alex | Style: swing | Risk: moderate
Market: regime Risk-on, VIX 16 (low), F&G 65 (Greed), SPY RSI 58
Positions: META 51% (8 sh @ $580, current $463, -20.2%), AAPL 49% (30 sh @ $180, current $216, +20.0%)
ACTIVE ALERTS: none
PREMARKET MOVERS in your book: META -2.1% premarket on continued AI-spending concerns
Ticker news: META — Reuters: Meta cuts 2026 capex after AI overspend concerns

Write the brief now.`;

console.log('=== BARGAIN RADAR ===');
console.log(await callOnce(bargainSys, bargainUser, 800));
console.log('\n=== SECTOR RADAR ===');
console.log(await callOnce(sectorSys, sectorUser, 800));
console.log('\n=== PORTFOLIO EXPLAINER ===');
console.log(await callOnce(explainerSys, explainerUser, 800));
console.log('\n=== PRE-MARKET BRIEF ===');
console.log(await callOnce(briefSys, briefUser, 280));
