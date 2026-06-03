// Pure reconciliation engine for syncing a connected brokerage into Outpost.
//
// The live provider (SnapTrade first, but the seam is provider-agnostic) hands us
// the user's current holdings and cash. This engine is the hard, provider-free
// part: it normalizes those holdings, diffs them against what we last synced, and
// returns exactly what the service layer should write: which positions to upsert,
// which to close (sold out), and which trades happened (so the rest of the app,
// thesis watch, decision memory, composure, can react). It is pure and
// deterministic so the whole sync can be unit-tested with fixtures before a
// single real API key exists.
//
// Design choices that matter:
//   - The broker is the source of truth for any ticker it reports. A ticker the
//     broker holds overwrites a manual row for the same ticker on sync.
//   - Live price moves are NOT trades. We diff on shares (and note avg-cost
//     changes), never on market value, so a ticking quote never looks like a buy.
//   - Multiple lots of the same ticker collapse into one share-weighted position.

const EPS = 1e-6; // float tolerance for share comparisons (fractional shares)

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
const round4 = (n) => Math.round(n * 10000) / 10000;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Normalize one raw holding (in whatever shape a provider returns) into the
 * canonical { ticker, shares, avgCost }. Accepts common field aliases. Returns
 * null for junk or a non-positive share count, so callers can filter.
 */
export function normalizeHolding(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ticker = String(raw.ticker ?? raw.symbol ?? '').toUpperCase().trim();
  const shares = num(raw.shares ?? raw.units ?? raw.quantity);
  if (!ticker || shares == null || shares <= 0) return null;
  const avgCost = num(raw.avgCost ?? raw.average_purchase_price ?? raw.avg_cost ?? raw.averageCost);
  return { ticker, shares: round4(shares), avgCost: avgCost != null && avgCost > 0 ? round2(avgCost) : null };
}

/**
 * Normalize a list of raw holdings, collapsing repeated tickers (separate lots)
 * into one share-weighted position. Order is by first appearance.
 */
export function normalizeHoldings(list) {
  const order = [];
  const byTicker = new Map();
  for (const raw of (Array.isArray(list) ? list : [])) {
    const h = normalizeHolding(raw);
    if (!h) continue;
    if (!byTicker.has(h.ticker)) {
      order.push(h.ticker);
      byTicker.set(h.ticker, h);
    } else {
      const prev = byTicker.get(h.ticker);
      const totalShares = round4(prev.shares + h.shares);
      let avgCost = prev.avgCost ?? h.avgCost;
      if (prev.avgCost != null && h.avgCost != null && totalShares > 0) {
        avgCost = round2((prev.avgCost * prev.shares + h.avgCost * h.shares) / totalShares);
      }
      byTicker.set(h.ticker, { ticker: h.ticker, shares: totalShares, avgCost });
    }
  }
  return order.map(t => byTicker.get(t));
}

function toMap(holdings) {
  const m = {};
  for (const h of (Array.isArray(holdings) ? holdings : [])) {
    if (h && h.ticker) m[h.ticker] = { shares: num(h.shares) ?? 0, avgCost: num(h.avgCost) };
  }
  return m;
}

/**
 * Diff the previously-synced holdings against the broker's current holdings.
 * Returns:
 *   - upserts: [{ ticker, shares, avgCost }]  the current broker holdings; write
 *              these into positions (broker is source of truth for its tickers).
 *   - closes:  [ticker]  tickers we synced before that the broker no longer holds
 *              (sold out); the service removes/closes those positions.
 *   - trades:  [{ ticker, action: 'buy'|'sell', sharesDelta, shares, avgCost }]
 *              detected activity since last sync, for decision memory etc. A buy
 *              is a new or grown position; a sell is a shrunk or closed one.
 * prevHoldings: the holdings array from the last saved sync state (or []).
 * brokerHoldings: the raw current holdings from the provider.
 */
export function reconcileHoldings(prevHoldings, brokerHoldings) {
  const prev = toMap(prevHoldings);
  const curr = normalizeHoldings(brokerHoldings);
  const currMap = toMap(curr);

  const upserts = curr.map(h => ({ ticker: h.ticker, shares: h.shares, avgCost: h.avgCost }));
  const trades = [];

  for (const h of curr) {
    const before = prev[h.ticker];
    if (!before) {
      trades.push({ ticker: h.ticker, action: 'buy', sharesDelta: h.shares, shares: h.shares, avgCost: h.avgCost });
    } else if (h.shares > before.shares + EPS) {
      trades.push({ ticker: h.ticker, action: 'buy', sharesDelta: round4(h.shares - before.shares), shares: h.shares, avgCost: h.avgCost });
    } else if (h.shares < before.shares - EPS) {
      trades.push({ ticker: h.ticker, action: 'sell', sharesDelta: round4(before.shares - h.shares), shares: h.shares, avgCost: h.avgCost });
    }
  }

  const closes = [];
  for (const ticker of Object.keys(prev)) {
    if (!currMap[ticker]) {
      closes.push(ticker);
      trades.push({ ticker, action: 'sell', sharesDelta: round4(prev[ticker].shares), shares: 0, avgCost: prev[ticker].avgCost });
    }
  }

  return { upserts, closes, trades };
}

/**
 * The serializable sync-state snapshot we persist (in agent_memory) after each
 * sync, so the next sync can diff against it. `at` is the caller's timestamp
 * (injected, not read here, so this stays pure and testable).
 */
export function buildSyncState(brokerHoldings, { accountId = null, at = null } = {}) {
  return {
    accountId: accountId ?? null,
    lastSyncedAt: at ?? null,
    holdings: normalizeHoldings(brokerHoldings),
  };
}

/**
 * Total investable cash across the provided account balances. Defensive: sums
 * only finite, non-negative cash figures. balances: [{ cash }] or [{ amount }].
 */
export function totalCashFromBalances(balances) {
  const list = Array.isArray(balances) ? balances : [];
  let total = 0;
  for (const b of list) {
    const c = num(b?.cash ?? b?.amount ?? b?.buying_power);
    if (c != null && c > 0) total += c;
  }
  return round2(total);
}
