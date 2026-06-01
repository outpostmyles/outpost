// Pins the market-hours logic (api/utils/marketHours.js): RTH boundaries,
// pre-market, weekends, holidays, early closes, DST, and the ET calendar date.
// These gate alert firing, price-staleness, the jobs scheduler, and "today"
// cache keys, so a timezone slip here ripples across the app. Inputs are fixed
// UTC instants so the assertions are deterministic on any machine.
import assert from 'node:assert/strict';
import { isMarketHours, isPreMarket, todayStr, isWeekday } from '../api/utils/marketHours.js';

const U = (s) => new Date(s); // a fixed UTC instant
const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('regular weekday during RTH is open', () => {
  // 2026-06-01 (Mon) 19:30Z = 15:30 EDT
  assert.equal(isMarketHours(U('2026-06-01T19:30:00Z')), true);
});

test('before 9:30 ET is pre-market, not RTH', () => {
  // 2026-06-01 13:00Z = 09:00 EDT
  assert.equal(isMarketHours(U('2026-06-01T13:00:00Z')), false);
  assert.equal(isPreMarket(U('2026-06-01T13:00:00Z')), true);
});

test('after the close is not market hours', () => {
  // 2026-06-01 21:00Z = 17:00 EDT
  assert.equal(isMarketHours(U('2026-06-01T21:00:00Z')), false);
});

test('weekend is closed', () => {
  // 2026-06-06 is a Saturday
  assert.equal(isMarketHours(U('2026-06-06T19:30:00Z')), false);
  assert.equal(isWeekday(U('2026-06-06T19:30:00Z')), false);
  assert.equal(isWeekday(U('2026-06-01T19:30:00Z')), true);
});

test('a holiday is closed even during would-be RTH', () => {
  // Christmas 2026-12-25, 18:00Z = 13:00 EST (open hours if not a holiday)
  assert.equal(isMarketHours(U('2026-12-25T18:00:00Z')), false);
});

test('early-close day shuts at 1pm ET', () => {
  // 2026-11-27 (Fri after Thanksgiving) is an early close
  assert.equal(isMarketHours(U('2026-11-27T17:00:00Z')), true);   // 12:00 EST -> open
  assert.equal(isMarketHours(U('2026-11-27T18:30:00Z')), false);  // 13:30 EST -> closed
});

test('DST is handled: 15:30 ET is open in both summer and winter', () => {
  assert.equal(isMarketHours(U('2026-06-01T19:30:00Z')), true);   // 15:30 EDT (UTC-4)
  assert.equal(isMarketHours(U('2026-12-01T20:30:00Z')), true);   // 15:30 EST (UTC-5), a Tue
});

test('todayStr is the ET calendar date regardless of server timezone', () => {
  // 2026-06-02 03:00Z = 23:00 EDT on 2026-06-01, so the ET date is still June 1.
  // This is the bug the fix addresses: toISOString() would have said June 2.
  assert.equal(todayStr(U('2026-06-02T03:00:00Z')), '2026-06-01');
  assert.equal(todayStr(U('2026-06-01T16:00:00Z')), '2026-06-01');
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
