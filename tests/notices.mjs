// Unit tests for the "Outpost noticed" passive observation generator.
// Pure function; deterministic with a fixed `now`. Verifies that each
// notice type triggers under the right conditions and not otherwise.
import assert from 'node:assert/strict';
import { generateNotices, extractTickersFromMessage, TICKER_STOPWORDS } from '../api/services/notices.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// Fixed reference time so age calculations are reproducible.
const NOW = new Date('2026-05-27T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000).toISOString();

// ─── extractTickersFromMessage ──────────────────────────────────────────

test('extractTickers: finds simple ticker', () => {
  assert.deepEqual(extractTickersFromMessage('I might buy NVDA next week'), ['NVDA']);
});

test('extractTickers: dedupes within one message', () => {
  const out = extractTickersFromMessage('NVDA is on fire, NVDA NVDA NVDA');
  assert.equal(out.length, 1);
  assert.equal(out[0], 'NVDA');
});

test('extractTickers: skips stopwords like CEO, AI, ETF', () => {
  const out = extractTickersFromMessage('The CEO mentioned AI on the ETF call but I think NVDA is the play');
  assert.deepEqual(out, ['NVDA']);
});

test('extractTickers: skips single letters', () => {
  const out = extractTickersFromMessage('A B C D NVDA');
  assert.deepEqual(out, ['NVDA']);
});

test('extractTickers: ignores lowercase', () => {
  const out = extractTickersFromMessage('I bought nvda yesterday');
  assert.deepEqual(out, []);
});

test('extractTickers: handles empty / null input', () => {
  assert.deepEqual(extractTickersFromMessage(''), []);
  assert.deepEqual(extractTickersFromMessage(null), []);
  assert.deepEqual(extractTickersFromMessage(undefined), []);
});

// ─── Closes without reflection ─────────────────────────────────────────

test('notice fires for close 3 days ago with no reflection', () => {
  const out = generateNotices({
    closedTrades: [{
      id: 't1', ticker: 'AAPL', pnl: -45,
      closed_at: daysAgo(3),
      thesis_played_out: null,
      reflection_what_happened: null,
      reflection_lesson: null,
      exit_reflection: null,
    }],
    now: NOW,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'close_no_reflection_t1');
  assert.equal(out[0].severity, 'high');
  assert.match(out[0].text, /AAPL.*-\$45.*3 days ago/);
  assert.equal(out[0].cta.action, 'open_close_reflection');
});

test('notice does NOT fire if reflection was logged', () => {
  const out = generateNotices({
    closedTrades: [{
      id: 't1', ticker: 'AAPL', pnl: 100,
      closed_at: daysAgo(5),
      thesis_played_out: null,
      reflection_what_happened: 'It played out.',
      reflection_lesson: null,
      exit_reflection: null,
    }],
    now: NOW,
  });
  assert.equal(out.length, 0);
});

test('notice does NOT fire if thesis_played_out was set', () => {
  const out = generateNotices({
    closedTrades: [{
      id: 't1', ticker: 'AAPL', pnl: 100,
      closed_at: daysAgo(5),
      thesis_played_out: 'yes',
      reflection_what_happened: null,
      reflection_lesson: null,
      exit_reflection: null,
    }],
    now: NOW,
  });
  assert.equal(out.length, 0);
});

test('notice does NOT fire if close was less than 2 days ago', () => {
  const out = generateNotices({
    closedTrades: [{
      id: 't1', ticker: 'AAPL', pnl: 100,
      closed_at: daysAgo(1),
      thesis_played_out: null,
      reflection_what_happened: null,
      reflection_lesson: null,
      exit_reflection: null,
    }],
    now: NOW,
  });
  assert.equal(out.length, 0);
});

// ─── Missing thesis ────────────────────────────────────────────────────

test('notice fires for position older than 7d with no thesis', () => {
  const out = generateNotices({
    positions: [{
      id: 'p1', ticker: 'TSLA',
      entry_thesis: null,
      purchased_at: daysAgo(10),
      created_at: daysAgo(10),
    }],
    now: NOW,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'no_thesis_p1');
  assert.equal(out[0].severity, 'medium');
  assert.match(out[0].text, /TSLA.*10 days/);
  assert.equal(out[0].cta.action, 'add_thesis');
});

test('notice does NOT fire for fresh position (< 7d) without thesis', () => {
  const out = generateNotices({
    positions: [{
      id: 'p1', ticker: 'TSLA',
      entry_thesis: null,
      purchased_at: daysAgo(3),
      created_at: daysAgo(3),
    }],
    now: NOW,
  });
  assert.equal(out.length, 0);
});

test('multiple thesis-less positions collapse into ONE consolidated notice', () => {
  const out = generateNotices({
    positions: [
      { id: 'p1', ticker: 'AAA', entry_thesis: null, purchased_at: daysAgo(20), created_at: daysAgo(20) },
      { id: 'p2', ticker: 'BBB', entry_thesis: null, purchased_at: daysAgo(15), created_at: daysAgo(15) },
      { id: 'p3', ticker: 'CCC', entry_thesis: '', purchased_at: daysAgo(10), created_at: daysAgo(10) },
    ],
    now: NOW,
  });
  const thesisNotices = out.filter(n => n.cta?.action === 'add_thesis');
  assert.equal(thesisNotices.length, 1);              // one nudge, not three
  assert.equal(thesisNotices[0].id, 'no_thesis_p1');  // the oldest
  assert.ok(/3 of your positions/.test(thesisNotices[0].text));
});

test('notice does NOT fire when thesis is already written', () => {
  const out = generateNotices({
    positions: [{
      id: 'p1', ticker: 'TSLA',
      entry_thesis: 'I think Tesla is the future.',
      purchased_at: daysAgo(30),
      created_at: daysAgo(30),
    }],
    now: NOW,
  });
  assert.equal(out.length, 0);
});

// ─── Chat mentions ─────────────────────────────────────────────────────

test('notice fires for ticker mentioned 3+ times, not owned, not watched', () => {
  const out = generateNotices({
    messages: [
      { content: 'should I buy NVDA' },
      { content: 'NVDA hit a new high' },
      { content: 'thinking about NVDA still' },
    ],
    positions: [],
    watchlist: [],
    now: NOW,
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'chat_mention_NVDA');
  assert.equal(out[0].severity, 'low');
  assert.match(out[0].text, /NVDA 3 times/);
});

test('notice does NOT fire for 2 mentions (below threshold)', () => {
  const out = generateNotices({
    messages: [
      { content: 'should I buy NVDA' },
      { content: 'NVDA hit a new high' },
    ],
    now: NOW,
  });
  assert.equal(out.length, 0);
});

test('notice does NOT fire if user already owns the ticker', () => {
  const out = generateNotices({
    messages: [
      { content: 'NVDA is on fire' },
      { content: 'NVDA NVDA' },  // single mention since we dedupe per message
      { content: 'I love NVDA' },
      { content: 'NVDA going up' },
    ],
    positions: [{ id: 'p1', ticker: 'NVDA', entry_thesis: 'my thesis', purchased_at: daysAgo(5), created_at: daysAgo(5) }],
    now: NOW,
  });
  assert.equal(out.length, 0);
});

test('notice does NOT fire if ticker is on watchlist', () => {
  const out = generateNotices({
    messages: [
      { content: 'should I buy NVDA' },
      { content: 'NVDA hit a new high' },
      { content: 'thinking about NVDA' },
    ],
    watchlist: [{ ticker: 'NVDA' }],
    now: NOW,
  });
  assert.equal(out.length, 0);
});

// ─── Ranking and capping ───────────────────────────────────────────────

test('returns at most 3 notices', () => {
  const out = generateNotices({
    closedTrades: [
      { id: 't1', ticker: 'A', pnl: 0, closed_at: daysAgo(5), thesis_played_out: null, reflection_what_happened: null, reflection_lesson: null, exit_reflection: null },
      { id: 't2', ticker: 'B', pnl: 0, closed_at: daysAgo(6), thesis_played_out: null, reflection_what_happened: null, reflection_lesson: null, exit_reflection: null },
      { id: 't3', ticker: 'C', pnl: 0, closed_at: daysAgo(7), thesis_played_out: null, reflection_what_happened: null, reflection_lesson: null, exit_reflection: null },
      { id: 't4', ticker: 'D', pnl: 0, closed_at: daysAgo(8), thesis_played_out: null, reflection_what_happened: null, reflection_lesson: null, exit_reflection: null },
    ],
    now: NOW,
  });
  assert.equal(out.length, 3);
});

test('high severity ranks above medium and low', () => {
  const out = generateNotices({
    closedTrades: [{ id: 't1', ticker: 'A', pnl: 0, closed_at: daysAgo(3), thesis_played_out: null, reflection_what_happened: null, reflection_lesson: null, exit_reflection: null }],
    positions: [{ id: 'p1', ticker: 'B', entry_thesis: null, purchased_at: daysAgo(20), created_at: daysAgo(20) }],
    messages: [
      { content: 'NVDA up' }, { content: 'NVDA down' }, { content: 'NVDA again' },
    ],
    now: NOW,
  });
  assert.equal(out.length, 3);
  assert.equal(out[0].severity, 'high');
  assert.equal(out[1].severity, 'medium');
  assert.equal(out[2].severity, 'low');
});

test('returned objects do not leak _priority internal field', () => {
  const out = generateNotices({
    closedTrades: [{ id: 't1', ticker: 'A', pnl: 0, closed_at: daysAgo(3), thesis_played_out: null, reflection_what_happened: null, reflection_lesson: null, exit_reflection: null }],
    now: NOW,
  });
  assert.ok(out[0]);
  assert.equal(out[0]._priority, undefined);
});

test('empty input returns empty array', () => {
  assert.deepEqual(generateNotices({ now: NOW }), []);
  assert.deepEqual(generateNotices({}), []);
});

// ─── Run ───────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
