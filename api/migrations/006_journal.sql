-- Journal: a place for users to save ideas, AI responses, tickers, and notes.
-- Organized into user-defined sections. Static snapshots (no ongoing price refresh).
-- Strictly user-facing — NOT read by the agent as context.

-- ============ SECTIONS ============
-- User-defined buckets. Each user gets 4 starter sections on first use.
CREATE TABLE IF NOT EXISTS journal_sections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_sections_user
  ON journal_sections(user_id, sort_order);

-- ============ ENTRIES ============
-- Individual journal entries. Each belongs to a section (or unfiled if section deleted).
CREATE TABLE IF NOT EXISTS journal_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  section_id      uuid REFERENCES journal_sections(id) ON DELETE SET NULL,
  ticker          text,
  content         text NOT NULL,
  source          text NOT NULL DEFAULT 'manual',  -- 'manual' | 'ai_agent' | 'ai_analysis' | 'ai_brief' | 'ai_news' | 'ai_catalyst'
  source_ref      text,                             -- optional id from source (e.g. message id)
  price_at_entry  numeric,                          -- snapshot of ticker price at save time (never updated)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_user_created
  ON journal_entries(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_journal_entries_user_ticker
  ON journal_entries(user_id, ticker)
  WHERE ticker IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_section
  ON journal_entries(section_id)
  WHERE section_id IS NOT NULL;
