// Frontier #6: the hidden bet. Retail owns "five stocks" that are secretly one
// bet (five AI names, five rate plays). Institutions think at the portfolio level.
// This is the first cut of that lens: group the book by sector or theme and catch
// when a large share moves together, so a user who feels diversified can see they
// are not. True price-correlation comes later; sector buckets catch most of it.
//
// Pure. The caller passes positions with a market `value` and a sectorOf lookup
// (so this stays free of the app's sector map).

const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const r0 = (n) => Math.round(n);

export function buildConcentrationRead(positions = [], { sectorOf = () => 'Unknown', threshold = 40 } = {}) {
  const rows = (Array.isArray(positions) ? positions : []).filter(p => p && (num(p.value) ?? 0) > 0);
  const total = rows.reduce((s, p) => s + num(p.value), 0);
  if (total <= 0 || rows.length < 2) return { hasRead: false };

  const bySector = new Map();
  for (const p of rows) {
    const sec = sectorOf(p.ticker) || 'Unknown';
    const e = bySector.get(sec) || { sector: sec, value: 0, tickers: [] };
    e.value += num(p.value); e.tickers.push(p.ticker); bySector.set(sec, e);
  }
  const sectors = [...bySector.values()]
    .map(e => ({ sector: e.sector, pct: r0((e.value / total) * 100), tickers: e.tickers }))
    .sort((a, b) => b.pct - a.pct);
  const top = sectors[0];
  // A hidden bet: one sector is a big slice AND it is more than one name (a single
  // big position is just concentration, which the cards already flag).
  const hiddenBet = !!(top && top.pct >= threshold && top.tickers.length >= 2 && top.sector !== 'Unknown');

  return {
    hasRead: true,
    nominalNames: rows.length,
    effectiveSectors: sectors.length,
    top,
    sectors,
    hiddenBet,
    note: hiddenBet
      ? `${top.tickers.length} of your ${rows.length} names are ${top.sector} (${top.tickers.join(', ')}), about ${top.pct}% of your book. That is closer to one bet than ${top.tickers.length} separate ones.`
      : '',
  };
}

/** Agent-context risk line, or '' when there is no hidden bet to call out. */
export function formatConcentrationRead(read) {
  if (!read?.hasRead || !read.hiddenBet) return '';
  return `HIDDEN CONCENTRATION (portfolio-level, plain it out for them): ${read.note} If that theme has a bad week, the whole book feels it.`;
}
