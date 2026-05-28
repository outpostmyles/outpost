-- Execution rating on closed trades.
--
-- The reflection flow already asks "did the thesis play out" (outcome).
-- This adds the missing half: how well did the USER execute. Execution is
-- the controllable variable. Outcome is luck-contaminated. Tracking both
-- lets the Patterns view show a real edge metric: avg execution rating,
-- and whether high-execution trades have a better win rate than low.
--
-- Scale: 1-5. Nullable so existing closed trades stay untouched and users
-- who skip the question on close don't get a fabricated score.
--
-- Idempotent. Safe to re-run.

ALTER TABLE closed_trades ADD COLUMN IF NOT EXISTS execution_rating SMALLINT
  CHECK (execution_rating IS NULL OR (execution_rating >= 1 AND execution_rating <= 5));

CREATE INDEX IF NOT EXISTS idx_closed_trades_execution_rating
  ON closed_trades(user_id, execution_rating)
  WHERE execution_rating IS NOT NULL;
