// Pure evaluation of trade-plan price levels against live prices.
//
// The explicit price_alerts pipeline only covers alerts a user creates by hand.
// This lets the monitor also honor the promise "when the price gets there,
// Outpost reminds you what you said" for the plan levels themselves: the target
// and stop a user wrote when they set up a position.
//
// Pure and dependency-free so the crossing logic and the dedupe key (which
// decides "fire once per level value") are unit-testable without a DB or email.

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// positions: [{ id, ticker, price_target, stop_loss, ... }]
// priceMap:  { TICKER: { price } }
// Returns the plan levels currently crossed: target reached (price >= target)
// or stop broken (price <= stop). A position can contribute both.
export function evaluatePlanAlerts(positions, priceMap) {
  const hits = [];
  for (const p of positions || []) {
    if (!p) continue;
    const price = num(priceMap?.[p.ticker]?.price);
    if (price == null) continue;

    const target = num(p.price_target);
    if (target != null && target > 0 && price >= target) {
      hits.push({ positionId: p.id, ticker: p.ticker, kind: 'target', threshold: target, price });
    }
    const stop = num(p.stop_loss);
    if (stop != null && stop > 0 && price <= stop) {
      hits.push({ positionId: p.id, ticker: p.ticker, kind: 'stop', threshold: stop, price });
    }
  }
  return hits;
}

// Stable dedupe key. Including the threshold value is deliberate: editing the
// plan level produces a new key, which re-arms the alert, and a level only ever
// fires once while its value is unchanged. Closing the position removes it from
// the monitored set, so it simply stops being checked.
export function planAlertKey(hit) {
  return `planalert_${hit.positionId}_${hit.kind}_${hit.threshold}`;
}
