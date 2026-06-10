// Pins buildFundedBuyArgs: the fill-if-absent merge rule and the new-position field
// mapping that the atomic funded-buy RPC relies on. If this drifts from the route, a
// merge could clobber an existing thesis/target/stop, or a buy could debit the wrong
// cost, so it is locked here.
import { buildFundedBuyArgs } from '../src/lib/buyMath.js';

const NOW = '2026-06-10T00:00:00.000Z';
const tests = [];
const test = (n, f) => tests.push({ n, f });
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'expected truthy'); };

test('new position: maps every provided field and computes cost', () => {
  const a = buildFundedBuyArgs({
    held: null, ticker: 'ACME', shares: 10, avgCost: 50, companyName: 'Acme', purchaseDate: null,
    entryThesis: 'AI tailwind', reversalCondition: 'breaks 40', priceTarget: 80,
    stopLoss: 40, tradeNotes: 'starter', thesisSource: 'user', source: 'screener', nowIso: NOW,
  });
  eq(a.mode, 'new'); eq(a.positionId, null); eq(a.ticker, 'ACME');
  eq(a.cost, 500, 'cost = shares*avgCost');
  eq(a.shares, 10); eq(a.avgCost, 50);
  eq(a.entryThesis, 'AI tailwind'); eq(a.thesisWrittenAt, NOW); eq(a.thesisSource, 'user');
  eq(a.priceTarget, 80); eq(a.stopLoss, 40); eq(a.reversalCondition, 'breaks 40');
  eq(a.tradeNotes, 'starter'); eq(a.source, 'screener');
});

test("new position: 'manual' source and a missing thesis collapse to null", () => {
  const a = buildFundedBuyArgs({ held: null, shares: 5, avgCost: 20, source: 'manual', nowIso: NOW });
  eq(a.source, null, "manual source is not stored");
  eq(a.entryThesis, null); eq(a.thesisWrittenAt, null); eq(a.thesisSource, null);
  eq(a.priceTarget, null); eq(a.stopLoss, null);
  eq(a.cost, 100);
});

test('merge: blends shares/avg_cost and debits only the added lot', () => {
  const held = { id: 'p1', shares: 10, avg_cost: 100, entry_thesis: null, price_target: null, stop_loss: null };
  const a = buildFundedBuyArgs({ held, shares: 10, avgCost: 200, nowIso: NOW });
  eq(a.mode, 'merge'); eq(a.positionId, 'p1');
  eq(a.shares, 20, 'blended shares'); eq(a.avgCost, 150, 'weighted average');
  eq(a.cost, 2000, 'cost is the ADDED lot, not the blended book');
});

test('merge: fills plan fields ONLY when the held position lacks them', () => {
  const held = { id: 'p1', shares: 10, avg_cost: 100, entry_thesis: null, price_target: null, stop_loss: null };
  const a = buildFundedBuyArgs({
    held, shares: 5, avgCost: 120, entryThesis: 'new thesis', priceTarget: 200,
    stopLoss: 90, thesisSource: 'user', nowIso: NOW,
  });
  eq(a.entryThesis, 'new thesis'); eq(a.thesisWrittenAt, NOW); eq(a.thesisSource, 'user');
  eq(a.priceTarget, 200); eq(a.stopLoss, 90);
});

test('merge: NEVER clobbers an existing thesis / target / stop (passes null)', () => {
  const held = { id: 'p1', shares: 10, avg_cost: 100, entry_thesis: 'old thesis', price_target: 150, stop_loss: 80 };
  const a = buildFundedBuyArgs({
    held, shares: 5, avgCost: 120, entryThesis: 'new thesis', priceTarget: 999,
    stopLoss: 10, thesisSource: 'user', nowIso: NOW,
  });
  eq(a.entryThesis, null, 'existing thesis preserved'); eq(a.thesisWrittenAt, null); eq(a.thesisSource, null);
  eq(a.priceTarget, null, 'existing target preserved'); eq(a.stopLoss, null, 'existing stop preserved');
  // but the blend and cost still apply
  eq(a.shares, 15); eq(a.cost, 600);
});

test('cost rounds to cents', () => {
  const a = buildFundedBuyArgs({ held: null, shares: 3, avgCost: 33.333, nowIso: NOW });
  eq(a.cost, 100, '3 * 33.333 = 99.999 -> 100.00');
});

let pass = 0, fail = 0;
for (const { n, f } of tests) {
  try { f(); console.log(`ok   ${n}`); pass++; }
  catch (e) { console.log(`FAIL ${n}: ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
