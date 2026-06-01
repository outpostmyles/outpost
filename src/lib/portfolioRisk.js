// Portfolio-level risk: the view a per-holding read can't give you. Are you
// over-exposed to one name, top-heavy, or too thin to absorb a single bad call.
// Concentration is the risk retail traders feel last and pay for most, so this
// names it plainly. Pure so the math is testable. Each position needs a ticker
// and a value (currentValue, else derived from price/shares).

function num(v) { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; }

function valueOf(p) {
  const cv = num(p.currentValue);
  if (cv != null && cv > 0) return cv;
  const px = num(p.currentPrice ?? p.avg_cost);
  const sh = num(p.shares);
  return (px != null && sh != null && px > 0 && sh > 0) ? px * sh : 0;
}

export function assessPortfolioRisk(positions = []) {
  const rows = (positions || [])
    .filter(Boolean)
    .map(p => ({ ticker: String(p.ticker || '').toUpperCase(), value: valueOf(p) }))
    .filter(r => r.ticker && r.value > 0);
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (rows.length === 0 || total <= 0) {
    return { level: 'ok', total: 0, weights: [], flags: [] };
  }

  const weights = rows
    .map(r => ({ ticker: r.ticker, pct: Math.round((r.value / total) * 1000) / 10 }))
    .sort((a, b) => b.pct - a.pct);

  const flags = [];
  const top = weights[0];

  // Single-name concentration (only meaningful with 2+ names; one position is
  // covered by the "thin" flag below with a clearer message).
  if (weights.length >= 2) {
    // Concentration is relative to equal weight, so an evenly split book never
    // trips (4 names at 25% each is fine; one name at 35% in a 5-name book is not).
    const equalWeight = 100 / weights.length;
    if (top.pct >= 40) {
      flags.push({ kind: 'single_name', severity: 'high', message: `${top.ticker} is ${top.pct}% of your book. One name is carrying nearly half your outcome.` });
    } else if (top.pct >= 25 && top.pct >= equalWeight * 1.5) {
      flags.push({ kind: 'single_name', severity: 'caution', message: `${top.ticker} is ${top.pct}% of your book. A lot is riding on one name.` });
    }
  }

  // Top-heavy (needs 5+ names: with four, top-3 being ~75% is just arithmetic,
  // not real skew).
  if (weights.length >= 5) {
    const top3 = weights.slice(0, 3).reduce((s, w) => s + w.pct, 0);
    if (top3 >= 75) {
      flags.push({ kind: 'top_heavy', severity: 'caution', message: `Your top 3 holdings are ${Math.round(top3)}% of the book. The rest barely move the needle.` });
    }
  }

  // Thin diversification.
  if (weights.length <= 2) {
    flags.push({
      kind: 'thin',
      severity: 'caution',
      message: weights.length === 1
        ? 'Your whole book is one position. Every outcome rides on it.'
        : 'Two positions means each one swings your entire book.',
    });
  }

  const level = flags.some(f => f.severity === 'high') ? 'high' : flags.length > 0 ? 'caution' : 'ok';
  return { level, total: Math.round(total), weights, flags };
}
