// Helpers that let the daily PULSE read the room.
//
// PULSE is the first thing a user sees on open. Being tone-deaf on a brutal day
// (a chirpy "coffee, not panic" while their book is bleeding) is exactly how a
// product that calls itself a calm friend loses trust. We classify the day's
// emotional register from real signals and use it to (a) steer the AI's
// one-liner and (b) pick a register-appropriate fallback when the AI is
// unavailable. Pure and dependency-free so the thresholds are unit-testable.

const STORM_FALLBACKS = [
  'Rough tape. Nothing on your book needs a decision this second. Breathe first.',
  'Red day. The plan you wrote on a calm morning counts more than the screen right now.',
  'Ugly session. You do not have to do anything today. Tell me if you want to talk one through.',
];

const CALM_FALLBACKS = [
  'Quiet morning. Coffee, not panic.',
  'Markets are markets. Nothing on your book demands attention right now.',
  'No fires. Good day to read someone else\'s thesis.',
  'Nothing screaming for action. Use the silence.',
  'Steady. The opportunities you\'ll regret missing aren\'t on the screen today.',
];

function num(v) {
  const x = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(x) ? x : null;
}

// Classify the day's emotional register from real portfolio + market signals.
// Conservative on purpose: it takes a genuine stressor (a broken stop, a hard
// daily drop, a deeply underwater book, spiking volatility, or extreme fear) to
// flip into "storm". Everything else stays "calm" so we don't cry wolf.
export function assessRegister(input) {
  const { pnlPercent, dayMovePercent, vix, fearGreed, brokenStop } = input || {};
  const reasons = [];
  if (brokenStop) reasons.push('a position broke its stop');
  const day = num(dayMovePercent);
  if (day != null && day <= -6) reasons.push('a holding is down hard today');
  const pnl = num(pnlPercent);
  if (pnl != null && pnl <= -15) reasons.push('the book is deep underwater');
  const v = num(vix);
  if (v != null && v >= 28) reasons.push('volatility is elevated');
  const fg = num(fearGreed);
  if (fg != null && fg <= 20) reasons.push('the market is in extreme fear');
  return { register: reasons.length > 0 ? 'storm' : 'calm', reasons };
}

// One line appended to the pulse system prompt to set the tone. Empty on a
// calm day so the prompt is unchanged from today's behavior.
export function moodDirective(register) {
  if (register === 'storm') {
    return 'TONE: the trader is likely having a hard day (a stop broke, a holding dropped hard, the book is underwater, or the tape is scary). Be the calm voice. Name it plainly, remind them their pre-written plan beats the screen, and do NOT cheerlead or push them to act.';
  }
  return '';
}

// Deterministic fallback line, register-aware, stable per user per day.
export function pickPulseFallback(register, seed = 0) {
  const pool = register === 'storm' ? STORM_FALLBACKS : CALM_FALLBACKS;
  const i = Math.abs(Math.trunc(num(seed) ?? 0)) % pool.length;
  return pool[i];
}
