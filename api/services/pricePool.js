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
// the pool so every user — including the very first one — gets the comparison.
const BENCHMARK_TICKERS = ['SPY', 'QQQ', 'DIA', 'IWM'];

/**
 * Query all unique tickers across positions and watchlists.
 * This is one lightweight DB query.
 */
async function collectTickers() {
  try {
    // Also pull tickers from active, not-yet-triggered price alerts so the
    // alert monitor always has fresh prices for any symbol a user cares
    // about — even if it's not in their portfolio or watchlist.
    const [posResult, watchResult, alertResult] = await Promise.allSettled([
      supabase.from('positions').select('ticker'),
      supabase.from('watchlist').select('ticker'),
      supabase.from('price_alerts').select('ticker').eq('active', true).eq('triggered', false),
    ]);
    const tickers = new Set();
    // Always seed with benchmarks so MARKET-RELATIVE / sector comparisons
    // never lose their reference even when no user holds the index ETF.
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
    return tickers;
  } catch (err) {
    console.error('[PricePool] Ticker collection error:', err.message);
    return allTickers;
  }
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
          prices.set(ticker, { ...data, updatedAt: now });
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
          prices.set(missing[i], { ...result.value, updatedAt: now });
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
 * Force a refresh — useful after a user adds a new position.
 * Debounced to prevent spam.
 */
let pendingRefresh = null;
export function requestRefresh() {
  if (pendingRefresh) return;
  pendingRefresh = setTimeout(() => {
    refreshPrices();
    pendingRefresh = null;
  }, 2000);
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
