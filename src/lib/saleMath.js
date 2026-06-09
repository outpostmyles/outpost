// Pure realized-sale math for selling some or all of a position. The close
// endpoint uses this so the money math is testable and identical whether you sell
// the whole lot or trim a piece. A partial sale does NOT change the cost basis of
// the shares that remain; you realize gain/loss only on the shares you sold.

const r2 = (n) => Math.round(n * 100) / 100;          // money: cents
const r6 = (n) => Math.round(n * 1e6) / 1e6;          // shares: allow fractional
const fin = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const EPS = 1e-9;

/**
 * @param p { avgCost, shares (held), sellShares, sellPrice, purchasedAt, nowMs }
 * @returns { ok:false, error } | { ok:true, isFullClose, sharesSold, remaining, proceeds, pnl, pnlPercent, holdDays }
 */
export function computeSale(input) {
  // A default param (= {}) only catches undefined, not null. Coerce any non-object
  // arg to {} so a null/primitive degrades to a clean ok:false instead of throwing.
  const { avgCost, shares, sellShares, sellPrice, purchasedAt = null, nowMs = 0 } = (input && typeof input === 'object') ? input : {};
  const ac = fin(avgCost) ?? 0;
  const held = fin(shares) ?? 0;
  const px = fin(sellPrice) ?? 0;
  let sold = fin(sellShares);

  if (held <= 0) return { ok: false, error: 'no_shares' };
  if (sold == null || sold <= 0) return { ok: false, error: 'invalid_shares' };
  if (sold > held + EPS) return { ok: false, error: 'exceeds_held' };

  const isFullClose = sold >= held - EPS;
  if (isFullClose) sold = held; // selling (essentially) everything closes it out

  const costBasis = ac * sold;            // cost of ONLY the shares sold
  const proceeds = px * sold;
  const pnl = proceeds - costBasis;
  const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

  let holdDays = null;
  if (purchasedAt) {
    const t = new Date(purchasedAt).getTime();
    if (Number.isFinite(t)) holdDays = Math.max(0, Math.floor(nowMs / 86400000) - Math.floor(t / 86400000));
  }

  return {
    ok: true,
    isFullClose,
    sharesSold: r6(sold),
    remaining: isFullClose ? 0 : r6(held - sold),
    proceeds: r2(proceeds),
    pnl: r2(pnl),
    pnlPercent: r2(pnlPercent),
    holdDays,
  };
}
