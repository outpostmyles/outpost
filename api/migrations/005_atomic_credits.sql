-- Atomic credit deduction to prevent race conditions.
-- Two concurrent requests can't both pass the balance check and both deduct.
-- Returns the new balance, or -1 if insufficient credits.

CREATE OR REPLACE FUNCTION deduct_credits(p_user_id uuid, p_amount int)
RETURNS int AS $$
DECLARE
  new_balance int;
BEGIN
  UPDATE user_profiles
  SET credits_remaining = credits_remaining - p_amount,
      credits_used_this_month = credits_used_this_month + p_amount
  WHERE id = p_user_id
    AND credits_remaining >= p_amount
  RETURNING credits_remaining INTO new_balance;

  IF NOT FOUND THEN
    RETURN -1;  -- insufficient credits
  END IF;

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql;

-- Refund credits (on failure/error)
CREATE OR REPLACE FUNCTION refund_credits(p_user_id uuid, p_amount int)
RETURNS void AS $$
BEGIN
  UPDATE user_profiles
  SET credits_remaining = credits_remaining + p_amount,
      credits_used_this_month = GREATEST(0, credits_used_this_month - p_amount)
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;
