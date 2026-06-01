// Unit tests for sectorExposure (src/lib/sectorExposure.js).
import assert from 'node:assert/strict';
import { sectorExposure } from '../src/lib/sectorExposure.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const h = (sector, value) => ({ sector, value });

test('empty book has no sectors', () => {
  const r = sectorExposure([]);
  assert.deepEqual(r.sectors, []);
  assert.equal(r.top, null);
  assert.equal(r.concentrated, false);
});

test('groups by sector and sorts by weight', () => {
  const r = sectorExposure([h('Technology', 3000), h('Energy', 1000), h('Technology', 2000)]);
  assert.deepEqual(r.sectors, [
    { sector: 'Technology', pct: 83.3 },
    { sector: 'Energy', pct: 16.7 },
  ]);
  assert.equal(r.top.sector, 'Technology');
});

test('flags concentration when one sector is half or more', () => {
  const r = sectorExposure([h('Technology', 6000), h('Healthcare', 2000), h('Energy', 2000)]);
  assert.equal(r.concentrated, true); // tech 60%
});

test('a balanced book across sectors is not concentrated', () => {
  const r = sectorExposure([h('Technology', 2500), h('Healthcare', 2500), h('Energy', 2500), h('Financials', 2500)]);
  assert.equal(r.concentrated, false); // 25% each
});

test('ignores rows missing a sector or value', () => {
  const r = sectorExposure([h('Technology', 5000), { value: 5000 }, { sector: 'Energy' }, h('Energy', 0)]);
  assert.deepEqual(r.sectors, [{ sector: 'Technology', pct: 100 }]);
});

test('handles null / missing input', () => {
  assert.equal(sectorExposure(null).top, null);
  assert.equal(sectorExposure(undefined).concentrated, false);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
