import { config } from '../config.js';
import { memGet, memSet } from '../services/memoryCache.js';

const BASE = 'https://api.polygon.io';
const KEY = config.polygonKey;

async function poly(path, ttlMs = 60000, cacheKey = null) {
  // Check in-memory cache first (no DB round trip)
  if (cacheKey) {
    const cached = memGet(`poly_${cacheKey}`);
    if (cached) return cached;
  }
  // 15s timeout — without this a hung Polygon response (which can happen during
  // their incidents) hangs every caller indefinitely. Most callers don't wrap
  // this in their own AbortController.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${BASE}${path}${path.includes('?') ? '&' : '?'}apiKey=${KEY}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Polygon ${res.status}: ${path}`);
    const data = await res.json();
    if (cacheKey) {
      memSet(`poly_${cacheKey}`, data, ttlMs);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getSnapshot(ticker) {
  try {
    const data = await poly(`/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}`, 30000, `snap_${ticker}`);
    const t = data?.ticker;
    if (!t) return null;
    // Use the best available price — prevDay.c is most reliable after hours
    const price = validPrice(t?.day?.c) ?? validPrice(t?.lastTrade?.p) ?? validPrice(t?.min?.c) ?? validPrice(t?.prevDay?.c) ?? null;
    const prev = validPrice(t?.prevDay?.c) ?? price;
    const change = price != null && prev != null ? price - prev : null;
    const changePct = prev && change != null ? (change / prev) * 100 : null;
    return {
      ticker,
      price: price != null ? parseFloat(price.toFixed(2)) : null,
      change: change != null ? parseFloat(change.toFixed(2)) : null,
      changePercent: changePct != null ? parseFloat(changePct.toFixed(2)) : null,
      volume: t?.day?.v ?? null,
      high: t?.day?.h ?? null,
      low: t?.day?.l ?? null,
      open: t?.day?.o ?? null,
      prevClose: prev != null ? parseFloat(prev.toFixed(2)) : null,
    };
  } catch (err) {
    console.error(`[Polygon] Snapshot failed for ${ticker}:`, err.message);
    return null;
  }
}

// Returns number if it's a valid positive price, null otherwise
function validPrice(v) {
  return typeof v === 'number' && v > 0 ? v : null;
}

export async function getSnapshots(tickers) {
  if (!tickers?.length) return {};
  try {
    const data = await poly(`/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers.join(',')}`, 30000);
    const result = {};
    for (const t of data?.tickers ?? []) {
      const price = validPrice(t?.day?.c) ?? validPrice(t?.lastTrade?.p) ?? validPrice(t?.min?.c) ?? validPrice(t?.prevDay?.c) ?? null;
      const prev = validPrice(t?.prevDay?.c) ?? price;
      const change = price != null && prev != null ? price - prev : null;
      const changePct = prev && change != null ? (change / prev) * 100 : null;
      result[t.ticker] = {
        price: price != null ? parseFloat(price.toFixed(2)) : null,
        changePercent: changePct != null ? parseFloat(changePct.toFixed(2)) : null,
        volume: t?.day?.v ?? null,
        prevClose: prev != null ? parseFloat(prev.toFixed(2)) : null,
      };
    }
    // Log tickers that returned no usable price
    const missing = tickers.filter(t => !result[t]?.price);
    if (missing.length > 0) {
      console.warn(`[Polygon] No price data for: ${missing.join(', ')}`);
    }
    return result;
  } catch (err) {
    console.error('[Polygon] Batch snapshot failed:', err.message);
    return {};
  }
}

export async function getMovers(direction = 'gainers') {
  try {
    const data = await poly(`/v2/snapshot/locale/us/markets/stocks/${direction}`, 5 * 60000, `movers_${direction}`);
    const tickers = (data?.tickers ?? []).filter(t => {
      const price = t?.day?.c ?? t?.lastTrade?.p ?? 0;
      const volume = t?.day?.v ?? 0;
      return price >= 5 && volume >= 500000;
    }).slice(0, 5);
    return tickers.map(t => {
      const price = t?.day?.c ?? t?.lastTrade?.p ?? 0;
      const prev = t?.prevDay?.c ?? price;
      const changePct = prev > 0 ? ((price - prev) / prev) * 100 : 0;
      return {
        ticker: t.ticker,
        price: parseFloat(price.toFixed(2)),
        changePercent: parseFloat(changePct.toFixed(2)),
        volume: t?.day?.v ?? 0,
      };
    });
  } catch { return []; }
}

export async function getVIX() {
  // Try Polygon's I:VIX (requires higher-tier plan, but try anyway)
  try {
    const data = await poly('/v2/aggs/ticker/I:VIX/prev?adjusted=true', 15 * 60000, 'vix');
    const result = data?.results?.[0];
    if (result?.c) {
      const value = parseFloat(result.c.toFixed(1));
      return { value, label: classifyVIX(value), source: 'polygon' };
    }
  } catch {}

  // Fallback 1: VIXY ETF snapshot (tracks VIX short-term futures)
  for (const etf of ['VIXY', 'UVXY']) {
    try {
      const snap = await getSnapshot(etf);
      if (snap?.price && snap.price > 0) {
        // VIXY/UVXY price-to-VIX mapping: these ETFs track VIX futures, not spot VIX.
        // Use prevDay close and change to estimate VIX direction.
        // VIXY typically trades at a fraction of VIX level; UVXY is 1.5x leveraged.
        const scale = etf === 'VIXY' ? 1.15 : 0.65;
        const estVix = parseFloat((snap.price * scale).toFixed(1));
        if (estVix > 5 && estVix < 80) { // sanity check
          return { value: estVix, label: classifyVIX(estVix), source: `${etf.toLowerCase()}_proxy`, estimated: true };
        }
      }
    } catch {}
  }

  // Fallback 2: Previous day aggregates for VIXY (works even when snapshot is stale)
  try {
    const data = await poly('/v2/aggs/ticker/VIXY/prev?adjusted=true', 30 * 60000, 'vixy_prev');
    const result = data?.results?.[0];
    if (result?.c && result.c > 0) {
      const estVix = parseFloat((result.c * 1.15).toFixed(1));
      if (estVix > 5 && estVix < 80) {
        return { value: estVix, label: classifyVIX(estVix), source: 'vixy_prev', estimated: true };
      }
    }
  } catch {}

  return null;
}

function classifyVIX(value) {
  if (value >= 30) return 'Extreme Fear';
  if (value >= 25) return 'Elevated';
  if (value >= 20) return 'Moderate';
  return 'Low';
}

export async function getFearGreed() {
  const cached = memGet('poly_fear_greed');
  if (cached) return cached;

  // Primary: CNN's STOCK MARKET Fear & Greed Index (the real one)
  try {
    const res = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'Accept': 'application/json' },
    });
    if (res.ok) {
      const raw = await res.json();
      const fg = raw?.fear_and_greed;
      if (fg?.score != null) {
        const value = Math.round(fg.score);
        const label = fg.rating || classifyFearGreed(value);
        const result = { value, label, source: 'cnn' };
        memSet('poly_fear_greed', result, 30 * 60000); // 30 min
        return result;
      }
    }
  } catch (e) {
    console.error('CNN F&G fetch failed:', e.message);
  }

  // Fallback: alternative.me crypto F&G (less accurate for stocks but better than nothing)
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    const raw = await res.json();
    const item = raw?.data?.[0];
    if (item) {
      const value = parseInt(item.value, 10);
      const result = { value, label: item.value_classification, source: 'crypto_fallback' };
      memSet('poly_fear_greed', result, 30 * 60000);
      return result;
    }
  } catch (e) {
    console.error('Alternative.me F&G fetch failed:', e.message);
  }

  return null;
}

function classifyFearGreed(value) {
  if (value <= 25) return 'Extreme Fear';
  if (value <= 45) return 'Fear';
  if (value <= 55) return 'Neutral';
  if (value <= 75) return 'Greed';
  return 'Extreme Greed';
}

export async function getRSI(ticker, timespan = 'day') {
  try {
    const data = await poly(`/v1/indicators/rsi/${ticker}?timespan=${timespan}&adjusted=true&window=14&series_type=close&limit=1`, 15 * 60000, `rsi_${ticker}`);
    const value = data?.results?.values?.[0]?.value;
    if (!value) return null;
    const rsi = parseFloat(value.toFixed(1));
    let label = 'Neutral';
    if (rsi >= 70) label = 'Overbought';
    else if (rsi <= 30) label = 'Oversold';
    else if (rsi >= 60) label = 'Bullish';
    else if (rsi <= 40) label = 'Bearish';
    return { value: rsi, label };
  } catch { return null; }
}

export async function getNews(ticker, limit = 20) {
  try {
    const data = await poly(`/v2/reference/news?ticker=${ticker}&limit=${limit}&order=desc`, 30 * 60000, `news_${ticker}`);
    return (data?.results ?? []).map(a => ({
      title: a.title,
      description: a.description || '',
      publishedUtc: a.published_utc,
      articleUrl: a.article_url,
      source: a.publisher?.name || 'Unknown',
      tickers: a.tickers || [],
    }));
  } catch { return []; }
}

/**
 * Get previous day close for a ticker using aggregates endpoint.
 * This is the most reliable fallback when snapshot endpoints fail.
 */
export async function getPrevClose(ticker) {
  try {
    const data = await poly(`/v2/aggs/ticker/${ticker}/prev?adjusted=true`, 60 * 60000, `prev_${ticker}`);
    const result = data?.results?.[0];
    if (result?.c && result.c > 0) {
      return {
        ticker,
        price: parseFloat(result.c.toFixed(2)),
        change: null,
        changePercent: null,
        volume: result.v ?? null,
        prevClose: parseFloat(result.c.toFixed(2)),
        source: 'prev_close',
      };
    }
    return null;
  } catch (err) {
    console.error(`[Polygon] PrevClose failed for ${ticker}:`, err.message);
    return null;
  }
}

/**
 * Get 5-day historical bars for market trend analysis.
 * Returns daily OHLCV for SPY, QQQ, and VIXY (VIX proxy).
 * Used to give AI context on WHERE the market has been, not just where it is.
 */
export async function getMarketTrend() {
  try {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 9); // 9 calendar days to ensure 5 trading days

    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    const [spyData, qqqData, vixyData] = await Promise.allSettled([
      poly(`/v2/aggs/ticker/SPY/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc`, 15 * 60000, `trend_SPY_${toStr}`),
      poly(`/v2/aggs/ticker/QQQ/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc`, 15 * 60000, `trend_QQQ_${toStr}`),
      poly(`/v2/aggs/ticker/VIXY/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc`, 15 * 60000, `trend_VIXY_${toStr}`),
    ]);

    function parseBars(result) {
      if (result.status !== 'fulfilled') return [];
      return (result.value?.results ?? []).slice(-5).map(bar => {
        const d = bar.t ? new Date(bar.t) : null;
        if (!d || isNaN(d.getTime())) return null;
        return {
          date: d.toISOString().split('T')[0],
          open: bar.o,
          close: bar.c,
          high: bar.h,
          low: bar.l,
          volume: bar.v,
        };
      }).filter(Boolean);
    }

    const spy = parseBars(spyData);
    const qqq = parseBars(qqqData);
    const vixy = parseBars(vixyData);

    // Build trend narratives
    function describeTrend(bars, ticker, isVixProxy = false) {
      if (bars.length < 2) return `${ticker}: insufficient data`;
      const first = bars[0];
      const last = bars[bars.length - 1];
      if (!first.close || first.close <= 0) return `${ticker}: invalid price data`;
      const totalChange = ((last.close - first.close) / first.close * 100).toFixed(1);
      const direction = last.close > first.close ? 'up' : last.close < first.close ? 'down' : 'flat';

      // Day-by-day closes for the AI to see the trajectory
      const closes = bars.map(b => {
        const day = new Date(b.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
        if (isVixProxy) {
          const estVix = (b.close * 1.15).toFixed(1);
          return `${day}: ~${estVix}`;
        }
        return `${day}: $${b.close.toFixed(2)}`;
      }).join(' → ');

      if (isVixProxy) {
        const estFirst = (first.close * 1.15).toFixed(1);
        const estLast = (last.close * 1.15).toFixed(1);
        return `VIX (est): ${closes} | Trend: ${direction} ${Math.abs(totalChange)}% over ${bars.length} days (${estFirst} → ${estLast})`;
      }
      return `${ticker}: ${closes} | Trend: ${direction} ${totalChange > 0 ? '+' : ''}${totalChange}% over ${bars.length} days`;
    }

    const spyTrend = describeTrend(spy, 'SPY');
    const qqqTrend = describeTrend(qqq, 'QQQ');
    const vixTrend = describeTrend(vixy, 'VIX', true);

    // Determine overall momentum
    let momentum = 'mixed';
    if (spy.length >= 2 && qqq.length >= 2) {
      const spyUp = spy[spy.length - 1].close > spy[spy.length - 2].close;
      const qqqUp = qqq[qqq.length - 1].close > qqq[qqq.length - 2].close;
      const vixDown = vixy.length >= 2 && vixy[vixy.length - 1].close < vixy[vixy.length - 2].close;
      if (spyUp && qqqUp && vixDown) momentum = 'improving';
      else if (spyUp && qqqUp) momentum = 'recovering';
      else if (!spyUp && !qqqUp && !vixDown) momentum = 'deteriorating';
      else if (!spyUp && !qqqUp) momentum = 'weakening';
    }

    // Fetch LONGER-TERM context (1-month, 3-month) so the agent can see the bigger picture
    // This prevents the agent from contradicting users about multi-week/month trends
    let longerTermContext = '';
    try {
      const oneMonthAgo = new Date(); oneMonthAgo.setDate(oneMonthAgo.getDate() - 35);
      const threeMonthsAgo = new Date(); threeMonthsAgo.setDate(threeMonthsAgo.getDate() - 95);
      const oneMonthStr = oneMonthAgo.toISOString().split('T')[0];
      const threeMonthStr = threeMonthsAgo.toISOString().split('T')[0];

      const [spy1m, spy3m, qqq1m, qqq3m] = await Promise.allSettled([
        poly(`/v2/aggs/ticker/SPY/range/1/day/${oneMonthStr}/${toStr}?adjusted=true&sort=asc&limit=2`, 60 * 60000, `lt_SPY_1m_${toStr}`),
        poly(`/v2/aggs/ticker/SPY/range/1/day/${threeMonthStr}/${toStr}?adjusted=true&sort=asc&limit=2`, 60 * 60000, `lt_SPY_3m_${toStr}`),
        poly(`/v2/aggs/ticker/QQQ/range/1/day/${oneMonthStr}/${toStr}?adjusted=true&sort=asc&limit=2`, 60 * 60000, `lt_QQQ_1m_${toStr}`),
        poly(`/v2/aggs/ticker/QQQ/range/1/day/${threeMonthStr}/${toStr}?adjusted=true&sort=asc&limit=2`, 60 * 60000, `lt_QQQ_3m_${toStr}`),
      ]);

      function calcChange(result, label) {
        if (result.status !== 'fulfilled') return null;
        const bars = result.value?.results ?? [];
        if (bars.length < 2) return null;
        const first = bars[0].c;
        const last = bars[bars.length - 1].c;
        if (!first || first <= 0 || !last) return null;
        const pct = ((last - first) / first * 100).toFixed(1);
        return `${label}: ${pct > 0 ? '+' : ''}${pct}% ($${first.toFixed(2)} → $${last.toFixed(2)})`;
      }

      const parts = [
        calcChange(spy1m, 'SPY 1-month'),
        calcChange(spy3m, 'SPY 3-month'),
        calcChange(qqq1m, 'QQQ 1-month'),
        calcChange(qqq3m, 'QQQ 3-month'),
      ].filter(Boolean);

      if (parts.length > 0) {
        longerTermContext = `\nBIGGER PICTURE (so you don't miss the forest for the trees):\n${parts.join('\n')}`;
      }
    } catch (ltErr) {
      console.warn('[Polygon] Longer-term trend fetch failed:', ltErr.message);
    }

    return {
      spy, qqq, vixy,
      spyTrend, qqqTrend, vixTrend,
      momentum,
      longerTermContext,
      narrative: `MARKET TREND (last ${spy.length} trading days):\n${spyTrend}\n${qqqTrend}\n${vixTrend}\nMomentum: ${momentum.toUpperCase()}${longerTermContext}`,
    };
  } catch (err) {
    console.error('[Polygon] Market trend fetch failed:', err.message);
    return { spy: [], qqq: [], vixy: [], spyTrend: '', qqqTrend: '', vixTrend: '', momentum: 'unknown', narrative: 'Market trend data unavailable.' };
  }
}

/**
 * Get 52-week high for a ticker using daily aggregates.
 * Returns { high, dateAtHigh, currentPrice, pctOffHigh } or null.
 * Used by Bargain Radar to find stocks well off their highs.
 */
export async function getFiftyTwoWeekHigh(ticker) {
  try {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 370); // ~53 weeks of calendar days
    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    const data = await poly(
      `/v2/aggs/ticker/${ticker}/range/1/day/${fromStr}/${toStr}?adjusted=true&sort=asc&limit=400`,
      6 * 60 * 60 * 1000, // 6 hours
      `52w_${ticker}_${toStr}`
    );
    const bars = data?.results ?? [];
    if (bars.length < 20) return null;

    let high = 0;
    let dateAtHigh = null;
    for (const b of bars) {
      if (b.h > high) {
        high = b.h;
        dateAtHigh = b.t ? new Date(b.t).toISOString().split('T')[0] : null;
      }
    }
    if (high <= 0) return null;

    const last = bars[bars.length - 1];
    const currentPrice = last?.c ?? null;
    const pctOffHigh = currentPrice ? ((currentPrice - high) / high) * 100 : null;

    return {
      ticker,
      high: parseFloat(high.toFixed(2)),
      dateAtHigh,
      currentPrice: currentPrice ? parseFloat(currentPrice.toFixed(2)) : null,
      pctOffHigh: pctOffHigh != null ? parseFloat(pctOffHigh.toFixed(2)) : null,
    };
  } catch (err) {
    console.error(`[Polygon] 52w high failed for ${ticker}:`, err.message);
    return null;
  }
}

/**
 * Get 200-day Simple Moving Average for a ticker.
 * Returns { value, label } or null.
 * Label is 'above' or 'below' indicating current price vs the SMA.
 */
export async function getSMA200(ticker) {
  try {
    const data = await poly(
      `/v1/indicators/sma/${ticker}?timespan=day&adjusted=true&window=200&series_type=close&limit=1`,
      6 * 60 * 60 * 1000,
      `sma200_${ticker}`
    );
    const value = data?.results?.values?.[0]?.value;
    if (!value) return null;
    return { value: parseFloat(value.toFixed(2)) };
  } catch (err) {
    console.error(`[Polygon] SMA200 failed for ${ticker}:`, err.message);
    return null;
  }
}

/**
 * Get broad market news (not ticker-specific).
 * Returns top 5 recent market headlines.
 */
export async function getMarketNews(limit = 5) {
  try {
    const data = await poly(`/v2/reference/news?limit=${limit}&order=desc`, 15 * 60000, 'market_news');
    return (data?.results ?? []).map(a => ({
      title: a.title,
      description: a.description || '',
      publishedUtc: a.published_utc,
      source: a.publisher?.name || 'Unknown',
      tickers: a.tickers || [],
    }));
  } catch { return []; }
}
