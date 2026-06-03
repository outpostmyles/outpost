// Pins decision memory (src/lib/decisionMemory.js): detecting the calls you make
// from snapshot diffs, grading them honestly against the price since, and the
// append-only log mechanics. The "what happened next" judgment is pure arithmetic,
// so it is fully testable here.
import assert from 'node:assert/strict';
import { snapshotReadState } from '../src/lib/readContinuity.js';
import { detectDecisions, gradeDecisions, callAge, appendDecisions } from '../src/lib/decisionMemory.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
const P = (o) => ({ shares: 10, currentPrice: 100, avg_cost: 100, ...o });
const snap = (positions, totalValue = 100000) => snapshotReadState({ positions, totalValue });

test('detects an opened position with its price', () => {
  const prior = snap([P({ ticker: 'OLD' })]);
  const curr = snap([P({ ticker: 'OLD' }), P({ ticker: 'RKLB', currentPrice: 106 })]);
  const ev = detectDecisions(prior, curr, '2026-06-02T00:00:00Z');
  const opened = ev.find(e => e.ticker === 'RKLB');
  assert.equal(opened.kind, 'opened');
  assert.equal(opened.px, 106);
});

test('detects a stop, a target, and a thesis written', () => {
  const prior = snap([P({ ticker: 'X' })]);
  const curr = snap([P({ ticker: 'X', currentPrice: 120, stop_loss: 100, price_target: 150, entry_thesis: 'good' })]);
  const kinds = detectDecisions(prior, curr, '2026-06-02T00:00:00Z').map(e => e.kind).sort();
  assert.deepEqual(kinds, ['set_stop', 'set_target', 'wrote_thesis']);
});

test('detects a trim, an add, and a close', () => {
  const prior = snap([P({ ticker: 'A', shares: 100 }), P({ ticker: 'B', shares: 100 }), P({ ticker: 'GONE', shares: 5, currentPrice: 40 })]);
  const curr = snap([P({ ticker: 'A', shares: 50 }), P({ ticker: 'B', shares: 150 })]);
  const ev = detectDecisions(prior, curr, '2026-06-02T00:00:00Z');
  assert.equal(ev.find(e => e.ticker === 'A').kind, 'trim');
  assert.equal(ev.find(e => e.ticker === 'B').kind, 'add');
  const closed = ev.find(e => e.ticker === 'GONE');
  assert.equal(closed.kind, 'closed');
  assert.equal(closed.px, 40); // last-seen price stands in for the exit
});

test('grades an open by the move since, with an honest tone', () => {
  const g = gradeDecisions([{ kind: 'opened', ticker: 'RKLB', at: '2026-05-01T00:00:00Z', px: 100 }], { RKLB: 120 }, Date.parse('2026-06-02T00:00:00Z'));
  assert.equal(g[0].since, 20);
  assert.equal(g[0].tone, 'good');
  assert.match(g[0].text, /opened RKLB near \$100\.00\. \+20% since/);
});

test('an early trim is a lesson, a trim before a fall is a good cut', () => {
  const early = gradeDecisions([{ kind: 'trim', ticker: 'ALAB', at: '2026-05-01T00:00:00Z', px: 300 }], { ALAB: 360 }, Date.now())[0];
  assert.equal(early.tone, 'learn');
  assert.match(early.text, /left some on the table/);
  const good = gradeDecisions([{ kind: 'trim', ticker: 'BE', at: '2026-05-01T00:00:00Z', px: 100 }], { BE: 80 }, Date.now())[0];
  assert.equal(good.tone, 'good');
  assert.match(good.text, /good cut/);
});

test('an exit that kept running is a lesson; one before a drop is a good exit', () => {
  const early = gradeDecisions([{ kind: 'closed', ticker: 'NVDA', at: '2026-04-01T00:00:00Z', px: 100 }], { NVDA: 130 }, Date.now())[0];
  assert.equal(early.tone, 'learn');
  assert.match(early.text, /kept running/);
  const good = gradeDecisions([{ kind: 'closed', ticker: 'PTON', at: '2026-04-01T00:00:00Z', px: 100 }], { PTON: 80 }, Date.now())[0];
  assert.equal(good.tone, 'good');
  assert.match(good.text, /ahead of the drop/);
});

test('a stop that stayed clear reads good; one being approached reads watch', () => {
  const clear = gradeDecisions([{ kind: 'set_stop', ticker: 'NVTS', at: '2026-05-01T00:00:00Z', px: 100 }], { NVTS: 118 }, Date.now())[0];
  assert.equal(clear.tone, 'good');
  assert.match(clear.text, /stayed clear/);
  const watch = gradeDecisions([{ kind: 'set_stop', ticker: 'FCEL', at: '2026-05-01T00:00:00Z', px: 100 }], { FCEL: 92 }, Date.now())[0];
  assert.equal(watch.tone, 'watch');
  assert.match(watch.text, /Watch the line/);
});

test('grading skips decisions with no usable price, newest first, capped', () => {
  const events = [
    { kind: 'opened', ticker: 'A', at: '2026-01-01T00:00:00Z', px: 100 },
    { kind: 'opened', ticker: 'B', at: '2026-03-01T00:00:00Z', px: 0 },     // bad px -> skip
    { kind: 'opened', ticker: 'C', at: '2026-05-01T00:00:00Z', px: 100 },   // no live price -> skip
    { kind: 'opened', ticker: 'D', at: '2026-04-01T00:00:00Z', px: 100 },
  ];
  const g = gradeDecisions(events, { A: 110, B: 110, D: 120 }, Date.now(), 8);
  assert.deepEqual(g.map(x => x.ticker), ['D', 'A']); // C/B dropped, D newer than A
});

test('callAge reads in human units', () => {
  assert.equal(callAge(0), 'today');
  assert.equal(callAge(3), '3d');
  assert.equal(callAge(14), '2w');
  assert.equal(callAge(120), '4mo');
});

test('appendDecisions appends and caps to the newest', () => {
  let log = [];
  for (let i = 0; i < 45; i++) log = appendDecisions(log, [{ kind: 'opened', ticker: `T${i}`, at: '2026-06-02T00:00:00Z', px: 100 }], 40);
  assert.equal(log.length, 40);
  assert.equal(log[log.length - 1].ticker, 'T44'); // newest kept
  assert.equal(log[0].ticker, 'T5');               // oldest 5 dropped
});

test('junk input never throws', () => {
  assert.deepEqual(detectDecisions(null, null, 'x'), []);
  assert.deepEqual(gradeDecisions(null, null), []);
  assert.deepEqual(appendDecisions(null, null), []);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
