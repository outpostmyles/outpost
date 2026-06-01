// A per-holding health read: is this position carrying the trader toward their
// goal, or quietly dragging them back. Distinct from the attention badge
// (computePositionStatus), which flags what needs eyes RIGHT NOW. Health is the
// reflective verdict: does this holding still earn its place.
//
// Thesis-aware on purpose. A position you can't explain is the easiest kind to
// hold too long, so "no thesis on record" is itself a health signal, which the
// price-only badge never captures. Pure so the verdict is unit-testable.

function num(v) { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; }
function clean(s) { return (s == null ? '' : String(s)).trim(); }

export function assessPositionHealth(pos) {
  pos = pos || {};
  const price = num(pos.price ?? pos.currentPrice);
  const cost = num(pos.avg_cost);
  const stop = num(pos.stop_loss);
  const target = num(pos.price_target);
  const hasThesis = !!clean(pos.entry_thesis);
  const pnlPct = pos.pnlPercent != null
    ? num(pos.pnlPercent)
    : (price != null && cost != null && cost > 0 ? ((price - cost) / cost) * 100 : null);

  // Reconsider: the holding is fighting the plan or deeply underwater.
  if (stop != null && stop > 0 && price != null && price < stop) {
    return { status: 'reconsider', reason: 'Below the stop you set. The plan said this is where you step back and decide.' };
  }
  if (pnlPct != null && pnlPct <= -20) {
    return { status: 'reconsider', reason: `Down ${Math.abs(Math.round(pnlPct))}% from your cost. Worth asking honestly whether the reason you bought it still holds.` };
  }

  // Watch: needs a deliberate look, not an alarm.
  if (target != null && target > 0 && price != null && price >= target) {
    return { status: 'watch', reason: 'At your target. Decide on purpose: take profits, trim, or let it run.' };
  }
  if (!hasThesis) {
    return { status: 'watch', reason: 'No thesis on record. Hard to know if a holding is still working when you never wrote down why you own it.' };
  }
  if (pnlPct != null && pnlPct <= -12) {
    return { status: 'watch', reason: `Down ${Math.abs(Math.round(pnlPct))}%, but you have a thesis. The question is whether it is still intact.` };
  }

  // On track: thesis on record, nothing fighting it.
  return { status: 'on_track', reason: 'Thesis on record and nothing is fighting it. Carrying its weight.' };
}
