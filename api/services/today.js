/**
 * TODAY — Outpost's curated picks surface.
 *
 * Aggregates the highest-signal item from each category and returns up to 5
 * ranked picks for the user. Designed to answer "what should I look at right
 * now?" in 30 seconds without forcing the user to walk every tab.
 *
 * Sources (all cached — no fresh AI calls here):
 *   - User positions     → ALERT (drawdown ≥20%, target hit, stop broken)
 *                          + MOVER (a holding moved ≥5% today)
 *   - User watchlist     → WATCH (alert near or hit)
 *   - catalyst_watch_today cache → CATALYST (top stock from today's latest drop)
 *   - sector_radar cache → HEAT (top heating sector)
 *   - bargain_radar cache → BARGAIN (top buyable dip not already held)
 *
 * Note: broad-market universe movers were intentionally removed from this
 * surface. They appear in the dedicated movers card lower on the home page
 * and were generating identical filler copy ("biggest mover in the broad
 * market") that buried the actually-meaningful signals. If TODAY has fewer
 * than `limit` items, we show a quiet-day message instead of padding noise.
 *
 * Cost: zero Claude calls. Returns in <100ms when caches are warm.
 *
 * Ranking: priority score per item (higher = more important).
 * Returns sorted by priority, capped at 5.
 */
import { supabase } from '../db.js';
import { getPrices } from './pricePool.js';

const PRIORITY = {
  STOP_BROKEN:       100,
  TARGET_HIT:         95,
  WATCH_HIT:          90,
  DEEP_DRAWDOWN:      85,  // -20%+
  WATCH_NEAR:         75,
  PORTFOLIO_MOVER:    70,  // a holding moved >5% today
  CATALYST_TOP:       65,  // top stock from today's latest catalyst drop
  MODERATE_DRAWDOWN:  60,  // -15% to -20%
  SECTOR_HEAT:        55,
  BARGAIN_PICK:       50,
};

/**
 * Build the TODAY feed for one user.
 * Returns: { items: [{ type, ticker, title, detail, priority, link }] }
 */
export async function buildTodayFeed(userId, opts = {}) {
  const limit = opts.limit ?? 5;

  // ── Load all the source data in parallel ────────────────────────────────
  const [
    posResult,
    watchResult,
    sectorCache,
    bargainCache,
    catalystCache,
  ] = await Promise.allSettled([
    supabase.from('positions').select('ticker, shares, avg_cost, price_target, stop_loss, entry_thesis').eq('user_id', userId),
    supabase.from('watchlist').select('ticker, alert_price, last_price, notes').eq('user_id', userId),
    supabase.from('ai_cache').select('result, created_at').eq('cache_key', 'sector_radar').maybeSingle(),
    supabase.from('ai_cache').select('result, created_at').eq('cache_key', 'bargain_radar').maybeSingle(),
    supabase.from('ai_cache').select('result, created_at').eq('cache_key', 'catalyst_watch_today').maybeSingle(),
  ]);

  const positions = posResult.status === 'fulfilled' ? (posResult.value.data ?? []) : [];
  const watchlist = watchResult.status === 'fulfilled' ? (watchResult.value.data ?? []) : [];
  const sectorRaw = sectorCache.status === 'fulfilled' ? sectorCache.value.data : null;
  const bargainRaw = bargainCache.status === 'fulfilled' ? bargainCache.value.data : null;
  const catalystRaw = catalystCache.status === 'fulfilled' ? catalystCache.value.data : null;

  // Live prices for the user's universe
  const allTickers = [
    ...new Set([
      ...positions.map(p => p.ticker),
      ...watchlist.map(w => w.ticker),
    ]),
  ];
  const priceMap = allTickers.length > 0 ? getPrices(allTickers) : {};

  const items = [];
  const heldTickers = new Set(positions.map(p => p.ticker));

  // ── Portfolio signals — drawdowns, target hits, stop breaks, big movers ──
  for (const p of positions) {
    const live = priceMap[p.ticker]?.price;
    const todayPct = priceMap[p.ticker]?.changePercent;
    if (!live) continue;

    const pnlPct = p.avg_cost > 0 ? ((live - p.avg_cost) / p.avg_cost) * 100 : 0;

    // Stop broken — highest priority
    if (p.stop_loss && live < p.stop_loss) {
      items.push({
        type: 'alert', subtype: 'stop_broken', ticker: p.ticker,
        title: `Stop broken at $${p.stop_loss.toFixed(2)}`,
        detail: `Now $${live.toFixed(2)}. Your written stop has been hit — decide intentionally, not in panic.`,
        priority: PRIORITY.STOP_BROKEN,
        link: { tab: 'portfolio', ticker: p.ticker },
      });
      continue;
    }
    // Target hit
    if (p.price_target && live >= p.price_target) {
      items.push({
        type: 'alert', subtype: 'target_hit', ticker: p.ticker,
        title: `Target hit at $${p.price_target.toFixed(2)}`,
        detail: `Now $${live.toFixed(2)}. Time to revisit whether you trim, hold, or raise the target.`,
        priority: PRIORITY.TARGET_HIT,
        link: { tab: 'portfolio', ticker: p.ticker },
      });
      continue;
    }
    // Deep drawdown
    if (pnlPct <= -20) {
      items.push({
        type: 'alert', subtype: 'deep_drawdown', ticker: p.ticker,
        title: `Down ${Math.abs(pnlPct).toFixed(0)}% from cost`,
        detail: `In real-damage territory. Worth honestly asking whether the thesis still holds at current prices.`,
        priority: PRIORITY.DEEP_DRAWDOWN,
        link: { tab: 'portfolio', ticker: p.ticker },
      });
      continue;
    }
    // Moderate drawdown
    if (pnlPct <= -15) {
      items.push({
        type: 'alert', subtype: 'moderate_drawdown', ticker: p.ticker,
        title: `Down ${Math.abs(pnlPct).toFixed(0)}% from cost`,
        detail: `Worth a look. Check if there's a real reason or just market noise.`,
        priority: PRIORITY.MODERATE_DRAWDOWN,
        link: { tab: 'portfolio', ticker: p.ticker },
      });
      continue;
    }
    // Big mover — only flag if it's a meaningful chunk move
    if (todayPct != null && Math.abs(todayPct) >= 5) {
      const dir = todayPct >= 0 ? 'up' : 'down';
      items.push({
        type: 'mover', subtype: 'portfolio_mover', ticker: p.ticker,
        title: `${dir} ${Math.abs(todayPct).toFixed(1)}% today`,
        detail: `Big move on one of your holdings — check what's driving it.`,
        priority: PRIORITY.PORTFOLIO_MOVER + (Math.abs(todayPct) >= 8 ? 5 : 0),
        link: { tab: 'portfolio', ticker: p.ticker },
      });
    }
  }

  // ── Watchlist alerts ────────────────────────────────────────────────────
  for (const w of watchlist) {
    if (!w.alert_price || !w.last_price) continue;
    const dist = ((w.alert_price - w.last_price) / w.last_price) * 100;

    if (dist <= 0) {
      items.push({
        type: 'watch', subtype: 'hit', ticker: w.ticker,
        title: `Hit your $${w.alert_price.toFixed(2)} alert`,
        detail: `Now $${w.last_price.toFixed(2)}. ${w.notes ? `Your note: "${w.notes.slice(0, 80)}"` : 'You wanted to know — now you know.'}`,
        priority: PRIORITY.WATCH_HIT,
        link: { tab: 'social', section: 'watchlist', ticker: w.ticker },
      });
    } else if (dist <= 5) {
      items.push({
        type: 'watch', subtype: 'near', ticker: w.ticker,
        title: `${dist.toFixed(1)}% from your alert`,
        detail: `Approaching $${w.alert_price.toFixed(2)} — currently $${w.last_price.toFixed(2)}.`,
        priority: PRIORITY.WATCH_NEAR,
        link: { tab: 'social', section: 'watchlist', ticker: w.ticker },
      });
    }
  }

  // ── Sector heat — top heating sector from cache ─────────────────────────
  if (sectorRaw?.result) {
    try {
      const sector = JSON.parse(sectorRaw.result);
      const top = (sector.heating || [])[0];
      if (top) {
        items.push({
          type: 'heat', subtype: 'sector', ticker: top.ticker || 'SECTOR',
          title: `${top.name || 'Sector'} heating up`,
          detail: top.thesis || 'Money rotating in based on multi-day flow signals.',
          priority: PRIORITY.SECTOR_HEAT + (top.signal === 'strong' ? 5 : 0),
          link: { tab: 'home', card: 'sector-radar' },
        });
      }
    } catch {}
  }

  // ── Bargain pick — top buyable that user doesn't already hold ───────────
  if (bargainRaw?.result) {
    try {
      const bargain = JSON.parse(bargainRaw.result);
      const buyable = (bargain.candidates || []).find(b =>
        b.verdict === 'buyable' && !heldTickers.has(b.ticker)
      );
      if (buyable) {
        items.push({
          type: 'bargain', subtype: 'pick', ticker: buyable.ticker,
          title: `Oversold — story intact`,
          detail: buyable.thesis || `Down sharply on macro fear, fundamentals unchanged.`,
          priority: PRIORITY.BARGAIN_PICK,
          link: { tab: 'social', section: 'bargain', ticker: buyable.ticker },
        });
      }
    } catch {}
  }

  // ── Catalyst — top stock from today's most recent drop ─────────────────
  // Surfaces the highest-conviction catalyst pick of the day. Skips anything
  // already in the user's portfolio or watchlist (they got covered above).
  if (catalystRaw?.result) {
    try {
      const cat = JSON.parse(catalystRaw.result);
      const drops = cat?.drops ? Object.values(cat.drops) : [];
      // Latest non-empty drop wins (sorted by generatedAt descending)
      const latestDrop = drops
        .filter(d => Array.isArray(d?.stocks) && d.stocks.length > 0)
        .sort((a, b) => new Date(b.generatedAt || 0) - new Date(a.generatedAt || 0))[0];
      if (latestDrop) {
        const watchSet = new Set(watchlist.map(w => w.ticker));
        const top = latestDrop.stocks.find(s =>
          s?.ticker && !heldTickers.has(s.ticker) && !watchSet.has(s.ticker)
        );
        if (top) {
          const flame = Math.max(1, Math.min(3, top.flameRating || 1));
          items.push({
            type: 'catalyst', subtype: 'top_pick', ticker: top.ticker,
            title: `${top.catalystLabel || 'Catalyst'} — ${'🔥'.repeat(flame)}`,
            detail: top.detail || `Catalyst flagged in the ${latestDrop.label || 'latest'} drop.`,
            priority: PRIORITY.CATALYST_TOP + (flame >= 3 ? 5 : 0),
            link: { tab: 'social', section: 'catalyst', ticker: top.ticker },
          });
        }
      }
    } catch {}
  }

  // ── Sort + cap ──────────────────────────────────────────────────────────
  items.sort((a, b) => b.priority - a.priority);
  let final = items.slice(0, limit);

  // Quiet-day fallback — better than padding with broad-market noise.
  if (final.length === 0) {
    final = [{
      type: 'quiet', subtype: 'no_signals', ticker: null,
      title: 'Nothing urgent on your book today',
      detail: 'No alerts, big movers, catalysts, or watchlist hits in your universe. Quiet day — that is also useful information.',
      priority: 0,
      link: { tab: 'home' },
    }];
  }

  return {
    items: final,
    generatedAt: new Date().toISOString(),
  };
}
