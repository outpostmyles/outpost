-- Journal redesign — replace sections/entries with simple named notes.
-- Notes work like chat conversations: create, rename, open, edit, delete.
-- Bookmark anywhere in the app appends content into a chosen note.

DROP TABLE IF EXISTS journal_entries;
DROP TABLE IF EXISTS journal_sections;

CREATE TABLE IF NOT EXISTS journal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled',
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_notes_user_updated
  ON journal_notes(user_id, updated_at DESC);
