-- Migration 003: Add unique constraints to prevent race conditions
-- Run this in Supabase SQL Editor

-- Prevent duplicate positions (same user + ticker)
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_user_ticker
  ON positions(user_id, ticker);

-- Prevent duplicate snapshots (same user + date)
-- Note: idx_portfolio_snapshots_user_date was already created in supabase-setup.sql
-- but as a non-unique index. Drop and recreate as unique.
DROP INDEX IF EXISTS idx_portfolio_snapshots_user_date;
CREATE UNIQUE INDEX idx_portfolio_snapshots_user_date
  ON portfolio_snapshots(user_id, date);

-- Index for faster message lookups (agent chat history)
CREATE INDEX IF NOT EXISTS idx_agent_messages_user_created
  ON agent_messages(user_id, created_at DESC);

-- Index for faster memory lookups
CREATE INDEX IF NOT EXISTS idx_agent_memory_user_created
  ON agent_memory(user_id, created_at DESC);
