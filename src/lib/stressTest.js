// Plain-English portfolio stress tests: what a drop would actually cost you, in
// dollars, so risk stops being abstract.
//
// Two kinds. A broad market move assumes your holdings move roughly with the
// market, stated honestly because we do not model per-stock beta yet (that is a
// root to deepen later). A shock to your single biggest holding is exact, since
// it is just that position's value times the move. Pure so the math is testable.

function num(v) { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; }

function valueOf(p) {
  const cv = num(p.currentValue);
  if (cv != null && cv > 0) return cv;
  const px = num(p.currentPrice ?? p.avg_cost);
  const sh = num(p.shares);
  return (px != null && sh != null && px > 0 && sh > 0) ? px * sh : 0;
}

export function buildStressTests(positions = []) {
  const rows = (positions || [])
    .filter(Boolean)
    .map(p => ({ ticker: String(p.ticker || '').toUpperCase(), value: valueOf(p) }))
    .filter(r => r.ticker && r.value > 0);
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total <= 0) return [];

  const top = rows.slice().sort((a, b) => b.value - a.value)[0];
  const round = (n) => Math.round(n);
  const pct1 = (n) => Math.round(n * 10) / 10;

  return [
    {
      key: 'market_10',
      label: 'Market falls 10%',
      impact: -round(total * 0.10),
      pct: -10,
      note: 'If your holdings move roughly with the market.',
    },
    {
      key: 'top_25',
      label: `${top.ticker} falls 25%`,
      impact: -round(top.value * 0.25),
      pct: -pct1((top.value * 0.25) / total * 100),
      note: `${top.ticker} is ${pct1(top.value / total * 100)}% of your book.`,
    },
    {
      key: 'market_25',
      label: 'A hard 25% market drop',
      impact: -round(total * 0.25),
      pct: -25,
      note: 'A 2022-style decline, holdings moving with the market.',
    },
  ];
}
