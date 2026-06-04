// Pure validation and normalization for an agent-PROPOSED change to a position's
// plan fields: the thesis, the stop loss, and the take profit (price target).
// These are the fields a trader sets by hand in Outpost; a linked brokerage syncs
// holdings (shares, cost, value) but never a plan, so this stays useful forever.
//
// This NEVER writes. It returns a normalized proposal the UI renders into a
// confirm card and applies through PATCH /positions/:id, or a rejection with a
// machine code the agent can turn into a plain-English clarification. Outpost is
// long only, so a valid stop sits below the live price and a valid target above
// it, and the stop must sit below the target.

const fin = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const round2 = (n) => Math.round(n * 100) / 100;

export const PROPOSAL_REJECTIONS = {
  not_held: 'That ticker is not in the trader\'s portfolio, so there is no position to update. Only propose plan changes for stocks they already hold.',
  nothing_to_change: 'No thesis, stop, or target was provided, so there is nothing to propose.',
  bad_stop: 'The stop loss is not a valid positive price.',
  bad_target: 'The take profit is not a valid positive price.',
  stop_above_price: 'The stop loss is at or above the current price. For a long position a stop sits below the price; ask the trader to confirm the level.',
  target_below_price: 'The take profit is at or below the current price. For a long position a target sits above the price; ask the trader to confirm the level.',
  stop_above_target: 'The stop loss is at or above the take profit. Ask the trader to clarify the levels.',
};

/**
 * Build a normalized position-update proposal, or reject it.
 *
 * @param input    { thesis?, stop_loss?, take_profit?, rationale? } as drafted by the agent
 * @param context  { position: { id, ticker } | null, price: number | null (the live price, if known) }
 * @returns        { ok: true, proposal } | { ok: false, error: <code> }
 */
export function buildPositionProposal(input = {}, { position = null, price = null } = {}) {
  if (!position?.id) return { ok: false, error: 'not_held' };

  const fields = {};
  const live = fin(price);

  if (input.thesis != null && String(input.thesis).trim()) {
    fields.entryThesis = String(input.thesis).trim().slice(0, 500);
  }

  if (input.stop_loss != null && String(input.stop_loss).trim() !== '') {
    const stop = fin(input.stop_loss);
    if (stop == null || stop <= 0) return { ok: false, error: 'bad_stop' };
    if (live != null && stop >= live) return { ok: false, error: 'stop_above_price' };
    fields.stopLoss = round2(stop);
  }

  if (input.take_profit != null && String(input.take_profit).trim() !== '') {
    const tp = fin(input.take_profit);
    if (tp == null || tp <= 0) return { ok: false, error: 'bad_target' };
    if (live != null && tp <= live) return { ok: false, error: 'target_below_price' };
    fields.priceTarget = round2(tp);
  }

  if (fields.stopLoss != null && fields.priceTarget != null && fields.stopLoss >= fields.priceTarget) {
    return { ok: false, error: 'stop_above_target' };
  }

  if (Object.keys(fields).length === 0) return { ok: false, error: 'nothing_to_change' };

  return {
    ok: true,
    proposal: {
      kind: 'position_update',
      positionId: position.id,
      ticker: position.ticker,
      fields,
      rationale: input.rationale ? String(input.rationale).trim().slice(0, 300) : null,
      livePrice: live,
    },
  };
}
