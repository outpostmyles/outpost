// Pins the ledger-integrity layer (src/lib/ledgerIntegrity.js): resolution
// profiling, the held-loser selection-bias detector, and the advice-lift trust
// gate. These keep the reward signal honest about its own bias.
import assert from 'node:assert/strict';
import { resolutionProfile, winRateBias, adviceLiftHonesty, advisedCoverage } from '../src/lib/ledgerIntegrity.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

const NOW = Date.parse('2026-06-15T12:00:00Z');
const DAY = 86400000;
const ago = (days) => new Date(NOW - days * DAY).toISOString();

// helpers to build decisions in the camelCase shape the brain consumes
const buy = (over = {}) => ({ type: 'open', ticker: 'X', source: null, outcomeStatus: null, ...over });
const resolvedBuy = (status, holdDays, over = {}) => buy({ outcomeStatus: status, outcomeHoldDays: holdDays, ...over });

test('resolutionProfile counts resolved vs unresolved and ages the pile', () => {
  const ds = [
    resolvedBuy('win', 5, { createdAt: ago(40) }),
    resolvedBuy('loss', 10, { createdAt: ago(30) }),
    buy({ createdAt: ago(50) }),  // unresolved, old
    buy({ createdAt: ago(20) }),  // unresolved
    { type: 'close', outcomeStatus: 'win', createdAt: ago(5) }, // ignored: not an open/add
  ];
  const p = resolutionProfile(ds, { now: NOW });
  assert.equal(p.total, 4);          // only opens/adds
  assert.equal(p.resolved, 2);
  assert.equal(p.unresolved, 2);
  assert.equal(Math.round(p.resolutionRate * 100), 50);
  assert.equal(p.unresolvedMedianAgeDays, 20); // lower-median of [20, 50]
});

test('winRateBias flags HIGH when winners sell fast and old buys sit unresolved', () => {
  const ds = [
    // 6 resolved: winners held ~4d, losses held ~12d (cut winners, hold losers)
    resolvedBuy('win', 4, { createdAt: ago(60) }),
    resolvedBuy('win', 3, { createdAt: ago(58) }),
    resolvedBuy('win', 5, { createdAt: ago(55) }),
    resolvedBuy('win', 4, { createdAt: ago(50) }),
    resolvedBuy('loss', 12, { createdAt: ago(48) }),
    resolvedBuy('win', 4, { createdAt: ago(45) }),
    // 5 unresolved, all aged ~40d, well past the ~4d winners are held => likely held losers
    buy({ createdAt: ago(40) }), buy({ createdAt: ago(41) }), buy({ createdAt: ago(42) }),
    buy({ createdAt: ago(39) }), buy({ createdAt: ago(43) }),
  ];
  const b = winRateBias(ds, { now: NOW });
  assert.equal(b.biasedHigh, true);
  assert.ok(b.resolutionRate < 60);            // 6 of 11 resolved
  assert.equal(b.resolvedWinHoldDays, 4);
  assert.match(b.why, /likely held losers/);
});

test('winRateBias does NOT flag when nearly everything is resolved', () => {
  const ds = [
    resolvedBuy('win', 5, { createdAt: ago(40) }),
    resolvedBuy('win', 6, { createdAt: ago(38) }),
    resolvedBuy('loss', 9, { createdAt: ago(35) }),
    resolvedBuy('win', 4, { createdAt: ago(30) }),
    resolvedBuy('loss', 8, { createdAt: ago(28) }),
    resolvedBuy('win', 7, { createdAt: ago(25) }),
    buy({ createdAt: ago(3) }), // one fresh unresolved, not an aged pile
  ];
  const b = winRateBias(ds, { now: NOW });
  assert.equal(b.biasedHigh, false);
  assert.match(b.why, /face value/);
});

test('winRateBias stays silent below the minimum resolved sample', () => {
  const ds = [resolvedBuy('win', 5, { createdAt: ago(10) }), buy({ createdAt: ago(40) })];
  const b = winRateBias(ds, { now: NOW });
  assert.equal(b.biasedHigh, false);
  assert.match(b.why, /too few resolved/);
});

test('adviceLiftHonesty distrusts a lopsided resolution comparison', () => {
  // Both groups clear the sample floor (6 resolved each), but resolve at very
  // different RATES: advised 100% vs self 33%. Not apples to apples.
  const advised = Array.from({ length: 6 }, () => resolvedBuy('win', 5, { source: 'deploy_cash' }));
  const self = [
    ...Array.from({ length: 6 }, () => resolvedBuy('loss', 9, { source: null })),
    ...Array.from({ length: 12 }, () => buy({ source: null })),
  ];
  const h = adviceLiftHonesty([...advised, ...self]);
  assert.equal(h.trust, false);
  assert.equal(h.advisedResolution, 100);
  assert.equal(h.selfResolution, 33); // 6 of 18
  assert.match(h.caveat, /not apples to apples/);
});

test('adviceLiftHonesty trusts comparable, well-resolved groups', () => {
  const advised = [
    ...Array.from({ length: 5 }, () => resolvedBuy('win', 5, { source: 'screener' })),
    buy({ source: 'screener' }),
  ]; // 5 of 6 resolved (83%)
  const self = [
    ...Array.from({ length: 5 }, () => resolvedBuy('loss', 7, { source: null })),
    buy({ source: null }),
  ]; // 5 of 6 resolved (83%)
  const h = adviceLiftHonesty([...advised, ...self]);
  assert.equal(h.trust, true);
  assert.equal(h.caveat, '');
});

test('adviceLiftHonesty flags a thin sample before trusting anything', () => {
  const h = adviceLiftHonesty([resolvedBuy('win', 5, { source: 'deploy_cash' }), resolvedBuy('loss', 9, { source: null })]);
  assert.equal(h.trust, false);
  assert.match(h.caveat, /thin/);
});

test('advisedCoverage reports which advice channels actually reach the ledger', () => {
  // All advised buys came through deploy_cash; screener and dossier are dark.
  const ds = [
    buy({ source: 'deploy_cash' }), buy({ source: 'deploy_cash' }),
    buy({ source: null }), buy({ source: 'manual' }),
  ];
  const c = advisedCoverage(ds);
  assert.equal(c.advisedTotal, 2);
  assert.deepEqual(c.sourcesSeen, ['deploy_cash']);
  assert.deepEqual(c.missingSources, ['screener', 'dossier']);
  assert.equal(c.narrow, true);
});

test('advisedCoverage is not narrow once two channels show up, and zero is zero', () => {
  const two = advisedCoverage([buy({ source: 'deploy_cash' }), buy({ source: 'screener' })]);
  assert.equal(two.narrow, false);
  assert.equal(two.advisedTotal, 2);
  const none = advisedCoverage([buy({ source: null }), buy({ source: 'manual' })]);
  assert.equal(none.advisedTotal, 0);
  assert.equal(none.narrow, false);
  assert.deepEqual(none.missingSources, ['deploy_cash', 'screener', 'dossier']);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
