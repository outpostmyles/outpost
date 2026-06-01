// Pins the input-sanitization layer (api/middleware/validate.js). These run on
// every write endpoint and the auth flow, so they are a security boundary: a
// silent regression here (a length cap dropped, a number check loosened, the
// password floor weakened) is a real hole. This locks the behavior down,
// including adversarial inputs.
import assert from 'node:assert/strict';
import {
  sanitizeTicker, sanitizeNumber, sanitizeString, sanitizeDate, sanitizeEnum,
  isDisplayNameAllowed, isValidEmail, isStrongEnoughPassword,
} from '../api/middleware/validate.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('sanitizeTicker uppercases, strips junk, bounds length', () => {
  assert.equal(sanitizeTicker('aapl'), 'AAPL');
  assert.equal(sanitizeTicker('  tsla  '), 'TSLA');
  assert.equal(sanitizeTicker('BRK.B'), 'BRKB');   // strips the dot
  assert.equal(sanitizeTicker('toolong'), null);    // > 5 chars
  assert.equal(sanitizeTicker('12345'), null);       // all stripped -> empty
  assert.equal(sanitizeTicker(''), null);
  assert.equal(sanitizeTicker(null), null);
  assert.equal(sanitizeTicker(42), null);            // non-string
});

test('sanitizeNumber parses, bounds, and rejects non-finite', () => {
  assert.equal(sanitizeNumber('12.5'), 12.5);
  assert.equal(sanitizeNumber('abc'), null);
  assert.equal(sanitizeNumber(5, 0, 10), 5);
  assert.equal(sanitizeNumber(-1, 0), null);          // below min
  assert.equal(sanitizeNumber(100, null, 50), null);  // above max
  assert.equal(sanitizeNumber(null), null);
  assert.equal(sanitizeNumber(undefined), null);
  // The hardening: Infinity must never pass as a "valid number".
  assert.equal(sanitizeNumber(Infinity), null);
  assert.equal(sanitizeNumber(-Infinity), null);
  assert.equal(sanitizeNumber(1e400), null);          // overflows to Infinity
  assert.equal(sanitizeNumber(NaN), null);
});

test('sanitizeString trims, caps length, coerces non-strings to empty', () => {
  assert.equal(sanitizeString('  hi  '), 'hi');
  assert.equal(sanitizeString('a'.repeat(600)).length, 500);
  assert.equal(sanitizeString('a'.repeat(600), 10).length, 10);
  assert.equal(sanitizeString(null), '');
  assert.equal(sanitizeString(42), '');
});

test('sanitizeDate normalizes valid dates and rejects junk', () => {
  assert.equal(sanitizeDate('2026-01-15'), '2026-01-15');
  assert.equal(sanitizeDate('garbage'), null);
  assert.equal(sanitizeDate(null), null);
});

test('sanitizeEnum falls back to the first allowed value', () => {
  assert.equal(sanitizeEnum('b', ['a', 'b', 'c']), 'b');
  assert.equal(sanitizeEnum('z', ['a', 'b']), 'a');   // not allowed -> safe default
  assert.equal(sanitizeEnum(null, ['a', 'b']), 'a');
});

test('isDisplayNameAllowed blocks slurs, impersonation, and spacing evasion', () => {
  assert.equal(isDisplayNameAllowed('Myles'), true);
  assert.equal(isDisplayNameAllowed('fuckface'), false);
  assert.equal(isDisplayNameAllowed('f u c k'), false);  // strips non-letters first
  assert.equal(isDisplayNameAllowed('admin'), false);     // impersonation
  assert.equal(isDisplayNameAllowed('Outpost Team'), false);
  assert.equal(isDisplayNameAllowed(null), true);         // falls back elsewhere
  // Known limitation of substring matching (Scunthorpe problem): pinned, not
  // endorsed. If this ever moves to a real moderation service, update here.
  assert.equal(isDisplayNameAllowed('Hancock'), false);
});

test('isValidEmail accepts well-formed, rejects malformed and oversized', () => {
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('  a@b.co  '), true);    // trims
  assert.equal(isValidEmail('nope'), false);
  assert.equal(isValidEmail('a@b'), false);           // no dot in domain
  assert.equal(isValidEmail('a b@c.co'), false);      // space
  assert.equal(isValidEmail('x'.repeat(255) + '@b.co'), false); // > 254
  assert.equal(isValidEmail(null), false);
});

test('isStrongEnoughPassword enforces floor and ceiling', () => {
  assert.equal(isStrongEnoughPassword('abcd1234'), true);
  assert.equal(isStrongEnoughPassword('abcdefgh'), false); // no digit
  assert.equal(isStrongEnoughPassword('12345678'), false); // no letter
  assert.equal(isStrongEnoughPassword('ab12'), false);      // too short
  assert.equal(isStrongEnoughPassword('a1' + 'x'.repeat(127)), false); // > 128
  assert.equal(isStrongEnoughPassword(null), false);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
