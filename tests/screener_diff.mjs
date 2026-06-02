// Pins the "what is new since you last looked" logic for living screeners
// (api/services/screenerDiff.js). This is what makes the nightly re-run feel
// alive: names that just appeared get flagged, the flag sticks until the user
// actually opens the screen, and a manual run by the user flags nothing.
import assert from 'node:assert/strict';
import { markScreenerNewcomers } from '../api/services/screenerDiff.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

const R = (ticker, extra = {}) => ({ ticker, thesis: `${ticker} fits`, ...extra });

test('silent run flags nothing (user is looking right now)', () => {
  const out = markScreenerNewcomers([R('NVDA')], [R('NVDA'), R('AMD')], { silent: true });
  assert.deepEqual(out.map(r => r.isNew), [false, false]);
});

test('a name not in the previous results is new', () => {
  const out = markScreenerNewcomers([R('NVDA')], [R('NVDA'), R('SMCI')], {});
  const byTicker = Object.fromEntries(out.map(r => [r.ticker, r.isNew]));
  assert.equal(byTicker.NVDA, false); // was there before, already seen
  assert.equal(byTicker.SMCI, true);  // brand new entrant
});

test('an unseen flag is sticky across runs until the screen is opened', () => {
  // SMCI was flagged new last run and the user never opened the screen.
  const prev = [R('NVDA', { isNew: false }), R('SMCI', { isNew: true })];
  const out = markScreenerNewcomers(prev, [R('NVDA'), R('SMCI')], {});
  const byTicker = Object.fromEntries(out.map(r => [r.ticker, r.isNew]));
  assert.equal(byTicker.SMCI, true); // still unseen, stays flagged
  assert.equal(byTicker.NVDA, false);
});

test('a previously seen name stays not-new', () => {
  const prev = [R('NVDA', { isNew: false })];
  const out = markScreenerNewcomers(prev, [R('NVDA')], {});
  assert.equal(out[0].isNew, false);
});

test('everything is new on the very first non-silent run', () => {
  const out = markScreenerNewcomers([], [R('NVDA'), R('AMD')], {});
  assert.deepEqual(out.map(r => r.isNew), [true, true]);
});

test('ticker match is case-insensitive', () => {
  const out = markScreenerNewcomers([R('nvda', { isNew: false })], [R('NVDA')], {});
  assert.equal(out[0].isNew, false); // same name, already seen
});

test('non-array / junk inputs do not crash', () => {
  assert.deepEqual(markScreenerNewcomers(null, null, {}), []);
  assert.deepEqual(markScreenerNewcomers(undefined, [R('NVDA')], {}).map(r => r.isNew), [true]);
  const messy = markScreenerNewcomers([{}, null], [R('NVDA')], {});
  assert.equal(messy[0].isNew, true);
});

test('original objects are not mutated', () => {
  const fresh = [R('NVDA')];
  markScreenerNewcomers([], fresh, {});
  assert.equal('isNew' in fresh[0], false); // returns new objects, leaves input clean
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
