// Composure: a score for what the investor CONTROLS, not what the market did.
//
// This is the thing a generic tracker cannot be. A tracker scores you on P&L,
// which in the short run is mostly luck, so a beginner down 5% in a red month
// feels like a failure and quits. Composure scores the controllable behaviors that
// actually compound into a good investor: did you go in with conviction, did you
// protect the downside, did you learn from your closes, did you follow your own
// plan, did you let winners run instead of riding losers. These can climb even in
// an ugly market, so the tool is visibly on the user's side, not the market's.
//
// Pure and deterministic, computed from the attribution/scorecard data and current
// positions we already have. Honest by construction: a dimension only counts when
// there is real data behind it, and the whole score hides until there is enough.

function rate(num, den) { return den > 0 ? Math.round((num / den) * 100) : null; }

const clean = (s) => !!(s && String(s).trim());

/**
 * Compute the composure score from { attribution, positions }.
 *  - attribution: api.portfolio.attribution() => { totalTrades, patterns, execution, scorecard }
 *  - positions: open positions (entry_thesis, stop_loss)
 * Returns { score, band, hasEnough, subs:[{key,label,value,note}] }. score/band null
 * until at least two dimensions have data, so we never show a flimsy number.
 */
export function computeComposure({ attribution, positions = [] } = {}) {
  const a = attribution || {};
  const patterns = a.patterns || {};
  const totalClosed = a.totalTrades || 0;
  const open = Array.isArray(positions) ? positions : [];
  const openTotal = open.length;

  const closedWith = (p) => patterns[p]?.with?.count || 0;
  const hasClosed = (p) => patterns[p]?.with?.count != null && totalClosed > 0;

  const openThesis = open.filter(p => clean(p?.entry_thesis)).length;
  const openStop = open.filter(p => p?.stop_loss > 0).length;

  const subs = [];

  // Conviction: you know WHY you own things (a written thesis), open + closed.
  {
    const num = (hasClosed('thesis') ? closedWith('thesis') : 0) + openThesis;
    const den = (hasClosed('thesis') ? totalClosed : 0) + openTotal;
    const v = rate(num, den);
    if (v != null && den >= 2) subs.push({ key: 'conviction', label: 'Conviction', value: v, note: 'You wrote down why you own it' });
  }
  // Protection: you decided your exit before you needed it (a stop), open + closed.
  {
    const num = (hasClosed('stopLoss') ? closedWith('stopLoss') : 0) + openStop;
    const den = (hasClosed('stopLoss') ? totalClosed : 0) + openTotal;
    const v = rate(num, den);
    if (v != null && den >= 2) subs.push({ key: 'protection', label: 'Protection', value: v, note: 'You set a stop before you needed it' });
  }
  // Reflection: you learn from how a trade closed.
  if (hasClosed('reflection')) {
    const v = rate(closedWith('reflection'), totalClosed);
    if (v != null) subs.push({ key: 'reflection', label: 'Reflection', value: v, note: 'You captured the lesson after closing' });
  }
  // Discipline: you followed your own plan, win or lose (your self-rating).
  if (a.execution?.avgRating != null && (a.execution?.rated || 0) >= 1) {
    subs.push({ key: 'discipline', label: 'Discipline', value: Math.round((a.execution.avgRating / 5) * 100), note: 'You stuck to your plan, win or lose' });
  }
  // Patience: you let winners run rather than riding losers down.
  const hw = a.scorecard?.avgHoldWinners, hl = a.scorecard?.avgHoldLosers;
  if (hw != null && hl != null && (hw + hl) > 0) {
    subs.push({ key: 'patience', label: 'Patience', value: Math.round((hw / (hw + hl)) * 100), note: 'You let winners run and cut losers' });
  }

  const hasEnough = subs.length >= 2;
  const score = hasEnough ? Math.round(subs.reduce((s, x) => s + x.value, 0) / subs.length) : null;
  return { score, band: band(score), hasEnough, subs };
}

// A qualitative band, kinder and more honest than a bare number. The point is to
// show movement and direction, not to grade harshly.
export function band(score) {
  if (score == null) return null;
  if (score >= 85) return 'Composed';
  if (score >= 65) return 'Steady hand';
  if (score >= 40) return 'Building discipline';
  return 'Finding your footing';
}
