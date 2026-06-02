// Pins the offline sector fallback (api/services/sectorMap.js). The live provider
// is rate-limited, so when it fails the sector card must still resolve common
// holdings instead of showing "Unknown 100%". resolveSector keeps the rule:
// live value wins, static map is the safety net, Unknown only as a last resort.
import assert from 'node:assert/strict';
import { staticSector, resolveSector } from '../api/services/sectorMap.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('covers the holdings that were showing Unknown', () => {
  assert.equal(staticSector('PLUG'), 'Industrials');
  assert.equal(staticSector('RKLB'), 'Industrials');
  assert.equal(staticSector('QBTS'), 'Technology');
  assert.equal(staticSector('CRWV'), 'Technology');
  assert.equal(staticSector('POET'), 'Technology');
});

test('covers the screener/compare names that were showing Unknown', () => {
  assert.equal(staticSector('GTLB'), 'Technology');
  assert.equal(staticSector('CPRT'), 'Industrials');
  assert.equal(staticSector('MARA'), 'Financial Services'); // the compare best-fit bug
  assert.equal(staticSector('MNDY'), 'Technology');
  assert.equal(staticSector('ALAB'), 'Technology');
});

test('uses FMP-style sector names (so live + fallback blend)', () => {
  assert.equal(staticSector('NVDA'), 'Technology');
  assert.equal(staticSector('JPM'), 'Financial Services');
  assert.equal(staticSector('GOOGL'), 'Communication Services');
  assert.equal(staticSector('AMZN'), 'Consumer Cyclical');
  assert.equal(staticSector('KO'), 'Consumer Defensive');
});

test('is case-insensitive and trims', () => {
  assert.equal(staticSector('nvda'), 'Technology');
  assert.equal(staticSector('  plug '), 'Industrials');
});

test('returns null for a ticker it does not know', () => {
  assert.equal(staticSector('ZZZZ'), null);
  assert.equal(staticSector(''), null);
  assert.equal(staticSector(null), null);
});

test('resolveSector prefers the live FMP sector', () => {
  assert.equal(resolveSector('PLUG', 'Utilities'), 'Utilities'); // live wins even if map disagrees
  assert.equal(resolveSector('NVDA', 'Technology'), 'Technology');
});

test('resolveSector falls back to the map when live is missing', () => {
  assert.equal(resolveSector('PLUG', null), 'Industrials');
  assert.equal(resolveSector('QBTS', undefined), 'Technology');
  assert.equal(resolveSector('PLUG', '  '), 'Industrials'); // blank live string is not a real value
});

test('resolveSector is honest with Unknown when nothing resolves', () => {
  assert.equal(resolveSector('ZZZZ', null), 'Unknown');
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
