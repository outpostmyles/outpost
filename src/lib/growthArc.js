// Your growth arc: not a log of what happened, but an honest then-vs-now read
// of how you've grown as an investor. Splits your closed trades by date into an
// early half and a recent half and surfaces where you've genuinely improved
// (win rate climbing, thesis discipline becoming a habit), or honestly flags a
// slip. The point is to make progress visible, since getting better is the
// whole game and it's hard to feel day to day.
//
// Pure. Needs a real history (10+ closed trades) before it says anything, since
// a growth claim on a handful of trades is just noise.

export function buildGrowthArc(closedTrades = [], { minTrades = 10 } = {}) {
  const trades = (closedTrades || [])
    .filter(t => t && t.closed_at)
    .map(t => ({
      ms: Date.parse(t.closed_at),
      pnl: Number(t.pnl),
      thesis: !!(t.entry_thesis && String(t.entry_thesis).trim()),
    }))
    .filter(t => Number.isFinite(t.ms))
    .sort((a, b) => a.ms - b.ms);

  if (trades.length < minTrades) return { hasEnough: false, lines: [] };

  const mid = Math.floor(trades.length / 2);
  const early = trades.slice(0, mid);
  const recent = trades.slice(mid);

  const rate = (arr, pred) => Math.round((arr.filter(pred).length / arr.length) * 100);
  const lines = [];

  // Win rate. Outcomes are noisier, so the improvement bar is modest but the
  // regression bar is higher (don't cry wolf on a rough recent stretch).
  const ewr = rate(early, t => t.pnl > 0);
  const rwr = rate(recent, t => t.pnl > 0);
  if (rwr - ewr >= 8) {
    lines.push({ metric: 'win_rate', then: ewr, now: rwr, improved: true, text: `Your win rate climbed from ${ewr}% to ${rwr}% as you went. You're picking better.` });
  } else if (ewr - rwr >= 15) {
    lines.push({ metric: 'win_rate', then: ewr, now: rwr, improved: false, text: `Your win rate slipped from ${ewr}% to ${rwr}% lately. Worth asking what changed.` });
  }

  // Thesis discipline. A behavior, so it's stable even at smaller samples.
  const etr = rate(early, t => t.thesis);
  const rtr = rate(recent, t => t.thesis);
  if (rtr - etr >= 15) {
    lines.push({ metric: 'thesis', then: etr, now: rtr, improved: true, text: `You write a thesis on ${rtr}% of trades now, up from ${etr}%. The discipline is becoming a habit.` });
  }

  return { hasEnough: true, lines };
}
