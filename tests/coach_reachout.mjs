// Pins the coach reach-out trigger (src/lib/coachReachout.js): it fires only on a
// genuinely hard moment, leads with the most acute one, and stays quiet otherwise.
import assert from 'node:assert/strict';
import { buildCoachReachout } from '../src/lib/coachReachout.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('a brutal day reaches out (hard) and names the drop', () => {
  const r = buildCoachReachout({ todayChangePct: -6, weekChangePct: -2 });
  assert.equal(r.show, true);
  assert.equal(r.tone, 'hard');
  assert.match(r.message, /Down 6% today/);
  assert.match(r.message, /before you act/);
});

test('a rough week reaches out when the day alone would not', () => {
  const r = buildCoachReachout({ todayChangePct: -1, weekChangePct: -10 });
  assert.equal(r.show, true);
  assert.match(r.message, /10% this week/);
});

test('a soft red day gets a gentle check-in', () => {
  const r = buildCoachReachout({ todayChangePct: -3, weekChangePct: 0 });
  assert.equal(r.tone, 'soft');
  assert.match(r.message, /I am here/);
});

test('a brutal day leads over a rough week', () => {
  const r = buildCoachReachout({ todayChangePct: -5, weekChangePct: -12 });
  assert.match(r.message, /today/); // the day, not the week, is surfaced
});

test('a normal or green day stays quiet', () => {
  assert.equal(buildCoachReachout({ todayChangePct: -1, weekChangePct: -3 }).show, false);
  assert.equal(buildCoachReachout({ todayChangePct: 2, weekChangePct: 5 }).show, false);
  assert.equal(buildCoachReachout({ todayChangePct: 0, weekChangePct: 0 }).show, false);
});

test('missing or junk signals never throw and stay quiet', () => {
  assert.equal(buildCoachReachout().show, false);
  assert.equal(buildCoachReachout({ todayChangePct: null, weekChangePct: null }).show, false);
  assert.equal(buildCoachReachout({ todayChangePct: NaN }).show, false);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
