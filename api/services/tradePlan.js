// "Think it through" trade-plan assessment. The math already exists (tradeMath:
// risk-based sizing + risk/reward), and the agent already has those tools. What
// is missing is the DISCIPLINE: running all of it, in order, and being honest
// about whether the user actually has a plan or a gut buy. This layer takes the
// pieces, reuses the tested math, and grades the plan's completeness, naming the
// one step almost everyone skips: the invalidation condition (what would prove
// you wrong). Pure and dependency-light, so it is unit-testable.

import { calculatePositionSize, calculateRiskReward } from './tradeMath.js';

const hasText = (v) => typeof v === 'string' && v.trim().length > 0;
const isPrice = (v) => Number.isFinite(v) && v > 0;

// The six disciplines of a thought-through entry, in the order a careful process
// runs them. Each carries WHY it matters, so a gap is a teaching moment.
const ORDER = ['thesis', 'invalidation', 'stop', 'target', 'sized', 'review'];
const LABEL = {
  thesis: 'Thesis (why you own it)',
  invalidation: 'Invalidation (what would prove you wrong)',
  stop: 'Stop loss',
  target: 'Target',
  sized: 'Sized to the risk',
  review: 'Review date',
};
const WHY = {
  thesis: 'The one reason you own it. Without it you cannot tell a thesis breaking from a normal dip.',
  invalidation: 'What would prove you wrong. This is the step almost everyone skips, and it is the one that turns a small loss into a big one.',
  stop: 'The price where you admit the trade is not working. A stop is the difference between a plan and hope.',
  target: 'Where you would take profit. Without it there is no risk-to-reward, so you cannot tell a good setup from a bad one.',
  sized: 'How much to buy so a stop-out costs a set slice of your account, not a number picked out of excitement.',
  review: 'When you will check in on purpose, so the position stays decided, not just held.',
};

/**
 * @param input { entry_price, stop_loss, target_price, account_size, risk_pct,
 *                thesis, invalidation, review_in_days }
 * @returns { verdict, headline, completeness, total, steps[], missing[],
 *            sizing, riskReward, warnings[] }
 */
export function assessTradePlan(input = {}) {
  const s = input || {};
  const { entry_price, stop_loss, target_price, account_size, risk_pct = 2, thesis, invalidation, review_in_days } = s;

  // Reuse the existing, tested math. Sizing needs account + entry + stop.
  let sizing = null;
  if (isPrice(account_size) && isPrice(entry_price) && isPrice(stop_loss)) {
    const r = calculatePositionSize({ account_size, risk_pct, entry_price, stop_loss, target_price });
    sizing = r && !r.error ? r : null;
  }
  let riskReward = null;
  if (isPrice(entry_price) && isPrice(stop_loss) && isPrice(target_price)) {
    const r = calculateRiskReward({ entry_price, stop_loss, targets: [target_price] });
    riskReward = r && !r.error ? r : null;
  }

  const has = {
    thesis: hasText(thesis),
    invalidation: hasText(invalidation),
    stop: isPrice(stop_loss) && (!isPrice(entry_price) || stop_loss < entry_price),
    target: isPrice(target_price) && (!isPrice(entry_price) || target_price > entry_price),
    sized: !!(sizing && sizing.shares_to_buy > 0),
    review: Number.isFinite(review_in_days) && review_in_days > 0,
  };

  const steps = ORDER.map(k => ({ key: k, label: LABEL[k], present: has[k], why: WHY[k] }));
  const missing = ORDER.filter(k => !has[k]);
  const completeness = ORDER.length - missing.length;

  // Verdict. A risk-defined plan needs at minimum a reason, a line that proves it
  // wrong, and a stop. No stop AND no invalidation is a gut buy, the trade that
  // hurts. Calibrated and honest, never a scold.
  let verdict, headline;
  if (!has.stop && !has.invalidation) {
    verdict = 'gut_buy';
    headline = 'Right now this is a gut buy. You have a ticker, but nothing that says when you are wrong and nothing that caps the loss. That is the trade that hurts.';
  } else if (has.thesis && has.invalidation && has.stop) {
    verdict = 'thought_through';
    headline = missing.length === 0
      ? 'This is a complete plan: a reason, a line that proves you wrong, a stop, a target, a size set to the risk, and a date to review. That is rare discipline.'
      : `Solid plan. You have the hard parts: a reason, what would prove you wrong, and a stop. Still open: ${missing.map(k => LABEL[k].toLowerCase()).join(', ')}.`;
  } else {
    verdict = 'has_gaps';
    const first = missing[0];
    headline = `Close, but not a plan yet. The piece missing is the ${LABEL[first].toLowerCase()}. ${WHY[first]}`;
  }

  return {
    verdict,
    headline,
    completeness,
    total: ORDER.length,
    steps,
    missing,
    sizing,
    riskReward,
    warnings: sizing && Array.isArray(sizing.warnings) ? sizing.warnings : [],
  };
}
