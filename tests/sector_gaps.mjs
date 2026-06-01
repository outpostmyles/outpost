// Unit tests for sectorGaps (src/lib/sectorGaps.js).
import assert from 'node:assert/strict';
import { sectorGaps } from '../src/lib/sectorGaps.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('nothing classified yet means no gaps', () => {
  const r = sectorGaps([]);
  assert.deepEqual(r.gaps, []);
  assert.deepEqual(r.absent, []);
});

test('a tech-only book surfaces mainstream gaps first', () => {
  const r = sectorGaps([{ sector: 'Technology', pct: 100 }]);
  assert.ok(r.absent.includes('Healthcare'));
  assert.ok(r.absent.includes('Energy'));
  // Suggestions lead with the biggest sectors, capped at 3.
  assert.equal(r.gaps.length, 3);
  assert.equal(r.gaps[0], 'Healthcare'); // first mainstream sector the book lacks
});

test('a thinly held sector counts as light, not absent', () => {
  const r = sectorGaps([
    { sector: 'Technology', pct: 70 },
    { sector: 'Energy', pct: 3 },
    { sector: 'Healthcare', pct: 27 },
  ]);
  assert.ok(r.light.some(l => l.sector === 'Energy'));
  assert.ok(!r.absent.includes('Energy'));
  assert.ok(!r.absent.includes('Healthcare')); // 27% is well held
});

test('a well-diversified book has few or no gaps in the suggestion list', () => {
  const r = sectorGaps([
    { sector: 'Technology', pct: 20 },
    { sector: 'Healthcare', pct: 20 },
    { sector: 'Financial Services', pct: 20 },
    { sector: 'Energy', pct: 20 },
    { sector: 'Industrials', pct: 20 },
  ]);
  // Still some niche sectors absent (Utilities, Real Estate), but the big ones are covered.
  assert.ok(!r.gaps.includes('Healthcare'));
  assert.ok(!r.gaps.includes('Financial Services'));
});

test('respects the max cap and handles missing input', () => {
  assert.ok(sectorGaps([{ sector: 'Technology', pct: 100 }], { max: 2 }).gaps.length <= 2);
  assert.deepEqual(sectorGaps(null).gaps, []);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
