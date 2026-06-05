// Frontier #3: the counterfactual ledger. What a sell actually cost or saved you
// versus simply holding. Only Outpost can compute this, because it recorded the
// decision (ticker, sell price, shares) and can compare it to the price now.
//
// oppCost = (currentPrice - sellPrice) * shares.
//   positive  -> it ran after you sold, you left money on the table (cutting a winner)
//   negative  -> it fell after you sold, you dodged a loss (a good exit)
// Pure and testable. The point is to make selling discipline a number, not a vibe.

const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const r0 = (n) => Math.round(n);
const r2 = (n) => Math.round(n * 100) / 100;

export function oppCost({ sellPrice, shares, currentPrice }) {
  const sp = num(sellPrice), sh = num(shares), cp = num(currentPrice);
  if (sp == null || sh == null || cp == null || sp <= 0) return null;
  return (cp - sp) * sh;
}

/**
 * @param sells     resolved sell decisions: [{ ticker, price (sold at), shares, type }]
 * @param priceMap  current prices: { TICKER: { price } }
 * @param opts      { minMovePct } ignore sells that have barely moved since (noise)
 */
export function summarizeCounterfactuals(sells, priceMap, { minMovePct = 3 } = {}) {
  const list = Array.isArray(sells) ? sells : [];
  let missed = 0, saved = 0, counted = 0;
  let worstMiss = null, bestDodge = null;
  for (const s of list) {
    const cur = num(priceMap?.[s?.ticker]?.price);
    const sp = num(s?.price), sh = num(s?.shares);
    if (cur == null || sp == null || sh == null || sp <= 0 || sh <= 0) continue;
    const movePct = ((cur - sp) / sp) * 100;
    if (Math.abs(movePct) < minMovePct) continue; // it has not really moved since, skip
    const cost = (cur - sp) * sh;
    counted++;
    const rec = { ticker: s.ticker, cost: r0(cost), movePct: r2(movePct), soldAt: r2(sp), nowAt: r2(cur) };
    if (cost > 0) { missed += cost; if (!worstMiss || cost > worstMiss.cost) worstMiss = rec; }
    else if (cost < 0) { saved += -cost; if (!bestDodge || cost < bestDodge.cost) bestDodge = rec; }
  }
  return { counted, missed: r0(missed), saved: r0(saved), net: r0(saved - missed), worstMiss, bestDodge };
}

/** Agent-context block, or '' when there is not enough to say anything honest. */
export function formatCounterfactual(cf) {
  if (!cf || cf.counted < 2) return '';
  const lines = ['WHAT THEIR SELLING HAS COST OR SAVED (counterfactual vs holding, recent sells, real dollars):'];
  if (cf.missed > 0) lines.push(`- Selling early has left about $${cf.missed} on the table.`);
  if (cf.saved > 0) lines.push(`- Exiting has dodged about $${cf.saved} of further loss.`);
  if (cf.worstMiss) lines.push(`- Biggest miss: ${cf.worstMiss.ticker}, sold near $${cf.worstMiss.soldAt}, now around $${cf.worstMiss.nowAt}.`);
  if (cf.bestDodge) lines.push(`- Best exit: ${cf.bestDodge.ticker}, sold near $${cf.bestDodge.soldAt}, now around $${cf.bestDodge.nowAt}.`);
  lines.push('Make their selling discipline concrete with these. If they keep cutting winners, name it gently. Never shame.');
  return lines.join('\n');
}
