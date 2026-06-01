// Unit tests for buildCoaching (src/lib/coaching.js).
import assert from 'node:assert/strict';
import { buildCoaching } from '../src/lib/coaching.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('not enough data yet', () => {
  const c = buildCoaching({ attribution: { scorecard: { totalTrades: 2 } } });
  assert.equal(c.hasEnough, false);
  assert.equal(c.fix, null);
});

test('broken stops is the top fix', () => {
  const c = buildCoaching({
    adherence: { summary: { tradesWithPlan: 8, stopBreachCount: 3 } },
  });
  assert.equal(c.hasEnough, true);
  assert.match(c.fix, /broke your own stop on 3 of 8/);
});

test('thesis win-rate gap becomes the fix when stops are clean', () => {
  const c = buildCoaching({
    attribution: { scorecard: { totalTrades: 10 }, patterns: { thesis: { lift: 30, with: { winRate: 70 }, without: { winRate: 40 } } } },
    adherence: { summary: { tradesWithPlan: 6, stopBreachCount: 0 } },
  });
  assert.match(c.fix, /70% .* 40%/);
  assert.match(c.fix, /thesis/i);
});

test('letting winners run is surfaced as a strength', () => {
  const c = buildCoaching({
    adherence: { summary: { tradesWithPlan: 8, stopBreachCount: 0, heldPastCount: 3, heldPastAvgOvershootPct: 12 } },
  });
  assert.match(c.strength, /let winners run/i);
  assert.match(c.strength, /12%/);
});

test('honoring stops is a strength when none were broken', () => {
  const c = buildCoaching({
    adherence: { summary: { tradesWithPlan: 6, stopBreachCount: 0, honoredStopCount: 2, heldPastCount: 0 } },
  });
  assert.match(c.strength, /honor your stops/i);
});

test('high win rate is the fallback strength', () => {
  const c = buildCoaching({
    attribution: { scorecard: { totalTrades: 12, winRate: 62 } },
  });
  assert.match(c.strength, /62% win rate/);
});

test('a clean disciplined trader can have a strength and no fix', () => {
  const c = buildCoaching({
    attribution: { scorecard: { totalTrades: 10, winRate: 64, avgHoldWinners: 30, avgHoldLosers: 20, wins: 6, losses: 4 } },
    adherence: { summary: { tradesWithPlan: 6, stopBreachCount: 0, earlyExitCount: 0, heldPastCount: 3, heldPastAvgOvershootPct: 8 } },
  });
  assert.equal(c.fix, null);
  assert.match(c.strength, /let winners run/i);
});

test('a recurring habit outranks a one-off count as the fix', () => {
  const c = buildCoaching({
    adherence: {
      summary: { tradesWithPlan: 6, stopBreachCount: 3 },
      byTrade: [
        { category: 'broke_stop', closedAt: '2026-01-10' },
        { category: 'broke_stop', closedAt: '2026-02-10' },
        { category: 'broke_stop', closedAt: '2026-03-10' },
      ],
    },
  });
  assert.match(c.fix, /habit/i);
  assert.match(c.fix, /months/);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
