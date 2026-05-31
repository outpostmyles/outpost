// Unit tests for frontend ticker detection (src/lib/tickers.js).
//
// This module mirrors extractTickersFromMessage in api/services/notices.js.
// These tests pin the shared behavior so the two copies don't drift: same
// regex, same stopwords, same de-dupe. Plus the known-ticker filter that the
// journal note chips rely on for precision.
import assert from 'node:assert/strict';
import { extractTickers, detectKnownTickers, TICKER_STOPWORDS } from '../src/lib/tickers.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ─── extractTickers ─────────────────────────────────────────────────────────

test('pulls a single ticker out of a sentence', () => {
  assert.deepEqual(extractTickers('I think AAPL is strong here'), ['AAPL']);
});

test('pulls multiple tickers in first-seen order', () => {
  assert.deepEqual(extractTickers('NVDA over AMD, but MSFT lags'), ['NVDA', 'AMD', 'MSFT']);
});

test('de-dupes repeats', () => {
  assert.deepEqual(extractTickers('NVDA NVDA NVDA to the moon'), ['NVDA']);
});

test('drops single-letter tokens', () => {
  assert.deepEqual(extractTickers('A B C TSLA'), ['TSLA']);
});

test('drops stopwords like AI, ETF, CEO', () => {
  assert.deepEqual(extractTickers('The AI ETF CEO said BUY'), []);
});

test('ignores lowercase and mixed case words', () => {
  assert.deepEqual(extractTickers('apple Tesla nvda'), []);
});

test('handles empty / non-string input', () => {
  assert.deepEqual(extractTickers(''), []);
  assert.deepEqual(extractTickers(null), []);
  assert.deepEqual(extractTickers(undefined), []);
  assert.deepEqual(extractTickers(42), []);
});

test('caps token length at 5 letters', () => {
  // GOOGL is 5 (valid); SIXSIX would be 6 and not matched as one token.
  assert.deepEqual(extractTickers('GOOGL and ABCDEF'), ['GOOGL']);
});

test('stopword set includes the obvious offenders', () => {
  for (const w of ['AI', 'ETF', 'CEO', 'BUY', 'SELL', 'YOLO', 'USA']) {
    assert.ok(TICKER_STOPWORDS.has(w), `${w} should be a stopword`);
  }
});

// ─── detectKnownTickers ──────────────────────────────────────────────────────

test('keeps only tokens in the known set', () => {
  const known = new Set(['AAPL', 'MSFT']);
  assert.deepEqual(detectKnownTickers('AAPL vs TODO vs MSFT vs PLAN', known), ['AAPL', 'MSFT']);
});

test('accepts an array of known tickers and uppercases them', () => {
  assert.deepEqual(detectKnownTickers('I still like nvda but NVDA chart is hot', ['nvda']), ['NVDA']);
});

test('returns [] when known set is empty', () => {
  assert.deepEqual(detectKnownTickers('AAPL MSFT NVDA', []), []);
  assert.deepEqual(detectKnownTickers('AAPL MSFT NVDA', new Set()), []);
});

test('does not linkify a real-looking false positive unless it is known', () => {
  // TODO is 4 letters, all caps, not a stopword — exactly the kind of token
  // we must NOT turn into a chip unless the user actually owns/watches it.
  assert.deepEqual(detectKnownTickers('TODO: review CASH levels', new Set(['AAPL'])), []);
});

test('preserves first-seen order against the known set', () => {
  const known = new Set(['MSFT', 'AAPL', 'NVDA']);
  assert.deepEqual(detectKnownTickers('NVDA then AAPL then MSFT', known), ['NVDA', 'AAPL', 'MSFT']);
});

// ─── Run ────────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
