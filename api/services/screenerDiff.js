// Pure "what is new since you last looked" logic for living screeners. Given the
// previous stored results and the fresh run, decide which fresh items to flag as
// new. This is the heart of a living screen: the nightly job re-runs the query
// and a name that just showed up gets marked so the user sees what changed while
// they were away.
//
// Rules:
//   - silent=true means the user is looking RIGHT NOW (they just created the
//     screen or hit rescan themselves), so nothing is flagged: there is no "while
//     you were away" when they are right here.
//   - otherwise an item is new if it was not in the previous results, OR it was
//     already flagged new and still has not been seen. The flag is sticky across
//     runs so a name found Monday is still flagged Wednesday if the user never
//     opened the screen. Opening the screen clears it (see the /:id/seen route).
//
// Pure and dependency-free so the behavior is unit-testable without Claude or the
// database.
export function markScreenerNewcomers(prev, fresh, { silent = false } = {}) {
  const list = Array.isArray(fresh) ? fresh : [];
  if (silent) return list.map(r => ({ ...r, isNew: false }));

  const prevByTicker = new Map(
    (Array.isArray(prev) ? prev : [])
      .filter(r => r && r.ticker)
      .map(r => [String(r.ticker).toUpperCase(), r])
  );

  return list.map(r => {
    const before = prevByTicker.get(String(r?.ticker || '').toUpperCase());
    const isNew = !before ? true : before.isNew === true; // new entrant, or carried-over unseen
    return { ...r, isNew };
  });
}
