-- Add purchased_at to positions table
-- This tracks when shares were actually bought (not when added to Outpost)
-- Critical for accurate tax calculations (short-term vs long-term, wash sales)

ALTER TABLE positions ADD COLUMN IF NOT EXISTS purchased_at timestamptz;

-- Backfill: existing positions without purchased_at get their created_at as fallback
UPDATE positions SET purchased_at = created_at WHERE purchased_at IS NULL;

-- Make it not null going forward (after backfill)
ALTER TABLE positions ALTER COLUMN purchased_at SET DEFAULT now();
