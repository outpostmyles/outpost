/**
 * First-AI-Moment service
 *
 * Used by /api/ai/welcome to generate a personalized 2-3 sentence greeting
 * for new users right after they finish onboarding. The point is to show the
 * "AI knows me" magic before they've added a single position. We:
 *
 *   - Use Haiku (fast, cheap) — cost per call is sub-cent
 *   - Don't deduct credits — this is a one-time onboarding gift
 *   - Always have a safe fallback so a Claude outage can't break onboarding
 *
 * The prompt-building logic is exported as pure helpers so tests can verify
 * the exact text without hitting Claude.
 */

const STYLE_LABELS = {
  day_trading: 'day trader',
  swing: 'swing trader',
  investor: 'long-term investor',
};

const RISK_LABELS = {
  conservative: 'conservative',
  moderate: 'moderate',
  aggressive: 'aggressive',
};

/**
 * Pure: build the user-facing prompt that goes to Claude.
 * Keeps the system prompt small + the user message specific.
 */
export function buildWelcomePrompt({ style, risk, assets, market }) {
  const styleLabel = STYLE_LABELS[style] || 'trader';
  const riskLabel = RISK_LABELS[risk] || 'moderate';
  const assetsList = Array.isArray(assets) && assets.length > 0
    ? assets.join(', ')
    : 'stocks';

  // Market context — pass numbers so Claude can reference them specifically
  const ctx = market || {};
  const vix = ctx.vix != null ? ctx.vix.toFixed(1) : '—';
  const fg = ctx.fearGreed != null ? ctx.fearGreed : '—';
  const regime = ctx.regime || 'Neutral';
  const spyRsi = ctx.spyRsi != null ? ctx.spyRsi.toFixed(1) : '—';

  return [
    `New ${styleLabel} just signed up. Risk: ${riskLabel}. Trading: ${assetsList}.`,
    `Market right now: regime ${regime}, VIX ${vix}, Fear & Greed ${fg}, SPY RSI ${spyRsi}.`,
    `Write a 2-3 sentence welcome that:`,
    `1) calls out one specific thing about today's market that's relevant to a ${riskLabel} ${styleLabel}`,
    `2) suggests one concrete next step they can take in Outpost (add a position, build a watchlist, ask the agent, etc.)`,
    `Keep it conversational and direct. No hype, no markdown.`,
  ].join('\n');
}

/**
 * Pure: short system prompt for the welcome moment.
 */
export function buildWelcomeSystemPrompt() {
  return [
    'You are Outpost, a personal trading coach inside the Outpost app.',
    'You are speaking to a brand-new user who just finished onboarding.',
    'Tone: warm but direct, like a knowledgeable friend. Never hyped.',
    'CRITICAL: Plain text only. No markdown, no asterisks, no bullets, no headers.',
    'CRITICAL: Maximum 3 sentences. Always under 60 words.',
  ].join(' ');
}

/**
 * Pure: deterministic fallback message for when Claude is unreachable.
 * Personalised by style so it still feels tailored even when the API is down.
 */
export function buildFallbackWelcome({ style }) {
  const tail = 'Drop a position you already own into Outpost and I will start tracking it with you.';
  switch (style) {
    case 'day_trading':
      return `Welcome aboard. Day trading is all about discipline — fast entries, faster exits, and a hard stop you actually honor. ${tail}`;
    case 'investor':
      return `Welcome aboard. Long-term investing rewards patience over reaction — the noise rarely matters, the thesis usually does. ${tail}`;
    case 'swing':
    default:
      return `Welcome aboard. Swing trading lives in the middle ground — wide enough stops to weather chop, tight enough plans to take profits when they show up. ${tail}`;
  }
}
