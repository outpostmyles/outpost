// Unit tests for the Daily Round step-composition (src/lib/dailyRound.js).
// Pins the ruthless behavior: safety = alerts then held big-moves (deduped),
// opportunity = a single non-held idea, and sharpen = reflection-on-a-recent-
// close only (never manufactured from a missing thesis or a behavior stat).
import assert from 'node:assert/strict';
import { buildRound } from '../src/lib/dailyRound.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const ITEMS = [
  { type: 'alert', subtype: 'stop_broken', ticker: 'AMD', priority: 100 },
  { type: 'alert', subtype: 'target_hit', ticker: 'NVDA', priority: 95 },
  { type: 'mover', ticker: 'AAPL', pct: -8, priority: 50 },
  { type: 'bargain', ticker: 'PYPL', priority: 70 },
  { type: 'catalyst', ticker: 'SOFI', priority: 80 },
  { type: 'heat', ticker: 'XLE', priority: 60 },
  { type: 'quiet', ticker: null, priority: 0 },
];

test('safety leads with alerts, then big moves on names you hold', () => {
  const r = buildRound({ todayItems: ITEMS, positions: [] });
  assert.deepEqual(r.safety.items.map(i => i.ticker), ['AMD', 'NVDA', 'AAPL']);
  assert.equal(r.safety.allClear, false);
});

test('a mover on a ticker that also has an alert is not duplicated', () => {
  const r = buildRound({
    todayItems: [
      { type: 'alert', subtype: 'stop_broken', ticker: 'AMD', priority: 100 },
      { type: 'mover', ticker: 'AMD', pct: -9, priority: 50 },
    ],
    positions: [],
  });
  assert.deepEqual(r.safety.items.map(i => i.ticker), ['AMD']);
});

test('all clear when there are no alerts and no held movers', () => {
  const r = buildRound({ todayItems: [{ type: 'bargain', ticker: 'PYPL', priority: 70 }], positions: [{ ticker: 'AAPL', entry_thesis: 'x' }] });
  assert.equal(r.safety.allClear, true);
  assert.equal(r.safety.checked, 1);
});

test('opportunity is a SINGLE idea, highest priority, not held', () => {
  const r = buildRound({ todayItems: ITEMS, positions: [{ ticker: 'XLE', entry_thesis: 'energy' }] });
  assert.deepEqual(r.opportunity.map(i => i.ticker), ['SOFI']); // SOFI(80) > PYPL(70); XLE held
});

test('opportunity holds only idea types, never alerts or movers', () => {
  const r = buildRound({ todayItems: ITEMS, positions: [] });
  for (const it of r.opportunity) assert.ok(['bargain', 'catalyst', 'heat', 'watch'].includes(it.type));
});

const NOW = Date.parse('2026-06-01T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

test('sharpen prompts a recent unreflected close', () => {
  const r = buildRound({ positions: [{ ticker: 'AMD' }], closedTrades: [{ id: 't1', ticker: 'TSLA', closed_at: daysAgo(3) }], nowMs: NOW });
  assert.equal(r.sharpen.kind, 'reflection');
  assert.equal(r.sharpen.ticker, 'TSLA');
  assert.equal(r.sharpen.tradeId, 't1');
});

test('sharpen is never manufactured: a missing thesis or behavior stat yields none', () => {
  const r = buildRound({
    positions: [{ ticker: 'AMD' }], // no thesis
    attribution: { scorecard: { totalTrades: 10, wins: 5, losses: 3, avgHoldWinners: 10, avgHoldLosers: 40 }, patterns: { thesis: { lift: 25, with: { winRate: 70 }, without: { winRate: 45 } } } },
    nowMs: NOW,
  });
  assert.equal(r.sharpen.kind, 'none');
});

test('a closed trade that already has a reflection is not prompted', () => {
  const r = buildRound({ closedTrades: [{ id: 't1', ticker: 'TSLA', closed_at: daysAgo(2), reflection_lesson: 'sized too big' }], nowMs: NOW });
  assert.equal(r.sharpen.kind, 'none');
});

test('a closed trade beyond the recency window is not prompted', () => {
  const r = buildRound({ closedTrades: [{ id: 't1', ticker: 'TSLA', closed_at: daysAgo(30) }], nowMs: NOW });
  assert.equal(r.sharpen.kind, 'none');
});

test('reflectedIds suppresses an already-prompted trade (no nagging)', () => {
  const r = buildRound({ closedTrades: [{ id: 't1', ticker: 'TSLA', closed_at: daysAgo(1) }], reflectedIds: ['t1'], nowMs: NOW });
  assert.equal(r.sharpen.kind, 'none');
});

test('the most recently closed unreflected trade is chosen', () => {
  const r = buildRound({
    closedTrades: [
      { id: 'old', ticker: 'F', closed_at: daysAgo(8) },
      { id: 'new', ticker: 'GME', closed_at: daysAgo(1) },
    ],
    nowMs: NOW,
  });
  assert.equal(r.sharpen.ticker, 'GME');
});

test('handles empty / missing inputs without throwing', () => {
  const r = buildRound();
  assert.equal(r.safety.allClear, true);
  assert.deepEqual(r.opportunity, []);
  assert.equal(r.sharpen.kind, 'none');
  assert.deepEqual(buildRound({}).opportunity, []);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
