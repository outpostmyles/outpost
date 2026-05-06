-- Migration 010: analytics_daily storage for the founder dashboard
-- resetDailyCounters() in api/services/analytics.js writes a row here at midnight ET.
-- The Founder Dashboard reads back the last 7-30 days for trend lines.
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS analytics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date text NOT NULL,                 -- YYYY-MM-DD (matches resetDailyCounters payload)
  data text NOT NULL,                 -- JSON.stringify(generateInsights() output)
  created_at timestamptz DEFAULT now()
);

-- One row per day. If the cron retries, the second insert no-ops.
CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_daily_date
  ON analytics_daily(date);

ALTER TABLE analytics_daily DISABLE ROW LEVEL SECURITY;
