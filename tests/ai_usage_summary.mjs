// Pins the founder AI-cost rollup (src/lib/aiUsageSummary.js): rolling windows,
// per-feature and per-model breakdowns, top users, the daily series, and the
// monthly run-rate. Time is injected so the windows are deterministic.
import assert from 'node:assert/strict';
import { summarizeUsage } from '../src/lib/aiUsageSummary.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const NOW = Date.parse('2026-06-15T12:00:00Z');
const HOUR = 3600000, DAY = 86400000;
const row = (feature, tier, cost, ageMs, user_id = null, input_tokens = 0, output_tokens = 0) =>
  ({ feature, tier, cost_usd: cost, user_id, input_tokens, output_tokens, created_at: new Date(NOW - ageMs).toISOString() });

test('empty input is all zeros, no breakdowns', () => {
  const s = summarizeUsage([], { now: NOW, days: 30 });
  assert.equal(s.totals.last24h.cost, 0);
  assert.equal(s.totals.last7d.cost, 0);
  assert.equal(s.totals.lastWindow.cost, 0);
  assert.deepEqual(s.byFeature, []);
  assert.equal(s.projectedMonthly, 0);
});

test('rows bucket into the right rolling windows', () => {
  const s = summarizeUsage([
    row('agent', 'sonnet', 1.0, 1 * HOUR),   // in 24h, 7d, 30d
    row('agent', 'sonnet', 2.0, 3 * DAY),    // in 7d, 30d
    row('briefs', 'haiku', 4.0, 20 * DAY),   // in 30d only
    row('briefs', 'haiku', 8.0, 40 * DAY),   // outside 30d, ignored entirely
  ], { now: NOW, days: 30 });
  assert.ok(close(s.totals.last24h.cost, 1.0));
  assert.ok(close(s.totals.last7d.cost, 3.0));    // 1 + 2
  assert.ok(close(s.totals.lastWindow.cost, 7.0)); // 1 + 2 + 4
  assert.equal(s.totals.lastWindow.calls, 3);
});

test('byFeature aggregates and sorts by cost, biggest first', () => {
  const s = summarizeUsage([
    row('agent', 'sonnet', 5.0, 1 * HOUR, 'u1'),
    row('agent', 'haiku', 1.0, 2 * HOUR, 'u1'),
    row('briefs', 'haiku', 3.0, 1 * DAY),
  ], { now: NOW, days: 30 });
  assert.equal(s.byFeature[0].feature, 'agent');
  assert.ok(close(s.byFeature[0].cost, 6.0));
  assert.equal(s.byFeature[0].calls, 2);
  assert.equal(s.byFeature[1].feature, 'briefs');
});

test('byModel groups by tier', () => {
  const s = summarizeUsage([
    row('agent', 'sonnet', 5.0, 1 * HOUR),
    row('agent', 'haiku', 1.0, 1 * HOUR),
    row('briefs', 'haiku', 2.0, 1 * HOUR),
  ], { now: NOW, days: 30 });
  const sonnet = s.byModel.find(m => m.tier === 'sonnet');
  const haiku = s.byModel.find(m => m.tier === 'haiku');
  assert.ok(close(sonnet.cost, 5.0));
  assert.ok(close(haiku.cost, 3.0)); // 1 + 2
});

test('topUsers excludes background jobs (null user) and ranks by cost', () => {
  const s = summarizeUsage([
    row('agent', 'sonnet', 4.0, 1 * HOUR, 'whale'),
    row('agent', 'haiku', 0.5, 1 * HOUR, 'casual'),
    row('briefs', 'haiku', 9.0, 1 * HOUR, null), // a job, no user
  ], { now: NOW, days: 30 });
  assert.equal(s.topUsers[0].userId, 'whale');
  assert.equal(s.topUsers.length, 2); // the null-user job is not a "user"
});

test('daily series is grouped by UTC date and sorted ascending', () => {
  const s = summarizeUsage([
    row('agent', 'sonnet', 1.0, 0),         // today
    row('agent', 'sonnet', 2.0, 1 * DAY),   // yesterday
    row('agent', 'sonnet', 0.5, 1 * DAY),   // yesterday again
  ], { now: NOW, days: 30 });
  assert.equal(s.daily.length, 2);
  assert.ok(s.daily[0].date < s.daily[1].date);
  const yesterday = s.daily[0];
  assert.ok(close(yesterday.cost, 2.5));
  assert.equal(yesterday.calls, 2);
});

test('projected monthly run-rate comes from the trailing 7 days', () => {
  // $7 over the last 7 days = $1/day => $30/month
  const s = summarizeUsage([
    row('agent', 'sonnet', 3.0, 1 * DAY),
    row('agent', 'sonnet', 4.0, 5 * DAY),
  ], { now: NOW, days: 30 });
  assert.ok(close(s.projectedMonthly, 30));
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
