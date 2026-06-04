// Pins THE BRAIN: the pure processing over the decision ledger. This is the
// company's core IP (grade decisions on process not luck, surface the receipts,
// catch the recurring self-sabotage, aggregate the crowd), so it is locked down
// hard and proven without a database.
import assert from 'node:assert/strict';
import {
  gradeDecision, summarizeDecisions, detectBehaviorPatterns, aggregateRetail, aggregateBehavior,
  decisionQualityIndex, aggregateQuality, adviceLift, pctOfBookForDecision,
} from '../src/lib/decisionLedger.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

// ── gradeDecision ────────────────────────────────────────────────────────────
test('a reasoned, sanely-sized buy grades well', () => {
  const g = gradeDecision({ type: 'open', thesis: 'cheap vs peers', pctOfBook: 10 });
  assert.ok(g.score >= 70, `expected B+, got ${g.score}`);
  assert.match(g.reasons.join(' '), /written reason/);
});

test('a no-thesis, oversized, chased buy that got lucky still grades F', () => {
  // The whole point: a winning trade with bad process is a bad decision.
  const g = gradeDecision({ type: 'open', pctOfBook: 50, todayChangePct: 20, outcomeStatus: 'win', thesisPlayedOut: 'no' });
  assert.equal(g.letter, 'F');
  assert.match(g.reasons.join(' '), /no thesis|oversized|chased/);
});

test('a well-reasoned loss grades like good process, not failure', () => {
  const g = gradeDecision({ type: 'open', thesis: 'turnaround', pctOfBook: 8, outcomeStatus: 'loss', thesisPlayedOut: 'no', outcomePnlPct: -12 });
  assert.ok(g.score >= 50 && g.score < 70, `expected ~C, got ${g.score}`);
});

test('letting a loss run past -25% is penalized', () => {
  const disciplined = gradeDecision({ type: 'close', outcomeStatus: 'loss', outcomePnlPct: -8 });
  const blownUp = gradeDecision({ type: 'close', outcomeStatus: 'loss', outcomePnlPct: -40 });
  assert.ok(blownUp.score < disciplined.score);
  assert.match(blownUp.reasons.join(' '), /past -25%/);
});

test('gradeDecision is null-safe on junk', () => {
  assert.strictEqual(gradeDecision(null), null);
  assert.strictEqual(gradeDecision('x'), null);
});

// ── summarizeDecisions ───────────────────────────────────────────────────────
test('summary counts types, win rate, and process hygiene', () => {
  const s = summarizeDecisions([
    { type: 'open', thesis: 'a', pctOfBook: 10 },
    { type: 'open', pctOfBook: 50 },                                  // no thesis, oversized
    { type: 'close', outcomeStatus: 'win', outcomePnlPct: 20 },
    { type: 'close', outcomeStatus: 'loss', outcomePnlPct: -10 },
  ]);
  assert.equal(s.total, 4);
  assert.equal(s.byType.open, 2);
  assert.equal(s.resolved, 2);
  assert.equal(s.winRate, 50);
  assert.equal(s.thesisCoverage, 50);   // 1 of 2 opens had a thesis
  assert.equal(s.oversizedRate, 50);    // 1 of 2 opens over 35%
  assert.ok(s.avgGrade != null);
});

test('summary trend reads improving when recent grades beat older ones', () => {
  // Newest-first (service orders desc). Recent = great, older = poor.
  const great = { type: 'open', thesis: 'solid', pctOfBook: 8, outcomeStatus: 'win', thesisPlayedOut: 'yes' };
  const poor = { type: 'open', pctOfBook: 60, todayChangePct: 25, outcomeStatus: 'loss', thesisPlayedOut: 'no' };
  const s = summarizeDecisions([great, great, great, poor, poor, poor]);
  assert.equal(s.trend, 'improving');
});

test('summary is safe on an empty ledger', () => {
  const s = summarizeDecisions([]);
  assert.equal(s.total, 0);
  assert.strictEqual(s.winRate, null);
  assert.deepEqual(s.byType, {});
});

// ── detectBehaviorPatterns ───────────────────────────────────────────────────
test('flags buying without a reason when it is a habit', () => {
  const opens = Array.from({ length: 5 }, (_, i) => ({ type: 'open', ticker: `T${i}` })); // none have a thesis
  const f = detectBehaviorPatterns(opens);
  assert.ok(f.find(x => x.key === 'no_thesis'));
});

test('flags chasing green days', () => {
  const opens = [
    { type: 'open', ticker: 'A', todayChangePct: 20 },
    { type: 'open', ticker: 'B', todayChangePct: 15 },
    { type: 'open', ticker: 'C', thesis: 'x', todayChangePct: 1 },
    { type: 'open', ticker: 'D', thesis: 'x', todayChangePct: 0 },
  ];
  const f = detectBehaviorPatterns(opens);
  assert.ok(f.find(x => x.key === 'chasing'));
});

test('flags holding losers longer than winners', () => {
  const decisions = [
    { type: 'close', outcomeStatus: 'win', outcomeHoldDays: 5 },
    { type: 'close', outcomeStatus: 'win', outcomeHoldDays: 7 },
    { type: 'close', outcomeStatus: 'loss', outcomeHoldDays: 40 },
    { type: 'close', outcomeStatus: 'loss', outcomeHoldDays: 60 },
  ];
  const f = detectBehaviorPatterns(decisions);
  assert.ok(f.find(x => x.key === 'hold_losers'));
});

test('a clean, disciplined ledger raises no flags', () => {
  const decisions = [
    { type: 'open', ticker: 'A', thesis: 'cheap', pctOfBook: 8, todayChangePct: 0 },
    { type: 'open', ticker: 'B', thesis: 'growth', pctOfBook: 10, todayChangePct: 1 },
    { type: 'open', ticker: 'C', thesis: 'value', pctOfBook: 9, todayChangePct: -1 },
    { type: 'open', ticker: 'D', thesis: 'moat', pctOfBook: 12, todayChangePct: 2 },
  ];
  assert.deepEqual(detectBehaviorPatterns(decisions), []);
});

test('detectBehaviorPatterns is safe on junk', () => {
  assert.deepEqual(detectBehaviorPatterns(null), []);
  assert.deepEqual(detectBehaviorPatterns([null, undefined, 'x']), []);
});

// ── aggregateRetail ──────────────────────────────────────────────────────────
test('aggregate surfaces the crowded names and the retail traps', () => {
  const decisions = [
    // NVDA: crowded across 3 users
    { type: 'open', ticker: 'NVDA', userId: 'u1' },
    { type: 'open', ticker: 'NVDA', userId: 'u2' },
    { type: 'open', ticker: 'NVDA', userId: 'u3' },
    // MEME: retail keeps losing on it (3 resolved, all losses)
    { type: 'open', ticker: 'MEME', userId: 'u1' },
    { type: 'close', ticker: 'MEME', userId: 'u1', outcomeStatus: 'loss' },
    { type: 'close', ticker: 'MEME', userId: 'u2', outcomeStatus: 'loss' },
    { type: 'close', ticker: 'MEME', userId: 'u3', outcomeStatus: 'loss' },
  ];
  const agg = aggregateRetail(decisions, { minSample: 3 });
  assert.equal(agg.crowded[0].ticker, 'NVDA');
  assert.equal(agg.crowded[0].uniqueUsers, 3);
  const trap = agg.retailTraps.find(t => t.ticker === 'MEME');
  assert.ok(trap);
  assert.equal(trap.retailWinRate, 0);
});

test('aggregate withholds a win rate below the minimum sample', () => {
  const agg = aggregateRetail([
    { type: 'open', ticker: 'X', userId: 'u1' },
    { type: 'close', ticker: 'X', userId: 'u1', outcomeStatus: 'loss' },
  ], { minSample: 3 });
  const x = agg.crowded.find(r => r.ticker === 'X');
  assert.strictEqual(x.retailWinRate, null); // only 1 resolved, not enough to claim a rate
});

test('aggregateRetail is safe on junk', () => {
  const agg = aggregateRetail(null);
  assert.equal(agg.totalDecisions, 0);
  assert.deepEqual(agg.crowded, []);
});

// ── aggregateBehavior (the population-level founder read) ─────────────────────
test('aggregateBehavior reports how prevalent each mistake is across users', () => {
  // Two users, both chase green days (each has 4 buys, all chasing).
  const chaser = (u) => Array.from({ length: 4 }, (_, i) => ({ type: 'open', userId: u, ticker: `T${i}`, todayChangePct: 20 }));
  const agg = aggregateBehavior([...chaser('u1'), ...chaser('u2')]);
  assert.equal(agg.totalUsers, 2);
  const chasing = agg.patterns.find(p => p.key === 'chasing');
  assert.ok(chasing);
  assert.equal(chasing.users, 2);
  assert.equal(chasing.pctOfUsers, 100);
});

test('aggregateBehavior is safe on junk and empty', () => {
  assert.deepEqual(aggregateBehavior(null), { totalUsers: 0, patterns: [] });
  assert.deepEqual(aggregateBehavior([{ type: 'open' }]), { totalUsers: 0, patterns: [] }); // no userId => no users
});

// ── THE OBJECTIVE: decisionQualityIndex ──────────────────────────────────────
test('decisionQualityIndex is high for disciplined process, low for sabotage', () => {
  const good = Array.from({ length: 4 }, (_, i) => ({ type: 'open', ticker: `G${i}`, thesis: 'reasoned', pctOfBook: 8, todayChangePct: 0, outcomeStatus: 'win', thesisPlayedOut: 'yes' }));
  const bad = Array.from({ length: 4 }, (_, i) => ({ type: 'open', ticker: `B${i}`, pctOfBook: 60, todayChangePct: 25, outcomeStatus: 'loss', thesisPlayedOut: 'no' }));
  const gq = decisionQualityIndex(good);
  const bq = decisionQualityIndex(bad);
  assert.ok(gq.index > bq.index, `good ${gq.index} should beat bad ${bq.index}`);
  assert.ok(bq.sabotagePenalty > 0, 'sabotage should be penalized');
});

test('decisionQualityIndex is null when nothing is graded yet', () => {
  const q = decisionQualityIndex([]);
  assert.strictEqual(q.index, null);
});

test('aggregateQuality averages the per-user index across the base', () => {
  const userDs = (u, thesis) => Array.from({ length: 4 }, (_, i) => ({ type: 'open', userId: u, ticker: `${u}${i}`, thesis, pctOfBook: 8, outcomeStatus: 'win', thesisPlayedOut: 'yes' }));
  const agg = aggregateQuality([...userDs('u1', 'x'), ...userDs('u2', 'y')]);
  assert.equal(agg.users, 2);
  assert.equal(agg.scored, 2);
  assert.ok(agg.avgIndex > 0);
});

// ── THE REWARD SIGNAL: adviceLift ────────────────────────────────────────────
test('adviceLift compares AI-sourced outcomes against self-directed ones', () => {
  const decisions = [
    // advised (deploy_cash): 2 wins, 0 losses => 100%
    { type: 'open', source: 'deploy_cash', outcomeStatus: 'win' },
    { type: 'open', source: 'deploy_cash', outcomeStatus: 'win' },
    // self-directed (manual): 1 win, 1 loss => 50%
    { type: 'open', source: 'manual', outcomeStatus: 'win' },
    { type: 'open', source: 'manual', outcomeStatus: 'loss' },
  ];
  const r = adviceLift(decisions);
  assert.equal(r.advised.winRate, 100);
  assert.equal(r.selfDirected.winRate, 50);
  assert.equal(r.lift, 50); // following advice beat self-directed by 50 points
});

test('adviceLift withholds a verdict when a side has no resolved trades', () => {
  const r = adviceLift([{ type: 'open', source: 'manual', outcomeStatus: 'win' }]);
  assert.strictEqual(r.lift, null);
  assert.strictEqual(r.advised.winRate, null);
});

// ── pctOfBookForDecision (completing the capture) ────────────────────────────
test('pctOfBook for an open uses the position already in the book', () => {
  const positions = [{ ticker: 'AAPL', shares: 10 }, { ticker: 'MSFT', shares: 5 }];
  const prices = { AAPL: { price: 100 }, MSFT: { price: 200 } };
  // AAPL 1000 of 2000 book = 50%
  assert.equal(pctOfBookForDecision({ type: 'open', ticker: 'AAPL', price: 100 }, positions, prices), 50);
});

test('pctOfBook for a close adds the sold position back to the book', () => {
  // AAPL already removed from positions; value it from the decision shares.
  const positions = [{ ticker: 'MSFT', shares: 5 }];
  const prices = { AAPL: { price: 100 }, MSFT: { price: 200 } };
  // AAPL 10*100=1000, book = 1000(MSFT) + 1000 = 2000 => 50%
  assert.equal(pctOfBookForDecision({ type: 'close', ticker: 'AAPL', price: 100, shares: 10 }, positions, prices), 50);
});

test('pctOfBookForDecision is null-safe on junk', () => {
  assert.strictEqual(pctOfBookForDecision(null, null, null), null);
  assert.strictEqual(pctOfBookForDecision({ ticker: 'AAPL' }, [], {}), null); // no price
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
