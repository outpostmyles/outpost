// Pure ranking logic for the Social → Discover feed.
//
// Before this, the Discover view stacked 4 separate sections (catalysts,
// hot sectors, bargains, trending). At first glance it was a wall of text
// and users had to scan through 4 categorical groupings to find what was
// interesting. Now we merge all four sources into one ranked list ordered
// by signal strength so the most-actionable thing is always on top.
//
// Pattern matches the TODAY card on Home: one column, type badges, type-
// colored accents, taps deep-link to the source's full view.
//
// Pure function so it's unit-testable without spinning up React or hitting
// supabase. Inputs are already-fetched data objects from the existing APIs.

const PRIORITY = {
  CATALYST_HIGH:   100,  // freshly dropped catalyst with flame rating >= 2
  SECTOR_STRONG:    85,  // sector heat with signal === 'strong'
  CATALYST_LOW:     80,  // dropped catalyst with flame rating 1
  BARGAIN:          70,
  SECTOR_EARLY:     60,  // signal === 'early' / 'warning'
  TRENDING:         40,
};

/**
 * Merge all source data into one ranked list of discover items.
 * Returns up to `limit` items, sorted by priority desc.
 *
 * Each item has the shape:
 *   {
 *     id:        stable per render so React can key on it
 *     type:      'catalyst' | 'sector' | 'bargain' | 'trending'
 *     ticker:    string | null
 *     title:     short headline (e.g. "AAPL +3.2%" or "Energy heating up")
 *     detail:    one-line body, optional
 *     accent:    'orange' | 'amber' | 'green' | 'blue' for the left bar
 *     signal:    short label rendered as a pill (CATALYST, STRONG, BUYABLE...)
 *     pct:       signed percent number for color/sign rendering when applicable
 *     deepLink:  which "see all" tab to route to ('ondeck' | 'radar' | 'bargain' | 'buzz')
 *     priority:  computed score (used only for sorting, not displayed)
 *   }
 */
export function buildDiscoverFeed(input, limit = 10) {
  const { catalystData, sector, bargain, buzz } = input || {};
  const items = [];

  // ─── Catalysts ──────────────────────────────────────────────────────────
  // Drops are time-ordered drops with .stocks lists. Each stock has changePct,
  // catalystLabel, detail, flameRating (1-3). The dropTime / dropLabel let us
  // surface "fresh from the 9:15am drop" context.
  const catalysts = [];
  for (const drop of (catalystData?.drops ?? [])) {
    for (const s of (drop.stocks ?? [])) {
      if (!s?.ticker) continue;
      const flame = Math.max(1, Math.min(3, s.flameRating || 1));
      catalysts.push({
        ticker: s.ticker,
        changePct: s.changePct,
        catalystLabel: s.catalystLabel,
        detail: s.detail || s.newsSource || null,
        dropTime: drop.scheduledTime,
        dropLabel: drop.label,
        flame,
      });
    }
  }
  // Rank within the catalyst pool by absolute % move so the biggest landings
  // surface first. Take the top few; below that gets buried.
  catalysts.sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));
  for (const c of catalysts.slice(0, 5)) {
    items.push({
      id: `catalyst:${c.ticker}:${c.dropTime || 'na'}`,
      type: 'catalyst',
      ticker: c.ticker,
      title: c.catalystLabel ? c.catalystLabel.toLowerCase() : 'catalyst',
      detail: c.detail || `Big move on ${c.ticker} flagged in the ${c.dropLabel || 'latest'} drop.`,
      accent: 'orange',
      signal: 'CATALYST',
      pct: c.changePct,
      meta: { dropTime: c.dropTime, flame: c.flame },
      deepLink: 'ondeck',
      priority: c.flame >= 2 ? PRIORITY.CATALYST_HIGH : PRIORITY.CATALYST_LOW,
    });
  }

  // ─── Hot Sectors ────────────────────────────────────────────────────────
  // Heating sectors rank higher than cooling because they answer "where is
  // money rotating in." Cooling sectors are useful but less actionable for
  // a buy-side discovery surface.
  for (const s of (sector?.heating ?? []).slice(0, 3)) {
    const strong = s.signal === 'strong';
    items.push({
      id: `sector_up:${s.ticker || s.name}`,
      type: 'sector',
      ticker: s.ticker || null,
      title: `${s.name || s.ticker} heating up`,
      detail: s.thesis || 'Money rotating in based on multi-day flow signals.',
      accent: 'green',
      signal: (s.signal || 'signal').toUpperCase(),
      pct: s.relativeStrength,
      meta: { direction: 'up' },
      deepLink: 'radar',
      priority: strong ? PRIORITY.SECTOR_STRONG : PRIORITY.SECTOR_EARLY,
    });
  }
  for (const s of (sector?.cooling ?? []).slice(0, 2)) {
    items.push({
      id: `sector_down:${s.ticker || s.name}`,
      type: 'sector',
      ticker: s.ticker || null,
      title: `${s.name || s.ticker} cooling`,
      detail: s.thesis || 'Money rotating out based on multi-day flow signals.',
      accent: 'red',
      signal: (s.signal || 'signal').toUpperCase(),
      pct: s.relativeStrength,
      meta: { direction: 'down' },
      deepLink: 'radar',
      priority: PRIORITY.SECTOR_EARLY,
    });
  }

  // ─── Bargain Picks ──────────────────────────────────────────────────────
  for (const b of (bargain?.picks ?? []).slice(0, 4)) {
    items.push({
      id: `bargain:${b.ticker}`,
      type: 'bargain',
      ticker: b.ticker,
      title: 'oversold, story intact',
      detail: b.thesis || `Down sharply on macro fear, fundamentals unchanged.`,
      accent: 'green',
      signal: 'BUYABLE',
      pct: b.pctOffHigh != null ? -b.pctOffHigh : null,  // negative for drawdown
      meta: {},
      deepLink: 'bargain',
      priority: PRIORITY.BARGAIN,
    });
  }

  // ─── Trending (compact, footer-style) ───────────────────────────────────
  // Less actionable than the above three because it's social-volume noise,
  // not fundamental signal. Surfaced last and rendered compactly.
  for (const t of (buzz?.buzzing ?? []).slice(0, 6)) {
    items.push({
      id: `trending:${t.ticker}`,
      type: 'trending',
      ticker: t.ticker,
      title: 'trending',
      detail: t.watchlistCount != null
        ? `${t.watchlistCount.toLocaleString()} watchers added recently.`
        : 'Lots of attention on this name right now.',
      accent: 'blue',
      signal: 'BUZZ',
      pct: t.changePct,
      meta: { watchers: t.watchlistCount },
      deepLink: 'buzz',
      priority: PRIORITY.TRENDING,
    });
  }

  // ─── Sort + cap ─────────────────────────────────────────────────────────
  items.sort((a, b) => b.priority - a.priority);
  return items.slice(0, limit);
}

/**
 * Turn a discover-feed item into a question for the agent. This is the tap-to-
 * ask bridge: a Discover row stops being a dead-end read and becomes a one-tap
 * conversation about that exact thing, grounded in the user's own book. Pure.
 */
export function discoverAskPrompt(item) {
  if (!item) return '';
  const t = item.ticker ? String(item.ticker).toUpperCase() : null;
  switch (item.type) {
    case 'catalyst':
      return t
        ? `${t} is moving on a catalyst today. What's driving it, and does it change anything for how I should think about it?`
        : `What's driving the catalysts moving the market today, and is any of it relevant to me?`;
    case 'sector':
      return `${item.title || 'This sector'} is on the radar. Should I have exposure there, and how would it fit my current book?`;
    case 'bargain':
      return t
        ? `Is ${t} a real buyable dip here, or a falling knife? Walk me through the setup and the risk.`
        : `Walk me through the strongest buyable dip on the radar right now and whether it fits me.`;
    case 'trending':
      return t
        ? `${t} is getting a lot of attention right now. Is there anything real behind it, or is it just noise?`
        : `What's trending right now, and is any of it actually worth my attention?`;
    default:
      return t
        ? `Tell me what's going on with ${t} and whether it's relevant to my portfolio.`
        : `What's worth my attention in the market right now?`;
  }
}
