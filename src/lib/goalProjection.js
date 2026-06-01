// Forward-looking trajectory toward the North Star.
//
// Given the user's daily portfolio snapshots, estimate the pace their total
// value has grown and project roughly how far they are from their freedom
// number. This is deliberately honest, not a promise: it is "if your recent
// pace held," and markets do not move in straight lines. We use total-value
// pace (savings plus gains both count toward a target portfolio value), and we
// require a few weeks of history before saying anything.
//
// Pure so the math is unit-testable.

export function projectGoal({ snapshots = [], current, target, nowMs = Date.now() } = {}) {
  const t = Number(target);
  if (!Number.isFinite(t) || t <= 0) return { enoughData: false };

  const cur = Number(current);
  if (Number.isFinite(cur) && cur >= t) return { enoughData: true, reached: true };

  const pts = (snapshots || [])
    .map(s => ({ ms: Date.parse(s.date || s.created_at), value: Number(s.total_value ?? s.value) }))
    .filter(p => Number.isFinite(p.ms) && Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => a.ms - b.ms);
  if (pts.length < 2) return { enoughData: false };

  const first = pts[0];
  const lastPt = pts[pts.length - 1];
  const spanDays = (lastPt.ms - first.ms) / 86400000;
  if (!Number.isFinite(spanDays) || spanDays < 21) return { enoughData: false }; // need ~3 weeks before projecting

  const perDay = (lastPt.value - first.value) / spanDays;
  const perMonth = Math.round(perDay * 30);
  if (!(perDay > 0)) return { enoughData: true, onTrack: false, perMonth };

  const base = Number.isFinite(cur) && cur > 0 ? cur : lastPt.value;
  const daysToTarget = (t - base) / perDay;
  if (!(daysToTarget > 0)) return { enoughData: true, reached: true };

  return {
    enoughData: true,
    onTrack: true,
    perMonth,
    yearsAway: Math.round((daysToTarget / 365) * 10) / 10,
  };
}
