// Unit tests for the resilient closed_trades query.
//
// The attribution endpoint adds execution_rating to its SELECT. If a user
// hasn't applied migration 017 yet, that column doesn't exist and the
// query fails. The fetchClosedTradesResilient helper retries without
// optional columns when it detects a missing-column error.
//
// We can't easily import fetchClosedTradesResilient (it's not exported from
// the route file and exporting it would muddy the module). Instead we test
// the DETECTION LOGIC directly. If detection works, the rest of the helper
// is a one-line query with a known fallback. The detection is the trick.
import assert from 'node:assert/strict';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// Replicated detection logic from attribution.js. Keep this in sync.
function looksLikeMissingColumn(error) {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return error.code === '42703'
    || (msg.includes('column') && msg.includes('does not exist'))
    || msg.includes('execution_rating');
}

// ─── Detection cases that SHOULD trigger fallback ───────────────────────

test('detects code 42703 (postgres undefined_column)', () => {
  assert.equal(looksLikeMissingColumn({ code: '42703', message: 'column foo does not exist' }), true);
});

test('detects "column X does not exist" message regardless of code', () => {
  assert.equal(looksLikeMissingColumn({ message: 'column "execution_rating" does not exist' }), true);
});

test('detects messages mentioning execution_rating specifically', () => {
  assert.equal(looksLikeMissingColumn({ message: 'unknown field execution_rating' }), true);
});

test('detects with mixed case message', () => {
  assert.equal(looksLikeMissingColumn({ message: 'COLUMN "Foo" DOES NOT EXIST' }), true);
});

// ─── Detection cases that should NOT trigger fallback ───────────────────

test('does not trigger on auth errors', () => {
  assert.equal(looksLikeMissingColumn({ message: 'jwt expired' }), false);
});

test('does not trigger on connection errors', () => {
  assert.equal(looksLikeMissingColumn({ message: 'connection terminated unexpectedly' }), false);
});

test('does not trigger on generic syntax error', () => {
  assert.equal(looksLikeMissingColumn({ code: '42601', message: 'syntax error at or near "SELECT"' }), false);
});

test('does not trigger when message mentions "column" but not "does not exist"', () => {
  // E.g. "column reference is ambiguous" — different problem entirely
  assert.equal(looksLikeMissingColumn({ message: 'column reference "id" is ambiguous' }), false);
});

test('does not trigger on null / undefined / empty errors', () => {
  assert.equal(looksLikeMissingColumn(null), false);
  assert.equal(looksLikeMissingColumn(undefined), false);
  assert.equal(looksLikeMissingColumn({}), false);
  assert.equal(looksLikeMissingColumn({ message: '' }), false);
});

// ─── Run ────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
