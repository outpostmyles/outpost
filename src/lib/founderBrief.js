// The founder "open sheet": compile the internal data (decision intelligence, AI
// cost, AI quality) into ONE plain-text block the founder can copy or screenshot
// and hand straight to Claude, plus an auto-generated recommendations list that
// turns the numbers into "here is what to fix next". Pure and testable; the IO
// layer gathers the inputs. FOUNDER-ONLY, never shown to a user.

const r2 = (n) => (Number.isFinite(n) ? n : 0).toFixed(2);
const money = (n) => { const v = Number(n) || 0; return v === 0 ? '$0' : v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`; };
const topKey = (m) => { let best = null, n = -1; for (const [k, v] of m) if (v > n) { n = v; best = k; } return best; };

/**
 * Aggregate raw ai_response_log rows (grader output) into a per-feature quality
 * picture: average score, how many were flagged, and the dominant failure tag.
 * Pure so it can be unit tested.
 */
export function summarizeQuality(rows, { flagThreshold = 70 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const feat = new Map();
  const failTally = new Map();
  let graded = 0, flagged = 0;
  for (const row of list) {
    if (row?.score == null) continue; // Number(null) is 0, not NaN, so guard explicitly
    const score = Number(row.score);
    if (!Number.isFinite(score)) continue;
    graded++;
    const isFlagged = score < flagThreshold;
    if (isFlagged) flagged++;
    const f = row.feature || 'unknown';
    let e = feat.get(f);
    if (!e) { e = { feature: f, count: 0, scoreSum: 0, flagged: 0, fails: new Map() }; feat.set(f, e); }
    e.count++; e.scoreSum += score; if (isFlagged) e.flagged++;
    for (const raw of Array.isArray(row.failures) ? row.failures : []) {
      // The grader stores each failure as "TAG: long explanation". Keep just the
      // TAG so the tally aggregates and the brief stays readable.
      const tag = String(raw).split(':')[0].trim().slice(0, 40);
      if (!tag) continue;
      failTally.set(tag, (failTally.get(tag) || 0) + 1);
      e.fails.set(tag, (e.fails.get(tag) || 0) + 1);
    }
  }
  const byFeature = [...feat.values()]
    .map(e => ({ feature: e.feature, count: e.count, avgScore: e.count ? Math.round(e.scoreSum / e.count) : null, flagged: e.flagged, topFailure: topKey(e.fails) }))
    .sort((a, b) => (a.avgScore ?? 101) - (b.avgScore ?? 101)); // worst first
  const topFailures = [...failTally.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  return { graded, flagged, flaggedPct: graded ? Math.round((flagged / graded) * 100) : 0, byFeature, topFailures };
}

// The recommendations layer: turn the data into a short list of concrete next
// moves. This is the part the founder hands to Claude.
function recommendations({ intel, usage, quality }) {
  const recs = [];
  // The feature producing the most bad outputs is the one to fix first, whether or
  // not its average is low (a high-average surface can still flag a lot).
  const worst = [...(quality?.byFeature || [])].filter(f => f.flagged > 0).sort((a, b) => b.flagged - a.flagged)[0];
  if (worst && worst.flagged >= 3) recs.push(`${worst.feature} has the most flagged outputs (${worst.flagged} of ${worst.count}, avg ${worst.avgScore}${worst.topFailure ? `, mostly ${worst.topFailure}` : ''}). Worth a prompt review.`);

  const topCost = (usage?.byFeature || [])[0];
  const total = usage?.totals?.lastWindow?.cost || 0;
  if (topCost && total > 0) {
    const share = Math.round((topCost.cost / total) * 100);
    recs.push(`${topCost.feature} is ${share}% of AI spend (${money(topCost.cost)} in ${usage.windowDays || 30}d)${share >= 50 ? '. Consider routing more of it to Haiku or batching the non-urgent calls.' : '.'}`);
  }
  if ((usage?.projectedMonthly || 0) >= 50) recs.push(`Projected AI run-rate is about $${Math.round(usage.projectedMonthly)} per month. Keep an eye on the top feature above.`);

  const pat = (intel?.behavior?.patterns || [])[0];
  if (pat) recs.push(`${pat.pctOfUsers}% of users show "${pat.label}". A nudge in the daily round could move the decision-quality index.`);

  if ((quality?.flaggedPct || 0) >= 15) recs.push(`${quality.flaggedPct}% of graded outputs are flagged. The grounding rule should help; recheck after a few days of fresh data.`);

  if (!recs.length) recs.push('Nothing urgent. Metrics look healthy for the window.');
  return recs;
}

/**
 * Compose the full plain-text brief.
 * @param inputs { intel, usage, quality, engagement, generatedAt }
 * @returns { text, recommendations }
 */
export function buildFounderBrief({ intel, usage, quality, engagement, generatedAt = '' } = {}) {
  const recs = recommendations({ intel, usage, quality });
  const L = [];
  L.push(`OUTPOST FOUNDER BRIEF${generatedAt ? `  (generated ${generatedAt})` : ''}`);
  L.push(`30-day window unless noted. Internal data, paste this to Claude.`);

  // Decision intelligence
  L.push('');
  L.push('== DECISION INTELLIGENCE ==');
  if (!intel || !intel.totalDecisions) {
    L.push('No decisions captured yet.');
  } else {
    L.push(`Decisions: ${intel.totalDecisions} across ${intel.behavior?.totalUsers ?? 0} users | tickers seen: ${intel.tickersTracked ?? 0}`);
    if (intel.quality?.avgIndex != null) L.push(`Decision quality index: ${intel.quality.avgIndex}/100 (scored ${intel.quality.scored} users)`);
    if (intel.adviceLift?.lift != null) L.push(`Advice lift: ${intel.adviceLift.lift >= 0 ? '+' : ''}${intel.adviceLift.lift} pts (advised ${intel.adviceLift.advised?.winRate}% vs self ${intel.adviceLift.selfDirected?.winRate}%)`);
    for (const p of (intel.behavior?.patterns || []).slice(0, 3)) L.push(`Habit: ${p.label}, ${p.pctOfUsers}% of users`);
    const traps = (intel.retailTraps || []).slice(0, 5).map(t => `${t.ticker} ${t.retailWinRate}%`).join(', ');
    if (traps) L.push(`Retail traps (win rate): ${traps}`);
  }

  // AI cost
  L.push('');
  L.push('== AI COST (Claude) ==');
  if (!usage || !usage.totals?.lastWindow?.calls) {
    L.push('No usage captured yet (run migration 019 if this stays empty).');
  } else {
    L.push(`24h: ${money(usage.totals.last24h?.cost)} (${usage.totals.last24h?.calls} calls) | 7d: ${money(usage.totals.last7d?.cost)} | 30d: ${money(usage.totals.lastWindow?.cost)}`);
    L.push(`Projected monthly: $${r2(usage.projectedMonthly)}`);
    const feats = (usage.byFeature || []).slice(0, 6).map(f => `${f.feature} ${money(f.cost)}`).join(', ');
    if (feats) L.push(`By feature: ${feats}`);
    const models = (usage.byModel || []).map(m => `${m.tier} ${money(m.cost)}`).join(', ');
    if (models) L.push(`By model: ${models}`);
  }

  // AI quality (grader)
  L.push('');
  L.push('== AI QUALITY (grader) ==');
  if (!quality || !quality.graded) {
    L.push('No graded outputs yet.');
  } else {
    L.push(`Graded: ${quality.graded} | flagged under 70: ${quality.flagged} (${quality.flaggedPct}%)`);
    for (const f of (quality.byFeature || []).slice(0, 6)) {
      L.push(`${f.feature}: ${f.avgScore ?? '?'} avg, ${f.flagged} flagged${f.topFailure ? `, top issue ${f.topFailure}` : ''}`);
    }
    const fails = (quality.topFailures || []).slice(0, 5).map(t => `${t.tag} (${t.count})`).join(', ');
    if (fails) L.push(`Top failure modes: ${fails}`);
  }

  // Engagement
  if (engagement) {
    L.push('');
    L.push('== ENGAGEMENT ==');
    L.push(`Users: ${engagement.totalUsers ?? 0} total, ${engagement.active7d ?? 0} active 7d | agent messages: ${engagement.agentMessages ?? 0}`);
  }

  // Recommendations
  L.push('');
  L.push('== RECOMMENDATIONS ==');
  recs.forEach((r, i) => L.push(`${i + 1}. ${r}`));

  return { text: L.join('\n'), recommendations: recs };
}
