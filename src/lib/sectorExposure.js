// Sector exposure: where the book actually leans. The single-name concentration
// band catches "one ticker is too big"; this catches the quieter version, "you
// are 70% in one sector and don't realize it." It's also the root that lets
// Discovery reason about what KIND of name fills a gap.
//
// Pure. Input: holdings = [{ sector, value }]. Output: sorted sector weights,
// the heaviest sector, and whether the book is sector-concentrated.

export function sectorExposure(holdings = []) {
  const rows = (holdings || [])
    .filter(h => h && h.sector && Number(h.value) > 0)
    .map(h => ({ sector: String(h.sector), value: Number(h.value) }));
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total <= 0) return { sectors: [], top: null, concentrated: false };

  const bySector = {};
  for (const r of rows) bySector[r.sector] = (bySector[r.sector] || 0) + r.value;

  const sectors = Object.entries(bySector)
    .map(([sector, value]) => ({ sector, pct: Math.round((value / total) * 1000) / 10 }))
    .sort((a, b) => b.pct - a.pct);

  const top = sectors[0] || null;
  // One sector at half the book or more is a concentration worth naming.
  const concentrated = !!(top && top.pct >= 50);
  return { sectors, top, concentrated };
}
