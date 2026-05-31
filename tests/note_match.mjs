// Unit tests for filterNotesByTicker — the matcher behind the "YOUR NOTES"
// section on a position card. It must be precise: only return notes that
// mention the ticker as a whole ALL-CAPS token, scanning both title and body.
// Substring noise and lowercase words must NOT match, or the card would show
// notes that have nothing to do with the holding.
import assert from 'node:assert/strict';
import { filterNotesByTicker } from '../api/services/noteMatch.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const notes = [
  { id: '1', title: 'AAPL thoughts', content: 'Still like the long-term story.' },
  { id: '2', title: 'Random ideas', content: 'I think NVDA runs into earnings.' },
  { id: '3', title: 'Education plan', content: 'Need to budget for tuition.' }, // contains "cat" substring in lowercase
  { id: '4', title: 'Watchlist', content: 'apple looks tired here' },           // lowercase, not a ticker
  { id: '5', title: 'Mixed', content: 'AAPL and NVDA both green today.' },
];

test('matches ticker in the title', () => {
  const out = filterNotesByTicker(notes, 'AAPL').map(n => n.id);
  assert.deepEqual(out, ['1', '5']);
});

test('matches ticker in the body', () => {
  const out = filterNotesByTicker(notes, 'NVDA').map(n => n.id);
  assert.deepEqual(out, ['2', '5']);
});

test('is case-insensitive on the requested ticker but token-precise on text', () => {
  // Requesting lowercase 'aapl' still works (we uppercase it)...
  assert.deepEqual(filterNotesByTicker(notes, 'aapl').map(n => n.id), ['1', '5']);
  // ...but lowercase "apple" in note 4 is never treated as a ticker.
  assert.equal(filterNotesByTicker(notes, 'APPLE').length, 0);
});

test('does not match on substrings (CAT not found inside "education")', () => {
  assert.deepEqual(filterNotesByTicker(notes, 'CAT'), []);
});

test('returns [] for empty/missing ticker', () => {
  assert.deepEqual(filterNotesByTicker(notes, ''), []);
  assert.deepEqual(filterNotesByTicker(notes, null), []);
  assert.deepEqual(filterNotesByTicker(notes, undefined), []);
});

test('handles empty / missing notes list', () => {
  assert.deepEqual(filterNotesByTicker([], 'AAPL'), []);
  assert.deepEqual(filterNotesByTicker(null, 'AAPL'), []);
});

test('tolerates notes with missing title or content', () => {
  const sparse = [
    { id: 'a', content: 'TSLA only in body' },
    { id: 'b', title: 'TSLA only in title' },
    { id: 'c' },
  ];
  assert.deepEqual(filterNotesByTicker(sparse, 'TSLA').map(n => n.id), ['a', 'b']);
});

test('does not match a ticker that appears only as part of a longer token', () => {
  const tricky = [{ id: 'x', title: '', content: 'AAPLE is not AAPL' }];
  // "AAPLE" is a 5-letter token != AAPL; only the standalone AAPL should match.
  assert.deepEqual(filterNotesByTicker(tricky, 'AAPL').map(n => n.id), ['x']);
  assert.deepEqual(filterNotesByTicker(tricky, 'AAPLE').map(n => n.id), ['x']);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
