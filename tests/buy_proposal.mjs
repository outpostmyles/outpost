// Pins the agent buy-proposal builder (src/lib/buyProposal.js): sizing from
// dollars or shares, long-only level validation, and the normalized confirm-card
// shape tagged source 'agent'. This never writes; it only drafts.
import assert from 'node:assert/strict';
import { buildBuyProposal, BUY_PROPOSAL_REJECTIONS } from '../src/lib/buyProposal.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('sizes a dollar budget into whole shares at the live price', () => {
  const r = buildBuyProposal({ ticker: 'nvda', dollars: 1000 }, { price: 90 });
  assert.equal(r.ok, true);
  assert.equal(r.proposal.kind, 'buy');
  assert.equal(r.proposal.ticker, 'NVDA');        // uppercased
  assert.equal(r.proposal.fields.shares, 11);     // floor(1000/90)
  assert.equal(r.proposal.fields.avgCost, 90);
  assert.equal(r.proposal.fields.estCost, 990);
  assert.equal(r.proposal.source, 'agent');       // the whole point: this counts as advised
});

test('an explicit share count wins over dollars and floors to whole shares', () => {
  const r = buildBuyProposal({ ticker: 'AMD', shares: 7.9, dollars: 99999 }, { price: 100 });
  assert.equal(r.proposal.fields.shares, 7);
  assert.equal(r.proposal.fields.estCost, 700);
});

test('carries thesis, stop, and target when they are valid (long only)', () => {
  const r = buildBuyProposal(
    { ticker: 'COST', dollars: 5000, thesis: 'membership moat compounding', stop_loss: 800, take_profit: 1100, rationale: 'support held' },
    { price: 900 },
  );
  assert.equal(r.ok, true);
  assert.equal(r.proposal.fields.entryThesis, 'membership moat compounding');
  assert.equal(r.proposal.fields.stopLoss, 800);
  assert.equal(r.proposal.fields.priceTarget, 1100);
  assert.equal(r.proposal.rationale, 'support held');
});

test('rejects a stop at or above the price, and a target at or below it', () => {
  assert.equal(buildBuyProposal({ ticker: 'X', dollars: 1000, stop_loss: 110 }, { price: 100 }).error, 'stop_above_price');
  assert.equal(buildBuyProposal({ ticker: 'X', dollars: 1000, take_profit: 90 }, { price: 100 }).error, 'target_below_price');
  assert.equal(buildBuyProposal({ ticker: 'X', dollars: 1000, stop_loss: 0 }, { price: 100 }).error, 'bad_stop');
});

test('needs a ticker, a live price, and a real size', () => {
  assert.equal(buildBuyProposal({ dollars: 1000 }, { price: 100 }).error, 'no_ticker');
  assert.equal(buildBuyProposal({ ticker: 'X', dollars: 1000 }, { price: 0 }).error, 'no_price');
  assert.equal(buildBuyProposal({ ticker: 'X' }, { price: 100 }).error, 'no_size');
  assert.equal(buildBuyProposal({ ticker: 'X', dollars: 50 }, { price: 100 }).error, 'size_too_small');
});

test('every rejection code has a plain-English message for the agent', () => {
  for (const code of ['no_ticker', 'no_price', 'no_size', 'size_too_small', 'bad_stop', 'stop_above_price', 'bad_target', 'target_below_price']) {
    assert.ok(typeof BUY_PROPOSAL_REJECTIONS[code] === 'string' && BUY_PROPOSAL_REJECTIONS[code].length > 0, code);
  }
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
