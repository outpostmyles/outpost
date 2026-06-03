// Pins the shared AI style rules and the brief de-truncation helper. The no-dash
// rule is the one the user cares about most (em/en dashes read as "written by an
// AI"), so we lock that the shared rule text exists, names the ban, and is itself
// free of the very characters it forbids. trimToLastSentence is pinned so a
// token-cap cutoff never ships a dangling fragment.
import assert from 'node:assert/strict';
import { NO_DASH_RULE, PLAIN_TEXT_RULE, trimToLastSentence } from '../api/utils/aiStyle.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

const EM = '—'; // em dash
const EN = '–'; // en dash

test('the shared rules contain no literal em/en dash', () => {
  // The rule that forbids dashes must not itself model one.
  assert.ok(!NO_DASH_RULE.includes(EM) && !NO_DASH_RULE.includes(EN), 'NO_DASH_RULE contains a dash');
  assert.ok(!PLAIN_TEXT_RULE.includes(EM) && !PLAIN_TEXT_RULE.includes(EN), 'PLAIN_TEXT_RULE contains a dash');
});

test('NO_DASH_RULE actually names the ban and is carried by PLAIN_TEXT_RULE', () => {
  assert.match(NO_DASH_RULE, /em-dash/i);
  assert.match(NO_DASH_RULE, /en-dash/i);
  // PLAIN_TEXT_RULE must carry the no-dash rule so every prompt that uses it
  // inherits the ban; this is the single point that keeps surfaces from drifting.
  assert.ok(PLAIN_TEXT_RULE.includes(NO_DASH_RULE), 'PLAIN_TEXT_RULE must include NO_DASH_RULE');
});

test('trimToLastSentence keeps text that already ends cleanly', () => {
  assert.equal(trimToLastSentence('Stocks are calm today. Watch SPY near 585.'), 'Stocks are calm today. Watch SPY near 585.');
  assert.equal(trimToLastSentence('Nice gain on NVDA!'), 'Nice gain on NVDA!');
  assert.equal(trimToLastSentence('Is that your plan?'), 'Is that your plan?');
  assert.equal(trimToLastSentence('She said "hold."'), 'She said "hold."'); // closing quote after period
});

test('trimToLastSentence cuts a mid-sentence cutoff back to the last full sentence', () => {
  assert.equal(
    trimToLastSentence('Stocks are calm today. Watch SPY near 585 and consider trimming App'),
    'Stocks are calm today.'
  );
});

test('trimToLastSentence does not treat a decimal point as a sentence end', () => {
  // The only terminator here is the one after "today"; the 585.20 decimal is not
  // followed by whitespace so it is not a boundary.
  assert.equal(
    trimToLastSentence('Calm today. SPY sits at 585.20 and could keep grindi'),
    'Calm today.'
  );
});

test('trimToLastSentence leaves a single unterminated fragment alone (better than empty)', () => {
  assert.equal(trimToLastSentence('Watching SPY around 585 into the open'), 'Watching SPY around 585 into the open');
});

test('trimToLastSentence is safe on non-strings and empties', () => {
  assert.equal(trimToLastSentence(null), null);
  assert.equal(trimToLastSentence(undefined), undefined);
  assert.equal(trimToLastSentence(42), 42);
  assert.equal(trimToLastSentence('   '), '');
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
