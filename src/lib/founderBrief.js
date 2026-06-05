// The founder "open sheet". One plain-text block the founder copies to Claude.
// Its only job is to answer two questions: what should we change about Outpost
// next, and did the last change work. Every number that does not move one of
// those is left out.
//
// Two rules, baked in:
//  1. Honest about data sufficiency. Each number carries its sample, thin or
//     seeded data is flagged, and a pre-beta banner warns when there are barely
//     any real users, so we never act on noise.
//  2. Observation only. Nothing here is applied automatically or shown to a user.
//     It is a dashboard and a notepad, not an actor.
//
// Pure and testable; the IO layer gathers the inputs. FOUNDER-ONLY.

const r2 = (n) => (Number.isFinite(n) ? n : 0).toFixed(2);
const money = (n) => { const v = Number(n) || 0; return v === 0 ? '$0' : v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`; };
const topKey = (m) => { let best = null, n = -1; for (const [k, v] of m) if (v > n) { n = v; best = k; } return best; };
const PRE_BETA_USERS = 25; // below this many real accounts, the data is a wiring check, not signal
const conf = (n, thin, ok) => (n < thin ? 'none' : n < ok ? 'thin' : 'ok');

/**
 * Roll grader rows (ai_response_log) into a per-feature quality picture: average
 * score, flagged count, dominant failure tag (the grader stores "TAG: long
 * explanation", so we keep just the TAG to aggregate). Pure.
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
      const tag = String(raw).split(':')[0].trim().slice(0, 40);
      if (!tag) continue;
      failTally.set(tag, (failTally.get(tag) || 0) + 1);
      e.fails.set(tag, (e.fails.get(tag) || 0) + 1);
    }
  }
  const byFeature = [...feat.values()]
    .map(e => ({ feature: e.feature, count: e.count, avgScore: e.count ? Math.round(e.scoreSum / e.count) : null, flagged: e.flagged, topFailure: topKey(e.fails) }))
    .sort((a, b) => (a.avgScore ?? 101) - (b.avgScore ?? 101));
  const topFailures = [...failTally.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  return { graded, flagged, flaggedPct: graded ? Math.round((flagged / graded) * 100) : 0, byFeature, topFailures };
}

/**
 * The quality picture plus a window-over-window flag-rate trend, so we can see
 * whether a fix actually lowered the flag rate (the "did our change work" loop).
 * recent = last windowDays, prior = the rest of the rows passed in. Pure.
 */
export function buildQualityTrend(rows, { now = 0, windowDays = 7, flagThreshold = 70 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const cutoff = now - windowDays * 86400000;
  const recent = [], prior = [];
  for (const r of list) {
    const t = Date.parse(r?.created_at);
    if (!Number.isFinite(t)) continue;
    (t >= cutoff ? recent : prior).push(r);
  }
  const overall = summarizeQuality(list, { flagThreshold });
  const rq = summarizeQuality(recent, { flagThreshold });
  const pq = summarizeQuality(prior, { flagThreshold });
  return {
    ...overall,
    recent: { graded: rq.graded, flaggedPct: rq.flaggedPct },
    prior: { graded: pq.graded, flaggedPct: pq.flaggedPct },
    flagRateDelta: (rq.graded && pq.graded) ? rq.flaggedPct - pq.flaggedPct : null,
  };
}

// The "what to look at" list: neutral notes for the founder, gated by confidence
// so we never recommend acting on noise. Never imperative about the app itself.
function observations({ intel, usage, q, preBeta }) {
  const obs = [];
  if (preBeta) obs.push('Everything above is thin or seeded. The single highest-value thing right now is real beta users; the brief is wired and ready to read them.');

  if ((q.graded ?? 0) >= 10) {
    const worst = (q.byFeature || []).filter(f => f.flagged >= 3).sort((a, b) => b.flagged - a.flagged)[0];
    if (worst) {
      const note = q.flagRateDelta != null && q.flagRateDelta <= -3
        ? 'The recent flag rate is falling, so a fix may already be landing; confirm over the next few days.'
        : 'Worth a look at that prompt.';
      obs.push(`${worst.feature} produces the most flagged output (${worst.flagged}, mostly ${worst.topFailure || 'mixed'}). ${note}`);
    }
  }

  const lift = intel?.adviceLift;
  const liftN = (lift?.advised?.n ?? 0) + (lift?.selfDirected?.n ?? 0);
  if (liftN < 10) obs.push('Advice lift is the make or break metric and it is still too thin to read. At beta, watch it first. If it is not clearly positive, the AI recommendations need rethinking before we lean on them.');

  const pat = (intel?.behavior?.patterns || [])[0];
  if (pat) obs.push(`${pat.pctOfUsers}% of users show "${pat.label}". If that holds with real users, the sharpest intervention against it is the highest-leverage thing to build.`);

  if ((usage?.projectedMonthly ?? 0) >= 50) obs.push(`AI run-rate is about $${Math.round(usage.projectedMonthly)} per month. If that climbs at beta, route the priciest surface to a cheaper model or batch it.`);

  obs.push('Reminder: this is a notepad, not an actor. Nothing here changes the app or reaches a user until you decide it.');
  return obs;
}

/**
 * Compose the brief.
 * @param inputs { intel, usage, qualityTrend, engagement, generatedAt }
 * @returns { text, observations }
 */
export function buildFounderBrief({ intel, usage, qualityTrend, engagement, generatedAt = '' } = {}) {
  const eng = engagement || {};
  const q = qualityTrend || {};
  const preBeta = (eng.totalUsers ?? 0) < PRE_BETA_USERS;
  const L = [];

  L.push(`OUTPOST FOUNDER BRIEF${generatedAt ? `  (generated ${generatedAt})` : ''}`);
  L.push('Internal. Nothing here is applied automatically or shown to users. You decide from it.');
  if (preBeta) {
    L.push('');
    L.push(`[PRE-BETA] Only ${eng.totalUsers ?? 0} real account${(eng.totalUsers ?? 0) === 1 ? '' : 's'}, and the data is sparse and partly seeded. Treat everything below as a wiring check, not signal, until real users arrive.`);
  }

  // 1. IS THE AI ANY GOOD?
  L.push('');
  const qLevel = conf(q.graded ?? 0, 10, 30);
  L.push(`== 1. IS THE AI ANY GOOD? ==  ${qLevel === 'none' ? '[not enough data]' : qLevel === 'thin' ? `[thin: ${q.graded} graded]` : `[${q.graded} graded]`}`);
  if (qLevel === 'none') {
    L.push('Fewer than 10 graded outputs. Nothing to read yet.');
  } else {
    L.push(`Flag rate: ${q.flaggedPct}% flagged under 70 (${q.graded} graded, 30d).`);
    if (q.flagRateDelta == null) {
      L.push('Trend: not enough recent data to compare windows yet.');
    } else {
      const d = q.flagRateDelta;
      const dir = d <= -3 ? `down ${-d} pts, the recent work may be landing` : d >= 3 ? `up ${d} pts, watch it` : 'about flat';
      L.push(`Recent 7d: ${q.recent.flaggedPct}% vs ${q.prior.flaggedPct}% before (${dir}).`);
    }
    const worst = (q.byFeature || []).filter(f => f.flagged > 0).sort((a, b) => b.flagged - a.flagged)[0];
    if (worst) L.push(`Worst surface: ${worst.feature}, ${worst.flagged} of ${worst.count} flagged${worst.topFailure ? `, mostly ${worst.topFailure}` : ''}.`);
    const fails = (q.topFailures || []).slice(0, 4).map(t => `${t.tag} (${t.count})`).join(', ');
    if (fails) L.push(`Failure modes: ${fails}.`);
  }

  // 2. IS OUTPOST HELPING?
  L.push('');
  L.push('== 2. IS OUTPOST HELPING? ==');
  const lift = intel?.adviceLift;
  const liftN = (lift?.advised?.n ?? 0) + (lift?.selfDirected?.n ?? 0);
  if (!lift || liftN < 10 || lift.lift == null) {
    L.push(`Advice lift: not enough resolved AI-sourced trades yet (have ${lift?.advised?.n ?? 0} advised, need ~10). This is the number that says whether Outpost actually helps, so it is the one to watch at beta.`);
  } else {
    L.push(`Advice lift: ${lift.lift >= 0 ? '+' : ''}${lift.lift} pts (advised ${lift.advised.winRate}% vs self ${lift.selfDirected.winRate}%, ${liftN} resolved)${conf(liftN, 10, 30) === 'thin' ? '  [thin]' : ''}.`);
  }
  if (intel?.quality?.avgIndex != null) {
    const dq = conf(intel.totalDecisions ?? 0, 50, 200);
    L.push(`Decision quality: ${intel.quality.avgIndex}/100 across ${intel.quality.scored} users${dq !== 'ok' ? `  [${dq === 'none' ? 'too thin to trust' : 'thin'}]` : ''}.`);
  } else {
    L.push('Decision quality: not enough graded decisions yet.');
  }

  // 3. WHAT DO USERS STRUGGLE WITH?
  L.push('');
  L.push('== 3. WHAT DO USERS STRUGGLE WITH? ==');
  const pats = (intel?.behavior?.patterns || []).slice(0, 2);
  if (!pats.length) L.push('No clear behavioral pattern yet (needs more decisions per user).');
  else for (const p of pats) L.push(`${p.label}, ${p.pctOfUsers}% of users.`);

  // 4. OPERATIONS
  L.push('');
  L.push('== 4. OPERATIONS ==');
  if (usage?.totals?.lastWindow?.calls) {
    const top = (usage.byFeature || [])[0];
    L.push(`AI cost: ${money(usage.totals.lastWindow.cost)} in 30d, projected ~$${r2(usage.projectedMonthly)}/mo${top ? `. Priciest: ${top.feature}` : ''}.`);
  } else {
    L.push('AI cost: nothing captured yet.');
  }
  L.push(`Errors (7d): ${eng.errors7d ?? 0}. Users: ${eng.totalUsers ?? 0} total, ${eng.active7d ?? 0} active 7d, ${eng.agentMessages ?? 0} agent messages.`);

  // WHAT TO LOOK AT
  const obs = observations({ intel, usage, q, preBeta });
  L.push('');
  L.push('== WHAT TO LOOK AT (you decide, nothing auto-applies) ==');
  obs.forEach((o, i) => L.push(`${i + 1}. ${o}`));

  return { text: L.join('\n'), observations: obs };
}
