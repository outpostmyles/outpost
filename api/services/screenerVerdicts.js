// Pure fail-closed merge for a custom screener run. Given the enriched
// candidates and Claude's vetting verdicts, keep ONLY the candidates Claude
// explicitly confirmed fit the user's query (fits === true) AND wrote a reason
// for. Everything else is dropped, never shown as a vetted pick.
//
// Same principle as Bargain Radar: a screener the user trusts must surface five
// real fits over fifteen loose ones. If Claude's vetting did not produce usable
// verdicts at all (call failed, unparseable), we surface NOTHING rather than a
// wall of unvetted names. Pure and dependency-free so the fail-closed behavior
// is unit-testable without calling Claude.
export function applyScreenerVerdicts(candidates, parsed) {
  const verdicts = parsed && Array.isArray(parsed.results) ? parsed.results
    : (Array.isArray(parsed) ? parsed : null);
  if (!verdicts) return [];

  const byTicker = {};
  for (const v of verdicts) {
    if (v && v.ticker) byTicker[String(v.ticker).toUpperCase()] = v;
  }

  const out = [];
  for (const c of (Array.isArray(candidates) ? candidates : [])) {
    const v = byTicker[String(c?.ticker || '').toUpperCase()];
    if (!v || v.fits !== true) continue;          // unconfirmed -> drop
    const thesis = v.thesis && String(v.thesis).trim();
    if (!thesis) continue;                          // no reason -> drop
    out.push({ ...c, thesis });
  }
  return out;
}
