// Pins the "today's move" math: only narrate positions we can actually price,
// count the rest as unpriced (never a fake flat), rank movers by dollar impact,
// and report worst-case quote recency. Pure, no IO.
import { summarizeMovers } from '../api/services/moverSummary.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error(`${msg || 'eq'}: expected ${B}, got ${A}`);
}
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }

test('no positions returns null', () => {
  eq(summarizeMovers([], {}), null, 'empty');
  eq(summarizeMovers(null, {}), null, 'null');
  eq(summarizeMovers(undefined), null, 'undefined');
});

test('only prices what it can, counts the rest as unpriced', () => {
  const positions = [
    { ticker: 'NVDA', shares: 10 },
    { ticker: 'AAPL', shares: 5 },
    { ticker: 'TSLA', shares: 2 },
    { ticker: 'MSFT', shares: 3 },  // missing from price map
    { ticker: 'AMD', shares: 4 },   // has price but null change
  ];
  const priceMap = {
    NVDA: { price: 100, changePercent: 5, updatedAt: 1000 },
    AAPL: { price: 200, changePercent: -2, updatedAt: 2000 },
    TSLA: { price: 50, changePercent: 0, updatedAt: 3000 },
    AMD: { price: 50, changePercent: null, updatedAt: 1500 },
  };
  const r = summarizeMovers(positions, priceMap);
  eq(r.positionCount, 5, 'positionCount');
  eq(r.pricedCount, 3, 'pricedCount');   // NVDA, AAPL, TSLA
  eq(r.unpricedCount, 2, 'unpricedCount'); // MSFT missing, AMD null change
  eq(r.pricesAsOf, 1000, 'oldest quote timestamp');
  eq(r.winners.map(w => w.ticker), ['NVDA'], 'winners');
  eq(r.losers.map(l => l.ticker), ['AAPL'], 'losers');     // TSLA flat -> neither
  eq(r.totalChange, 27.21, 'totalChange');
  eq(r.totalChangePct, 1.31, 'totalChangePct');
});

test('a position with no live price is never narrated as flat', () => {
  const r = summarizeMovers([{ ticker: 'X', shares: 10 }], { X: null });
  eq(r.pricedCount, 0, 'none priced');
  eq(r.unpricedCount, 1, 'one unpriced');
  eq(r.winners, [], 'no winners');
  eq(r.losers, [], 'no losers');
  eq(r.totalChangePct, 0, 'flat pct when nothing priced');
  eq(r.pricesAsOf, null, 'no asOf when nothing priced');
});

test('null and non-finite prices are treated as unpriced', () => {
  const r = summarizeMovers(
    [{ ticker: 'A', shares: 1 }, { ticker: 'B', shares: 1 }, { ticker: 'C', shares: 1 }],
    { A: { price: 'oops', changePercent: 5 }, B: { price: -3, changePercent: 5 }, C: { price: 0, changePercent: 5 } },
  );
  eq(r.pricedCount, 0, 'garbage prices excluded');
  eq(r.unpricedCount, 3, 'all three unpriced');
});

test('winners are ranked by dollar impact and capped at three', () => {
  const positions = [10, 20, 30, 40].map((pct, i) => ({ ticker: `W${i}`, shares: 1 }));
  const priceMap = {
    W0: { price: 100, changePercent: 10, updatedAt: 5 },
    W1: { price: 100, changePercent: 20, updatedAt: 5 },
    W2: { price: 100, changePercent: 30, updatedAt: 5 },
    W3: { price: 100, changePercent: 40, updatedAt: 5 },
  };
  const r = summarizeMovers(positions, priceMap);
  eq(r.winners.length, 3, 'capped at 3');
  eq(r.winners[0].changePct, 40, 'biggest impact first');
  eq(r.winners[2].changePct, 20, 'third place');
});

test('pricesAsOf is the oldest quote among priced positions', () => {
  const r = summarizeMovers(
    [{ ticker: 'A', shares: 1 }, { ticker: 'B', shares: 1 }],
    { A: { price: 10, changePercent: 1, updatedAt: 9000 }, B: { price: 10, changePercent: 1, updatedAt: 4000 } },
  );
  eq(r.pricesAsOf, 4000, 'oldest wins');
});

test('garbage inputs never throw', () => {
  for (const bad of [[{}], [{ ticker: 'A', shares: 'x' }], [null], [{ ticker: 'A', shares: 1 }]]) {
    const r = summarizeMovers(bad, { A: { price: 10, changePercent: 'no' } });
    ok(r && Number.isFinite(r.pricedCount), 'returns a shape');
  }
});

let pass = 0, fail = 0;
for (const { n, f } of tests) {
  try { f(); console.log(`ok   ${n}`); pass++; }
  catch (e) { console.log(`FAIL ${n}: ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
