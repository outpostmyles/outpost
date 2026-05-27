-- Atomic position close: delete from positions + insert into closed_trades
-- in a single transaction. Replaces the JS pattern that deleted first and
-- archived second — if the archive INSERT failed, the closed trade was
-- silently lost (tax-reporting + reflection data gone).
--
-- Returns:
--   * NULL if the position doesn't exist or isn't owned by p_user_id
--     (caller responds 404 — same as before)
--   * The closed_trade row on success (caller can confirm and return 200)
--
-- Concurrent double-close: only one transaction's DELETE acquires the row
-- lock; the other sees zero rows from DELETE...RETURNING and exits with
-- NULL. Idempotent from the client's perspective.

CREATE OR REPLACE FUNCTION close_position(
  p_position_id   uuid,
  p_user_id       uuid,
  p_sell_price    numeric,
  p_pnl           numeric,
  p_pnl_percent   numeric,
  p_hold_days     int,
  p_reflection_what_happened text,
  p_reflection_lesson        text,
  p_thesis_played_out        text,
  p_exit_reflection          text,
  p_exit_outcome             text
)
RETURNS closed_trades AS $$
DECLARE
  v_pos      positions;
  v_closed   closed_trades;
BEGIN
  -- Atomically remove the position and capture its row for archiving.
  -- Scoped by user_id so a leaked id from another user can't be closed.
  DELETE FROM positions
   WHERE id = p_position_id
     AND user_id = p_user_id
  RETURNING * INTO v_pos;

  IF NOT FOUND THEN
    RETURN NULL;  -- caller responds 404
  END IF;

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
    exit_reflection,
    exit_outcome,
    thesis_played_out,
    reflection_what_happened,
    reflection_lesson,
    opened_at,
    closed_at,
    hold_days
  ) VALUES (
    p_user_id,
    v_pos.ticker,
    v_pos.company_name,
    v_pos.shares,
    v_pos.avg_cost,
    p_sell_price,
    p_pnl,
    p_pnl_percent,
    v_pos.entry_thesis,
    v_pos.price_target,
    v_pos.stop_loss,
    v_pos.trade_notes,
    p_exit_reflection,
    p_exit_outcome,
    p_thesis_played_out,
    p_reflection_what_happened,
    p_reflection_lesson,
    v_pos.purchased_at,  -- null if user never set one — same rule as before
    now(),
    p_hold_days
  )
  RETURNING * INTO v_closed;

  RETURN v_closed;
END;
$$ LANGUAGE plpgsql;
