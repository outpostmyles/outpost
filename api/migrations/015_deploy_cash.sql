-- Migration 015: Deploy Cash workflow (Phase 4)
-- Adds:
--   1. deploy_cash_sessions table — logs every deploy-cash session
--      (the recommendations shown + which one the user picked + whether
--      they actually executed it as a new position).
--   2. positions.source — tracks how a position was created so we can
--      thread "deploy_cash" originations back to their session.
-- Run in the Supabase SQL editor.

-- ─── 1. DEPLOY CASH SESSIONS ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS deploy_cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Inputs the user provided
  amount numeric NOT NULL,
  time_horizon text,   -- 'never' | '5plus' | '1to5' | 'this_year' | 'unsure' | null
  goal text,           -- 'grow_aggressively' | 'build_steadily' | 'preserve' | 'open' | null

  -- The 2-3 recommendation cards we generated, stored verbatim so future
  -- check-ins ("you deployed $500 into NVDA — here's how it's tracking")
  -- can quote the original reasoning back to the user.
  options_shown jsonb NOT NULL,
  market_context_note text,

  -- Outcomes — both nullable since the user may close the modal without picking
  user_choice_id text,                            -- id within options_shown
  executed_position_id uuid REFERENCES positions(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deploy_cash_sessions_user
  ON deploy_cash_sessions(user_id, created_at DESC);

ALTER TABLE deploy_cash_sessions DISABLE ROW LEVEL SECURITY;

-- ─── 2. POSITIONS — source provenance ───────────────────────────────────────

-- How was this position created? Values used in code:
--   'manual'      — user added through Add Position modal (default)
--   'deploy_cash' — originated from a Deploy Cash recommendation
--   'import'      — CSV import
--   'screenshot'  — broker screenshot parse
-- Nullable + defaulted so backfilled rows remain valid.
ALTER TABLE positions ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
