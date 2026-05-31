// Pure verdict-merge for Bargain Radar's Claude qualitative filter (stage 5).
//
// The radar makes users a specific promise: every name it surfaces passed a
// "real problem vs buyable dip" check by Claude. So this MUST fail closed. If
// Claude's verification did not actually produce a usable "buyable" verdict for
// a name (the call failed, timed out, returned unparseable output, or just
// skipped that ticker), the name is DROPPED, never presented as vetted.
//
// Showing an unverified pick with a confident "buyable" label is exactly the
// kind of quiet wrongness that breaks trust in an advisor product, so it is
// worth surfacing nothing over surfacing something unchecked.
//
// Kept as a pure function (no SDK, no network) so the fail-closed behavior is
// unit-testable without calling Claude.

export function applyBuyableVerdicts(candidates, parsed) {
  const verdicts = parsed && Array.isArray(parsed.verdicts) ? parsed.verdicts : null;
  // No usable verdict payload at all: surface nothing rather than a wall of
  // unvetted names dressed up as buyable dips.
  if (!verdicts) return [];

  const byTicker = {};
  for (const v of verdicts) {
    if (v && v.ticker) byTicker[String(v.ticker).toUpperCase()] = v;
  }

  const survivors = [];
  for (const c of candidates || []) {
    const v = byTicker[String(c?.ticker || '').toUpperCase()];
    if (!v) continue;                       // no verdict for this name -> drop
    if (v.verdict === 'buyable') {
      const thesis = v.thesis && String(v.thesis).trim();
      survivors.push({ ...c, verdict: 'buyable', thesis: thesis || 'Buyable dip.' });
    }
    // 'avoid' or any unrecognized verdict -> drop
  }
  return survivors;
}
