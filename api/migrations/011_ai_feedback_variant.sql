-- Migration 011: A/B prompt experiments
-- Adds a variant column to ai_feedback so we can compute per-variant approval
-- rates in the founder dashboard.
-- Run this in the Supabase SQL Editor.

ALTER TABLE ai_feedback ADD COLUMN IF NOT EXISTS variant text;

-- Existing rows pre-experiment stay null and bucket under 'untagged' in
-- aggregateFeedbackByVariant() so historical feedback isn't lost.
CREATE INDEX IF NOT EXISTS idx_ai_feedback_feature_variant
  ON ai_feedback(feature, variant);
