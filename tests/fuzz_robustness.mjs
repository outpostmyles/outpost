// Robustness fuzz: every pure decision module takes data straight from external
// APIs (FMP, Finnhub, Polygon, Claude) or the DB, any of which can hand back
// nulls, wrong types, NaN, or a non-array where we expected an array. None of
// these functions may THROW on bad input; they must degrade, not crash. This
// harness hammers each with a battery of hostile inputs and fails loudly if any
// throws. (Crash-safety, not correctness, is the point here.)
import assert from 'node:assert/strict';

import { buildStressTests } from '../src/lib/stressTest.js';
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

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
