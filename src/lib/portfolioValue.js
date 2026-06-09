// The hottest money path in the app: live portfolio value and P&L, computed on
// every Home and Portfolio load. It used to live inline in the /value route,
// where `currentPrice * shares` had no guard on shares and `live.price ?? avg_cost`
// let a NaN price through (?? only catches null), so a single malformed row could
// turn the entire portfolio value and P&L into NaN, a visible "snap" on the most
// important number a user sees. Extracted here, pure and hard: every input is
// sanitized to a finite number before the math, and every output is finite. One
// bad position can never poison the totals. Unit-tested and fuzzed.

const fin = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };          // any non-finite -> 0
const finPos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }; // a usable price, else null
const r2 = (n) => parseFloat((Number.isFinite(n) ? n : 0).toFixed(2));

/**
 * @param positions raw rows: { ticker, shares, avg_cost, ... }
 * @param priceMap  ticker -> { price, changePercent, updatedAt } or null
 * @param opts { marketOpen, earningsMap, now }
 * @returns { positions: enriched[], totals: { totalValue, totalCost, totalPnl,
 *   totalPnlPercent, totalTodayChange, todayChangePercent, staleCount } }
 *   Every numeric output is guaranteed finite.
 */
export function computePortfolioValue(positions, priceMap = {}, { marketOpen = false, earningsMap = {}, now = Date.now() } = {}) {
  const list = Array.isArray(positions) ? positions.filter(Boolean) : [];
  let totalValue = 0, totalCost = 0, totalTodayChange = 0, staleCount = 0;

  const enriched = list.map(p => {
    const shares = fin(p?.shares);                       // bad shares -> 0, never NaN
    const avgCost = Math.max(0, fin(p?.avg_cost));
    const live = priceMap?.[p?.ticker] || null;
    const livePrice = finPos(live?.price);               // a NaN price is NOT a usable price
    const hasLivePrice = livePrice != null;
    const currentPrice = livePrice ?? (avgCost > 0 ? avgCost : 0);
    if (!hasLivePrice) staleCount++;
    const priceAgeMs = Number.isFinite(live?.updatedAt) ? now - live.updatedAt : null;
    const priceAgeMin = priceAgeMs != null ? Math.round(priceAgeMs / 60000) : null;

    const currentValue = currentPrice * shares;
    const costBasis = avgCost * shares;
    const pnl = currentValue - costBasis;
    const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

    // Dollar change off the PREVIOUS value, not the current one. Guard the
    // denominator so changePercent === -100 cannot produce Infinity and a
    // non-finite changePercent cannot leak in.
    const todayChangePercent = Number.isFinite(live?.changePercent) ? live.changePercent : 0;
    const denom = 1 + (todayChangePercent / 100);
    const prevValue = (todayChangePercent !== 0 && denom > 0 && Number.isFinite(denom)) ? currentValue / denom : currentValue;
    const todayChange = currentValue - prevValue;

    totalValue += currentValue;
    totalCost += costBasis;
    totalTodayChange += todayChange;

    return {
      ...p,
      shares,
      currentPrice: r2(currentPrice),
      currentValue: r2(currentValue),
      pnl: r2(pnl),
      pnlPercent: r2(pnlPercent),
      todayChange: r2(todayChange),
      todayChangePercent: r2(todayChangePercent),
      marketOpen,
      priceStale: !hasLivePrice,
      priceAgeMin,
      earnings: earningsMap?.[p?.ticker] || null,
    };
  });

  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const prevTotalValue = totalValue - totalTodayChange;
  const todayChangePercent = prevTotalValue > 0 ? (totalTodayChange / prevTotalValue) * 100 : 0;

  return {
    positions: enriched,
    totals: {
      totalValue: r2(totalValue),
      totalCost: r2(totalCost),
      totalPnl: r2(totalPnl),
      totalPnlPercent: r2(totalPnlPercent),
      totalTodayChange: r2(totalTodayChange),
      todayChangePercent: r2(todayChangePercent),
      staleCount,
    },
  };
}
