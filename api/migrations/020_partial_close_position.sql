-- Atomic PARTIAL sell (trim): reduce a position's shares and archive the sold
-- portion to closed_trades, in one transaction. The remaining position keeps its
-- avg_cost (a partial sale does not change the cost basis of what is left). Full
-- sells stay on close_position (migration 016); this is strictly for selling SOME.
--
-- Why a transaction: without it, a failed archive INSERT after the share-reduction
-- UPDATE would lose the realized gain from the user's track record while still
-- having taken the shares out. Both happen, or neither does.
--
-- Returns NULL if the position is gone, not owned by p_user_id, or no longer has
-- MORE than p_sell_shares left (a concurrent trim or close won the race). The
-- strict > guard guarantees a partial always leaves a positive remainder and makes
-- the operation safe against double-sell. Caller responds 404 on NULL.

CREATE OR REPLACE FUNCTION partial_close_position(
  p_position_id   uuid,
  p_user_id       uuid,
  p_sell_shares   numeric,
  p_sell_price    numeric,
  p_pnl           numeric,
  p_pnl_percent   numeric,
  p_hold_days     int
)
RETURNS closed_trades AS $$
DECLARE
  v_pos      positions;
  v_closed   closed_trades;
BEGIN
  -- Reduce the remaining shares atomically. Scoped by user_id so a leaked id from
  -- another user cannot be trimmed. The strict > guard means only a true partial
  -- passes (full sells use close_position) and only one concurrent transaction can
  -- win the row.
  UPDATE positions
     SET shares = shares - p_sell_shares
   WHERE id = p_position_id
     AND user_id = p_user_id
     AND shares > p_sell_shares
  RETURNING * INTO v_pos;

  IF NOT FOUND THEN
    RETURN NULL;  -- caller responds 404
  END IF;

  -- Archive ONLY the sold portion. avg_cost and purchased_at carry over from the
  -- position (the lot's cost basis and entry date are unchanged by a trim).
  INSERT INTO closed_trades (
    user_id,
    ticker,
    company_name,
    shares,
    avg_cost,
    sell_price,
    pnl,
    pnl_percent,
    entry_thesis,
    price_target,
    stop_loss,
    trade_notes,
    opened_at,
    closed_at,
    hold_days
  ) VALUES (
    p_user_id,
    v_pos.ticker,
    v_pos.company_name,
    p_sell_shares,
    v_pos.avg_cost,
    p_sell_price,
    p_pnl,
    p_pnl_percent,
    v_pos.entry_thesis,
    v_pos.price_target,
    v_pos.stop_loss,
    v_pos.trade_notes,
    v_pos.purchased_at,
    now(),
    p_hold_days
  )
  RETURNING * INTO v_closed;

  RETURN v_closed;
END;
$$ LANGUAGE plpgsql;
