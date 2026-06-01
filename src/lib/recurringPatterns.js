// Detects a behavior that recurs across months, not just once. A mistake you
// made in three separate months is a habit, and the habit is what a coach calls
// out, far more than a single slip.
//
// Operates on plan-adherence byTrade rows, each already classified with a
// category and a closedAt date, so there's no re-classification here. Pure.

const NEGATIVE = new Set(['broke_stop', 'early_exit']);

export function detectRecurring(byTrade = []) {
  const groups = {}; // category -> { count, months: Set<YYYY-MM> }
  for (const t of byTrade || []) {
    if (!t || !NEGATIVE.has(t.category)) continue;
    const month = t.closedAt ? String(t.closedAt).slice(0, 7) : null; // YYYY-MM
    if (!month || month.length < 7) continue;
    const g = groups[t.category] || (groups[t.category] = { count: 0, months: new Set() });
    g.count += 1;
    g.months.add(month);
  }

  // Recurring = the behavior shows up in 2+ distinct months AND 3+ times total.
  // One bad month is noise; the same mistake across months is a pattern.
  let best = null;
  for (const cat of Object.keys(groups)) {
    const g = groups[cat];
    if (g.months.size >= 2 && g.count >= 3 && (!best || g.count > best.count)) {
      best = { kind: cat, count: g.count, months: g.months.size };
    }
  }
  if (!best) return null;

  best.message = best.kind === 'broke_stop'
    ? `Breaking your stop is a habit, not a slip: ${best.count} times across ${best.months} different months. This is the one to break.`
    : `Cutting winners early keeps recurring: ${best.count} times across ${best.months} months. Letting them run is the work.`;
  return best;
}
