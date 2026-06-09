-- Atomic cash adjust: apply a credit/debit to a user's cash balance in one
-- transaction, serialized per user, so two trades that credit/debit at the same
-- instant can never lose an update.
--
-- Cash lives in agent_memory as a per-user JSON singleton (memory_type
-- 'cash_balance', content {"amount": N}). The app used to read-modify-write it in
-- JS: read the balance, add the delta, write it back. Two concurrent adjusts for
-- the same user (e.g. the agent executing a trade while the user manually sells)
-- both read the old balance and the second write clobbers the first, silently
-- losing a credit or debit and drifting cash from holdings. This function does the
-- read-modify-write inside the database under a per-user advisory lock, so those
-- adjusts serialize instead of racing.
--
-- The lock is transaction-scoped (auto-releases at commit/rollback) and keyed on
-- the user id, so it only ever blocks another adjust for the SAME user, never the
-- table. Cash never goes negative and is always rounded to cents, the same
-- invariants as the JS path (nextCashBalance). Returns the new balance.
--
-- The JS adjustCashBalance prefers this RPC and falls back to its retried
-- read-modify-write if the function is absent (migration not yet run), so the app
-- works before and after this migration; running it just upgrades adjust from
-- "resilient" to "atomic".

CREATE OR REPLACE FUNCTION adjust_cash_balance(
  p_user_id  uuid,
  p_delta    numeric
)
RETURNS numeric AS $$
DECLARE
  v_current numeric;
  v_new     numeric;
BEGIN
  -- Serialize all cash adjusts for THIS user. Without it, two concurrent adjusts
  -- both read the old balance and one overwrites the other (a lost update).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Current balance = the latest cash_balance row's amount, matching how the app
  -- reads it. No row yet, or a junk/negative value, is treated as 0.
  SELECT (content::jsonb ->> 'amount')::numeric
    INTO v_current
    FROM agent_memory
   WHERE user_id = p_user_id AND memory_type = 'cash_balance'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_current IS NULL OR v_current < 0 THEN
    v_current := 0;
  END IF;

  v_new := round(v_current + COALESCE(p_delta, 0), 2);
  IF v_new IS NULL OR v_new < 0 THEN
    v_new := 0;  -- cash never goes negative
  END IF;

  -- Collapse to a single canonical row. Safe inside this transaction and under the
  -- lock: a concurrent reader sees the old row until commit, then the new one,
  -- never a gap (no zero-window).
  DELETE FROM agent_memory
   WHERE user_id = p_user_id AND memory_type = 'cash_balance';
  INSERT INTO agent_memory (user_id, memory_type, content, created_at)
  VALUES (p_user_id, 'cash_balance', jsonb_build_object('amount', v_new)::text, now());

  RETURN v_new;
END;
$$ LANGUAGE plpgsql;
