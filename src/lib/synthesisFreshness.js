// Freshness gate for the portfolio "Outpost Read". The read has to EARN its place:
// a full synthesis fires only when something MATERIAL changed since the user last
// saw one, and on a quiet day we show a short standing-status line instead of
// repeating the same paragraph. Pure and testable; the IO layer stores the
// fingerprint next to the cached text and compares.
//
// The trick is bucketing. Ordinary daily noise (a 2% move, a 1% drift in weight)
// must NOT count as material, or the read churns and repeats. Only crossing a real
// threshold does: a position growing into too-big a share, a loss deepening past a
// band, a winner crossing a band, a stop broken, a target reached, a plan set, a
// position added or closed. Composition is handled by the caller's bookStamp.

// Which bucket v lands in, by ascending edges. band(12,[25,40]) = 0, band(30,...) = 1.
function band(v, edges) {
  let i = 0;
  for (const e of edges) { if (v >= e) i++; else break; }
  return i;
}

const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };

/**
 * A compact signature of the material state. Two summaries with the same
 * fingerprint warrant the same read, so the synthesis can stay quiet.
 */
export function materialFingerprint(summary) {
  if (!summary) return 'empty';
  const parts = [`n${summary.positionCount ?? 0}`];
  for (const c of summary.topConcentration ?? []) parts.push(`c:${c.ticker}:${band(num(c.pctOfBook), [25, 40])}`); // weight band
  for (const d of summary.drawdowns ?? []) parts.push(`d:${d.ticker}:${band(-num(d.pnlPct), [25, 40])}`);          // loss band (pnlPct is negative)
  for (const w of summary.winners ?? []) parts.push(`w:${w.ticker}:${band(num(w.pnlPct), [100, 200])}`);           // gain band
  for (const t of summary.nearTarget ?? []) parts.push(`t:${t.ticker}`);                                            // binary-material
  for (const s of summary.belowStop ?? []) parts.push(`s:${s.ticker}`);
  parts.push(`p${band(num(summary.planCoveragePct), [50, 80])}`);                                                   // plan coverage band
  return parts.sort().join('|');
}

const setOf = (arr, key) => new Set((arr ?? []).map(x => x[key]));

/**
 * Human-readable phrases for what became material since the previous read, so the
 * full synthesis can LEAD with the new thing and never read generically. Empty
 * when there is no prior summary (the first read) or nothing notable changed.
 */
export function summaryDelta(prevSummary, currSummary) {
  if (!prevSummary || !currSummary) return [];
  const out = [];
  const prevStop = setOf(prevSummary.belowStop, 'ticker'), currStop = setOf(currSummary.belowStop, 'ticker');
  for (const t of currStop) if (!prevStop.has(t)) out.push(`${t} just broke below its stop`);
  const prevTgt = setOf(prevSummary.nearTarget, 'ticker'), currTgt = setOf(currSummary.nearTarget, 'ticker');
  for (const t of currTgt) if (!prevTgt.has(t)) out.push(`${t} reached near its target`);
  // deeper losses (new, or dropped into a worse band)
  const prevDd = new Map((prevSummary.drawdowns ?? []).map(d => [d.ticker, band(-num(d.pnlPct), [25, 40])]));
  for (const d of currSummary.drawdowns ?? []) {
    const b = band(-num(d.pnlPct), [25, 40]);
    if (!prevDd.has(d.ticker)) out.push(`${d.ticker} fell into a real loss from your cost`);
    else if (b > prevDd.get(d.ticker)) out.push(`${d.ticker} dropped into a deeper loss`);
  }
  // new big winners
  const prevWin = setOf(prevSummary.winners, 'ticker'), currWin = setOf(currSummary.winners, 'ticker');
  for (const t of currWin) if (!prevWin.has(t)) out.push(`${t} crossed into a big gain`);
  // concentration grew a band
  const prevConc = new Map((prevSummary.topConcentration ?? []).map(c => [c.ticker, band(num(c.pctOfBook), [25, 40])]));
  for (const c of currSummary.topConcentration ?? []) {
    const b = band(num(c.pctOfBook), [25, 40]);
    if ((prevConc.get(c.ticker) ?? -1) < b) out.push(`${c.ticker} grew to a bigger share of your book`);
  }
  const dn = (currSummary.positionCount ?? 0) - (prevSummary.positionCount ?? 0);
  if (dn > 0) out.push(`you added ${dn === 1 ? 'a position' : `${dn} positions`}`);
  else if (dn < 0) out.push(`you closed ${(-dn) === 1 ? 'a position' : `${-dn} positions`}`);
  return out;
}

/**
 * The quiet-day line: short, honest, derived (no model call), surfacing the most
 * important STANDING condition so an ongoing risk is never silently dropped just
 * because it did not change today.
 */
export function quietLine(summary) {
  if (!summary) return null;
  const stop = (summary.belowStop ?? [])[0];
  if (stop) return `Quiet day. ${stop.ticker} is still under your stop at $${stop.stop}. Decide if that is your line or not.`;
  const deep = (summary.drawdowns ?? []).find(d => -num(d.pnlPct) >= 25);
  if (deep) return `Quiet day. ${deep.ticker} is still down ${Math.abs(num(deep.pnlPct))}% from your cost, nothing new today.`;
  const tgt = (summary.nearTarget ?? [])[0];
  if (tgt) return `Quiet day. ${tgt.ticker} is still near your target of $${tgt.target}.`;
  const unplanned = (summary.positionCount ?? 0) - (summary.plannedCount ?? 0);
  if (unplanned > 0) return `Quiet day. ${unplanned} of your ${summary.positionCount} position${summary.positionCount === 1 ? '' : 's'} still ${unplanned === 1 ? 'has' : 'have'} no exit plan, worth setting one.`;
  return `Quiet day. Nothing in your book is near a stop or target, and nothing has broken.`;
}
