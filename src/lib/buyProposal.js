// Pure validation and normalization for an agent-PROPOSED new buy. The sibling of
// positionProposal.js: that one drafts a change to a HELD position; this one drafts
// a brand-new purchase the trader is about to make on the agent's suggestion.
//
// This NEVER writes. It returns a normalized proposal the UI renders into a confirm
// card and applies through POST /positions (tagged source 'agent', so the reward
// signal can finally see chat-driven advice), or a rejection with a machine code the
// agent turns into a plain-English clarification. Outpost is long only, so a valid
// stop sits below the live price and a valid target above it, and the stop sits
// below the target. Sizing accepts whole shares or a dollar budget (floored to
// whole shares against the live price).

const fin = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const round2 = (n) => Math.round(n * 100) / 100;

export const BUY_PROPOSAL_REJECTIONS = {
  no_ticker: 'No ticker was given, so there is nothing to propose buying.',
  no_price: 'There is no live price for that ticker right now, so the buy cannot be sized or checked.',
  no_size: 'No size was given. Provide either a dollar amount to invest or a share count.',
  size_too_small: 'The dollar amount is smaller than one share at the current price. Ask the trader for a larger amount.',
  bad_stop: 'The stop loss is not a valid positive price.',
  stop_above_price: 'The stop loss is at or above the current price. For a long buy the stop sits below the price; ask the trader to confirm.',
  bad_target: 'The take profit is not a valid positive price.',
  target_below_price: 'The take profit is at or below the current price. For a long buy the target sits above the price; ask the trader to confirm.',
};

/**
 * Build a normalized buy proposal, or reject it.
 *
 * @param input   { ticker, company_name?, dollars?, shares?, thesis?, stop_loss?, take_profit?, rationale? }
 * @param context { price: number | null (the live price) }
 * @returns       { ok: true, proposal } | { ok: false, error: <code> }
 */
export function buildBuyProposal(input = {}, { price = null } = {}) {
  const sym = typeof input.ticker === 'string' ? input.ticker.toUpperCase().trim() : '';
  if (!sym) return { ok: false, error: 'no_ticker' };

  const live = fin(price);
  if (live == null || live <= 0) return { ok: false, error: 'no_price' };

  // Size: an explicit positive share count wins; otherwise convert a dollar budget
  // to whole shares at the live price.
  let shares = fin(input.shares);
  if (shares == null || shares <= 0) {
    const dollars = fin(input.dollars);
    if (dollars == null || dollars <= 0) return { ok: false, error: 'no_size' };
    shares = Math.floor(dollars / live);
    if (shares <= 0) return { ok: false, error: 'size_too_small' };
  } else {
    shares = Math.floor(shares); // whole shares only
    if (shares <= 0) return { ok: false, error: 'no_size' };
  }

  const fields = { shares, avgCost: round2(live), estCost: round2(shares * live) };

  if (input.thesis != null && String(input.thesis).trim()) {
    fields.entryThesis = String(input.thesis).trim().slice(0, 500);
  }
  if (input.stop_loss != null && String(input.stop_loss).trim() !== '') {
    const stop = fin(input.stop_loss);
    if (stop == null || stop <= 0) return { ok: false, error: 'bad_stop' };
    if (stop >= live) return { ok: false, error: 'stop_above_price' };
    fields.stopLoss = round2(stop);
  }
  if (input.take_profit != null && String(input.take_profit).trim() !== '') {
    const tp = fin(input.take_profit);
    if (tp == null || tp <= 0) return { ok: false, error: 'bad_target' };
    if (tp <= live) return { ok: false, error: 'target_below_price' };
    fields.priceTarget = round2(tp);
  }
  // No stop-vs-target check needed: a live price is required, and long-only forces
  // stop < price < target, so the stop is always below the target here.

  return {
    ok: true,
    proposal: {
      kind: 'buy',
      ticker: sym,
      companyName: input.company_name ? String(input.company_name).trim().slice(0, 80) : null,
      fields,
      rationale: input.rationale ? String(input.rationale).trim().slice(0, 300) : null,
      livePrice: round2(live),
      source: 'agent',
    },
  };
}
