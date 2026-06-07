// Pure math for the "why did my portfolio move today" read. Kept dependency-free
// so it is unit-testable without a DB, the price pool, or Claude.
//
// The core honesty rule: a position we cannot price with a real, fresh change
// percent is counted as "unpriced" and never narrated as a mover. The old code
// fell back to cost basis and a flat 0%, which quietly turned a data gap into a
// fake "unchanged" and let the read describe moves it could not actually see.

export const round2 = (n) => parseFloat((Number(n) || 0).toFixed(2));

/**
 * @param positions array of { ticker, shares, avg_cost }
 * @param priceMap   ticker -> { price, changePercent, updatedAt } (pool shape) or null
 * @returns null when there are no positions, otherwise:
 *   { totalChange, totalChangePct, totalValue, positionCount, pricedCount,
 *     unpricedCount, pricesAsOf, winners[], losers[] }
 *   pricesAsOf is the OLDEST quote timestamp among the priced positions, so the
 *   caller can show worst-case recency.
 */
export function summarizeMovers(positions, priceMap, { now = Date.now() } = {}) {
  const list = Array.isArray(positions) ? positions : [];
  if (list.length === 0) return null;

  let totalChange = 0, totalValue = 0, pricedCount = 0, unpricedCount = 0;
  let pricesAsOf = null;
  const enriched = [];

  for (const p of list) {
    const live = priceMap?.[p?.ticker] || null;
    const price = (live && Number.isFinite(live.price) && live.price > 0) ? live.price : null;
    const changePct = (live && Number.isFinite(live.changePercent)) ? live.changePercent : null;
    // No live price, or no real change percent (the pool nulls bad ones), means
    // we cannot honestly say how it moved today. Skip it from narration + totals.
    if (price == null || changePct == null) { unpricedCount++; continue; }
    pricedCount++;
    if (Number.isFinite(live.updatedAt)) {
      pricesAsOf = pricesAsOf == null ? live.updatedAt : Math.min(pricesAsOf, live.updatedAt);
    }
    const currentValue = price * (p.shares ?? 0);
    const prevValue = changePct !== 0 ? currentValue / (1 + changePct / 100) : currentValue;
    const dollarImpact = currentValue - prevValue;
    totalChange += dollarImpact;
    totalValue += currentValue;
    enriched.push({
      ticker: p.ticker,
      shares: p.shares,
      currentPrice: round2(price),
      changePct: round2(changePct),
      dollarImpact: round2(dollarImpact),
      currentValue: round2(currentValue),
    });
  }

  const base = {
    totalChange: round2(totalChange),
    totalValue: round2(totalValue),
    positionCount: list.length,
    pricedCount,
    unpricedCount,
    pricesAsOf,
  };
  if (pricedCount === 0) return { ...base, totalChangePct: 0, winners: [], losers: [] };

  const prevTotalValue = totalValue - totalChange;
  const totalChangePct = prevTotalValue > 0 ? (totalChange / prevTotalValue) * 100 : 0;
  // Rank by absolute dollar impact so we surface "what moved the needle", not
  // biggest-% (which favors tiny positions).
  const sortedByImpact = [...enriched].sort((a, b) => Math.abs(b.dollarImpact) - Math.abs(a.dollarImpact));
  return {
    ...base,
    totalChangePct: round2(totalChangePct),
    winners: sortedByImpact.filter(p => p.dollarImpact > 0.01).slice(0, 3),
    losers: sortedByImpact.filter(p => p.dollarImpact < -0.01).slice(0, 3),
  };
}
