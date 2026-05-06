-- Migration 008: Price alerts + close-time reflection
-- Adds:
--   1. price_alerts table — persistent per-user price alerts for positions or arbitrary tickers
--   2. exit_reflection + exit_outcome columns on closed_trades for the learning loop
-- Run this in the Supabase SQL Editor.

-- ─── 1. PRICE ALERTS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS price_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  -- 'above' triggers when live price >= threshold
  -- 'below' triggers when live price <= threshold
  -- 'percent_change' triggers when daily change_percent crosses threshold (signed)
  direction text NOT NULL CHECK (direction IN ('above', 'below', 'percent_change')),
  threshold numeric NOT NULL,
  note text,  -- optional user-entered context ("take profits here", "stop breach", etc.)
  triggered boolean DEFAULT false,
  triggered_at timestamptz,
  triggered_price numeric,
  notified_at timestamptz,  -- when the email was actually sent (separate from triggered_at)
  active boolean DEFAULT true,  -- user can toggle without deleting
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_active ON price_alerts(active, triggered) WHERE active = true AND triggered = false;
CREATE INDEX IF NOT EXISTS idx_price_alerts_ticker ON price_alerts(ticker) WHERE active = true AND triggered = false;

ALTER TABLE price_alerts DISABLE ROW LEVEL SECURITY;

-- ─── 2. CLOSE-TIME REFLECTION ───────────────────────────────────────────────

ALTER TABLE closed_trades ADD COLUMN IF NOT EXISTS exit_reflection text;
-- One of: 'win_thesis_right' | 'win_thesis_wrong' | 'loss_thesis_right' | 'loss_thesis_wrong' | null
ALTER TABLE closed_trades ADD COLUMN IF NOT EXISTS exit_outcome text;

-- Index for the agent tool that surfaces lessons by ticker
CREATE INDEX IF NOT EXISTS idx_closed_trades_user_ticker ON closed_trades(user_id, ticker, closed_at DESC);
