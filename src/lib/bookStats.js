// THE single source of truth for a position's market value and its weight in the
// book. Before this, market value was computed five different ways (in /value as
// currentPrice*shares, in positionStatus off currentValue, in portfolioActions
// and readContinuity by recomputing price*shares, in stressTest with its own
// valueOf) and pctOfBook was derived in ~8 places with three different roundings.
// That is exactly how the same holding could read "24%" on a card and "25% of
// your book" in an action, or how the agent's "% of book" could disagree with
// the screen. Everything now flows through here:
//   - ONE market-value definition (marketValueOf),
//   - ONE denominator: the summed market value of HOLDINGS only (not cash, not
//     cost basis),
//   - ONE rounding for the displayed/attached weight (1 decimal).
// /value tags every position with pctOfBook using this, and every consumer reads
// that tag (falling back to the same helper when it is absent), so a ticker can
// no longer show two different weights anywhere in the app.

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * A position's market value, defined once. Prefer an already-computed
 * currentValue/marketValue so we never recompute it a second, divergent way.
 * Otherwise price * shares using the live price. We deliberately do NOT fall
 * back to avg_cost here: a missing live price is a data gap, and counting cost
 * basis as market value would silently inflate the book. The live /value path
 * passes currentValue (which already encodes whatever fallback it chose), so
 * this stays faithful to what the rest of the payload shows.
 */
export function marketValueOf(p) {
  if (!p) return 0;
  const cv = num(p.currentValue ?? p.marketValue);
  if (cv != null && cv > 0) return cv;
  const px = num(p.currentPrice ?? p.livePrice ?? p.price);
  const sh = num(p.shares);
  return (px != null && px > 0 && sh != null && sh > 0) ? px * sh : 0;
}

/**
 * A position's cost basis (what you paid): avg cost per share * shares. Returns
 * 0 when either piece is missing or non-positive.
 */
export function costBasisOf(p) {
  if (!p) return 0;
  const ac = num(p.avg_cost ?? p.avgCost);
  const sh = num(p.shares);
  return (ac != null && ac > 0 && sh != null && sh > 0) ? ac * sh : 0;
}

/**
 * Weight of one position in the book, as a percent, at full precision. The
 * denominator is the book's holdings value (sum of market values), passed in so
 * callers that already summed it do not resum. Returns null when there is no
 * book value to divide by, so callers can render "—" instead of NaN% or a
 * misleading 0%.
 */
export function pctOfBookOf(p, holdingsValue) {
  const hv = num(holdingsValue);
  if (hv == null || hv <= 0) return null;
  const mv = marketValueOf(p);
  if (mv <= 0) return 0;
  return (mv / hv) * 100;
}

const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * A stable, order-independent fingerprint of the book's SHAPE: the set of
 * tickers and, for each, the shares and average cost. Used to invalidate cached
 * AI reads (the portfolio synthesis) the moment the book actually changes: add,
 * close, or edit a position and the stamp changes, so a stale "you're 30% in
 * NVDA" can't survive after you've sold it. Live price moves do NOT change the
 * stamp (they are not a book change), which is what keeps it from thrashing the
 * cache every tick. Equal stamp means equal book.
 */
/**
 * Blend an added lot into an existing position at the weighted-average cost.
 * This is the "I bought more" math: give it the held shares/avg and the newly
 * bought shares/price, get back the combined { shares, avgCost }. If the prior
 * cost is unknown (0), the blend still computes from what is known. Pure and
 * defensive (junk coerces to 0).
 */
export function mergeLots(prevShares, prevAvgCost, addShares, addPrice) {
  const ps = num(prevShares) ?? 0;
  const pa = num(prevAvgCost) ?? 0;
  const as = num(addShares) ?? 0;
  const ap = num(addPrice) ?? 0;
  const shares = ps + as;
  if (shares <= 0) return { shares: 0, avgCost: 0 };
  const avgCost = (ps * pa + as * ap) / shares;
  return { shares: round4(shares), avgCost: round2(avgCost) };
}

export function bookStamp(positions) {
  const list = (Array.isArray(positions) ? positions : []).filter(Boolean);
  const parts = list.map(p => {
    const t = String(p.ticker ?? '').toUpperCase();
    const sh = Number(p.shares) || 0;
    const ac = Number(p.avg_cost ?? p.avgCost) || 0;
    return `${t}:${sh}:${ac}`;
  }).sort();
  return parts.join('|');
}

/**
 * THE book-stats selector. Give it the positions (enriched with currentValue if
 * you have it); get back the book aggregates and the same positions, in order,
 * each tagged with marketValue, costBasis, pctOfBook (rounded to 1 decimal: the
 * single display rounding), unrealizedPnl and unrealizedPnlPct.
 *
 * Returns { book: { holdingsValue, totalCost, unrealizedPnl, unrealizedPnlPct,
 * count }, positions: [...tagged] }.
 */
export function computeBookStats(positions) {
  const list = (Array.isArray(positions) ? positions : []).filter(Boolean);
  let holdingsValue = 0, totalCost = 0, count = 0;
  const mids = list.map(p => {
    const mv = marketValueOf(p);
    const cb = costBasisOf(p);
    holdingsValue += mv;
    totalCost += cb;
    if (mv > 0) count++;
    return { p, mv, cb };
  });

  const tagged = mids.map(({ p, mv, cb }) => {
    const pct = holdingsValue > 0 ? (mv / holdingsValue) * 100 : null;
    const pnl = mv - cb;
    return {
      ...p,
      marketValue: round2(mv),
      costBasis: round2(cb),
      pctOfBook: pct != null ? round1(pct) : null,
      unrealizedPnl: round2(pnl),
      unrealizedPnlPct: cb > 0 ? round2((pnl / cb) * 100) : null,
    };
  });

  const unrealizedPnl = holdingsValue - totalCost;
  return {
    book: {
      holdingsValue: round2(holdingsValue),
      totalCost: round2(totalCost),
      unrealizedPnl: round2(unrealizedPnl),
      unrealizedPnlPct: totalCost > 0 ? round2((unrealizedPnl / totalCost) * 100) : null,
      count,
    },
    positions: tagged,
  };
}
