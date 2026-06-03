// Pins the "What needs you" action list (src/lib/portfolioActions.js): the
// prioritized, proactive, one-per-name decisions at the top of the Portfolio tab.
import assert from 'node:assert/strict';
import { buildPortfolioActions } from '../src/lib/portfolioActions.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
const P = (o) => ({ shares: 10, todayChangePercent: 0, ...o });

test('flags a broken stop as the top action', () => {
  const a = buildPortfolioActions([P({ ticker: 'X', currentPrice: 90, avg_cost: 100, stop_loss: 95 })], 1000);
  assert.equal(a[0].ticker, 'X');
  assert.match(a[0].text, /broke its stop/);
  assert.equal(a[0].actionType, 'research');
});

test('flags a target hit', () => {
  const a = buildPortfolioActions([P({ ticker: 'X', currentPrice: 120, avg_cost: 100, price_target: 110 })], 1000);
  assert.match(a[0].text, /hit your target/);
});

test('flags a deep drawdown', () => {
  const a = buildPortfolioActions([P({ ticker: 'X', currentPrice: 70, avg_cost: 100 })], 1000);
  assert.match(a[0].text, /down 30% from your cost/);
});

test('proactively flags a winner with no stop', () => {
  const a = buildPortfolioActions([P({ ticker: 'X', currentPrice: 150, avg_cost: 100 })], 100000);
  assert.match(a[0].text, /up 50% with no stop/);
  assert.equal(a[0].actionType, 'ask');
  assert.match(a[0].askMessage, /set a sensible stop/);
});

test('flags single-name concentration (when not a no-stop winner)', () => {
  const a = buildPortfolioActions([P({ ticker: 'BIG', currentPrice: 110, avg_cost: 100, shares: 100, stop_loss: 90 })], 27500);
  assert.match(a[0].text, /of your book/);
  assert.equal(a[0].actionLabel, 'TRIM?');
});

test('flags a missing thesis on a meaningful, planned, calm position', () => {
  const a = buildPortfolioActions([P({ ticker: 'X', currentPrice: 102, avg_cost: 100, stop_loss: 95, price_target: 130, shares: 10 })], 10200);
  assert.match(a[0].text, /no thesis on record/);
  assert.equal(a[0].actionLabel, 'WRITE WHY');
});

test('a calm, planned, thesis-backed position produces no action', () => {
  const a = buildPortfolioActions([P({ ticker: 'X', currentPrice: 102, avg_cost: 100, stop_loss: 95, price_target: 130, entry_thesis: 'good co', shares: 1 })], 1000000);
  assert.equal(a.length, 0);
});

test('one action per ticker, capped at five, highest severity first', () => {
  const many = [];
  for (let i = 0; i < 8; i++) many.push(P({ ticker: `T${i}`, currentPrice: 60, avg_cost: 100 }));
  const a = buildPortfolioActions(many, 100000);
  assert.equal(a.length, 5);
  assert.ok(a.every((x, i) => i === 0 || a[i - 1].severity >= x.severity));
  assert.equal(new Set(a.map(x => x.ticker)).size, a.length);
});

test('junk input does not crash', () => {
  assert.deepEqual(buildPortfolioActions(null, 0), []);
  assert.deepEqual(buildPortfolioActions([null, {}], 0), []);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
