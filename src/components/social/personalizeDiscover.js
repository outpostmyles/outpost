// Personalize the Discover feed with what we honestly know about the user:
// what they own and what they watch. Two moves:
//   - drop ideas for tickers they already hold (owning it is not discovering it)
//   - float ideas for tickers on their watchlist to the top, tagged, because a
//     watchlist entry is the user's own statement of interest
//
// Deeper "fits your trading style/edge" matching needs per-name metadata
// (sector, fundamentals, setup type) the feed does not carry yet, so we don't
// fake it. Pure so the re-ranking is unit-testable.

export function personalizeDiscover(items = [], opts) {
  const { held = [], watch = [] } = opts || {};
  const heldSet = new Set((Array.isArray(held) ? held : []).map(t => String(t).toUpperCase()));
  const watchSet = new Set((Array.isArray(watch) ? watch : []).map(t => String(t).toUpperCase()));

  const out = [];
  for (const it of (Array.isArray(items) ? items : [])) {
    if (!it) continue;
    const tk = it.ticker ? String(it.ticker).toUpperCase() : null;
    if (tk && heldSet.has(tk)) continue; // already own it: not a discovery
    const onWatch = !!(tk && watchSet.has(tk));
    out.push({ ...it, onWatch, forYou: onWatch ? 'On your watchlist' : null });
  }

  // Watchlist names float up (explicit interest); within each group the feed's
  // existing priority order is preserved.
  out.sort((a, b) => {
    if (a.onWatch !== b.onWatch) return a.onWatch ? -1 : 1;
    return (b.priority ?? 0) - (a.priority ?? 0);
  });
  return out;
}
