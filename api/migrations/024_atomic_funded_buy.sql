-- Make a FUNDED buy ("pay for this from my tracked cash") one transaction: the
-- position write AND the cash debit commit together, after an affordability check
-- taken under the per-user lock.
--
-- Before this, a funded buy wrote the position (insert a new one, or update the
-- blended shares/avg_cost on an existing one), then debited cash in a SECOND step.
-- A crash in that gap left holdings up with cash never reduced, inflating the
-- account, the same drift class migration 023 closed for close/trim, on the buy
-- side. The JS affordability check already stops the deterministic case (buying
-- more than you hold in cash), but not a crash mid-write.
--
-- Scope is deliberately narrow: ONLY funded buys go through here. A non-funded buy
-- (recording a holding you already own, no cash movement) keeps its plain single
-- insert/update, which is already atomic on its own. So this function never touches
-- the common "just log what I own" path.
--
-- The business logic stays in JS (the weighted-average blend, and the "fill a plan
-- field only if the position does not already have one" rule). This function is a
-- parameterized writer: JS passes the exact final values, the function writes them
-- and debits, atomically. Plan fields use COALESCE(p_x, x) so a NULL means "leave
-- what's there" (the fill-if-absent rule), while shares/avg_cost are always set.
--
-- Returns jsonb:
--   { ok:true,  position:{...}, cash:N }                      on success
--   { ok:false, reason:'insufficient_cash', available, needed} if cash < cost
--   { ok:false, reason:'not_found' }                          if the merge row is gone
-- A unique-violation on insert (duplicate ticker race) raises 23505 and rolls the
-- whole thing back (no debit), which the caller maps to a 409, atomic either way.
--
-- Backward compatible: the API prefers this and falls back to the old two-step if
-- the function is absent, so the app works before and after applying it.

CREATE OR REPLACE FUNCTION buy_position_funded(
  p_user_id           uuid,
  p_position_id       uuid,      -- NULL = insert a new position; else update this held row (merge)
  p_cost              numeric,   -- cash to debit (= shares * avg_cost, > 0)
  p_shares            numeric,   -- final share count (already blended for a merge)
  p_avg_cost          numeric,   -- final average cost (already blended for a merge)
  p_ticker            text,      -- insert-only fields below are ignored on a merge
  p_company_name      text,
  p_purchased_at      timestamptz,
  p_source            text,
  p_reversal_condition text,
  p_trade_notes       text,
  p_entry_thesis      text,      -- plan fields: set on insert; COALESCE fill-if-absent on merge
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
  -- Hold the per-user cash lock across the WHOLE operation so the affordability
  -- check, the position write, and the debit cannot interleave with another cash
  -- writer. adjust_cash_balance re-takes this same lock during the debit, which is
  -- safe: advisory locks are re-acquirable by the session that holds them.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Affordability INSIDE the lock (no time-of-check/time-of-use gap): the balance
  -- read here is the same one the debit will start from.
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
    -- New position. A duplicate-ticker race raises 23505 here and rolls back the
    -- whole transaction (no debit), which the caller turns into a 409.
    INSERT INTO positions (
      user_id, ticker, company_name, shares, avg_cost, purchased_at, created_at,
      entry_thesis, thesis_written_at, thesis_source, reversal_condition,
      price_target, stop_loss, trade_notes, source
    ) VALUES (
      p_user_id, p_ticker, p_company_name, p_shares, p_avg_cost, p_purchased_at, now(),
      p_entry_thesis, p_thesis_written_at, p_thesis_source, p_reversal_condition,
      p_price_target, p_stop_loss, p_trade_notes, COALESCE(p_source, 'manual')
      -- COALESCE matches the route's plain insert, which omits source and lets the
      -- column DEFAULT 'manual' (migration 015) apply. Explicit NULL would diverge.
    )
    RETURNING * INTO v_pos;
  ELSE
    -- Merge into an existing holding. shares/avg_cost always update; plan fields
    -- only fill when JS passed a non-null (the fill-if-absent rule lives in JS).
    UPDATE positions SET
      shares            = p_shares,
      avg_cost          = p_avg_cost,
      entry_thesis      = COALESCE(p_entry_thesis, entry_thesis),
      thesis_written_at = COALESCE(p_thesis_written_at, thesis_written_at),
      thesis_source     = COALESCE(p_thesis_source, thesis_source),
      price_target      = COALESCE(p_price_target, price_target),
      stop_loss         = COALESCE(p_stop_loss, stop_loss)
    WHERE id = p_position_id AND user_id = p_user_id
    RETURNING * INTO v_pos;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;
  END IF;

  -- Debit in the same transaction. We already proved cash >= cost under this lock,
  -- so the clamp-at-zero in adjust_cash_balance never fires here.
  PERFORM adjust_cash_balance(p_user_id, -COALESCE(p_cost, 0));
  SELECT (content::jsonb ->> 'amount')::numeric INTO v_cash
    FROM agent_memory
   WHERE user_id = p_user_id AND memory_type = 'cash_balance'
   ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object('ok', true, 'position', to_jsonb(v_pos), 'cash', round(COALESCE(v_cash, 0), 2));
END;
$$ LANGUAGE plpgsql;
