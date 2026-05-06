-- Migration 012: AI response logging + review queue
-- Stores every AI response (currently just /analysis) with its auto-grade
-- so the founder can review low-quality outputs and use the patterns to
-- iterate prompts.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS ai_response_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE SET NULL,
  feature text NOT NULL,            -- 'analysis_quick' | 'analysis_deep' | 'brief' | etc
  ticker text,                      -- when applicable
  variant text,                     -- A/B variant id, null if not tagged
  input_preview text,               -- first ~500 chars of the prompt
  output text NOT NULL,             -- the actual AI response
  score integer,                    -- 0-100 from the auto-grader
  failures text[],                  -- rule names that failed (e.g. ['NO_INVENTED_DETAILS'])
  grader_notes text,                -- short overall note from grader
  reviewed boolean DEFAULT false,   -- founder marked as reviewed
  review_verdict text,              -- 'fine' | 'problem' | null (set by founder)
  created_at timestamptz DEFAULT now()
);

-- Founder dashboard queries: low scores first, unreviewed first, recent first
CREATE INDEX IF NOT EXISTS idx_ai_response_log_review_queue
  ON ai_response_log(reviewed, score, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_response_log_feature
  ON ai_response_log(feature, created_at DESC);

ALTER TABLE ai_response_log DISABLE ROW LEVEL SECURITY;
