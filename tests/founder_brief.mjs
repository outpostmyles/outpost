// Pins the founder brief (src/lib/founderBrief.js): the grader-quality rollup and
// the composed copy-paste block with its recommendations layer.
import assert from 'node:assert/strict';
import { summarizeQuality, buildFounderBrief } from '../src/lib/founderBrief.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('summarizeQuality is empty-safe', () => {
  const q = summarizeQuality([]);
  assert.equal(q.graded, 0);
  assert.equal(q.flaggedPct, 0);
  assert.deepEqual(q.byFeature, []);
});

test('summarizeQuality aggregates per feature, worst first, with the dominant failure', () => {
  const rows = [
    { feature: 'portfolio_synthesis', score: 60, failures: ['MAGNITUDE_CALIBRATED'] },
    { feature: 'portfolio_synthesis', score: 68, failures: ['MAGNITUDE_CALIBRATED', 'NO_INVENTED_DETAILS'] },
    { feature: 'analysis_quick', score: 95, failures: [] },
    { feature: 'analysis_quick', score: 50, failures: ['NO_INVENTED_DETAILS'] },
  ];
  const q = summarizeQuality(rows, { flagThreshold: 70 });
  assert.equal(q.graded, 4);
  assert.equal(q.flagged, 3); // 60, 68, 50 are under 70
  assert.equal(q.byFeature[0].feature, 'portfolio_synthesis'); // avg 64, worse than analysis_quick avg 72
  assert.equal(q.byFeature[0].avgScore, 64);
  assert.equal(q.byFeature[0].topFailure, 'MAGNITUDE_CALIBRATED');
  assert.equal(q.topFailures[0].tag, 'MAGNITUDE_CALIBRATED'); // 2 vs others
});

test('non-numeric scores are skipped, not counted', () => {
  const q = summarizeQuality([{ feature: 'x', score: null }, { feature: 'x', score: 80, failures: [] }]);
  assert.equal(q.graded, 1);
});

test('buildFounderBrief degrades gracefully with no data', () => {
  const { text, recommendations } = buildFounderBrief({});
  assert.match(text, /OUTPOST FOUNDER BRIEF/);
  assert.match(text, /No decisions captured yet/);
  assert.match(text, /No usage captured yet/);
  assert.match(text, /No graded outputs yet/);
  assert.ok(recommendations.length >= 1);
  assert.match(recommendations[0], /Nothing urgent/);
});

test('buildFounderBrief composes the sections and recommends the worst surface, biggest cost, top habit', () => {
  const intel = {
    totalDecisions: 200, tickersTracked: 30,
    quality: { avgIndex: 23, scored: 8 },
    adviceLift: { lift: 11, advised: { winRate: 62 }, selfDirected: { winRate: 51 } },
    behavior: { totalUsers: 10, patterns: [{ label: 'Holding losers, cutting winners', pctOfUsers: 80, users: 8 }] },
    retailTraps: [{ ticker: 'SNAP', retailWinRate: 18 }],
  };
  const usage = {
    windowDays: 30,
    totals: { last24h: { cost: 0.42, calls: 38 }, last7d: { cost: 3.1, calls: 200 }, lastWindow: { cost: 9.4, calls: 800 } },
    projectedMonthly: 13.3,
    byFeature: [{ feature: 'agent', cost: 6.1, calls: 400 }, { feature: 'synthesis', cost: 0.9, calls: 50 }],
    byModel: [{ tier: 'sonnet', cost: 7.8 }, { tier: 'haiku', cost: 1.6 }],
  };
  const quality = summarizeQuality([
    { feature: 'portfolio_synthesis', score: 60, failures: ['MAGNITUDE_CALIBRATED'] },
    { feature: 'portfolio_synthesis', score: 64, failures: ['MAGNITUDE_CALIBRATED'] },
    { feature: 'portfolio_synthesis', score: 66, failures: ['MAGNITUDE_CALIBRATED'] },
    { feature: 'portfolio_synthesis', score: 68, failures: ['MAGNITUDE_CALIBRATED'] },
    { feature: 'portfolio_synthesis', score: 62, failures: ['MAGNITUDE_CALIBRATED'] },
  ]);
  const { text, recommendations } = buildFounderBrief({ intel, usage, quality, engagement: { totalUsers: 12, active7d: 5, agentMessages: 140 }, generatedAt: '2026-06-04T22:00:00Z' });

  assert.match(text, /DECISION INTELLIGENCE/);
  assert.match(text, /Decision quality index: 23\/100/);
  assert.match(text, /AI COST/);
  assert.match(text, /Projected monthly: \$13.30/);
  assert.match(text, /AI QUALITY/);
  assert.match(text, /ENGAGEMENT/);
  assert.match(text, /RECOMMENDATIONS/);

  assert.ok(recommendations.some(r => /portfolio_synthesis is the lowest-quality surface/.test(r)));
  assert.ok(recommendations.some(r => /agent is 65% of AI spend/.test(r)));
  assert.ok(recommendations.some(r => /80% of users show "Holding losers/.test(r)));
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
