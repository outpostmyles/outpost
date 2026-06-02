/**
 * Global Price Pool
 *
 * Aggregates all unique tickers from positions + watchlists,
 * fetches them in ONE batch Polygon call every 30 seconds during market hours.
 * Individual /portfolio/value and /social/watchlist calls read from memory.
 *
 * This eliminates ~30% of Polygon API traffic.
 */

import { supabase } from '../db.js';
import { getSnapshots, getSnapshot } from '../utils/polygon.js';
import { isMarketHours } from '../utils/marketHours.js';
import { trackPriceRefresh } from './monitor.js';

// ticker -> { price, changePercent, volume, prevClose, updatedAt }
const prices = new Map();
let lastFetchAt = null;
let allTickers = new Set();
let interval = null;

// Always-include benchmarks. Without these, features that compare a position's
// move to the broad market (e.g. /analysis MARKET-RELATIVE) silently lose
// their comparison data when no user happens to hold SPY/QQQ. Pin them to
// the pool so every user, including the very first one, gets the comparison.
const BENCHMARK_TICKERS = ['SPY', 'QQQ', 'DIA', 'IWM'];

// Ticker-set cache. The pool used to query positions + watchlist + alerts on
// every refresh tick (every 30s). At 1000 users with 30 positions each that's
// 60k rows scanned twice a minute just to know which tickers to fetch. Now
// the set is cached for TICKER_CACHE_TTL_MS and invalidated explicitly when
// any mutation site calls requestRefresh().
const TICKER_CACHE_TTL_MS = 5 * 60 * 1000;
let tickerCacheEntry = null;  // { tickers: Set<string>, expiresAt: number }

// Sanity bounds for changePercent at ingestion. Polygon's snapshot endpoint
// occasionally returns wildly wrong change percentages for thin-volume stocks
// (stale prevClose, bad split adjustment, weird premarket pricing). Anything
// outside these bounds is almost certainly a data error and gets nulled out
// so the UI shows "—" instead of "+7,825%". Real moves like a small-cap pump
// on news rarely exceed +500% in a single session, and a stock dropping more
// than 95% in one day is essentially delisting territory.
const CHANGE_PCT_MAX = 500;
const CHANGE_PCT_MIN = -95;

/**
 * Query all unique tickers across positions, watchlists, and alerts.
 * Cached in memory for TICKER_CACHE_TTL_MS. Mutation sites (position add,
 * watchlist add, alert create) call invalidateTickerSet via requestRefresh
 * so a new ticker shows up in the next refresh, not 5 minutes later.
 */
async function getTickerSet() {
  if (tickerCacheEntry && Date.now() < tickerCacheEntry.expiresAt) {
    return tickerCacheEntry.tickers;
  }
  try {
    const [posResult, watchResult, alertResult] = await Promise.allSettled([
      supabase.from('positions').select('ticker'),
      supabase.from('watchlist').select('ticker'),
      supabase.from('price_alerts').select('ticker').eq('active', true).eq('triggered', false),
    ]);
    const tickers = new Set();
    for (const t of BENCHMARK_TICKERS) tickers.add(t);
    if (posResult.status === 'fulfilled') {
      for (const p of posResult.value.data ?? []) tickers.add(p.ticker);
    }
    if (watchResult.status === 'fulfilled') {
      for (const w of watchResult.value.data ?? []) tickers.add(w.ticker);
    }
    if (alertResult.status === 'fulfilled') {
      for (const a of alertResult.value.data ?? []) tickers.add(a.ticker);
    }
    allTickers = tickers;
    tickerCacheEntry = { tickers, expiresAt: Date.now() + TICKER_CACHE_TTL_MS };
    return tickers;
  } catch (err) {
    console.error('[PricePool] Ticker collection error:', err.message);
    // If we have a stale cache entry, prefer that over an empty set so prices
    // keep refreshing for known tickers during a transient DB blip.
    if (tickerCacheEntry?.tickers?.size) return tickerCacheEntry.tickers;
    return allTickers;
  }
}

/**
 * Invalidate the ticker-set cache. Called by requestRefresh so a newly-added
 * position triggers a fresh DB query on the next refresh tick.
 */
function invalidateTickerSet() {
  tickerCacheEntry = null;
}

/**
 * Validates a price snapshot. Returns the snapshot with changePercent set to
 * null if it falls outside sanity bounds (likely a stale prevClose from
 * Polygon, not a real move). Logs the rejection so we can monitor frequency.
 * Pure-ish: only side effect is a console.warn for outliers.
 */
function sanitizeSnapshot(ticker, snapshot) {
  if (!snapshot || snapshot.price == null) return snapshot;
  const cp = snapshot.changePercent;
  // Null out anything out of bounds OR non-finite. A NaN/Infinity changePercent
  // (e.g. a divide-by-zero on a bad prevClose) is as much a data error as a
  // +7,825% reading, and would otherwise render as "NaN%" downstream.
  if (cp != null && (!Number.isFinite(cp) || cp > CHANGE_PCT_MAX || cp < CHANGE_PCT_MIN)) {
    console.warn(`[PricePool] Rejecting suspicious changePercent for ${ticker}: ${cp.toFixed(2)}% (price $${snapshot.price}, prevClose $${snapshot.prevClose}). Nulling out.`);
    return { ...snapshot, changePercent: null };
  }
  return snapshot;
}

// Exported alias so callers that haven't migrated to getTickerSet still work.
async function collectTickers() {
  return getTickerSet();
}

/**
 * Fetch prices for all tickers in one batch call.
 */
async function refreshPrices() {
  try {
    const tickers = await collectTickers();

    // Prune entries for tickers nobody holds, watches, or has alerts on anymore.
    // Without this, the `prices` Map grows unboundedly and serves stale data for
    // tickers that have since been closed/removed (e.g. "still showing AAPL at
    // last week's price for a user who just sold all their AAPL").
    for (const ticker of prices.keys()) {
      if (!tickers.has(ticker)) prices.delete(ticker);
    }

    if (tickers.size === 0) return;

    const tickerArray = [...tickers];

    // Polygon batch endpoint supports up to ~200 tickers per call
    const chunks = [];
    for (let i = 0; i < tickerArray.length; i += 200) {
      chunks.push(tickerArray.slice(i, i + 200));
    }

    let successCount = 0;
    for (const chunk of chunks) {
      const snapshots = await getSnapshots(chunk);
      const now = Date.now();
      for (const [ticker, data] of Object.entries(snapshots)) {
        if (data.price != null) {
          const clean = sanitizeSnapshot(ticker, data);
          prices.set(ticker, { ...clean, updatedAt: now });
          successCount++;
        }
      }
    }

    // For any tickers that didn't get a price from the batch call,
    // try individual snapshot as fallback (handles edge cases)
    const missing = tickerArray.filter(t => !prices.has(t) || !prices.get(t)?.price);
    if (missing.length > 0 && missing.length <= 10) {
      console.log(`[PricePool] Fetching ${missing.length} missing tickers individually: ${missing.join(', ')}`);
      const fetches = await Promise.allSettled(missing.map(t => getSnapshot(t)));
      const now = Date.now();
      fetches.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value?.price) {
          const clean = sanitizeSnapshot(missing[i], result.value);
          prices.set(missing[i], { ...clean, updatedAt: now });
          successCount++;
        }
      });
    }

    lastFetchAt = Date.now();
    const stillMissing = tickerArray.filter(t => !prices.has(t) || !prices.get(t)?.price);
    if (stillMissing.length > 0) {
      console.warn(`[PricePool] Still missing prices for: ${stillMissing.join(', ')}`);
    }
    if (tickers.size > 0) {
      console.log(`[PricePool] Refreshed ${successCount}/${tickers.size} tickers`);
    }
    trackPriceRefresh(true, stillMissing.length);
  } catch (err) {
    console.error('[PricePool] Refresh error:', err.message);
    trackPriceRefresh(false, 0);
  }
}

/**
 * Initialize the price pool. Call once on server boot.
 */
export async function initPricePool() {
  console.log('[PricePool] Initializing global price pool...');

  // Initial fetch
  await refreshPrices();

  // During market hours: refresh every 30 seconds
  // After hours: refresh every 5 minutes (prices are static but new positions may be added)
  interval = setInterval(async () => {
    const refreshInterval = isMarketHours() ? 30 * 1000 : 5 * 60 * 1000;
    const timeSinceLastFetch = Date.now() - (lastFetchAt ?? 0);
    if (timeSinceLastFetch >= refreshInterval) {
      try { await refreshPrices(); } catch (err) { console.error('[PricePool] Refresh failed:', err.message); }
    }
  }, 30 * 1000);

  console.log(`[PricePool] Ready with ${prices.size} tickers`);
}

/**
 * Get price for a single ticker from the pool.
 * Returns null if not in pool.
 */
export function getPrice(ticker) {
  return prices.get(ticker) ?? null;
}

/**
 * Get prices for multiple tickers from the pool.
 * Returns a map of ticker -> price data (same shape as getSnapshots).
 * Tickers without data get a null placeholder so callers can show "price unavailable"
 * instead of silently omitting the ticker (which breaks P&L calculations).
 */
export function getPrices(tickers) {
  const result = {};
  for (const ticker of tickers) {
    const p = prices.get(ticker);
    result[ticker] = p ?? null;
  }
  return result;
}

/**
 * Force a refresh. Useful after a user adds a new position or watchlist
 * entry, since otherwise the pool won't know to fetch the new ticker for
 * up to TICKER_CACHE_TTL_MS. Invalidates the ticker-set cache so the
 * upcoming refresh re-queries the DB for the new set.
 *
 * Debounced 2 seconds. Multiple rapid mutations (e.g. screenshot import
 * adding 5 positions at once) collapse into a single refresh.
 */
let pendingRefresh = null;
export function requestRefresh() {
  invalidateTickerSet();
  if (pendingRefresh) return;
  pendingRefresh = setTimeout(() => {
    refreshPrices();
    pendingRefresh = null;
  }, 2000);
}

// Test seam. Exports a way to force the cache to expire NOW so unit tests can
// verify the cached-vs-fresh paths without waiting 5 minutes of wall clock.
export function _expireTickerCacheForTest() {
  if (tickerCacheEntry) tickerCacheEntry.expiresAt = 0;
}

// Test seam. Lets unit tests exercise the sanitizer directly.
export function _sanitizeSnapshotForTest(ticker, snapshot) {
  return sanitizeSnapshot(ticker, snapshot);
}

/**
 * Check if market is currently open (convenience re-export).
 */
export function isPoolMarketOpen() {
  return isMarketHours();
}

export function poolStats() {
  return { tickers: prices.size, lastFetchAt, allTickers: [...allTickers] };
}
