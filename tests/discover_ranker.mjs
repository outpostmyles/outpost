// Unit tests for the Social Discover feed ranker.
//
// buildDiscoverFeed merges 4 sources (catalysts, hot sectors, bargain picks,
// trending) into one priority-ranked list. Before this the Discover view
// stacked 4 separate sections and felt like a wall of text. These tests pin
// the ranking order, the cap, the empty-input handling, and the item shape so
// a future refactor can't silently reshuffle what users see on top.
import assert from 'node:assert/strict';
import { buildDiscoverFeed, discoverAskPrompt } from '../src/components/social/discoverRanker.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// Small builders so each test only specifies the fields it cares about.
function drop(stocks, extra = {}) {
  return { scheduledTime: '09:15', label: 'morning', isGenerated: true, stocks, ...extra };
}
function catalystData(stocks) {
  return { drops: [drop(stocks)] };
}

// ─── Empty / missing input ────────────────────────────────────────────────

test('returns [] when called with no args', () => {
  assert.deepEqual(buildDiscoverFeed(), []);
});

test('returns [] when all sources empty', () => {
  const out = buildDiscoverFeed({ catalystData: {}, sector: {}, bargain: {}, buzz: {} });
  assert.deepEqual(out, []);
});

test('tolerates null sources without throwing', () => {
  const out = buildDiscoverFeed({ catalystData: null, sector: null, bargain: null, buzz: null });
  assert.deepEqual(out, []);
});

test('skips catalyst stocks with no ticker', () => {
  const out = buildDiscoverFeed({
    catalystData: catalystData([{ changePct: 5 }, { ticker: 'AAPL', changePct: 3 }]),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].ticker, 'AAPL');
});

// ─── Ranking order across sources ───────────────────────────────────────────

test('high-flame catalyst outranks strong sector outranks bargain outranks trending', () => {
  const out = buildDiscoverFeed({
    catalystData: catalystData([{ ticker: 'NVDA', changePct: 6, flameRating: 3 }]),
    sector: { heating: [{ name: 'Energy', signal: 'strong', relativeStrength: 4 }] },
    bargain: { picks: [{ ticker: 'DIS', pctOffHigh: -22 }] },
    buzz: { buzzing: [{ ticker: 'GME', changePct: 1, watchlistCount: 9000 }] },
  });
  assert.deepEqual(out.map(i => i.type), ['catalyst', 'sector', 'bargain', 'trending']);
});

test('low-flame catalyst still outranks bargain but sits below strong sector', () => {
  const out = buildDiscoverFeed({
    catalystData: catalystData([{ ticker: 'F', changePct: 2, flameRating: 1 }]),
    sector: { heating: [{ name: 'Energy', signal: 'strong', relativeStrength: 4 }] },
    bargain: { picks: [{ ticker: 'DIS', pctOffHigh: -22 }] },
  });
  assert.deepEqual(out.map(i => i.type), ['sector', 'catalyst', 'bargain']);
});

test('early sector signal sorts below bargain', () => {
  const out = buildDiscoverFeed({
    sector: { heating: [{ name: 'Energy', signal: 'early', relativeStrength: 2 }] },
    bargain: { picks: [{ ticker: 'DIS', pctOffHigh: -22 }] },
  });
  assert.deepEqual(out.map(i => i.type), ['bargain', 'sector']);
});

test('catalysts within the pool rank by absolute percent move', () => {
  const out = buildDiscoverFeed({
    catalystData: catalystData([
      { ticker: 'AAA', changePct: 2, flameRating: 2 },
      { ticker: 'BBB', changePct: -9, flameRating: 2 },
      { ticker: 'CCC', changePct: 5, flameRating: 2 },
    ]),
  });
  // Same priority (flame 2), so absolute-move ordering from the pre-sort wins.
  assert.deepEqual(out.map(i => i.ticker), ['BBB', 'CCC', 'AAA']);
});

// ─── Caps per source ────────────────────────────────────────────────────────

test('caps catalysts at top 5 by absolute move', () => {
  const stocks = Array.from({ length: 8 }, (_, i) => ({
    ticker: `T${i}`, changePct: i + 1, flameRating: 1,
  }));
  const out = buildDiscoverFeed({ catalystData: catalystData(stocks) }, 50);
  const catalysts = out.filter(i => i.type === 'catalyst');
  assert.equal(catalysts.length, 5);
  // Biggest movers kept: T7..T3 (changePct 8..4).
  assert.deepEqual(catalysts.map(i => i.ticker), ['T7', 'T6', 'T5', 'T4', 'T3']);
});

test('caps heating sectors at 3 and cooling at 2', () => {
  const out = buildDiscoverFeed({
    sector: {
      heating: Array.from({ length: 5 }, (_, i) => ({ name: `H${i}`, signal: 'early' })),
      cooling: Array.from({ length: 4 }, (_, i) => ({ name: `C${i}`, signal: 'early' })),
    },
  }, 50);
  const sectors = out.filter(i => i.type === 'sector');
  assert.equal(sectors.length, 5);
});

test('caps bargains at 4 and trending at 6', () => {
  const out = buildDiscoverFeed({
    bargain: { picks: Array.from({ length: 7 }, (_, i) => ({ ticker: `B${i}`, pctOffHigh: -10 })) },
    buzz: { buzzing: Array.from({ length: 9 }, (_, i) => ({ ticker: `Z${i}`, changePct: 1 })) },
  }, 50);
  assert.equal(out.filter(i => i.type === 'bargain').length, 4);
  assert.equal(out.filter(i => i.type === 'trending').length, 6);
});

// ─── Global limit ─────────────────────────────────────────────────────────

test('honors the limit cap after sorting', () => {
  const out = buildDiscoverFeed({
    catalystData: catalystData([
      { ticker: 'A', changePct: 6, flameRating: 3 },
      { ticker: 'B', changePct: 5, flameRating: 3 },
    ]),
    buzz: { buzzing: Array.from({ length: 6 }, (_, i) => ({ ticker: `Z${i}`, changePct: 1 })) },
  }, 3);
  assert.equal(out.length, 3);
  // The two high-flame catalysts must survive the cap; trending gets cut.
  assert.deepEqual(out.slice(0, 2).map(i => i.type), ['catalyst', 'catalyst']);
});

test('default limit is 10', () => {
  const out = buildDiscoverFeed({
    buzz: { buzzing: Array.from({ length: 6 }, (_, i) => ({ ticker: `Z${i}`, changePct: 1 })) },
    bargain: { picks: Array.from({ length: 4 }, (_, i) => ({ ticker: `B${i}`, pctOffHigh: -10 })) },
    sector: { heating: Array.from({ length: 3 }, (_, i) => ({ name: `H${i}`, signal: 'early' })) },
  });
  // 6 + 4 + 3 = 13 eligible, capped to 10.
  assert.equal(out.length, 10);
});

// ─── Item shape ─────────────────────────────────────────────────────────────

test('catalyst item carries the full shape', () => {
  const [item] = buildDiscoverFeed({
    catalystData: catalystData([{
      ticker: 'AAPL', changePct: 3.2, flameRating: 2,
      catalystLabel: 'EARNINGS BEAT', detail: 'Crushed estimates',
    }]),
  });
  assert.equal(item.type, 'catalyst');
  assert.equal(item.ticker, 'AAPL');
  assert.equal(item.title, 'earnings beat');
  assert.equal(item.detail, 'Crushed estimates');
  assert.equal(item.accent, 'orange');
  assert.equal(item.signal, 'CATALYST');
  assert.equal(item.pct, 3.2);
  assert.equal(item.deepLink, 'ondeck');
  assert.equal(item.meta.flame, 2);
  assert.ok(item.id.startsWith('catalyst:AAPL'));
  assert.equal(typeof item.priority, 'number');
});

test('cooling sector is red and flagged direction down', () => {
  const [item] = buildDiscoverFeed({
    sector: { cooling: [{ name: 'Utilities', signal: 'warning', relativeStrength: -3 }] },
  });
  assert.equal(item.type, 'sector');
  assert.equal(item.accent, 'red');
  assert.equal(item.meta.direction, 'down');
  assert.equal(item.deepLink, 'radar');
  assert.ok(item.title.includes('cooling'));
});

test('bargain pct is the drawdown, passed through as the negative it already is', () => {
  // pctOffHigh from the source is negative (price below the 52w high). It must
  // reach the feed still negative, so the UI renders it red ("down 22% off its
  // high"), not flip it to a green +22% that looks like a gain.
  const [item] = buildDiscoverFeed({ bargain: { picks: [{ ticker: 'DIS', pctOffHigh: -22 }] } });
  assert.equal(item.pct, -22);
  assert.equal(item.signal, 'BUYABLE');
  assert.equal(item.deepLink, 'bargain');
});

test('a deep drawdown never renders as a positive (green) pct', () => {
  // Regression for the sign-flip: a stock 59.7% off its high must show negative,
  // never +59.7%.
  const [item] = buildDiscoverFeed({ bargain: { picks: [{ ticker: 'NVTS', pctOffHigh: -59.7 }] } });
  assert.ok(item.pct < 0, `expected negative drawdown, got ${item.pct}`);
  assert.equal(item.pct, -59.7);
});

test('trending detail uses watcher count when present', () => {
  const [item] = buildDiscoverFeed({
    buzz: { buzzing: [{ ticker: 'GME', changePct: 4, watchlistCount: 12000 }] },
  });
  assert.equal(item.signal, 'BUZZ');
  assert.equal(item.deepLink, 'buzz');
  assert.ok(item.detail.includes('12,000'));
});

test('flameRating clamps into 1..3', () => {
  const out = buildDiscoverFeed({
    catalystData: catalystData([
      { ticker: 'HI', changePct: 5, flameRating: 9 },
      { ticker: 'LO', changePct: 4, flameRating: 0 },
    ]),
  });
  const hi = out.find(i => i.ticker === 'HI');
  const lo = out.find(i => i.ticker === 'LO');
  assert.equal(hi.meta.flame, 3);
  assert.equal(lo.meta.flame, 1);
});

test('ids are unique across a mixed feed', () => {
  const out = buildDiscoverFeed({
    catalystData: catalystData([{ ticker: 'AAPL', changePct: 3, flameRating: 2 }]),
    sector: { heating: [{ name: 'Energy', signal: 'strong' }] },
    bargain: { picks: [{ ticker: 'DIS', pctOffHigh: -10 }] },
    buzz: { buzzing: [{ ticker: 'GME', changePct: 1 }] },
  });
  const ids = out.map(i => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('discoverAskPrompt builds a ticker-specific question per type', () => {
  assert.match(discoverAskPrompt({ type: 'catalyst', ticker: 'nvda' }), /^NVDA is moving on a catalyst/);
  assert.match(discoverAskPrompt({ type: 'bargain', ticker: 'AMD' }), /Is AMD a real buyable dip/);
  assert.match(discoverAskPrompt({ type: 'trending', ticker: 'GME' }), /GME is getting a lot of attention/);
  assert.match(discoverAskPrompt({ type: 'sector', title: 'Energy heating up' }), /^Energy heating up is on the radar/);
});

test('discoverAskPrompt falls back gracefully without a ticker or on junk', () => {
  assert.match(discoverAskPrompt({ type: 'catalyst' }), /catalysts moving the market/);
  assert.match(discoverAskPrompt({ type: 'mystery', ticker: 'X' }), /going on with X/);
  assert.equal(discoverAskPrompt(null), '');
});

// ─── Run ────────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
