/**
 * TODAY — Outpost's curated picks surface.
 *
 * Aggregates the highest-signal item from each category and returns up to
 * `limit` (default 10) ranked picks for the user. Designed to answer "what
 * should I look at right now?" in 30 seconds without forcing the user to
 * walk every tab. Renders smaller on calm days, not padded to 10.
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
 * Returns sorted by priority, capped at `limit` (default 10).
 *
 * Mover compositing: on a volatile day a single user might have 5 holdings
 * each up or down 5%+, which used to fill every TODAY slot with the same
 * boilerplate "Big move on one of your holdings" card and crowd out
 * catalysts, sector heat, and other distinct signals. When >=3 movers land
 * in TODAY, they collapse into ONE composite item (type='mover_group')
 * that lists every mover compactly. Other signal types stay free to fill
 * the remaining slots.
 */
import { supabase } from '../db.js';
import { getPrices } from './pricePool.js';
import { getMarketData } from './marketData.js';
import { todayStr } from '../utils/marketHours.js';

// Hybrid freshness gate for the cached signals TODAY renders. Intraday signals
// (sector heat, catalysts) are only meaningful for the SAME ET trading day, so
// once the date rolls over they are hidden rather than shown as today's. Daily
// signals (the nightly bargain scan) stay valid into the next morning, up to
// ~30h, and are labeled "as of last night's scan" once they are no longer
// same-day. Pure (now is injectable) so the date logic is unit-testable.
const DAILY_MAX_AGE_HOURS = 30;
export function cacheFreshness(kind, createdAtIso, now = new Date()) {
  if (!createdAtIso) return { show: false, asOf: null };
  const created = new Date(createdAtIso);
  if (Number.isNaN(created.getTime())) return { show: false, asOf: null };
  const sameDay = todayStr(created) === todayStr(now);
  if (kind !== 'daily') return { show: sameDay, asOf: null }; // intraday: same ET day only
  if (sameDay) return { show: true, asOf: null };
  const ageHours = (now.getTime() - created.getTime()) / 3600000;
  return ageHours <= DAILY_MAX_AGE_HOURS
    ? { show: true, asOf: "last night's scan" }
    : { show: false, asOf: null };
}

// Plain-English scope for the sector ETFs the radar tracks, so "Energy" (XLE,
// the oil & gas majors) is never read as a user's clean-energy or nuclear names,
// which often move the opposite way. Falls back to just the sector name.
const SECTOR_SCOPE = {
  XLK: 'big tech', SMH: 'semiconductors', XLE: 'oil & gas majors', XLF: 'big banks',
  XLV: 'healthcare', XLY: 'consumer / retail', XLP: 'consumer staples', XLI: 'industrials',
  XLU: 'utilities', XLB: 'materials', XLRE: 'real estate', XLC: 'communication / media',
};
function sectorLabel(top) {
  const name = top.name || 'Sector';
  const scope = top.ticker ? SECTOR_SCOPE[String(top.ticker).toUpperCase()] : null;
  return scope ? `${name} (${top.ticker}: ${scope})` : name;
}

/**
 * Frame the top heating sector for the current market regime. On a risk-off day,
 * a sector still showing strength is defensive leadership, not a green light to
 * chase, so we say that instead of cheerleading "heating up" while the broader
 * market sells off (which read as tone-deaf). The label names the ETF's scope so
 * it can't be confused with a user's same-named-but-different sub-sector. Pure so
 * the behavior is testable. Returns { title, detail, priorityBonus } or null.
 */
export function frameSectorHeat(top, regime) {
  if (!top) return null;
  const label = sectorLabel(top);
  const riskOff = regime === 'Risk Off';
  return {
    title: riskOff ? `${label} holding up while the market is jittery` : `${label} heating up`,
    detail: top.thesis || (riskOff
      ? 'Relative strength here even as the broader market pulls back. That is defensive leadership, not a green light to chase.'
      : 'Money rotating in based on multi-day flow signals.'),
    // The strong-signal priority bump only applies in calmer regimes. On a
    // risk-off day we do not let a hot sector jump ahead of the user's own
    // risk items (broken stops, deep drawdowns).
    priorityBonus: (!riskOff && top.signal === 'strong') ? 5 : 0,
  };
}

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
/**
 * Pure: given the raw items list, collapse 3+ portfolio movers into a
 * single composite item. Returns a new array, never mutates the input.
 * Below the threshold, returns the items unchanged. Exported for tests.
 *
 * The composite item inherits the priority of the highest-priority mover
 * in the group so it still floats up to the same position in the final
 * sort. Movers inside the group are sorted by absolute % desc so the
 * biggest move shows first when rendered.
 */
export function compositeMovers(items, threshold = 3) {
  const movers = items.filter(i => i?.type === 'mover');
  if (movers.length < threshold) return [...items];

  const nonMovers = items.filter(i => i?.type !== 'mover');
  const maxPriority = Math.max(...movers.map(m => m.priority ?? 0));
  const sortedMovers = [...movers].sort((a, b) => Math.abs(b.pct ?? 0) - Math.abs(a.pct ?? 0));

  const composite = {
    type: 'mover_group',
    subtype: 'portfolio_movers',
    ticker: null,
    title: `${movers.length} positions moved 5%+`,
    detail: 'Big day across your book. Tap any ticker to dig in.',
    priority: maxPriority,
    movers: sortedMovers.map(m => ({
      ticker: m.ticker,
      pct: m.pct,
      direction: m.direction,
      title: m.title,
      link: m.link,
    })),
  };
  return [...nonMovers, composite];
}

export async function buildTodayFeed(userId, opts = {}) {
  const limit = opts.limit ?? 10;
  const moverCompositeThreshold = opts.moverCompositeThreshold ?? 3;

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
    // Big mover. Only flag if it's a meaningful chunk move. The composite
    // step below collapses 3+ of these into one card so they don't crowd
    // out other signal types on a volatile day.
    if (todayPct != null && Math.abs(todayPct) >= 5) {
      const dir = todayPct >= 0 ? 'up' : 'down';
      items.push({
        type: 'mover', subtype: 'portfolio_mover', ticker: p.ticker,
        title: `${dir} ${Math.abs(todayPct).toFixed(1)}% today`,
        detail: `Big move on one of your holdings. Check what's driving it.`,
        priority: PRIORITY.PORTFOLIO_MOVER + (Math.abs(todayPct) >= 8 ? 5 : 0),
        link: { tab: 'portfolio', ticker: p.ticker },
        pct: todayPct,           // signed, for compositing sort + rendering
        direction: dir,
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

  // ── Sector heat: top heating sector from cache, framed for the regime ──
  // Intraday signal: only shown if the radar was generated today, never stale.
  if (sectorRaw?.result && cacheFreshness('intraday', sectorRaw.created_at).show) {
    try {
      const sector = JSON.parse(sectorRaw.result);
      const top = (sector.heating || [])[0];
      const heat = frameSectorHeat(top, getMarketData().regime);
      if (heat) {
        items.push({
          type: 'heat', subtype: 'sector', ticker: top.ticker || 'SECTOR',
          title: heat.title,
          detail: heat.detail,
          priority: PRIORITY.SECTOR_HEAT + heat.priorityBonus,
          link: { tab: 'home', card: 'sector-radar' },
        });
      }
    } catch {}
  }

  // ── Bargain pick: top buyable that user doesn't already hold ────────────
  // Daily signal: the nightly scan stays valid into the next morning (up to
  // ~30h), labeled "as of last night's scan" once it is no longer same-day.
  const bargainFresh = bargainRaw?.result ? cacheFreshness('daily', bargainRaw.created_at) : { show: false, asOf: null };
  if (bargainFresh.show) {
    try {
      const bargain = JSON.parse(bargainRaw.result);
      const buyable = (bargain.candidates || []).find(b =>
        b.verdict === 'buyable' && !heldTickers.has(b.ticker)
      );
      if (buyable) {
        const asOf = bargainFresh.asOf ? ` (as of ${bargainFresh.asOf})` : '';
        items.push({
          type: 'bargain', subtype: 'pick', ticker: buyable.ticker,
          title: `Oversold, story intact`,
          detail: `${buyable.thesis || 'Down sharply on macro fear, fundamentals unchanged.'}${asOf}`,
          priority: PRIORITY.BARGAIN_PICK,
          link: { tab: 'social', section: 'bargain', ticker: buyable.ticker },
        });
      }
    } catch {}
  }

  // ── Catalyst: top stock from today's most recent drop ──────────────────
  // Surfaces the highest-conviction catalyst pick of the day. Skips anything
  // already in the user's portfolio or watchlist (they got covered above).
  // Intraday signal: only shown if the catalyst drop is from today.
  if (catalystRaw?.result && cacheFreshness('intraday', catalystRaw.created_at).show) {
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

  // ── Composite movers ────────────────────────────────────────────────────
  // When 3+ portfolio movers landed in items, collapse them into ONE
  // mover_group card so they don't eat every TODAY slot with boilerplate
  // copy. Below the threshold, keep them as individual cards.
  const composited = compositeMovers(items, moverCompositeThreshold);

  // ── Sort + cap ──────────────────────────────────────────────────────────
  composited.sort((a, b) => b.priority - a.priority);
  let final = composited.slice(0, limit);

  // Quiet-day fallback — better than padding with broad-market noise.
  if (final.length === 0) {
    final = [{
      type: 'quiet', subtype: 'no_signals', ticker: null,
      title: 'Nothing urgent on your book today',
      detail: 'No alerts, big movers, catalysts, or watchlist hits in your universe. A quiet day is also useful information.',
      priority: 0,
      link: { tab: 'home' },
    }];
  }

  return {
    items: final,
    generatedAt: new Date().toISOString(),
  };
}
