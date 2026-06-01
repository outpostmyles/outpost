// Pure headline "edge" metrics over a user's closed trades.
//
// This is the track-record summary a trader actually wants at a glance: am I
// net up, do I win more than I lose, and the behavioral tell of whether I cut
// winners short and ride losers (average hold time, winners vs losers).
//
// The Patterns tab already breaks win rate down by behavior (thesis vs not,
// stop vs not). This sits ABOVE that as the top-line "here is your record".
//
// Input: an array of closed_trades rows with at least { pnl, pnl_percent,
// hold_days, ticker }. `pnl` is dollars, `pnl_percent` is the percent return.
// Pure and dependency-free so the math is unit-testable without a DB.

function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

export function computeScorecard(trades) {
  const all = (Array.isArray(trades) ? trades : []).filter(Boolean);
  const totalTrades = all.length;
  if (totalTrades === 0) return null;

  const pnlOf = (t) => num(t.pnl) ?? 0;
  const winners = all.filter(t => pnlOf(t) > 0);
  const losers = all.filter(t => pnlOf(t) < 0);
  const breakeven = totalTrades - winners.length - losers.length;

  const totalPnl = round2(all.reduce((s, t) => s + pnlOf(t), 0));
  const winRate = round1((winners.length / totalTrades) * 100);

  const grossProfit = winners.reduce((s, t) => s + pnlOf(t), 0);
  const grossLoss = Math.abs(losers.reduce((s, t) => s + pnlOf(t), 0));
  const avgWin = winners.length ? round2(grossProfit / winners.length) : null;
  const avgLoss = losers.length ? round2(-grossLoss / losers.length) : null; // negative
  // Profit factor: dollars won per dollar lost. Null when there are no losses
  // (the ratio would be infinite, and "no losses yet" is the honest framing).
  const profitFactor = grossLoss > 0 ? round2(grossProfit / grossLoss) : null;
  const expectancy = round2(totalPnl / totalTrades); // avg realized $ per trade

  const avgHold = (arr) => {
    const h = arr.map(t => num(t.hold_days)).filter(v => v != null && v >= 0);
    return h.length ? Math.round(h.reduce((s, v) => s + v, 0) / h.length) : null;
  };
  const avgHoldWinners = avgHold(winners);
  const avgHoldLosers = avgHold(losers);

  // Best / worst by dollar P&L.
  let best = null, worst = null;
  for (const t of all) {
    const p = pnlOf(t);
    if (best == null || p > pnlOf(best)) best = t;
    if (worst == null || p < pnlOf(worst)) worst = t;
  }
  const trim = (t) => t ? {
    ticker: t.ticker || null,
    pnl: round2(pnlOf(t)),
    pnlPercent: num(t.pnl_percent) != null ? round1(num(t.pnl_percent)) : null,
  } : null;

  return {
    totalTrades,
    wins: winners.length,
    losses: losers.length,
    breakeven,
    winRate,
    totalPnl,
    avgWin,
    avgLoss,
    profitFactor,
    expectancy,
    avgHoldWinners,
    avgHoldLosers,
    best: trim(best),
    worst: trim(worst),
  };
}
