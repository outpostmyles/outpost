/**
 * Shared Market Data Service
 *
 * Fetches VIX, Fear & Greed, RSI, and movers on background timers.
 * All user requests read from memory — zero Polygon calls for shared data.
 *
 * ACCURACY RULES:
 * 1. Every data point has its own fetchedAt timestamp
 * 2. getMarketData() includes age in seconds so frontend can show staleness
 * 3. If data is older than MAX_AGE, it's marked as stale (not silently served as fresh)
 * 4. Failed refreshes trigger immediate retry (once), not just a log
 */

import { getVIX, getFearGreed, getRSI, getMovers } from '../utils/polygon.js';
import { isMarketHours } from '../utils/marketHours.js';

// Max age before data is considered stale (in ms)
const MAX_AGE = {
  vix: 30 * 60 * 1000,        // 30 minutes
  fearGreed: 60 * 60 * 1000,   // 1 hour
  rsi: 15 * 60 * 1000,         // 15 minutes
  movers: 10 * 60 * 1000,      // 10 minutes
};

// In-memory store for shared market data
const data = {
  vix: null,
  vixFetchedAt: null,
  fearGreed: null,
  fearGreedFetchedAt: null,
  spyRsi: null,
  qqqRsi: null,
  rsiFetchedAt: null,
  moversGainers: [],
  moversLosers: [],
  moversFetchedAt: null,
  moversLive: true,
  regime: 'Neutral',
  marketOpen: false,
};

const intervals = [];

// Pure regime classifier, exported for tests. vixVal / fgVal may be null or
// undefined when that feed has not loaded yet (both missing -> 'Unknown').
export function classifyRegime(vixVal, fgVal) {
  if (vixVal == null && fgVal == null) return 'Unknown';
  if (vixVal >= 25 && fgVal <= 30) return 'Risk Off';
  if (vixVal <= 18 && fgVal >= 60) return 'Risk On';
  if (vixVal >= 22 || fgVal <= 35) return 'Risk Off';
  return 'Neutral';
}

function computeRegime() {
  return classifyRegime(data.vix?.value, data.fearGreed?.value);
}

function ageSeconds(fetchedAt) {
  if (!fetchedAt) return null;
  return Math.round((Date.now() - new Date(fetchedAt).getTime()) / 1000);
}

function isStale(fetchedAt, maxAgeMs) {
  if (!fetchedAt) return true;
  return Date.now() - new Date(fetchedAt).getTime() > maxAgeMs;
}

async function refreshWithRetry(fn, label) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[MarketData] ${label} failed, retrying once:`, err.message);
    try {
      return await fn();
    } catch (retryErr) {
      console.error(`[MarketData] ${label} retry also failed:`, retryErr.message);
      return null;
    }
  }
}

async function refreshVIX() {
  const result = await refreshWithRetry(getVIX, 'VIX');
  if (result) {
    data.vix = result;
    data.vixFetchedAt = new Date().toISOString();
    data.regime = computeRegime();
  }
}

async function refreshFearGreed() {
  const result = await refreshWithRetry(getFearGreed, 'F&G');
  if (result) {
    data.fearGreed = result;
    data.fearGreedFetchedAt = new Date().toISOString();
    data.regime = computeRegime();
  }
}

async function refreshRSI() {
  const [spy, qqq] = await Promise.allSettled([
    refreshWithRetry(() => getRSI('SPY'), 'SPY RSI'),
    refreshWithRetry(() => getRSI('QQQ'), 'QQQ RSI'),
  ]);
  if (spy.status === 'fulfilled' && spy.value) data.spyRsi = spy.value;
  if (qqq.status === 'fulfilled' && qqq.value) data.qqqRsi = qqq.value;
  data.rsiFetchedAt = new Date().toISOString();
}

// Sanity bounds for mover changePercent. Same threshold as the price-pool
// sanitizer. Polygon's gainers/losers endpoint occasionally returns thin
// tickers with absurd changes (stale prevClose, mid-split reporting, etc).
// A "+7,825%" on the Top Movers list is essentially always bad data, and
// surfacing it costs trust more than dropping a few rows costs information.
// Real news pumps that hit 500%+ in a session are exceedingly rare; if
// they're real, they'll still be in tomorrow's news.
const MOVER_CHANGE_PCT_MAX = 500;
const MOVER_CHANGE_PCT_MIN = -95;

function sanityFilterMovers(list) {
  if (!Array.isArray(list)) return list;
  const dropped = [];
  const kept = list.filter(m => {
    const cp = m?.changePercent;
    // A "mover" with no known move does not belong on a movers list. getMovers
    // already recovers the percent from Polygon's own field and drops the rest;
    // this is the belt-and-suspenders so a blank-percent row can never render.
    if (cp == null) { dropped.push(`${m.ticker}:no-%`); return false; }
    if (cp > MOVER_CHANGE_PCT_MAX || cp < MOVER_CHANGE_PCT_MIN) {
      dropped.push(`${m.ticker}:${cp.toFixed(0)}%`);
      return false;
    }
    return true;
  });
  if (dropped.length > 0) {
    console.warn(`[MarketData] Dropped ${dropped.length} suspicious mover entries: ${dropped.join(', ')}`);
  }
  return kept;
}

async function refreshMovers() {
  const [gainers, losers] = await Promise.allSettled([
    refreshWithRetry(() => getMovers('gainers'), 'Gainers'),
    refreshWithRetry(() => getMovers('losers'), 'Losers'),
  ]);
  const newGainers = gainers.status === 'fulfilled' ? sanityFilterMovers(gainers.value) : null;
  const newLosers = losers.status === 'fulfilled' ? sanityFilterMovers(losers.value) : null;

  // Only overwrite if we got real data. This keeps last session's movers
  // alive after hours.
  if (newGainers?.length) {
    data.moversGainers = newGainers;
    data.moversLive = true;
    data.moversFetchedAt = new Date().toISOString();
  } else if (data.moversGainers.length > 0 && !isMarketHours()) {
    data.moversLive = false;
  }
  if (newLosers?.length) {
    data.moversLosers = newLosers;
    if (!newGainers?.length) data.moversFetchedAt = new Date().toISOString();
  }
}

// Test seam for sanity-guard unit tests.
export function _sanityFilterMoversForTest(list) {
  return sanityFilterMovers(list);
}

/**
 * Initialize the service. Call once on server boot.
 */
export async function initMarketDataService() {
  console.log('[MarketData] Initializing shared market data service...');

  // Fetch everything once on startup
  await Promise.allSettled([refreshVIX(), refreshFearGreed(), refreshRSI(), refreshMovers()]);
  data.marketOpen = isMarketHours();
  console.log(`[MarketData] Initial load complete. Regime: ${data.regime}, VIX: ${data.vix?.value ?? 'N/A'}, F&G: ${data.fearGreed?.value ?? 'N/A'} (source: ${data.fearGreed?.source ?? 'none'})`);

  // VIX: every 15 minutes
  intervals.push(setInterval(refreshVIX, 15 * 60 * 1000));

  // Fear & Greed: every 15 minutes (was 30, but CNN data updates more often)
  intervals.push(setInterval(refreshFearGreed, 15 * 60 * 1000));

  // RSI: every 5 minutes during market hours, every 15 minutes otherwise
  let rsiTickCount = 0;
  intervals.push(setInterval(() => {
    rsiTickCount++;
    if (isMarketHours() || rsiTickCount % 3 === 0) {
      refreshRSI();
    }
  }, 5 * 60 * 1000));

  // Movers: every 5 minutes (saves ~500 Polygon calls/day vs 2min)
  intervals.push(setInterval(() => {
    data.marketOpen = isMarketHours();
    refreshMovers();
  }, 5 * 60 * 1000));

  // Update marketOpen flag every minute
  intervals.push(setInterval(() => {
    data.marketOpen = isMarketHours();
  }, 60 * 1000));
}

/**
 * Get all shared market data with freshness info.
 */
export function getMarketData() {
  return {
    vix: data.vix,
    vixAge: ageSeconds(data.vixFetchedAt),
    vixStale: isStale(data.vixFetchedAt, MAX_AGE.vix),
    fearGreed: data.fearGreed,
    fearGreedAge: ageSeconds(data.fearGreedFetchedAt),
    fearGreedStale: isStale(data.fearGreedFetchedAt, MAX_AGE.fearGreed),
    spyRsi: data.spyRsi,
    qqqRsi: data.qqqRsi,
    rsiAge: ageSeconds(data.rsiFetchedAt),
    regime: data.regime,
    marketOpen: data.marketOpen,
    lastUpdated: data.vixFetchedAt || data.fearGreedFetchedAt,
  };
}

/**
 * Get movers with freshness info.
 */
export function getMoversData() {
  return {
    gainers: data.moversGainers,
    losers: data.moversLosers,
    updatedAt: data.moversFetchedAt,
    ageSeconds: ageSeconds(data.moversFetchedAt),
    stale: isStale(data.moversFetchedAt, MAX_AGE.movers),
    live: data.moversLive ?? true,
  };
}

/**
 * Get full sentiment object (matches existing /market/sentiment response shape).
 */
export function getSentimentData() {
  return {
    vix: data.vix,
    fearGreed: data.fearGreed,
    rsi: { SPY: data.spyRsi, QQQ: data.qqqRsi },
    marketRegime: data.regime,
    updatedAt: data.vixFetchedAt || data.fearGreedFetchedAt,
    freshness: {
      vixAge: ageSeconds(data.vixFetchedAt),
      fearGreedAge: ageSeconds(data.fearGreedFetchedAt),
      fearGreedSource: data.fearGreed?.source ?? 'unknown',
      rsiAge: ageSeconds(data.rsiFetchedAt),
    },
  };
}
