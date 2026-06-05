// Frontier #5: name the emotion in the moment. Institutions strip emotion; we can
// at least detect and name it. From the context captured at a decision (the
// ticker's move on the day, the market regime, fear/greed, and whether a loss was
// just realized), classify a buy or sell as FOMO, a revenge trade, a panic sell,
// or calm. Pure and testable. Used to warn at the decision point and to tag each
// decision so the Machine can see how much of someone's trading is emotional.

const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * @param decision { type, ticker, todayChangePct, pctOfBook }
 * @param ctx      { regime, fearGreed, hadRecentLoss }
 * @returns { kind: 'fomo'|'revenge'|'panic'|'calm', label, why }
 */
export function classifyEmotion(decision = {}, ctx = {}) {
  const type = decision.type;
  const today = num(decision.todayChangePct);
  const regime = String(ctx.regime || '').toLowerCase();
  const fg = num(ctx.fearGreed);
  const isBuy = type === 'open' || type === 'add';
  const isSell = type === 'close' || type === 'trim';
  const tk = decision.ticker || 'a name';

  // FOMO: buying a name already running hard, in a hot or greedy tape.
  if (isBuy && today != null && today >= 8 && (regime.includes('on') || (fg != null && fg >= 70))) {
    return { kind: 'fomo', label: 'FOMO buy', why: `buying ${tk} already up ${r1(today)}% on a hot tape` };
  }
  // Revenge: buying right after a loss was realized (caller supplies the flag).
  if (isBuy && ctx.hadRecentLoss) {
    return { kind: 'revenge', label: 'revenge trade', why: 'jumping back in right after a realized loss' };
  }
  // Panic: selling into fear, a risk-off tape, or a hard down day.
  if (isSell && (regime.includes('off') || (fg != null && fg <= 25) || (today != null && today <= -5))) {
    return { kind: 'panic', label: 'panic sell', why: `selling ${tk} into fear or a hard down day` };
  }
  return { kind: 'calm', label: 'calm', why: '' };
}

// A short note to surface at the decision point, or '' when the read is calm.
export function emotionWarning(read) {
  if (!read || read.kind === 'calm') return '';
  const lead = read.kind === 'fomo' ? 'This has the shape of a FOMO buy'
    : read.kind === 'revenge' ? 'This looks like a revenge trade'
    : 'This looks like a panic sell';
  return `${lead}: ${read.why}. Not a no, just worth a breath before you commit.`;
}
