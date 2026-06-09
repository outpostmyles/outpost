// Robustness fuzz: every pure decision module takes data straight from external
// APIs (FMP, Finnhub, Polygon, Claude) or the DB, any of which can hand back
// nulls, wrong types, NaN, or a non-array where we expected an array. None of
// these functions may THROW on bad input; they must degrade, not crash. This
// harness hammers each with a battery of hostile inputs and fails loudly if any
// throws. (Crash-safety, not correctness, is the point here.)
import assert from 'node:assert/strict';

import { buildStressTests } from '../src/lib/stressTest.js';
import { marketValueOf, costBasisOf, pctOfBookOf, computeBookStats, bookStamp } from '../src/lib/bookStats.js';
import { computePortfolioValue } from '../src/lib/portfolioValue.js';
import { sectorExposure } from '../src/lib/sectorExposure.js';
import { sectorGaps } from '../src/lib/sectorGaps.js';
import { goalProgress } from '../src/lib/goalProgress.js';
import { projectGoal } from '../src/lib/goalProjection.js';
import { assessPositionHealth } from '../src/lib/positionHealth.js';
import { assessPortfolioRisk } from '../src/lib/portfolioRisk.js';
import { buildCoaching } from '../src/lib/coaching.js';
import { detectRecurring } from '../src/lib/recurringPatterns.js';
import { buildGrowthArc } from '../src/lib/growthArc.js';
import { buildRound } from '../src/lib/dailyRound.js';
import { filterNotes } from '../src/lib/journalSearch.js';
import { personalizeDiscover } from '../src/components/social/personalizeDiscover.js';
import { buildDiscoverFeed } from '../src/components/social/discoverRanker.js';
import { computeScorecard } from '../api/services/tradeScorecard.js';
import { applyBuyableVerdicts } from '../api/services/bargainVerdicts.js';
import { evaluatePlanAlerts, planAlertKey } from '../api/services/planAlerts.js';
import { assessRegister, pickPulseFallback, moodDirective } from '../api/services/pulseContext.js';
import { shouldFire } from '../api/services/alertRules.js';

// A nasty spread: nullish, wrong primitives, edge numbers, and arrays of junk.
const HOSTILE = [
  undefined, null, 0, -1, NaN, Infinity, -Infinity, 1e308, true, false,
  'x', '', '   ', {}, { foo: 1 }, [], [null], [undefined], [{}],
  [{ ticker: null }], [{ ticker: 'A', value: NaN }], [{ pnl: 'oops' }],
  [1, 2, 3], 'not-an-array', { ticker: 'A' }, [{ closed_at: 'bogus' }],
];

// Each entry: [label, fn]. fn receives one hostile value; for two-arg functions
// we fuzz one position while holding the other benign, then swap.
const cases = [
  ['buildStressTests(arg)', x => buildStressTests(x)],
  ['buildStressTests([], opts)', x => buildStressTests([{ ticker: 'A', currentValue: 100 }], x)],
  ['marketValueOf', x => marketValueOf(x)],
  ['costBasisOf', x => costBasisOf(x)],
  ['pctOfBookOf(a)', x => pctOfBookOf(x, 1000)],
  ['pctOfBookOf(b)', x => pctOfBookOf({ currentValue: 100 }, x)],
  ['computeBookStats', x => computeBookStats(x)],
  ['computePortfolioValue(positions)', x => computePortfolioValue(x, {})],
  ['computePortfolioValue(priceMap)', x => computePortfolioValue([{ ticker: 'A', shares: 5, avg_cost: 10 }], x)],
  ['computePortfolioValue(opts)', x => computePortfolioValue([{ ticker: 'A', shares: 5, avg_cost: 10 }], { A: { price: 12 } }, x ?? {})],
  ['bookStamp', x => bookStamp(x)],
  ['sectorExposure', x => sectorExposure(x)],
  ['sectorGaps', x => sectorGaps(x)],
  ['sectorGaps(_, opts)', x => sectorGaps([{ sector: 'Tech', pct: 90 }], x)],
  ['goalProgress(a)', x => goalProgress(x, 100000)],
  ['goalProgress(b)', x => goalProgress(50000, x)],
  ['projectGoal(arg)', x => projectGoal(x)],
  ['projectGoal({snapshots})', x => projectGoal({ snapshots: x, current: 1, target: 2 })],
  ['assessPositionHealth', x => assessPositionHealth(x)],
  ['assessPortfolioRisk', x => assessPortfolioRisk(x)],
  ['buildCoaching(arg)', x => buildCoaching(x)],
  ['buildCoaching({a,a})', x => buildCoaching({ attribution: x, adherence: x })],
  ['detectRecurring', x => detectRecurring(x)],
  ['buildGrowthArc', x => buildGrowthArc(x)],
  ['buildRound(arg)', x => buildRound(x)],
  ['buildRound({fields})', x => buildRound({ todayItems: x, positions: x, attribution: x, adherence: x, closedTrades: x })],
  ['filterNotes(a)', x => filterNotes(x, 'aapl')],
  ['filterNotes(b)', x => filterNotes([{ title: 'x', preview: 'y' }], x)],
  ['personalizeDiscover(a)', x => personalizeDiscover(x, {})],
  ['personalizeDiscover(b)', x => personalizeDiscover([{ ticker: 'A', priority: 1 }], { held: x, watch: x })],
  ['buildDiscoverFeed(arg)', x => buildDiscoverFeed(x)],
  ['buildDiscoverFeed({fields})', x => buildDiscoverFeed({ catalystData: x, sector: x, bargain: x, buzz: x })],
  ['computeScorecard', x => computeScorecard(x)],
  ['applyBuyableVerdicts(a)', x => applyBuyableVerdicts(x, { verdicts: [] })],
  ['applyBuyableVerdicts(b)', x => applyBuyableVerdicts([{ ticker: 'A' }], x)],
  ['evaluatePlanAlerts(a)', x => evaluatePlanAlerts(x, {})],
  ['evaluatePlanAlerts(b)', x => evaluatePlanAlerts([{ ticker: 'A', price_target: 1 }], x)],
  ['planAlertKey', x => planAlertKey(x ?? {})],
  ['assessRegister', x => assessRegister(x)],
  ['pickPulseFallback', x => pickPulseFallback(x, x)],
  ['moodDirective', x => moodDirective(x)],
  ['shouldFire(a)', x => shouldFire(x ?? {}, { price: 100 })],
  ['shouldFire(b)', x => shouldFire({ direction: 'above', threshold: 100 }, x)],
];

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

for (const [label, fn] of cases) {
  test(`${label} survives hostile input`, () => {
    for (const h of HOSTILE) {
      try {
        fn(h);
      } catch (e) {
        throw new Error(`threw on input ${JSON.stringify(h)}: ${e.message}`);
      }
    }
  });
}

// Beyond not-throwing: the book selector must always yield FINITE aggregates and
// never a NaN weight, no matter how garbage the positions are. A NaN here would
// smear "NaN%" across cards and feed the agent a broken number.
test('computeBookStats always yields finite book aggregates and safe weights', () => {
  for (const h of HOSTILE) {
    const { book, positions } = computeBookStats(Array.isArray(h) ? h : [h]);
    for (const k of ['holdingsValue', 'totalCost', 'unrealizedPnl', 'count']) {
      assert.ok(Number.isFinite(book[k]), `book.${k} not finite for ${JSON.stringify(h)}`);
    }
    for (const p of positions) {
      assert.ok(p.pctOfBook === null || Number.isFinite(p.pctOfBook), `pctOfBook neither null nor finite for ${JSON.stringify(h)}`);
      assert.ok(Number.isFinite(p.marketValue) && Number.isFinite(p.costBasis), `marketValue/costBasis not finite for ${JSON.stringify(h)}`);
    }
  }
});

// The headline money path: portfolio value, P&L, today's change. Whatever junk
// the position rows or the price map carry, every total must come out FINITE.
// One NaN here is a visible "$NaN" on the home screen, the single worst number
// the app can show. We also feed a deliberately poisoned price map (NaN price,
// -100% change that would divide by zero) alongside good rows and prove the good
// math still lands and nothing goes Infinity.
test('computePortfolioValue always yields finite totals and per-position numbers', () => {
  const NUMERIC_TOTALS = ['totalValue', 'totalCost', 'totalPnl', 'totalPnlPercent', 'totalTodayChange', 'todayChangePercent'];
  const NUMERIC_POS = ['currentPrice', 'currentValue', 'pnl', 'pnlPercent', 'todayChange', 'todayChangePercent'];
  for (const h of HOSTILE) {
    // h fuzzed as the positions list, as the price map, and as opts.
    const trials = [
      computePortfolioValue(Array.isArray(h) ? h : [h], {}),
      computePortfolioValue([{ ticker: 'A', shares: 5, avg_cost: 10 }], h),
      computePortfolioValue([{ ticker: 'A', shares: 5, avg_cost: 10 }], { A: { price: 12, changePercent: 4 } }, typeof h === 'object' && h ? h : {}),
    ];
    for (const { positions, totals } of trials) {
      for (const k of NUMERIC_TOTALS) assert.ok(Number.isFinite(totals[k]), `totals.${k} not finite for ${JSON.stringify(h)}`);
      assert.ok(Number.isInteger(totals.staleCount) && totals.staleCount >= 0, `staleCount bad for ${JSON.stringify(h)}`);
      for (const p of positions) for (const k of NUMERIC_POS) assert.ok(Number.isFinite(p[k]), `position.${k} not finite for ${JSON.stringify(h)}`);
    }
  }
  // One poisoned row (NaN price) must not infect a healthy row's totals.
  const mixed = computePortfolioValue(
    [{ ticker: 'GOOD', shares: 10, avg_cost: 100 }, { ticker: 'BAD', shares: 3, avg_cost: 50 }],
    { GOOD: { price: 120, changePercent: 2 }, BAD: { price: NaN, changePercent: -100 } },
  );
  for (const k of NUMERIC_TOTALS) assert.ok(Number.isFinite(mixed.totals[k]), `mixed totals.${k} not finite`);
  assert.equal(mixed.totals.totalValue, 1350, 'good row (1200) + bad row falls back to cost (150) = 1350');
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
