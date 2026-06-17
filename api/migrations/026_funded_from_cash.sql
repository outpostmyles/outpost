-- Symmetric cash model: a position remembers whether its shares were bought WITH
-- tracked cash (a funded buy) or merely recorded (an existing holding, no cash
-- moved). A close/trim then credits proceeds to cash ONLY for funded positions,
-- mirroring the debit side. Without this, every close credited cash even for
-- imported holdings that never debited it, drifting account value upward the
-- first time any tester sold a position they had recorded rather than bought.
--
-- NULLABLE on purpose. Existing rows (created before this migration) stay NULL,
-- which the API treats as "legacy, credit as before" so applying this migration
-- does NOT retroactively change the cash behavior of positions already on the
-- books. Only NEW buys after this get an explicit true/false, and only an
-- explicit false skips the credit on close.
--
-- Apply this BEFORE deploying the matching API code: the code writes this column
-- on every new buy, so the column must exist first.

alter table positions add column if not exists funded_from_cash boolean default null;

-- Re-create the atomic funded-buy writer (migration 024) so it stamps
-- funded_from_cash = true on the position it creates or merges into. A funded buy,
-- by definition, debited cash, so its proceeds should credit cash on close.
-- Identical to 024 in every other respect.
CREATE OR REPLACE FUNCTION buy_position_funded(
  p_user_id           uuid,
  p_position_id       uuid,
  p_cost              numeric,
  p_shares            numeric,
  p_avg_cost          numeric,
  p_ticker            text,
  p_company_name      text,
  p_purchased_at      timestamptz,
  p_source            text,
  p_reversal_condition text,
  p_trade_notes       text,
  p_entry_thesis      text,
  p_thesis_written_at timestamptz,
  p_thesis_source     text,
  p_price_target      numeric,
  p_stop_loss         numeric
)
RETURNS jsonb AS $$
DECLARE
  v_cash numeric;
  v_pos  positions;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT (content::jsonb ->> 'amount')::numeric INTO v_cash
    FROM agent_memory
   WHERE user_id = p_user_id AND memory_type = 'cash_balance'
   ORDER BY created_at DESC LIMIT 1;
  v_cash := COALESCE(v_cash, 0);
  IF v_cash + 0.005 < COALESCE(p_cost, 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_cash',
      'available', round(v_cash, 2), 'needed', round(COALESCE(p_cost, 0), 2));
  END IF;

  IF p_position_id IS NULL THEN
    INSERT INTO positions (
      user_id, ticker, company_name, shares, avg_cost, purchased_at, created_at,
      entry_thesis, thesis_written_at, thesis_source, reversal_condition,
      price_target, stop_loss, trade_notes, source, funded_from_cash
    ) VALUES (
      p_user_id, p_ticker, p_company_name, p_shares, p_avg_cost, p_purchased_at, now(),
      p_entry_thesis, p_thesis_written_at, p_thesis_source, p_reversal_condition,
      p_price_target, p_stop_loss, p_trade_notes, COALESCE(p_source, 'manual'), true
    )
    RETURNING * INTO v_pos;
  ELSE
    UPDATE positions SET
      shares            = p_shares,
      avg_cost          = p_avg_cost,
      entry_thesis      = COALESCE(p_entry_thesis, entry_thesis),
      thesis_written_at = COALESCE(p_thesis_written_at, thesis_written_at),
      thesis_source     = COALESCE(p_thesis_source, thesis_source),
      price_target      = COALESCE(p_price_target, price_target),
      stop_loss         = COALESCE(p_stop_loss, stop_loss),
      funded_from_cash  = true
    WHERE id = p_position_id AND user_id = p_user_id
    RETURNING * INTO v_pos;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
  END IF;

  PERFORM adjust_cash_balance(p_user_id, -COALESCE(p_cost, 0));
  SELECT (content::jsonb ->> 'amount')::numeric INTO v_cash
    FROM agent_memory
   WHERE user_id = p_user_id AND memory_type = 'cash_balance'
   ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object('ok', true, 'position', to_jsonb(v_pos), 'cash', round(COALESCE(v_cash, 0), 2));
END;
$$ LANGUAGE plpgsql;
