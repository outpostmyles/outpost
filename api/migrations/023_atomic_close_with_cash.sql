-- Make "sell a position" and "credit its proceeds to cash" ONE transaction.
--
-- Before this migration the API closed a position with the atomic close_position
-- RPC (migration 016), then credited the proceeds to cash in a SECOND, separate
-- call (adjust_cash_balance, migration 022). Both calls are individually atomic,
-- but the gap between them is not: if the process dies (deploy, OOM, restart) in
-- that window, the shares are gone from holdings and the proceeds were never added
-- to cash. The user permanently loses the value of the sale. The API even logs a
-- "CASH DRIFT" line when the second step fails, proving the seam is real.
--
-- The fix is to compose the two audited functions into one transaction instead of
-- duplicating their bodies. A plpgsql function runs in a single transaction, so a
-- thin wrapper that calls close_position and then adjust_cash_balance makes the
-- position delete, the closed_trades archive, AND the cash credit all-or-nothing.
-- If the credit fails, the close rolls back too: the position is still there to
-- retry, and cash never drifts from holdings.
--
-- Backward compatible: the API prefers these wrappers and falls back to the old
-- two-step (close, then credit) if this migration has not been applied yet, so the
-- app works before and after. Applying it upgrades close-and-credit from
-- "resilient" to "atomic", the same staging migration 022 used for adjust.

-- Full close + credit proceeds, atomically.
CREATE OR REPLACE FUNCTION close_position_and_credit(
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
  p_exit_outcome             text,
  p_proceeds      numeric
)
RETURNS closed_trades AS $$
DECLARE
  v_closed closed_trades;
BEGIN
  -- Reuse the audited atomic close (DELETE position + INSERT closed_trade in this
  -- same transaction). Returns NULL if the position is gone or not owned by the
  -- user (a double-close race) -> credit nothing, return NULL so the caller 404s.
  v_closed := close_position(
    p_position_id, p_user_id, p_sell_price, p_pnl, p_pnl_percent, p_hold_days,
    p_reflection_what_happened, p_reflection_lesson, p_thesis_played_out,
    p_exit_reflection, p_exit_outcome
  );
  IF v_closed IS NULL THEN
    RETURN NULL;
  END IF;

  -- Credit the proceeds in the SAME transaction, under the same per-user advisory
  -- lock adjust_cash_balance takes (so it still serializes against other cash
  -- writers). If this raises, the whole transaction rolls back: the position is
  -- NOT closed and cash is NOT changed. No drift possible.
  PERFORM adjust_cash_balance(p_user_id, COALESCE(p_proceeds, 0));

  RETURN v_closed;
END;
$$ LANGUAGE plpgsql;

-- Partial close (trim) + credit proceeds, atomically. Same composition over the
-- audited partial_close_position (migration 020).
CREATE OR REPLACE FUNCTION partial_close_position_and_credit(
  p_position_id   uuid,
  p_user_id       uuid,
  p_sell_shares   numeric,
  p_sell_price    numeric,
  p_pnl           numeric,
  p_pnl_percent   numeric,
  p_hold_days     int,
  p_proceeds      numeric
)
RETURNS closed_trades AS $$
DECLARE
  v_closed closed_trades;
BEGIN
  v_closed := partial_close_position(
    p_position_id, p_user_id, p_sell_shares, p_sell_price, p_pnl, p_pnl_percent, p_hold_days
  );
  IF v_closed IS NULL THEN
    RETURN NULL;  -- raced with another trim/close, or nothing left to sell
  END IF;

  PERFORM adjust_cash_balance(p_user_id, COALESCE(p_proceeds, 0));

  RETURN v_closed;
END;
$$ LANGUAGE plpgsql;

-- Set the cash balance to an exact amount under the SAME per-user advisory lock
-- adjust_cash_balance uses. Before this, "set my cash to match my brokerage" went
-- through a JS insert-then-prune that took no lock, so it and a trade's atomic
-- credit/debit ran with zero mutual exclusion and could clobber each other. Now
-- every cash writer (adjust AND set) serializes in one lock domain.
CREATE OR REPLACE FUNCTION set_cash_balance(
  p_user_id uuid,
  p_amount  numeric
)
RETURNS numeric AS $$
DECLARE
  v_amt numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  v_amt := round(COALESCE(p_amount, 0), 2);
  IF v_amt IS NULL OR v_amt < 0 THEN
    v_amt := 0;  -- cash never goes negative, same invariant as everywhere else
  END IF;

  DELETE FROM agent_memory
   WHERE user_id = p_user_id AND memory_type = 'cash_balance';
  INSERT INTO agent_memory (user_id, memory_type, content, created_at)
  VALUES (p_user_id, 'cash_balance', jsonb_build_object('amount', v_amt)::text, now());

  RETURN v_amt;
END;
$$ LANGUAGE plpgsql;
