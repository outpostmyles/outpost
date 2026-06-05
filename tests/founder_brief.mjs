// Pins the founder brief (src/lib/founderBrief.js): the grader-quality rollup, the
// window-over-window flag-rate trend, and the composed block (four questions,
// confidence and sample gating so seeded data cannot fool us, observation only).
import assert from 'node:assert/strict';
import { summarizeQuality, buildQualityTrend, buildFounderBrief, graderVsReality } from '../src/lib/founderBrief.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

const NOW = Date.parse('2026-06-15T12:00:00Z');
const DAY = 86400000;
const qrow = (feature, score, ageDays, failures = []) => ({ feature, score, failures, created_at: new Date(NOW - ageDays * DAY).toISOString() });

test('summarizeQuality normalizes "TAG: explanation" so tags aggregate', () => {
  const q = summarizeQuality([
    { feature: 'analysis_quick', score: 40, failures: ['NO_INVENTED_DETAILS: a fake insider sale'] },
    { feature: 'analysis_deep', score: 55, failures: ['NO_INVENTED_DETAILS: an invented India deal'] },
  ]);
  assert.equal(q.topFailures[0].tag, 'NO_INVENTED_DETAILS');
  assert.equal(q.topFailures[0].count, 2);
  assert.equal(q.byFeature[0].topFailure, 'NO_INVENTED_DETAILS');
});

test('summarizeQuality skips null scores (Number(null) is 0, not NaN)', () => {
  assert.equal(summarizeQuality([{ feature: 'x', score: null }, { feature: 'x', score: 80 }]).graded, 1);
});

test('buildQualityTrend computes a recent-vs-prior flag rate delta', () => {
  const rows = [
    // recent 7d: 1 of 2 flagged (50%)
    qrow('s', 60, 1, ['T']), qrow('s', 90, 2),
    // prior: 1 of 4 flagged (25%)
    qrow('s', 50, 10, ['T']), qrow('s', 90, 11), qrow('s', 95, 12), qrow('s', 88, 13),
  ];
  const t = buildQualityTrend(rows, { now: NOW, windowDays: 7 });
  assert.equal(t.recent.flaggedPct, 50);
  assert.equal(t.prior.flaggedPct, 25);
  assert.equal(t.flagRateDelta, 25); // worse recently
  assert.equal(t.graded, 6); // overall still aggregates everything
});

test('buildQualityTrend leaves the delta null when a window is empty', () => {
  const t = buildQualityTrend([qrow('s', 60, 1, ['T'])], { now: NOW, windowDays: 7 });
  assert.equal(t.flagRateDelta, null); // no prior-window rows to compare
});

test('brief is observation-only and degrades gracefully with nothing', () => {
  const { text, observations } = buildFounderBrief({});
  assert.match(text, /OUTPOST FOUNDER BRIEF/);
  assert.match(text, /Nothing here is applied automatically or shown to users/);
  assert.match(text, /IS THE AI ANY GOOD\?/);
  assert.match(text, /IS OUTPOST HELPING\?/);
  assert.match(text, /WHAT DO USERS STRUGGLE WITH\?/);
  assert.match(text, /OPERATIONS/);
  assert.ok(observations.some(o => /notepad, not an actor/.test(o)));
});

test('a thin userbase trips the pre-beta banner', () => {
  const { text } = buildFounderBrief({ engagement: { totalUsers: 12 }, generatedAt: 'now' });
  assert.match(text, /\[PRE-BETA\] Only 12 real accounts/);
  assert.match(text, /wiring check, not signal/);
});

test('quality section flags thin samples and reads the trend', () => {
  const qualityTrend = buildQualityTrend([
    qrow('portfolio_synthesis', 60, 1, ['NO_FORCED_ACTION: pushed a trim']),
    qrow('portfolio_synthesis', 95, 10),
  ], { now: NOW, windowDays: 7 });
  const { text } = buildFounderBrief({ qualityTrend, engagement: { totalUsers: 100 } });
  assert.match(text, /\[thin: 2 graded\]|not enough data/); // small sample is flagged, never presented as solid
});

test('advice lift reads "not enough" until the sample is real, the make-or-break watch', () => {
  const intel = { adviceLift: { lift: 11, advised: { n: 3, winRate: 60 }, selfDirected: { n: 2, winRate: 50 } }, totalDecisions: 30, quality: { avgIndex: 40, scored: 5 }, behavior: { patterns: [] } };
  const { text, observations } = buildFounderBrief({ intel, engagement: { totalUsers: 100 } });
  assert.match(text, /Advice lift: not enough resolved AI-sourced trades/);
  assert.ok(observations.some(o => /make or break/.test(o)));
});

test('with real volume the worst surface and the top struggle drive the notes', () => {
  const qualityTrend = buildQualityTrend(
    Array.from({ length: 12 }, (_, i) => qrow('portfolio_synthesis', 60, i % 6, ['NO_FORCED_ACTION: trim push'])),
    { now: NOW, windowDays: 7 },
  );
  const intel = {
    adviceLift: { lift: 8, advised: { n: 20, winRate: 60 }, selfDirected: { n: 18, winRate: 52 } },
    totalDecisions: 300, quality: { avgIndex: 41, scored: 40 },
    behavior: { patterns: [{ key: 'hold_losers', label: 'Holding losers, cutting winners', pctOfUsers: 75 }] },
  };
  const { text, observations } = buildFounderBrief({ intel, qualityTrend, engagement: { totalUsers: 120, active7d: 60, agentMessages: 400 } });
  assert.match(text, /Advice lift: \+8 pts/);
  assert.ok(observations.some(o => /portfolio_synthesis produces the most flagged output/.test(o)));
  assert.ok(observations.some(o => /75% of users show "Holding losers/.test(o)));
});

test('graderVsReality flags the widest grader-vs-users gap first', () => {
  const byFeature = [
    { feature: 'analysis_deep', avgScore: 85 },   // users hate it: 20% approve, gap +65
    { feature: 'portfolio_synthesis', avgScore: 50 }, // users love it: 90% approve, gap -40
  ];
  const feedback = {
    analysis_deep: { up: 2, down: 8 },       // 20% of 10
    portfolio_synthesis: { up: 18, down: 2 }, // 90% of 20
  };
  const out = graderVsReality(byFeature, feedback);
  assert.equal(out.length, 2);
  assert.equal(out[0].feature, 'analysis_deep'); // biggest absolute gap leads
  assert.equal(out[0].approval, 20);
  assert.equal(out[0].gap, 65);
  assert.equal(out[1].gap, -40);
});

test('graderVsReality ignores thin feedback and missing scores', () => {
  const out = graderVsReality(
    [{ feature: 'a', avgScore: 80 }, { feature: 'b', avgScore: null }, { feature: 'c', avgScore: 70 }],
    { a: { up: 2, down: 2 }, b: { up: 10, down: 0 }, c: {} }, // a: only 4 votes, b: no score, c: no votes
  );
  assert.equal(out.length, 0);
});

test('the brief surfaces a grader-vs-users miscalibration when they disagree', () => {
  const qualityTrend = buildQualityTrend(
    Array.from({ length: 12 }, (_, i) => qrow('analysis_deep', 88, i % 6)),
    { now: NOW, windowDays: 7 },
  );
  const feedback = { analysis_deep: { up: 1, down: 9 } }; // 10% approve vs an 88 grader score
  const { observations } = buildFounderBrief({ qualityTrend, feedback, engagement: { totalUsers: 120 } });
  assert.ok(observations.some(o => /Grader vs users/.test(o) && /too easy on it/.test(o)));
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
