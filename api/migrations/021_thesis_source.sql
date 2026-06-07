-- Thesis authorship. Distinguish a thesis the USER actually wrote (real
-- conviction) from one the AGENT drafted and the user merely accepted. An
-- agent-written thesis is not personal conviction, so it must not count toward
-- "did writing a thesis lift your win rate", or the data is skewed. NULL means
-- user/manual, the historical default, and is treated as user conviction.
ALTER TABLE positions ADD COLUMN IF NOT EXISTS thesis_source text;
ALTER TABLE closed_trades ADD COLUMN IF NOT EXISTS thesis_source text;

-- Carry thesis_source from the position onto the archived closed_trade, so the
-- attribution stat can keep excluding agent-authored theses after a close.
-- These re-declare close_position (016) and partial_close_position (020) with
-- the single added column copied through; the signatures are unchanged.

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
  DELETE FROM positions
   WHERE id = p_position_id
     AND user_id = p_user_id
  RETURNING * INTO v_pos;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO closed_trades (
    user_id, ticker, company_name, shares, avg_cost, sell_price, pnl, pnl_percent,
    entry_thesis, thesis_source, price_target, stop_loss, trade_notes,
    exit_reflection, exit_outcome, thesis_played_out,
    reflection_what_happened, reflection_lesson, opened_at, closed_at, hold_days
  ) VALUES (
    p_user_id, v_pos.ticker, v_pos.company_name, v_pos.shares, v_pos.avg_cost,
    p_sell_price, p_pnl, p_pnl_percent,
    v_pos.entry_thesis, v_pos.thesis_source, v_pos.price_target, v_pos.stop_loss, v_pos.trade_notes,
    p_exit_reflection, p_exit_outcome, p_thesis_played_out,
    p_reflection_what_happened, p_reflection_lesson, v_pos.purchased_at, now(), p_hold_days
  )
  RETURNING * INTO v_closed;

  RETURN v_closed;
END;
$$ LANGUAGE plpgsql;

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
  UPDATE positions
     SET shares = shares - p_sell_shares
   WHERE id = p_position_id
     AND user_id = p_user_id
     AND shares > p_sell_shares
  RETURNING * INTO v_pos;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO closed_trades (
    user_id, ticker, company_name, shares, avg_cost, sell_price, pnl, pnl_percent,
    entry_thesis, thesis_source, price_target, stop_loss, trade_notes,
    opened_at, closed_at, hold_days
  ) VALUES (
    p_user_id, v_pos.ticker, v_pos.company_name, p_sell_shares, v_pos.avg_cost,
    p_sell_price, p_pnl, p_pnl_percent,
    v_pos.entry_thesis, v_pos.thesis_source, v_pos.price_target, v_pos.stop_loss, v_pos.trade_notes,
    v_pos.purchased_at, now(), p_hold_days
  )
  RETURNING * INTO v_closed;

  RETURN v_closed;
END;
$$ LANGUAGE plpgsql;
