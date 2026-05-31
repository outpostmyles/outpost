// Unit tests for the journal notes search filter (src/lib/journalSearch.js).
// Pins case-insensitivity, title + preview coverage, multi-term AND semantics,
// and the empty-query passthrough so the Notes list can rely on it.
import assert from 'node:assert/strict';
import { filterNotes } from '../src/lib/journalSearch.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const notes = [
  { id: '1', title: 'AAPL thesis', preview: 'Long-term story still intact, services growing.' },
  { id: '2', title: 'Earnings season prep', preview: 'Watch AAPL and NVDA reports this week.' },
  { id: '3', title: 'Random', preview: 'Grocery list and other junk.' },
  { id: '4', title: 'Macro notes', preview: 'Rates, the Fed, and what it means for tech.' },
];

test('empty query returns all notes', () => {
  assert.equal(filterNotes(notes, '').length, 4);
  assert.equal(filterNotes(notes, '   ').length, 4);
  assert.equal(filterNotes(notes, null).length, 4);
});

test('matches against the title', () => {
  assert.deepEqual(filterNotes(notes, 'macro').map(n => n.id), ['4']);
});

test('matches against the preview body', () => {
  assert.deepEqual(filterNotes(notes, 'services').map(n => n.id), ['1']);
});

test('is case-insensitive', () => {
  assert.deepEqual(filterNotes(notes, 'AAPL').map(n => n.id), ['1', '2']);
  assert.deepEqual(filterNotes(notes, 'aapl').map(n => n.id), ['1', '2']);
});

test('multi-term query uses AND across title + preview', () => {
  // "aapl earnings": note 2 has both (title "Earnings", preview "AAPL").
  assert.deepEqual(filterNotes(notes, 'aapl earnings').map(n => n.id), ['2']);
});

test('multi-term with no single note containing all terms returns nothing', () => {
  assert.deepEqual(filterNotes(notes, 'grocery aapl'), []);
});

test('preserves original order', () => {
  assert.deepEqual(filterNotes(notes, 'a').map(n => n.id), notes.filter(n => `${n.title} ${n.preview}`.toLowerCase().includes('a')).map(n => n.id));
});

test('handles missing title or preview fields', () => {
  const sparse = [
    { id: 'a', title: 'OnlyTitle has keyword zebra' },
    { id: 'b', preview: 'only preview has zebra' },
    { id: 'c' },
  ];
  assert.deepEqual(filterNotes(sparse, 'zebra').map(n => n.id), ['a', 'b']);
});

test('handles empty / missing notes list', () => {
  assert.deepEqual(filterNotes([], 'x'), []);
  assert.deepEqual(filterNotes(null, 'x'), []);
  assert.deepEqual(filterNotes(undefined, ''), []);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
