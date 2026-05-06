-- Migration 009: Email notification preferences
-- Adds two boolean toggles to user_profiles so users can opt out of cron-driven emails.
-- Default true: existing users (and new signups) get emails until they say otherwise.
-- Run this in the Supabase SQL Editor.

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email_daily_digest BOOLEAN DEFAULT true;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email_weekly_summary BOOLEAN DEFAULT true;
