// Pins the proactive-opener phrasing (api/services/agentOpener.js): the agent's
// first move that turns the day's top signal into an invitation to talk.
import assert from 'node:assert/strict';
import { buildAgentOpener } from '../api/services/agentOpener.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('quiet day with holdings still invites a conversation', () => {
  const o = buildAgentOpener([], { hasPositions: true });
  assert.match(o, /Quiet across your book/);
  assert.match(o, /\?$/); // ends inviting a reply
});

test('quiet day with no holdings nudges toward adding some', () => {
  const o = buildAgentOpener([], { hasPositions: false });
  assert.match(o, /add a few holdings/);
  assert.match(o, /on your radar/);
});

test('a signal whose detail already asks a question is used as-is', () => {
  const detail = 'NVDA broke past your $120 target — now $126.00 (+5.0% past target). Take some off, or let it run?';
  const o = buildAgentOpener([{ kind: 'position_past_target', detail, priority: 'high' }]);
  assert.equal(o, detail); // no second question stacked on
});

test('a statement signal gets an inviting question appended', () => {
  const o = buildAgentOpener([{ kind: 'position_near_target', detail: 'AAPL is 2.0% from your $200 target.', priority: 'medium' }]);
  assert.match(o, /^AAPL is 2\.0% from your \$200 target\. /);
  assert.match(o, /take profits or let it run\?$/);
});

test('uses the top (first) signal in the sorted list', () => {
  const o = buildAgentOpener([
    { kind: 'position_below_stop', detail: 'AAPL broke below your $180 stop.', priority: 'high' },
    { kind: 'big_mover', detail: 'TSLA up 8% today.', priority: 'medium' },
  ]);
  assert.match(o, /^AAPL broke below your \$180 stop\./);
  assert.match(o, /honor the stop or hold\?$/);
});

test('a new-names screener signal invites the user to run through them', () => {
  const detail = 'Your "AI infrastructure stocks" screen turned up 2 new names since you last looked: NVDA, SMCI';
  const o = buildAgentOpener([{ kind: 'screener_new', detail, priority: 1 }]);
  assert.match(o, /^Your "AI infrastructure stocks" screen turned up 2 new names/);
  assert.match(o, /run through the new names with you\?$/);
});

test('unknown signal kind falls back to a generic invite', () => {
  const o = buildAgentOpener([{ kind: 'something_new', detail: 'Heads up on XYZ.', priority: 'low' }]);
  assert.equal(o, 'Heads up on XYZ. Want to think it through together?');
});

test('non-array input is treated as a quiet day, not a crash', () => {
  assert.match(buildAgentOpener(null), /Quiet across your book|on your radar/);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
