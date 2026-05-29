// Unit tests for the data-hygiene fixes shipped after real beta usage
// surfaced three small problems:
//
//   1. Price-pool snapshot sanitizer. Polygon occasionally returns absurd
//      change percentages for thin tickers. We reject anything outside
//      [-95, +500] at ingestion so the UI never shows "+7,825%".
//
//   2. Mover-list sanitizer. Same issue but on Polygon's gainers/losers
//      endpoint, which feeds the Top Movers card on Home.
//
//   3. Agent date-meaning. The history aggregator used to emit
//      "Bought N TICKER" with `created_at` as the date whenever the user
//      didn't fill in the optional purchase date. The agent then said
//      "you bought this 2 days ago" when the user had actually owned it
//      for months. Fix: when purchased_at is missing, the event title
//      says "Added to Outpost" and a `purchaseDateProvided: false` flag
//      tells the agent not to reason about hold duration from the date.
import assert from 'node:assert/strict';
import { _sanitizeSnapshotForTest } from '../api/services/pricePool.js';
import { _sanityFilterMoversForTest } from '../api/services/marketData.js';
import { positionToOpenEvent } from '../api/services/historyAggregator.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ─── Snapshot sanitizer ─────────────────────────────────────────────────

test('sanitize: normal change% passes through unchanged', () => {
  const out = _sanitizeSnapshotForTest('AAPL', { price: 175.5, changePercent: 1.2, prevClose: 173.42 });
  assert.equal(out.changePercent, 1.2);
});

test('sanitize: -50% (real bad day) passes through', () => {
  const out = _sanitizeSnapshotForTest('XYZ', { price: 5, changePercent: -50, prevClose: 10 });
  assert.equal(out.changePercent, -50);
});

test('sanitize: +200% (real small-cap pump on news) passes through', () => {
  const out = _sanitizeSnapshotForTest('PUMP', { price: 9, changePercent: 200, prevClose: 3 });
  assert.equal(out.changePercent, 200);
});

test('sanitize: +501% gets nulled out (data error)', () => {
  const out = _sanitizeSnapshotForTest('THIN', { price: 5, changePercent: 501, prevClose: 0.83 });
  assert.equal(out.changePercent, null);
  // Other fields preserved
  assert.equal(out.price, 5);
  assert.equal(out.prevClose, 0.83);
});

test('sanitize: +7825.53 (the exact bug from beta screenshot) gets nulled', () => {
  const out = _sanitizeSnapshotForTest('QH', { price: 7.45, changePercent: 7825.53, prevClose: 0.094 });
  assert.equal(out.changePercent, null);
  assert.equal(out.price, 7.45);  // price itself stays
});

test('sanitize: -96% gets nulled out (likely delisting noise)', () => {
  const out = _sanitizeSnapshotForTest('DEAD', { price: 0.05, changePercent: -96, prevClose: 1.25 });
  assert.equal(out.changePercent, null);
});

test('sanitize: null changePercent stays null (no error)', () => {
  const out = _sanitizeSnapshotForTest('ABC', { price: 10, changePercent: null, prevClose: 10 });
  assert.equal(out.changePercent, null);
});

test('sanitize: missing snapshot returns unchanged', () => {
  assert.equal(_sanitizeSnapshotForTest('X', null), null);
});

test('sanitize: missing price returns unchanged (no validation)', () => {
  const out = _sanitizeSnapshotForTest('X', { price: null, changePercent: 9999 });
  // No price, no judgement. Pass through as-is.
  assert.equal(out.changePercent, 9999);
});

// ─── Mover-list sanitizer ───────────────────────────────────────────────

test('movers: normal list passes through entirely', () => {
  const out = _sanityFilterMoversForTest([
    { ticker: 'AAPL', changePercent: 1.5 },
    { ticker: 'MSFT', changePercent: -0.8 },
    { ticker: 'NVDA', changePercent: 3.2 },
  ]);
  assert.equal(out.length, 3);
});

test('movers: drops +7825% entry', () => {
  const out = _sanityFilterMoversForTest([
    { ticker: 'AAPL', changePercent: 1.5 },
    { ticker: 'QH', changePercent: 7825.53 },
    { ticker: 'NVDA', changePercent: 3.2 },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(m => m.ticker), ['AAPL', 'NVDA']);
});

test('movers: drops multiple absurd entries at once', () => {
  const out = _sanityFilterMoversForTest([
    { ticker: 'AAPL', changePercent: 1.5 },
    { ticker: 'A', changePercent: 7825 },
    { ticker: 'B', changePercent: 99999 },
    { ticker: 'C', changePercent: -98 },
    { ticker: 'NVDA', changePercent: 3.2 },
  ]);
  assert.equal(out.length, 2);
});

test('movers: keeps entries with null changePercent (renders as —)', () => {
  const out = _sanityFilterMoversForTest([
    { ticker: 'AAPL', changePercent: 1.5 },
    { ticker: 'MISSING', changePercent: null },
  ]);
  assert.equal(out.length, 2);
});

test('movers: keeps +200% (real pump territory)', () => {
  const out = _sanityFilterMoversForTest([
    { ticker: 'PUMP', changePercent: 200 },
  ]);
  assert.equal(out.length, 1);
});

test('movers: handles empty / non-array input', () => {
  assert.deepEqual(_sanityFilterMoversForTest([]), []);
  assert.equal(_sanityFilterMoversForTest(null), null);
  assert.equal(_sanityFilterMoversForTest(undefined), undefined);
});

// ─── Agent date meaning ─────────────────────────────────────────────────

test('position with user-provided purchase date: title says "Bought"', () => {
  const event = positionToOpenEvent({
    id: 'p1', ticker: 'NVDA', shares: 100, avg_cost: 130,
    purchased_at: '2024-01-15',
    created_at: '2026-05-27',
    entry_thesis: 'Buying for AI capex',
  });
  assert.match(event.title, /^Bought 100 NVDA @ \$130\.00$/);
  assert.equal(event.date, '2024-01-15');
  assert.equal(event.meta.purchaseDateProvided, true);
});

test('position WITHOUT purchase date: title says "Added to Outpost"', () => {
  const event = positionToOpenEvent({
    id: 'p2', ticker: 'NVDA', shares: 100, avg_cost: 130,
    purchased_at: null,
    created_at: '2026-05-27',
    entry_thesis: null,
  });
  assert.match(event.title, /Added 100 NVDA/);
  assert.match(event.title, /Outpost/);
  assert.match(event.title, /purchase date not specified/);
  assert.equal(event.meta.purchaseDateProvided, false);
});

test('position WITHOUT purchase date: excerpt explains user did not specify', () => {
  const event = positionToOpenEvent({
    id: 'p3', ticker: 'AAPL', shares: 50, avg_cost: 200,
    purchased_at: null,
    created_at: '2026-05-27',
    entry_thesis: null,
  });
  assert.match(event.excerpt, /did not specify when they actually bought/);
});

test('position WITHOUT purchase date but WITH thesis: excerpt is the thesis', () => {
  const event = positionToOpenEvent({
    id: 'p4', ticker: 'AAPL', shares: 50, avg_cost: 200,
    purchased_at: null,
    created_at: '2026-05-27',
    entry_thesis: 'Solid balance sheet, services growth.',
  });
  // The thesis takes precedence over the explanatory text because the agent
  // wants to see what the user wrote, not boilerplate about missing data.
  assert.match(event.excerpt, /Solid balance sheet/);
});

test('position with no openDate at all: returns null (no event)', () => {
  const event = positionToOpenEvent({
    id: 'p5', ticker: 'AAPL', shares: 50, avg_cost: 200,
    purchased_at: null,
    created_at: null,
  });
  assert.equal(event, null);
});

test('null input returns null safely', () => {
  assert.equal(positionToOpenEvent(null), null);
  assert.equal(positionToOpenEvent(undefined), null);
});

test('event id stable across calls (so dedupe works)', () => {
  const p = {
    id: 'p1', ticker: 'AAPL', shares: 10, avg_cost: 175,
    purchased_at: null, created_at: '2026-05-27', entry_thesis: null,
  };
  const a = positionToOpenEvent(p);
  const b = positionToOpenEvent(p);
  assert.equal(a.id, b.id);
  assert.equal(a.id, 'open:p1');
});

// ─── Run ────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
