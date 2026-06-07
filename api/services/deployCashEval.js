// Deploy Cash QUALITY eval. The existing audit (tests/_deploy_cash_audit.mjs)
// proves the safety RULES hold across the filter matrix. This grades how GOOD the
// recommendation is for each goal + horizon, so the founder can see where the
// response is weak (by goal, by horizon, the worst cells) and fix the prompt
// there, instead of spot-checking by hand.
//
// Pure: the rubric, the prompt builder, the grade parser, and the matrix rollup.
// The Claude call and the live-backend matrix run live in tests/_deploy_cash_eval.mjs
// (a founder tool) which imports these. FOUNDER-ONLY, never shown to a user.

export const DEPLOY_CASH_RUBRIC = `You grade a "deploy my cash" recommendation from a retail investing app. The user picked a GOAL, a TIME HORIZON, and an amount; the app returned 2-3 options. Grade how GOOD the response is for THAT user and THOSE settings. Be strict and honest.

Score each rule pass=1 / fail=0:
1. FILTER_FIT: the options match the goal + horizon (preserve -> income/fixed-income/cash; aggressive -> growth; money needed this year -> cash-equivalents only). A clear mismatch is an automatic fail.
2. CONTEXT_AWARE: the options account for what the user already holds (does not pile into an already-large position, uses their book when relevant).
3. SPECIFIC: each option explains why THIS instrument for THIS person, not generic boilerplate that would fit anyone.
4. SIZED_SENSIBLY: the dollar sizing fits the amount and the concentration caps, and deploys most of the cash or says plainly why it holds some back.
5. CALM_CLEAR: plain English, calm advisor voice, no hype, no jargon dumped without explanation.
6. HONEST: no guarantees or overpromising, and it stays framed as education, not a directive to buy.

Respond with ONLY valid JSON:
{"scores":{"FILTER_FIT":0|1,"CONTEXT_AWARE":0|1,"SPECIFIC":0|1,"SIZED_SENSIBLY":0|1,"CALM_CLEAR":0|1,"HONEST":0|1},"overall":0-100,"failures":["short reason per failed rule"],"notes":"one short overall note"}`;

const HORIZON_LABEL = { this_year: 'needs the money this year', '1to5': '1 to 5 years', '5plus': '5+ years', never: 'no specific timeline' };
const GOAL_LABEL = { preserve: 'preserve capital', build_steadily: 'build steadily', grow_aggressively: 'grow aggressively', open: 'open to ideas' };

/** Build the grader's user message for one case. Pure + deterministic. */
export function buildDeployCashGradePrompt({ amount, goal, horizon, portfolio = [], options = [] }) {
  const book = (Array.isArray(portfolio) && portfolio.length)
    ? portfolio.map(p => `${p.ticker} (~$${Math.round(p.value || 0)})`).join(', ')
    : '(empty portfolio)';
  const opts = (Array.isArray(options) ? options : []).map((o, i) =>
    `${i + 1}. ${o.ticker || '?'} - ${o.title || ''} - deploy $${Math.round(o.estimated_cost || 0)}\n   ${o.action_summary || o.rationale || ''}`
  ).join('\n');
  return [
    `User wants to deploy $${amount}.`,
    `Goal: ${GOAL_LABEL[goal] || goal}. Horizon: ${HORIZON_LABEL[horizon] || horizon}.`,
    `Current book: ${book}.`,
    '',
    'The app returned these options:',
    opts || '(no options returned)',
    '',
    'Grade this response now. Return ONLY the JSON.',
  ].join('\n');
}

/** Parse the grader JSON. Fail closed: junk or an out-of-range score returns null
 *  (a missing grade, never a fake one). */
export function parseDeployCashGrade(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o; try { o = JSON.parse(m[0]); } catch { return null; }
  const overall = Number(o?.overall);
  if (!Number.isFinite(overall) || overall < 0 || overall > 100) return null;
  return {
    overall: Math.round(overall),
    scores: (o && typeof o.scores === 'object' && o.scores) ? o.scores : {},
    failures: Array.isArray(o?.failures) ? o.failures.map(String) : [],
    notes: String(o?.notes || '').slice(0, 240),
  };
}

/**
 * Roll per-cell results into a founder-readable matrix summary. A cell is
 * { label, goal, horizon, safetyOk, quality } where quality is parseDeployCashGrade
 * output or null. A cell "passes" only when it is BOTH safe and high quality, so
 * the pass rate never rewards a polished-but-unsafe answer. Pure.
 */
export function summarizeDeployCashEval(cells, { qualityThreshold = 80 } = {}) {
  const list = (Array.isArray(cells) ? cells : []).filter(Boolean);
  const graded = list.filter(c => c.quality && Number.isFinite(c.quality.overall));
  const avgScore = graded.length
    ? Math.round(graded.reduce((s, c) => s + c.quality.overall, 0) / graded.length)
    : null;
  const passing = list.filter(c => c.safetyOk !== false && c.quality && c.quality.overall >= qualityThreshold);
  const passRate = list.length ? Math.round((passing.length / list.length) * 100) : 0;

  const byKey = (key) => {
    const m = {};
    for (const c of graded) { (m[c[key] || 'unknown'] ||= []).push(c.quality.overall); }
    return Object.fromEntries(Object.entries(m).map(([k, a]) => [k, Math.round(a.reduce((s, n) => s + n, 0) / a.length)]));
  };

  const weakest = [...graded]
    .sort((a, b) => a.quality.overall - b.quality.overall)
    .slice(0, 3)
    .map(c => ({ label: c.label, overall: c.quality.overall, notes: c.quality.notes }));

  return {
    total: list.length,
    graded: graded.length,
    avgScore,
    passRate,
    byGoal: byKey('goal'),
    byHorizon: byKey('horizon'),
    weakest,
    unsafe: list.filter(c => c.safetyOk === false).map(c => c.label),
  };
}
