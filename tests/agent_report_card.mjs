// Pins the founder Report Card synthesis: the overall status grade, the
// per-vital state bands, sample-size honesty (no grading on noise), the
// recent-window preference, and the headline branches. Pure, no IO.
import { buildAgentReportCard } from '../src/lib/agentReportCard.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg || 'eq'}: expected ${B}, got ${A}`);
}
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }
const vital = (card, key) => card.vitals.find(v => v.key === key);

test('empty signals grade as too-early, all vitals none', () => {
  const c = buildAgentReportCard({});
  eq(c.status, 'thin', 'status');
  eq(c.statusLabel, 'Too early to grade', 'label');
  for (const v of c.vitals) eq(v.state, 'none', `${v.key} none`);
  ok(/wired/.test(c.headline), 'thin headline mentions instruments wired');
  eq(c.topAction, null, 'no action');
});

test('pre-beta with no signal stays thin even with zero errors', () => {
  eq(buildAgentReportCard({ totalUsers: 4, errors7d: 0 }).status, 'thin', 'status');
});

test('all good grades healthy with good vitals', () => {
  const c = buildAgentReportCard({
    totalUsers: 40, active7d: 20,
    approvalRate7d: 82, thumbsUp7d: 9, thumbsDown7d: 2,
    qualityTrend: { graded: 30, flaggedPct: 6, recent: { graded: 20, flaggedPct: 5 } },
    adviceLift: { lift: 4, advised: { n: 8 }, selfDirected: { n: 9 } },
    projectedMonthly: 22, cost7d: 5.12, errors7d: 0,
  });
  eq(c.status, 'healthy', 'status');
  eq(vital(c, 'landed').state, 'good', 'landed');
  eq(vital(c, 'accurate').state, 'good', 'accurate');
  eq(vital(c, 'helping').state, 'good', 'helping');
  eq(vital(c, 'cost').state, 'good', 'cost');
  eq(vital(c, 'accurate').value, '95% clean', 'clean value');
});

test('high flag rate grades attention and names accuracy', () => {
  const c = buildAgentReportCard({
    totalUsers: 40,
    qualityTrend: { graded: 30, flaggedPct: 40, recent: { graded: 20, flaggedPct: 40 } },
  });
  eq(vital(c, 'accurate').state, 'bad', 'accurate bad');
  eq(c.status, 'attention', 'status');
  ok(/Accuracy slipped/.test(c.headline), 'headline names accuracy');
});

test('negative advice lift grades attention and bad', () => {
  const c = buildAgentReportCard({
    totalUsers: 40,
    adviceLift: { lift: -6, advised: { n: 7 }, selfDirected: { n: 8 } },
  });
  eq(vital(c, 'helping').state, 'bad', 'helping bad');
  eq(c.status, 'attention', 'status');
});

test('elevated errors grade attention even with no AI signal', () => {
  const c = buildAgentReportCard({ totalUsers: 40, errors7d: 12 });
  eq(c.status, 'attention', 'status');
  ok(/Errors are elevated/.test(c.headline), 'headline names errors');
});

test('mid approval grades watch', () => {
  const c = buildAgentReportCard({ totalUsers: 40, approvalRate7d: 58, thumbsUp7d: 7, thumbsDown7d: 5 });
  eq(vital(c, 'landed').state, 'warn', 'landed warn');
  eq(c.status, 'watch', 'status');
});

test('a single error nudges an otherwise-clean week to watch', () => {
  const c = buildAgentReportCard({
    totalUsers: 40, errors7d: 1,
    qualityTrend: { graded: 20, flaggedPct: 0, recent: { graded: 20, flaggedPct: 0 } },
  });
  eq(c.status, 'watch', 'status');
});

test('fewer than 5 thumbs leaves landed ungraded', () => {
  const c = buildAgentReportCard({
    totalUsers: 40, approvalRate7d: 100, thumbsUp7d: 3, thumbsDown7d: 0,
    qualityTrend: { graded: 20, flaggedPct: 0, recent: { graded: 20, flaggedPct: 0 } },
  });
  eq(vital(c, 'landed').state, 'none', 'landed none');
  ok(/needed/.test(vital(c, 'landed').sub), 'sub explains threshold');
});

test('fewer than 10 resolved leaves lift ungraded', () => {
  const c = buildAgentReportCard({ totalUsers: 40, adviceLift: { lift: 9, advised: { n: 3 }, selfDirected: { n: 4 } } });
  eq(vital(c, 'helping').state, 'none', 'helping none');
});

test('fewer than 10 graded leaves accuracy ungraded', () => {
  const c = buildAgentReportCard({ totalUsers: 40, qualityTrend: { graded: 6, flaggedPct: 0, recent: { graded: 6, flaggedPct: 0 } } });
  eq(vital(c, 'accurate').state, 'none', 'accurate none');
});

test('high projected cost grades cost warn and bumps to watch', () => {
  const c = buildAgentReportCard({ totalUsers: 40, projectedMonthly: 150, cost7d: 34 });
  eq(vital(c, 'cost').state, 'warn', 'cost warn');
  eq(c.status, 'watch', 'status');
});

test('top observation surfaces as the action, trimmed', () => {
  const c = buildAgentReportCard({ totalUsers: 40, topObservation: '  Look at the deploy_cash prompt.  ' });
  eq(c.topAction, 'Look at the deploy_cash prompt.', 'trimmed action');
});

test('non-string observation is ignored', () => {
  eq(buildAgentReportCard({ totalUsers: 40, topObservation: 123 }).topAction, null, 'null action');
});

test('recent window is preferred over the whole window for flag rate', () => {
  const c = buildAgentReportCard({ totalUsers: 40, qualityTrend: { graded: 100, flaggedPct: 30, recent: { graded: 12, flaggedPct: 0 } } });
  eq(vital(c, 'accurate').state, 'good', 'uses recent window');
  eq(vital(c, 'accurate').value, '100% clean', 'recent clean');
});

test('garbage inputs never throw and always return four vitals', () => {
  for (const bad of [null, undefined, { approvalRate7d: 'x', qualityTrend: 'no', adviceLift: 7 }, { thumbsUp7d: NaN }]) {
    const c = buildAgentReportCard(bad);
    ok(c && Array.isArray(c.vitals) && c.vitals.length === 4, 'returns 4 vitals');
  }
});

let pass = 0, fail = 0;
for (const { n, f } of tests) {
  try { f(); console.log(`ok   ${n}`); pass++; }
  catch (e) { console.log(`FAIL ${n}: ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
