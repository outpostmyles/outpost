// Pins the hidden-bet read (src/lib/concentrationRead.js): sector grouping, the
// hidden-bet threshold, and the "one big single name is not a hidden bet" rule.
import assert from 'node:assert/strict';
import { buildConcentrationRead, formatConcentrationRead } from '../src/lib/concentrationRead.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

const SECTOR = { NVDA: 'Tech', AMD: 'Tech', SMCI: 'Tech', COST: 'Staples', XOM: 'Energy' };
const sectorOf = (t) => SECTOR[t] || 'Unknown';
const P = (ticker, value) => ({ ticker, value });

test('catches five-names-one-bet: a sector over the threshold with 2+ names', () => {
  const read = buildConcentrationRead(
    [P('NVDA', 4000), P('AMD', 3000), P('SMCI', 1000), P('COST', 1000), P('XOM', 1000)],
    { sectorOf, threshold: 40 },
  );
  assert.equal(read.hasRead, true);
  assert.equal(read.hiddenBet, true);
  assert.equal(read.top.sector, 'Tech');
  assert.equal(read.top.pct, 80); // 8000 of 10000
  assert.match(read.note, /3 of your 5 names are Tech/);
});

test('a single big position is concentration, NOT a hidden bet (one name)', () => {
  const read = buildConcentrationRead([P('NVDA', 8000), P('COST', 1000), P('XOM', 1000)], { sectorOf, threshold: 40 });
  assert.equal(read.hiddenBet, false); // Tech is 80% but it is one name, not a hidden multi-name bet
});

test('a genuinely spread book does not trip', () => {
  const read = buildConcentrationRead([P('NVDA', 2000), P('COST', 2000), P('XOM', 2000)], { sectorOf, threshold: 40 });
  assert.equal(read.hiddenBet, false);
});

test('fewer than two positions, or no value, returns no read', () => {
  assert.equal(buildConcentrationRead([P('NVDA', 5000)], { sectorOf }).hasRead, false);
  assert.equal(buildConcentrationRead([], { sectorOf }).hasRead, false);
});

test('format is empty unless there is a hidden bet', () => {
  assert.equal(formatConcentrationRead({ hasRead: true, hiddenBet: false }), '');
  const read = buildConcentrationRead([P('NVDA', 4000), P('AMD', 4000), P('COST', 2000)], { sectorOf, threshold: 40 });
  assert.match(formatConcentrationRead(read), /HIDDEN CONCENTRATION/);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
