-- ============================================================
-- OUTPOST — New tables for monitoring & analytics
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

-- 1. Unique index on portfolio_snapshots to prevent duplicate daily snapshots
CREATE UNIQUE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_date
ON portfolio_snapshots(user_id, date);

-- 2. Error log — critical errors persisted from monitor.js
CREATE TABLE IF NOT EXISTS error_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  endpoint text NOT NULL,
  message text,
  severity text DEFAULT 'critical',
  created_at timestamptz DEFAULT now()
);

-- Index for querying recent errors
CREATE INDEX IF NOT EXISTS idx_error_log_created
ON error_log(created_at DESC);

-- Auto-cleanup: keep only 30 days of error logs
-- (Run manually or set up a pg_cron job)
-- DELETE FROM error_log WHERE created_at < now() - interval '30 days';

-- 3. Analytics daily summaries — persisted from analytics.js at midnight
CREATE TABLE IF NOT EXISTS analytics_daily (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date date NOT NULL UNIQUE,
  data jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_date
ON analytics_daily(date DESC);

-- 4. ai_feedback is defined canonically in schema.sql (the base), which runs first.
-- It was re-declared here with an extra 'positive boolean' column, but that CREATE
-- was always a no-op (the table already existed) and nothing reads 'positive' (every
-- reader aggregates 'rating'), so it was dead and misleading. Dropped. The index
-- below is the only ai_feedback index, so it stays.

CREATE INDEX IF NOT EXISTS idx_ai_feedback_user
ON ai_feedback(user_id, created_at DESC);

-- 5. Ensure closed_trades table exists (used by portfolio.js)
CREATE TABLE IF NOT EXISTS closed_trades (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  company_name text,
  shares numeric,
  avg_cost numeric,
  sell_price numeric,
  pnl numeric,
  pnl_percent numeric,
  entry_thesis text,
  price_target numeric,
  stop_loss numeric,
  trade_notes text,
  opened_at timestamptz,
  closed_at timestamptz DEFAULT now(),
  hold_days integer
);

CREATE INDEX IF NOT EXISTS idx_closed_trades_user
ON closed_trades(user_id, closed_at DESC);

-- Done! All tables are ready.
