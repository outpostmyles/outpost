// Sector gaps: the sectors a book is missing or thin in. Pairs with
// sectorExposure (where you ARE) to power discovery that fills holes instead of
// piling onto what you already lean into. Pure.
//
// Input: the user's sector weights [{ sector, pct }] (from sectorExposure).
// Output: { absent, light, gaps } where gaps is a short, ordered suggestion
// list (biggest, most mainstream sectors first).

// FMP's profile taxonomy, ordered roughly by market weight so suggestions lead
// with mainstream sectors (Healthcare, Financials) rather than niche ones.
const CANONICAL = [
  'Technology',
  'Healthcare',
  'Financial Services',
  'Consumer Cyclical',
  'Communication Services',
  'Industrials',
  'Consumer Defensive',
  'Energy',
  'Real Estate',
  'Basic Materials',
  'Utilities',
];

export function sectorGaps(sectors = [], opts) {
  const { lightPct = 5, max = 3 } = opts || {};
  const have = new Map((Array.isArray(sectors) ? sectors : []).filter(Boolean).map(s => [String(s.sector), Number(s.pct) || 0]));
  const classified = [...have.values()].reduce((a, b) => a + b, 0);
  // Nothing classified yet (no positions, or all 'Unknown'): no gaps to suggest.
  if (classified <= 0) return { absent: [], light: [], gaps: [] };

  const absent = [];
  const light = [];
  for (const sec of CANONICAL) {
    const pct = have.get(sec) ?? 0;
    if (pct <= 0) absent.push(sec);
    else if (pct < lightPct) light.push({ sector: sec, pct });
  }

  // Suggest the absent (mainstream first), then the thinnest held sectors.
  const gaps = [...absent, ...light.map(l => l.sector)].slice(0, max);
  return { absent, light, gaps };
}
