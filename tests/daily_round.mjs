// Unit tests for the Daily Round step-composition (src/lib/dailyRound.js).
// Pins how TODAY items split into safety vs opportunity, the held-ticker
// exclusion and 2-item ration on opportunity, and the priority order of the
// single "sharpen" ask (missing thesis > record insight > nothing).
import assert from 'node:assert/strict';
import { buildRound } from '../src/lib/dailyRound.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const ITEMS = [
  { type: 'alert', subtype: 'stop_broken', ticker: 'AMD', priority: 100 },
  { type: 'alert', subtype: 'target_hit', ticker: 'NVDA', priority: 95 },
  { type: 'mover', ticker: 'AAPL', pct: -2, priority: 50 },
  { type: 'bargain', ticker: 'PYPL', priority: 70 },
  { type: 'catalyst', ticker: 'SOFI', priority: 80 },
  { type: 'heat', ticker: 'XLE', priority: 60 },
  { type: 'quiet', ticker: null, priority: 0 },
];

test('safety holds only the alert items', () => {
  const r = buildRound({ todayItems: ITEMS, positions: [] });
  assert.deepEqual(r.safety.items.map(i => i.ticker), ['AMD', 'NVDA']);
  assert.equal(r.safety.allClear, false);
});

test('all clear when there are no alerts', () => {
  const r = buildRound({ todayItems: [{ type: 'bargain', ticker: 'PYPL', priority: 70 }], positions: [{ ticker: 'AAPL', entry_thesis: 'x' }] });
  assert.equal(r.safety.allClear, true);
  assert.equal(r.safety.checked, 1);
});

test('opportunity excludes held tickers, sorts by priority, caps at 2', () => {
  const r = buildRound({ todayItems: ITEMS, positions: [{ ticker: 'XLE', entry_thesis: 'energy' }] });
  // XLE is held (excluded). Of PYPL(70), SOFI(80) remain top 2 by priority.
  assert.deepEqual(r.opportunity.map(i => i.ticker), ['SOFI', 'PYPL']);
});

test('opportunity ignores alerts and movers (only idea types)', () => {
  const r = buildRound({ todayItems: ITEMS, positions: [] });
  for (const it of r.opportunity) {
    assert.ok(['bargain', 'catalyst', 'heat', 'watch'].includes(it.type));
  }
});

test('sharpen asks for a missing thesis first', () => {
  const r = buildRound({
    todayItems: [],
    positions: [{ ticker: 'NVDA', entry_thesis: 'AI demand' }, { ticker: 'AMD' }],
  });
  assert.equal(r.sharpen.kind, 'thesis');
  assert.equal(r.sharpen.ticker, 'AMD');
  assert.ok(r.sharpen.prompt.includes('AMD'));
});

test('sharpen falls back to the thesis win-rate insight', () => {
  const r = buildRound({
    todayItems: [],
    positions: [{ ticker: 'NVDA', entry_thesis: 'x' }],
    attribution: { scorecard: { totalTrades: 10 }, patterns: { thesis: { lift: 25, with: { winRate: 70 }, without: { winRate: 45 } } } },
  });
  assert.equal(r.sharpen.kind, 'insight');
  assert.ok(r.sharpen.prompt.includes('70%'));
  assert.ok(r.sharpen.prompt.includes('45%'));
});

test('sharpen falls back to the hold-time tell when no thesis lift', () => {
  const r = buildRound({
    todayItems: [],
    positions: [{ ticker: 'NVDA', entry_thesis: 'x' }],
    attribution: { scorecard: { totalTrades: 8, wins: 5, losses: 3, avgHoldWinners: 10, avgHoldLosers: 40 } },
  });
  assert.equal(r.sharpen.kind, 'insight');
  assert.ok(/losers/.test(r.sharpen.prompt));
});

test('sharpen is none when there is nothing pointed to say', () => {
  const r = buildRound({
    todayItems: [],
    positions: [{ ticker: 'NVDA', entry_thesis: 'x' }],
    attribution: { scorecard: { wins: 5, losses: 3, avgHoldWinners: 30, avgHoldLosers: 31 } },
  });
  assert.equal(r.sharpen.kind, 'none');
});

test('handles empty / missing inputs without throwing', () => {
  const r = buildRound();
  assert.equal(r.safety.allClear, true);
  assert.deepEqual(r.opportunity, []);
  assert.equal(r.sharpen.kind, 'none');
  assert.deepEqual(buildRound({}).opportunity, []);
});

const NOW = Date.parse('2026-06-01T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

test('sharpen prompts a recent unreflected closed trade ahead of a missing thesis', () => {
  const r = buildRound({
    positions: [{ ticker: 'AMD' }], // missing thesis, but a fresh reflection wins
    closedTrades: [{ id: 't1', ticker: 'TSLA', closed_at: daysAgo(3) }],
    nowMs: NOW,
  });
  assert.equal(r.sharpen.kind, 'reflection');
  assert.equal(r.sharpen.ticker, 'TSLA');
  assert.equal(r.sharpen.tradeId, 't1');
});

test('a closed trade that already has a reflection is not prompted', () => {
  const r = buildRound({
    positions: [{ ticker: 'NVDA', entry_thesis: 'x' }],
    closedTrades: [{ id: 't1', ticker: 'TSLA', closed_at: daysAgo(2), reflection_lesson: 'sized too big' }],
    nowMs: NOW,
  });
  assert.equal(r.sharpen.kind, 'none');
});

test('a closed trade beyond the recency window is not prompted', () => {
  const r = buildRound({
    positions: [{ ticker: 'NVDA', entry_thesis: 'x' }],
    closedTrades: [{ id: 't1', ticker: 'TSLA', closed_at: daysAgo(30) }],
    nowMs: NOW,
  });
  assert.equal(r.sharpen.kind, 'none');
});

test('reflectedIds suppresses an already-prompted trade (no nagging)', () => {
  const r = buildRound({
    positions: [{ ticker: 'NVDA', entry_thesis: 'x' }],
    closedTrades: [{ id: 't1', ticker: 'TSLA', closed_at: daysAgo(1) }],
    reflectedIds: ['t1'],
    nowMs: NOW,
  });
  assert.equal(r.sharpen.kind, 'none');
});

test('the most recently closed unreflected trade is chosen', () => {
  const r = buildRound({
    positions: [{ ticker: 'NVDA', entry_thesis: 'x' }],
    closedTrades: [
      { id: 'old', ticker: 'F', closed_at: daysAgo(8) },
      { id: 'new', ticker: 'GME', closed_at: daysAgo(1) },
    ],
    nowMs: NOW,
  });
  assert.equal(r.sharpen.kind, 'reflection');
  assert.equal(r.sharpen.ticker, 'GME');
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
