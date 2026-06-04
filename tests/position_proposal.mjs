// Pins the guardrails on agent-proposed position plan changes
// (src/lib/positionProposal.js). The agent never writes; this is the validator
// that decides whether a draft becomes a confirm card or a clarification. Long
// only: stop below live price, target above, stop below target.
import assert from 'node:assert/strict';
import { buildPositionProposal, PROPOSAL_REJECTIONS } from '../src/lib/positionProposal.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

const POS = { id: 'p1', ticker: 'NVDA' };

test('rejects a ticker the trader does not hold', () => {
  const r = buildPositionProposal({ thesis: 'x' }, { position: null, price: 100 });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_held');
});

test('thesis-only proposal normalizes and caps at 500 chars', () => {
  const r = buildPositionProposal({ thesis: '  data center demand  ' }, { position: POS, price: 100 });
  assert.equal(r.ok, true);
  assert.equal(r.proposal.fields.entryThesis, 'data center demand');
  assert.equal(r.proposal.kind, 'position_update');
  assert.equal(r.proposal.positionId, 'p1');
  assert.equal(r.proposal.ticker, 'NVDA');

  const long = buildPositionProposal({ thesis: 'y'.repeat(900) }, { position: POS, price: 100 });
  assert.equal(long.proposal.fields.entryThesis.length, 500);
});

test('a stop below the live price is accepted and rounded', () => {
  const r = buildPositionProposal({ stop_loss: 88.005 }, { position: POS, price: 100 });
  assert.equal(r.ok, true);
  assert.equal(r.proposal.fields.stopLoss, 88.01);
  assert.equal(r.proposal.fields.priceTarget, undefined);
});

test('a stop at or above the live price is rejected (long only)', () => {
  assert.equal(buildPositionProposal({ stop_loss: 105 }, { position: POS, price: 100 }).error, 'stop_above_price');
  assert.equal(buildPositionProposal({ stop_loss: 100 }, { position: POS, price: 100 }).error, 'stop_above_price');
});

test('a target above the live price is accepted; at or below is rejected', () => {
  assert.equal(buildPositionProposal({ take_profit: 130 }, { position: POS, price: 100 }).proposal.fields.priceTarget, 130);
  assert.equal(buildPositionProposal({ take_profit: 95 }, { position: POS, price: 100 }).error, 'target_below_price');
  assert.equal(buildPositionProposal({ take_profit: 100 }, { position: POS, price: 100 }).error, 'target_below_price');
});

test('non-positive or junk numbers are rejected', () => {
  assert.equal(buildPositionProposal({ stop_loss: -5 }, { position: POS, price: 100 }).error, 'bad_stop');
  assert.equal(buildPositionProposal({ stop_loss: 'abc' }, { position: POS, price: 100 }).error, 'bad_stop');
  assert.equal(buildPositionProposal({ take_profit: 0 }, { position: POS, price: 100 }).error, 'bad_target');
});

test('stop at or above target is rejected even if each is individually valid', () => {
  // both sides valid vs a 100 price (stop 95 < price, target 120 > price) but stop > target after swap
  const r = buildPositionProposal({ stop_loss: 99, take_profit: 130 }, { position: POS, price: 100 });
  assert.equal(r.ok, true); // 99 < 100 < 130, fine
  const bad = buildPositionProposal({ stop_loss: 96, take_profit: 95 }, { position: POS, price: 100 });
  // 96 >= price? no (96<100 ok), 95 <= price (100) -> target_below_price fires first
  assert.equal(bad.error, 'target_below_price');
  // construct a case where both pass the price checks but stop>=target is impossible
  // for a long (stop<price<target always implies stop<target), so verify the guard
  // directly when price is unknown:
  const noPrice = buildPositionProposal({ stop_loss: 120, take_profit: 110 }, { position: POS, price: null });
  assert.equal(noPrice.error, 'stop_above_target');
});

test('with no live price, positivity and stop<target still hold but the above/below checks are skipped', () => {
  const r = buildPositionProposal({ stop_loss: 90, take_profit: 110 }, { position: POS, price: null });
  assert.equal(r.ok, true);
  assert.equal(r.proposal.fields.stopLoss, 90);
  assert.equal(r.proposal.fields.priceTarget, 110);
  assert.equal(r.proposal.livePrice, null);
});

test('empty draft (no thesis, stop, or target) has nothing to propose', () => {
  assert.equal(buildPositionProposal({}, { position: POS, price: 100 }).error, 'nothing_to_change');
  assert.equal(buildPositionProposal({ thesis: '   ' }, { position: POS, price: 100 }).error, 'nothing_to_change');
});

test('all three fields together produce one combined proposal with rationale', () => {
  const r = buildPositionProposal(
    { thesis: 'AI capex cycle', stop_loss: 85, take_profit: 140, rationale: 'risk 15% to make 40%' },
    { position: POS, price: 100 },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.proposal.fields, { entryThesis: 'AI capex cycle', stopLoss: 85, priceTarget: 140 });
  assert.equal(r.proposal.rationale, 'risk 15% to make 40%');
  assert.equal(r.proposal.livePrice, 100);
});

test('every rejection code has a plain-English message for the agent', () => {
  for (const code of ['not_held', 'nothing_to_change', 'bad_stop', 'bad_target', 'stop_above_price', 'target_below_price', 'stop_above_target']) {
    assert.ok(PROPOSAL_REJECTIONS[code] && PROPOSAL_REJECTIONS[code].length > 0, `missing message for ${code}`);
  }
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
