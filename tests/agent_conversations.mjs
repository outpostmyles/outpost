// Pins the agent chat-switcher grouping (src/lib/agentConversations.js). The
// route loads messages newest-first so recent conversations are never truncated
// out under the row cap; this grouping must stay correct regardless of input
// order: lastActivity = the newest message (drives the sort), title = the
// earliest message (the opener), legacy bucket for null conversation_id.
import assert from 'node:assert/strict';
import { groupConversations } from '../src/lib/agentConversations.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

const msg = (conv, content, created) => ({ conversation_id: conv, role: 'user', content, created_at: created });
const byId = (list) => Object.fromEntries(list.map(c => [c.id, c]));

test('groups by conversation_id with correct counts', () => {
  const out = groupConversations([
    msg('a', 'hi', '2026-06-01T10:00:00Z'),
    msg('a', 'reply', '2026-06-01T10:01:00Z'),
    msg('b', 'other', '2026-06-01T11:00:00Z'),
  ]);
  const m = byId(out);
  assert.equal(out.length, 2);
  assert.equal(m.a.count, 2);
  assert.equal(m.b.count, 1);
});

test('lastActivity is the NEWEST message even when rows arrive newest-first', () => {
  // Rows in descending order (as the fixed route now loads them).
  const out = groupConversations([
    msg('a', 'third', '2026-06-01T10:05:00Z'),
    msg('a', 'second', '2026-06-01T10:02:00Z'),
    msg('a', 'first', '2026-06-01T10:00:00Z'),
  ]);
  assert.equal(out[0].lastActivity, '2026-06-01T10:05:00Z'); // newest, not overwritten by older rows
});

test('lastActivity is order-independent (shuffled rows give the same max)', () => {
  const out = groupConversations([
    msg('a', 'b', '2026-06-01T10:02:00Z'),
    msg('a', 'd', '2026-06-01T10:09:00Z'),
    msg('a', 'a', '2026-06-01T10:00:00Z'),
    msg('a', 'c', '2026-06-01T10:05:00Z'),
  ]);
  assert.equal(out[0].lastActivity, '2026-06-01T10:09:00Z');
});

test('title is the EARLIEST message (the opener), not the newest', () => {
  const out = groupConversations([
    msg('a', 'latest assistant turn', '2026-06-01T10:05:00Z'),
    msg('a', 'should I buy NVDA?', '2026-06-01T10:00:00Z'), // opener, earliest
    msg('a', 'middle', '2026-06-01T10:02:00Z'),
  ]);
  assert.equal(out[0].title, 'should I buy NVDA?');
});

test('most-recently-active conversation sorts first', () => {
  const out = groupConversations([
    msg('old', 'q', '2026-06-01T09:00:00Z'),
    msg('new', 'q', '2026-06-03T09:00:00Z'),
    msg('mid', 'q', '2026-06-02T09:00:00Z'),
  ]);
  assert.deepEqual(out.map(c => c.id), ['new', 'mid', 'old']);
});

test('null conversation_id collapses into one legacy bucket with a friendly title', () => {
  const out = groupConversations([
    msg(null, '', '2026-06-01T10:00:00Z'),     // blank content
    msg(null, '', '2026-06-01T10:01:00Z'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, '__legacy__');
  assert.equal(out[0].count, 2);
  assert.equal(out[0].title, 'Earlier conversation'); // fallback when no content to title with
});

test('a real conversation with no usable content falls back to "New conversation"', () => {
  const out = groupConversations([msg('c', '   ', '2026-06-01T10:00:00Z')]);
  assert.equal(out[0].title, 'New conversation');
});

test('title is capped at 60 chars', () => {
  const long = 'x'.repeat(200);
  const out = groupConversations([msg('a', long, '2026-06-01T10:00:00Z')]);
  assert.equal(out[0].title.length, 60);
});

test('non-string and null rows never crash the grouping', () => {
  const out = groupConversations([
    null,
    { conversation_id: 'a', content: 12345, created_at: '2026-06-01T10:00:00Z' }, // non-string content ignored for title
    msg('a', 'real opener', '2026-06-01T09:00:00Z'),
  ]);
  assert.equal(out[0].count, 2);
  assert.equal(out[0].title, 'real opener');
});

test('non-array input returns an empty list', () => {
  assert.deepEqual(groupConversations(null), []);
  assert.deepEqual(groupConversations(undefined), []);
  assert.deepEqual(groupConversations('nope'), []);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
