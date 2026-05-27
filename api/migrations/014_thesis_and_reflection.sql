-- Migration 014: Thesis & Accountability Loop (Phase 2)
-- Adds:
--   1. reversal_condition + thesis_written_at on positions table
--      (entry_thesis already exists from migration 002)
--   2. thesis_played_out + reflection_what_happened + reflection_lesson
--      on closed_trades (exit_reflection + exit_outcome stay for backward compat)
-- Run this in the Supabase SQL Editor.

-- ─── 1. POSITIONS — thesis fields ───────────────────────────────────────────

-- "What would make you change your mind?" — captured at position creation.
ALTER TABLE positions ADD COLUMN IF NOT EXISTS reversal_condition text;

-- When the thesis was first written. Used by the position card to show
-- "thesis written 23 days ago" so users can see how their thinking has held up.
-- Nullable: legacy positions and positions saved without a thesis stay null.
ALTER TABLE positions ADD COLUMN IF NOT EXISTS thesis_written_at timestamptz;

-- ─── 2. CLOSED TRADES — structured reflection ───────────────────────────────

-- One of: 'yes' | 'partially' | 'no' | null
-- Captured at close time; answers "did your thesis play out?"
ALTER TABLE closed_trades ADD COLUMN IF NOT EXISTS thesis_played_out text;

-- The longer narrative of what actually happened during the hold.
-- Supplements (does NOT replace) exit_reflection from migration 008.
-- Going forward, this is the primary "what happened" field; exit_reflection
-- is kept populated with the same content for backward compatibility with
-- the agent's get_closed_trade_reflection tool.
ALTER TABLE closed_trades ADD COLUMN IF NOT EXISTS reflection_what_happened text;

-- The lesson the user wants to remember for next time.
-- New field with no legacy equivalent.
ALTER TABLE closed_trades ADD COLUMN IF NOT EXISTS reflection_lesson text;

-- Index for the My Theses view — pulls closed trades grouped by thesis outcome.
CREATE INDEX IF NOT EXISTS idx_closed_trades_thesis_played_out
  ON closed_trades(user_id, thesis_played_out)
  WHERE thesis_played_out IS NOT NULL;

-- Reversal condition is queried alongside entry_thesis on the position card;
-- positions are already indexed by user_id from the base schema. No new index needed.
