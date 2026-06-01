// The alert firing decision, pure and dependency-free so it can be unit-tested
// without the price pool, Supabase, or Resend. This is the call that decides
// whether a user gets an email, so it's worth pinning precisely.
export function shouldFire(alert, priceData) {
  if (!priceData?.price) return false;
  const price = priceData.price;
  const changePct = priceData.changePercent;
  const threshold = parseFloat(alert.threshold);
  if (!Number.isFinite(threshold)) return false;

  if (alert.direction === 'above') return price >= threshold;
  if (alert.direction === 'below') return price <= threshold;
  if (alert.direction === 'percent_change') {
    // Positive threshold (e.g. +5) fires when the daily change >= threshold.
    // Negative threshold (e.g. -5) fires when the daily change <= threshold.
    if (changePct == null) return false;
    if (threshold >= 0) return changePct >= threshold;
    return changePct <= threshold;
  }
  return false;
}
