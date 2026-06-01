// Progress toward the user's North Star: the portfolio value that means
// financial freedom to them. Pure so the math is unit-testable. `current` is
// today's total portfolio value, `target` is the freedom number they set.
export function goalProgress(current, target) {
  const t = Number(target);
  if (!Number.isFinite(t) || t <= 0) return null;
  const c = Number(current);
  const cur = Number.isFinite(c) && c > 0 ? c : 0;
  const pct = Math.max(0, Math.min(100, Math.round((cur / t) * 1000) / 10));
  const remaining = Math.max(0, Math.round((t - cur) * 100) / 100);
  return { current: cur, target: t, pct, remaining, reached: cur >= t };
}
