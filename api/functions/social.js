import express from 'express';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { sanitizeTicker } from '../middleware/validate.js';
import { lookupStock } from '../services/agentTools.js';
import { getPrices, isPoolMarketOpen, requestRefresh } from '../services/pricePool.js';
import { getSnapshots } from '../utils/polygon.js';
import { getTickerNews, isFinnhubAvailable } from '../utils/finnhub.js';

const router = express.Router();
const WATCHLIST_LIMITS = { free: 5, starter: 20, pro: 50, elite: 100 };
const SCAN_INTERVAL = 30 * 60 * 1000; // 30 minutes

// In-memory store for buzz data (resets on server restart)
let buzzingNow = [];        // Current top 5
let earlierToday = [];      // Stocks that fell off, resets daily
let lastScanTime = null;
let scanDay = null;          // Track current day for midnight reset

// Large-cap tickers to filter differently (buzz is normal for these)
const LARGE_CAPS = new Set([
  'AAPL','MSFT','GOOGL','GOOG','AMZN','NVDA','META','TSLA','BRK.A','BRK.B',
  'JPM','V','UNH','XOM','JNJ','WMT','MA','PG','HD','CVX','MRK','ABBV','LLY',
  'KO','PEP','COST','BAC','AVGO','TMO','MCD','DIS','CSCO','ACN','ABT','DHR',
  'ADBE','CRM','NFLX','INTC','AMD','QCOM','TXN','ORCL','IBM','GE','CAT','BA',
  'SPY','QQQ','DIA','IWM','VOO','VTI','ARKK',
]);

/**
 * Fetch trending symbols from StockTwits (public, no auth needed)
 */
async function fetchStockTwitsTrending() {
  try {
    const res = await fetch('https://api.stocktwits.com/api/2/trending/symbols.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      console.warn(`[BuzzScanner] StockTwits returned ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data?.symbols ?? []).map(s => ({
      ticker: s.symbol,
      title: s.title,
      watchlistCount: s.watchlist_count ?? 0,
    }));
  } catch (err) {
    console.error('[BuzzScanner] StockTwits fetch failed:', err.message);
    return [];
  }
}

/**
 * Core scan: Get StockTwits trending, enrich with Polygon price data,
 * filter and rank for the most interesting movers.
 */
async function runBuzzScan() {
  console.log('[BuzzScanner] Running scan...');
  const trending = await fetchStockTwitsTrending();
  if (!trending.length) {
    console.warn('[BuzzScanner] No trending data from StockTwits');
    return [];
  }

  // Split into small/mid caps vs large caps
  const smallMid = trending.filter(t => !LARGE_CAPS.has(t.ticker));
  const largeCap = trending.filter(t => LARGE_CAPS.has(t.ticker));

  // Get all tickers for price enrichment
  const allTickers = trending.map(t => t.ticker);
  let priceData = {};
  try {
    priceData = await getSnapshots(allTickers);
  } catch (err) {
    console.warn('[BuzzScanner] Polygon snapshot failed:', err.message);
  }

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true,
    timeZone: 'America/New_York',
  });

  // Score and rank small/mid caps (the CYCN-type plays)
  // Higher score = more interesting: buzz + price move + volume
  const scoredSmall = smallMid.map(t => {
    const snap = priceData[t.ticker];
    const changePct = snap?.changePercent ?? 0;
    const price = snap?.price ?? null;
    const volume = snap?.volume ?? 0;

    // Buzz score: watchlist count as proxy for attention
    const buzzScore = t.watchlistCount;
    // Movement score: bigger move = more interesting
    const moveScore = Math.abs(changePct) * 10;
    // Combined score
    const totalScore = buzzScore + moveScore;

    return {
      ticker: t.ticker,
      name: t.title,
      price,
      changePct: changePct ? parseFloat(changePct.toFixed(2)) : null,
      volume,
      watchlistCount: t.watchlistCount,
      buzzScore: totalScore,
      flaggedAt: timeStr,
      flaggedAtISO: now.toISOString(),
      type: 'smallmid',
    };
  }).filter(t => t.price && t.price > 0.5) // Filter out sub-penny stocks
    .sort((a, b) => b.buzzScore - a.buzzScore);

  // Score large caps — only include if they have a BIG move (>4%)
  const scoredLarge = largeCap
    .map(t => {
      const snap = priceData[t.ticker];
      const changePct = snap?.changePercent ?? 0;
      return {
        ticker: t.ticker,
        name: t.title,
        price: snap?.price ?? null,
        changePct: changePct ? parseFloat(changePct.toFixed(2)) : null,
        volume: snap?.volume ?? 0,
        watchlistCount: t.watchlistCount,
        buzzScore: t.watchlistCount + Math.abs(changePct) * 10,
        flaggedAt: timeStr,
        flaggedAtISO: now.toISOString(),
        type: 'largecap',
      };
    })
    .filter(t => t.price && Math.abs(t.changePct ?? 0) >= 4) // Only large caps with BIG moves
    .sort((a, b) => b.buzzScore - a.buzzScore);

  // Combine: prioritize small/mid caps (4 slots), max 1 large cap
  const combined = [...scoredSmall.slice(0, 4), ...scoredLarge.slice(0, 1)]
    .sort((a, b) => b.buzzScore - a.buzzScore)
    .slice(0, 5);

  // Fetch news for each buzzing stock to generate "why" descriptions
  if (isFinnhubAvailable() && combined.length > 0) {
    try {
      const newsResults = await Promise.allSettled(
        combined.map(stock => getTickerNews(stock.ticker, 2))
      );
      for (let i = 0; i < combined.length; i++) {
        const result = newsResults[i];
        if (result.status === 'fulfilled' && result.value?.length > 0) {
          const topHeadline = result.value[0];
          combined[i].reason = topHeadline.title;
          combined[i].reasonSource = topHeadline.source;
        }
      }
    } catch (err) {
      console.warn('[BuzzScanner] News enrichment failed:', err.message);
    }
  }

  // Generate fallback reasons for stocks without news
  for (const stock of combined) {
    if (!stock.reason) {
      const parts = [];
      if (Math.abs(stock.changePct ?? 0) > 5) parts.push(`${stock.changePct > 0 ? 'Up' : 'Down'} ${Math.abs(stock.changePct).toFixed(1)}% today`);
      if (stock.watchlistCount > 50000) parts.push(`${(stock.watchlistCount / 1000).toFixed(0)}K watchers on StockTwits`);
      else if (stock.watchlistCount > 0) parts.push(`Trending on StockTwits`);
      if (stock.volume > 10000000) parts.push(`Heavy volume ${(stock.volume / 1000000).toFixed(1)}M`);
      stock.reason = parts.length > 0 ? parts.join(' · ') : 'Trending on social media';
    }
  }

  console.log(`[BuzzScanner] Found ${combined.length} buzzing stocks (${scoredSmall.length} small/mid, ${scoredLarge.length} notable large)`);
  return combined;
}

/**
 * Background scanner — runs every 30 minutes.
 * Manages buzzing now vs earlier today.
 */
async function backgroundBuzzScan() {
  try {
    // Check for midnight reset
    const today = new Date().toISOString().split('T')[0];
    if (scanDay && scanDay !== today) {
      console.log('[BuzzScanner] New day — clearing earlier today');
      earlierToday = [];
    }
    scanDay = today;

    const newBuzz = await runBuzzScan();
    if (!newBuzz.length) return;

    // Move stocks that fell off buzzing now to earlier today
    const newTickers = new Set(newBuzz.map(b => b.ticker));
    for (const old of buzzingNow) {
      if (!newTickers.has(old.ticker)) {
        // It fell off — add to earlier today if not already there
        const alreadyInEarlier = earlierToday.some(e => e.ticker === old.ticker);
        if (!alreadyInEarlier) {
          // Enrich with current price to show what happened since flagging
          const priceNow = getPrices([old.ticker]);
          const current = priceNow[old.ticker];
          earlierToday.unshift({
            ...old,
            droppedAt: new Date().toLocaleTimeString('en-US', {
              hour: 'numeric', minute: '2-digit', hour12: true,
              timeZone: 'America/New_York',
            }),
            currentPrice: current?.price ?? old.price,
            currentChangePct: current?.changePercent ?? old.changePct,
          });
        }
      }
    }
    // Keep earlier today to max 15 entries
    earlierToday = earlierToday.slice(0, 15);

    buzzingNow = newBuzz;
    lastScanTime = new Date().toISOString();

    // Cache to Supabase for persistence
    const cacheKey = 'buzz_scan_current';
    const payload = JSON.stringify({ buzzing: buzzingNow, earlier: earlierToday, scannedAt: lastScanTime });
    const { data: existing } = await supabase.from('ai_cache').select('id').eq('cache_key', cacheKey).maybeSingle();
    if (existing) await supabase.from('ai_cache').update({ result: payload, created_at: lastScanTime }).eq('id', existing.id);
    else await supabase.from('ai_cache').insert({ cache_key: cacheKey, result: payload, created_at: lastScanTime });

    console.log(`[BuzzScanner] Scan complete — ${buzzingNow.length} buzzing, ${earlierToday.length} earlier today`);
  } catch (err) {
    console.error('[BuzzScanner] Background scan error:', err.message);
  }
}

/**
 * Start the background buzz scanner.
 */
export function startBackgroundScanner() {
  console.log('[BuzzScanner] Starting buzz scanner...');

  // Load cached data on startup
  (async () => {
    try {
      const { data: cached } = await supabase.from('ai_cache').select('*').eq('cache_key', 'buzz_scan_current').maybeSingle();
      if (cached?.result) {
        const parsed = JSON.parse(cached.result);
        // Only use if from today
        const cachedDate = cached.created_at?.split('T')[0];
        const today = new Date().toISOString().split('T')[0];
        if (cachedDate === today) {
          buzzingNow = parsed.buzzing ?? [];
          earlierToday = parsed.earlier ?? [];
          lastScanTime = parsed.scannedAt;
          console.log(`[BuzzScanner] Loaded cached data — ${buzzingNow.length} buzzing, ${earlierToday.length} earlier`);
        }
      }
    } catch {}

    // Run first scan after 5 second startup delay
    setTimeout(() => {
      backgroundBuzzScan();
      // Then every 30 minutes
      setInterval(backgroundBuzzScan, SCAN_INTERVAL);
    }, 5000);
  })();
}

// ============ API ROUTES ============

// GET /api/social/buzz — main endpoint for the social tab
router.get('/buzz', requireAuth, rateLimit(20), async (req, res) => {
  try {
    const [positions, watchlist] = await Promise.all([
      supabase.from('positions').select('ticker').eq('user_id', req.user.id),
      supabase.from('watchlist').select('ticker').eq('user_id', req.user.id),
    ]);
    const portTickers = new Set((positions.data ?? []).map(p => p.ticker));
    const watchTickers = new Set((watchlist.data ?? []).map(w => w.ticker));

    const enriched = (list) => list.map(t => ({
      ...t,
      inPortfolio: portTickers.has(t.ticker),
      inWatchlist: watchTickers.has(t.ticker),
    }));

    const nextScanMs = lastScanTime ? (new Date(lastScanTime).getTime() + SCAN_INTERVAL) - Date.now() : 0;
    const nextScanIn = Math.max(0, Math.ceil(nextScanMs / 60000));

    res.json({
      buzzing: enriched(buzzingNow),
      earlierToday: enriched(earlierToday),
      scannedAt: lastScanTime,
      nextScanIn,
    });
  } catch {
    res.status(500).json({ error: 'Scanner unavailable' });
  }
});

// Keep old /scan endpoint as alias for backwards compatibility
router.get('/scan', requireAuth, rateLimit(10), async (req, res) => {
  try {
    // Return buzz data in the old format
    const tickers = buzzingNow.map(t => ({
      ticker: t.ticker,
      mentionCount: t.watchlistCount,
      sentiment: (t.changePct ?? 0) > 0 ? 'Bullish' : (t.changePct ?? 0) < 0 ? 'Bearish' : 'Mixed',
      momentum: 'Trending',
      topPostTitle: `Trending on StockTwits — ${t.watchlistCount.toLocaleString()} watchers`,
      topPostUrl: `https://stocktwits.com/symbol/${t.ticker}`,
    }));
    res.json({ tickers, isCached: !!lastScanTime, cachedAt: lastScanTime, nextScanIn: 30 });
  } catch {
    res.status(500).json({ error: 'Scanner unavailable' });
  }
});

// ============ WATCHLIST (unchanged) ============

router.get('/watchlist', requireAuth, rateLimit(20), async (req, res) => {
  try {
    const { data: items } = await supabase.from('watchlist').select('*').eq('user_id', req.user.id).order('added_at', { ascending: false });
    const list = items ?? [];

    if (list.length > 0) {
      const priceMap = getPrices(list.map(i => i.ticker));
      list.forEach(item => {
        if (priceMap[item.ticker]) {
          item.last_price = priceMap[item.ticker].price;
          item.change_percent = isPoolMarketOpen() ? priceMap[item.ticker].changePercent : 0;
        }
      });
    }

    res.json({ items: list });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/watchlist', requireAuth, rateLimit(15), async (req, res) => {
  try {
    const ticker = sanitizeTicker(req.body.ticker);
    if (!ticker) return res.status(400).json({ error: 'Valid ticker required' });

    // Validate ticker exists on a real exchange
    try {
      const lookup = await lookupStock({ ticker });
      if (lookup?.error || !lookup?.price) {
        return res.status(400).json({ error: `Ticker unavailable — "${ticker}" isn't a valid US stock symbol` });
      }
    } catch {
      return res.status(400).json({ error: `Ticker unavailable — "${ticker}" isn't a valid US stock symbol` });
    }

    const plan = req.user.plan ?? 'free';
    const limit = WATCHLIST_LIMITS[plan] ?? 5;
    const { data: existing } = await supabase.from('watchlist').select('id').eq('user_id', req.user.id);
    if ((existing?.length ?? 0) >= limit) {
      return res.status(403).json({ error: `Watchlist full (${limit} max on ${plan} plan) — upgrade to add more` });
    }

    const { data: dup } = await supabase.from('watchlist').select('id').eq('user_id', req.user.id).eq('ticker', ticker).maybeSingle();
    if (dup) return res.status(409).json({ error: `${ticker} is already in your watchlist` });

    const insertData = {
      user_id: req.user.id,
      ticker,
      company_name: req.body.companyName || ticker,
      added_at: new Date().toISOString(),
    };
    // Optional watchlist notes and alert price
    if (req.body.notes) insertData.notes = req.body.notes.slice(0, 500);
    if (req.body.alertPrice) insertData.alert_price = parseFloat(req.body.alertPrice) || null;

    const { data: item, error } = await supabase.from('watchlist').insert(insertData).select().single();

    if (error) return res.status(500).json({ error: 'Failed to add to watchlist' });
    requestRefresh();
    res.json({ success: true, item });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/watchlist/:id', requireAuth, rateLimit(15), async (req, res) => {
  try {
    const { data: item } = await supabase.from('watchlist').select('id').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const updates = {};
    if (req.body.notes !== undefined) updates.notes = (req.body.notes || '').slice(0, 500) || null;
    if (req.body.alertPrice !== undefined) updates.alert_price = req.body.alertPrice ? parseFloat(req.body.alertPrice) : null;

    await supabase.from('watchlist').update(updates).eq('id', req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/watchlist/:id', requireAuth, rateLimit(15), async (req, res) => {
  try {
    const { data: item } = await supabase.from('watchlist').select('id').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
    if (!item) return res.status(404).json({ error: 'Item not found' });
    await supabase.from('watchlist').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
