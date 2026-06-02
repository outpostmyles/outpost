// Pins the personalized "for your book" read (api/services/researchDossier.js).
// This is the part no generic screener can copy: how a name fits THIS user's
// sectors, concentration, and size. Pure, so it is tested without live data.
import assert from 'node:assert/strict';
import { forYourBook } from '../api/services/researchDossier.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

const book = [
  { ticker: 'NVDA', sector: 'Technology', value: 6000, beta: 1.6 },
  { ticker: 'MSFT', sector: 'Technology', value: 2000, beta: 1.0 },
  { ticker: 'JPM', sector: 'Financial Services', value: 2000, beta: 1.1 },
]; // book = 10000, 80% Technology, 20% Financial Services

test('flags adding to an already-heavy sector', () => {
  const r = forYourBook({ ticker: 'AMD', sector: 'Technology', beta: 1.8, holdings: book });
  assert.equal(r.sectorFit, 'concentrated');
  assert.equal(r.sectorPct, 80);
  assert.match(r.fitNote, /heaviest area|concentration/i);
});

test('flags a brand new sector as diversifying', () => {
  const r = forYourBook({ ticker: 'XOM', sector: 'Energy', beta: 0.9, holdings: book });
  assert.equal(r.sectorFit, 'new');
  assert.equal(r.sectorPct, 0);
  assert.match(r.fitNote, /New ground|diversify/i);
});

test('rounds out a lighter area', () => {
  const r = forYourBook({ ticker: 'GS', sector: 'Financial Services', beta: 1.2, holdings: book });
  assert.equal(r.sectorFit, 'fits');
  assert.equal(r.sectorPct, 20);
});

test('knows when you already own it', () => {
  const r = forYourBook({ ticker: 'NVDA', sector: 'Technology', beta: 1.6, holdings: book });
  assert.equal(r.holdsAlready, true);
  assert.equal(r.sectorFit, 'owned');
  assert.match(r.fitNote, /already own/i);
});

test('suggests a starter size relative to the book', () => {
  const r = forYourBook({ ticker: 'AMD', sector: 'Technology', beta: 1.8, holdings: book });
  assert.match(r.suggestedSize, /\$500\b/);      // 5% of 10,000
  assert.match(r.suggestedSize, /\$10,000\b/);
});

test('describes volatility from beta', () => {
  assert.match(forYourBook({ ticker: 'AMD', sector: 'Technology', beta: 1.8, holdings: book }).betaNote, /swingier/i);
  assert.match(forYourBook({ ticker: 'KO', sector: 'Consumer Defensive', beta: 0.5, holdings: book }).betaNote, /calmer/i);
});

test('handles an empty book without crashing', () => {
  const r = forYourBook({ ticker: 'AMD', sector: 'Technology', beta: 1.8, holdings: [] });
  assert.equal(r.bookValue, 0);
  assert.equal(r.sectorPct, 0);
  assert.equal(r.suggestedSize, null);
  assert.equal(r.sectorFit, 'new'); // nothing held, so any sector is new ground
});

test('handles an unknown sector honestly', () => {
  const r = forYourBook({ ticker: 'ZZZZ', sector: 'Unknown', beta: null, holdings: book });
  assert.equal(r.sectorFit, 'unknown');
  assert.equal(r.betaNote, null);
});

test('junk holdings do not crash', () => {
  const r = forYourBook({ ticker: 'AMD', sector: 'Technology', beta: 1.8, holdings: [null, {}, { value: 'x' }] });
  assert.equal(r.bookValue, 0);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
