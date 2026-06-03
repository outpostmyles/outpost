// Pins the "since you were last here" memory (src/lib/readContinuity.js): the
// snapshot shape, the diff that turns two snapshots into human lines, and the
// re-anchor rule that keeps a within-session reload from swallowing what you just did.
import assert from 'node:assert/strict';
import { snapshotReadState, diffReadState, shouldReanchor } from '../src/lib/readContinuity.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

const P = (o) => ({ shares: 10, currentPrice: 100, avg_cost: 100, ...o });

test('snapshotReadState captures weight, plan, thesis, pnl and verdict', () => {
  const s = snapshotReadState({
    positions: [P({ ticker: 'DELL', currentPrice: 176, avg_cost: 100, shares: 10, stop_loss: 150, entry_thesis: 'margins' })],
    totalValue: 1760,
    thesisWatches: { DELL: { verdict: 'weakening' } },
  });
  const h = s.holdings.DELL;
  assert.equal(h.stop, true);
  assert.equal(h.th, true);
  assert.equal(h.tgt, false);
  assert.equal(h.pnl, 76);
  assert.equal(h.pct, 100);
  assert.equal(h.v, 'weakening');
});

test('snapshotReadState is null-safe and handles a zero book', () => {
  assert.deepEqual(snapshotReadState({}).holdings, {});
  const s = snapshotReadState({ positions: [P({ ticker: 'X' })], totalValue: 0 });
  assert.equal(s.holdings.X.pct, 0);
});

test('no prior snapshot yields no lines (no greeting on the first ever visit)', () => {
  const curr = snapshotReadState({ positions: [P({ ticker: 'X' })], totalValue: 1000 });
  assert.deepEqual(diffReadState(null, curr).lines, []);
  assert.deepEqual(diffReadState(undefined, curr).lines, []);
});

test('acknowledges a stop you set and a thesis you wrote', () => {
  const prior = snapshotReadState({ positions: [P({ ticker: 'NVTS' })], totalValue: 1000 });
  const curr = snapshotReadState({ positions: [P({ ticker: 'NVTS', stop_loss: 90, entry_thesis: 'grid' })], totalValue: 1000 });
  const lines = diffReadState(prior, curr).lines;
  assert.ok(lines.some(l => /set a stop on NVTS/.test(l)));
  assert.ok(lines.some(l => /wrote a thesis on NVTS/.test(l)));
});

test('a slipping thesis leads, and reads as breaking when it broke', () => {
  const prior = snapshotReadState({ positions: [P({ ticker: 'DELL', entry_thesis: 'x' })], totalValue: 1000, thesisWatches: { DELL: { verdict: 'intact' } } });
  const curr = snapshotReadState({ positions: [P({ ticker: 'DELL', entry_thesis: 'x' })], totalValue: 1000, thesisWatches: { DELL: { verdict: 'broken' } } });
  const lines = diffReadState(prior, curr).lines;
  assert.equal(lines[0], 'Your DELL thesis slipped to breaking.');
});

test('a firming thesis reads positively', () => {
  const prior = snapshotReadState({ positions: [P({ ticker: 'COST', entry_thesis: 'x' })], totalValue: 1000, thesisWatches: { COST: { verdict: 'weakening' } } });
  const curr = snapshotReadState({ positions: [P({ ticker: 'COST', entry_thesis: 'x' })], totalValue: 1000, thesisWatches: { COST: { verdict: 'intact' } } });
  assert.ok(diffReadState(prior, curr).lines.some(l => /firmed up to intact/.test(l)));
});

test('flags a deepening loss and a growing concentration', () => {
  const prior = snapshotReadState({ positions: [P({ ticker: 'BE', currentPrice: 100, avg_cost: 100, shares: 10 })], totalValue: 10000 });
  const curr = snapshotReadState({ positions: [P({ ticker: 'BE', currentPrice: 80, avg_cost: 100, shares: 10 })], totalValue: 10000 });
  assert.ok(diffReadState(prior, curr).lines.some(l => /BE fell further, now -20% from cost/.test(l)));

  const p2 = snapshotReadState({ positions: [P({ ticker: 'DELL', currentPrice: 100, shares: 14 })], totalValue: 10000 }); // 14%
  const c2 = snapshotReadState({ positions: [P({ ticker: 'DELL', currentPrice: 100, shares: 18 })], totalValue: 10000 }); // 18%
  assert.ok(diffReadState(p2, c2).lines.some(l => /DELL grew to 18% of your book/.test(l)));
});

test('notices a trim, a new name, and a close', () => {
  const prior = snapshotReadState({ positions: [P({ ticker: 'ALAB', shares: 100 }), P({ ticker: 'OLD', shares: 5 })], totalValue: 100000 });
  const curr = snapshotReadState({ positions: [P({ ticker: 'ALAB', shares: 50 }), P({ ticker: 'NEW', shares: 5 })], totalValue: 100000 });
  const lines = diffReadState(prior, curr).lines;
  assert.ok(lines.some(l => /trimmed ALAB/.test(l)));
  assert.ok(lines.some(l => /added NEW/.test(l)));
  assert.ok(lines.some(l => /closed OLD/.test(l)));
});

test('caps at three lines, most important first', () => {
  const prior = snapshotReadState({ positions: [
    P({ ticker: 'A', currentPrice: 100, avg_cost: 100 }), P({ ticker: 'B', currentPrice: 100, avg_cost: 100 }),
    P({ ticker: 'C', entry_thesis: 'x' }), P({ ticker: 'D' }),
  ], totalValue: 100000, thesisWatches: { C: { verdict: 'intact' } } });
  const curr = snapshotReadState({ positions: [
    P({ ticker: 'A', currentPrice: 70, avg_cost: 100 }),   // big drawdown (pri 7)
    P({ ticker: 'B', currentPrice: 60, avg_cost: 100 }),   // bigger drawdown (pri 7)
    P({ ticker: 'C', entry_thesis: 'x', stop_loss: 50 }),  // set a stop (pri 5)
    P({ ticker: 'D', entry_thesis: 'now written' }),       // wrote a thesis (pri 5)
  ], totalValue: 100000, thesisWatches: { C: { verdict: 'broken' } } }); // C thesis broke (pri 8)
  const lines = diffReadState(prior, curr).lines;
  assert.equal(lines.length, 3);
  assert.match(lines[0], /thesis slipped to breaking/); // pri 8 leads
});

test('shouldReanchor: fresh visit re-anchors, a same-session reload does not', () => {
  const now = Date.parse('2026-06-02T15:00:00Z');
  assert.equal(shouldReanchor(null, now), true);                                       // never anchored
  assert.equal(shouldReanchor('2026-06-02T14:30:00Z', now), false);                    // 30 min ago, same day
  assert.equal(shouldReanchor('2026-06-02T05:00:00Z', now), true);                     // 10h ago
  assert.equal(shouldReanchor('2026-06-01T14:30:00Z', now), true);                     // previous day
  assert.equal(shouldReanchor('garbage', now), true);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
