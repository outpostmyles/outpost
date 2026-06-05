// Pins the portfolio-read freshness gate (src/lib/synthesisFreshness.js): the
// material fingerprint (bucketed so daily noise does not churn, real threshold
// crossings do), the delta phrases the full read leads with, and the quiet-day
// standing line.
import assert from 'node:assert/strict';
import { materialFingerprint, summaryDelta, quietLine } from '../src/lib/synthesisFreshness.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

const S = (o = {}) => ({
  positionCount: 5, totalValue: 10000, totalPnl: 500, todayChange: 20,
  topConcentration: [], movers: [], drawdowns: [], winners: [], nearTarget: [], belowStop: [],
  planCoveragePct: 100, plannedCount: 5, ...o,
});

test('a normal daily wiggle does NOT change the fingerprint', () => {
  const a = materialFingerprint(S({ topConcentration: [{ ticker: 'AAPL', pctOfBook: 18.0 }] }));
  const b = materialFingerprint(S({ topConcentration: [{ ticker: 'AAPL', pctOfBook: 19.4 }] })); // same 15-25 band
  assert.equal(a, b);
});

test('crossing a concentration band DOES change the fingerprint', () => {
  const a = materialFingerprint(S({ topConcentration: [{ ticker: 'AAPL', pctOfBook: 23 }] })); // band 0
  const b = materialFingerprint(S({ topConcentration: [{ ticker: 'AAPL', pctOfBook: 27 }] })); // band 1
  assert.notEqual(a, b);
});

test('a loss deepening across a band changes the fingerprint; a small drift does not', () => {
  const mild = materialFingerprint(S({ drawdowns: [{ ticker: 'BE', pnlPct: -12 }] }));
  const mild2 = materialFingerprint(S({ drawdowns: [{ ticker: 'BE', pnlPct: -18 }] })); // same -10..-25 band
  assert.equal(mild, mild2);
  const deep = materialFingerprint(S({ drawdowns: [{ ticker: 'BE', pnlPct: -30 }] }));     // -25..-40 band
  assert.notEqual(mild, deep);
});

test('breaking a stop or reaching a target changes the fingerprint', () => {
  const base = materialFingerprint(S());
  assert.notEqual(base, materialFingerprint(S({ belowStop: [{ ticker: 'NVDA', stop: 100 }] })));
  assert.notEqual(base, materialFingerprint(S({ nearTarget: [{ ticker: 'MSFT', target: 500 }] })));
});

test('adding or closing a position changes the fingerprint', () => {
  assert.notEqual(materialFingerprint(S({ positionCount: 5 })), materialFingerprint(S({ positionCount: 6 })));
});

test('two identical quiet states share a fingerprint (so the read can stay quiet)', () => {
  assert.equal(materialFingerprint(S()), materialFingerprint(S()));
});

test('delta is empty on the first read and on an unchanged state', () => {
  assert.deepEqual(summaryDelta(null, S()), []);
  assert.deepEqual(summaryDelta(S(), S()), []);
});

test('delta names a freshly broken stop and a freshly reached target', () => {
  const prev = S();
  const curr = S({ belowStop: [{ ticker: 'NVDA', stop: 100 }], nearTarget: [{ ticker: 'MSFT', target: 500 }] });
  const d = summaryDelta(prev, curr);
  assert.ok(d.some(x => /NVDA.*broke below its stop/.test(x)));
  assert.ok(d.some(x => /MSFT.*reached near its target/.test(x)));
});

test('delta names a new position and a deeper loss', () => {
  const prev = S({ positionCount: 5, drawdowns: [{ ticker: 'BE', pnlPct: -12 }] });
  const curr = S({ positionCount: 6, drawdowns: [{ ticker: 'BE', pnlPct: -30 }] });
  const d = summaryDelta(prev, curr);
  assert.ok(d.some(x => /added a position/.test(x)));
  assert.ok(d.some(x => /BE dropped into a deeper loss/.test(x)));
});

test('quietLine surfaces the most important standing condition first', () => {
  assert.match(quietLine(S({ belowStop: [{ ticker: 'NVDA', stop: 100 }] })), /NVDA is still under your stop/);
  assert.match(quietLine(S({ drawdowns: [{ ticker: 'BE', pnlPct: -32 }] })), /BE is still down 32% from your cost/);
  assert.match(quietLine(S({ nearTarget: [{ ticker: 'MSFT', target: 500 }] })), /MSFT is still near your target/);
  assert.match(quietLine(S({ positionCount: 4, plannedCount: 2 })), /2 of your 4 positions still have no exit plan/);
  assert.match(quietLine(S()), /Nothing in your book is near a stop or target/);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
