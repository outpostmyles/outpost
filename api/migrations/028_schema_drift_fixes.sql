-- Schema-drift fixes (2026-06-18). These tables/columns were added to the DEV
-- database directly during feature work and never written into schema.sql or a
-- migration, so the prod database (built fresh from the setup bundle) was created
-- WITHOUT them. Each silently broke its feature on prod the moment a user touched it:
--   - screeners      -> custom natural-language screeners (Social) 500'd
--   - research_status -> the dossier "researched / watching" status never persisted
--   - watchlist.notes / .alert_price -> watchlist notes + price alerts failed to save
-- Found by scripts/_drift_audit.mjs (diffs the dev schema against the repo schema).
-- Idempotent; safe to run once in the prod SQL editor.

-- Custom screeners: a saved natural-language screen + its last vetted results.
create table if not exists screeners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  name text not null,
  query text not null,
  results jsonb,
  last_run_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists screeners_user_idx on screeners (user_id);

-- Per-user, per-ticker research status (drives the dossier "researched / watching" badge).
create table if not exists research_status (
  user_id uuid references user_profiles(id) on delete cascade,
  ticker text not null,
  status text not null,
  updated_at timestamptz default now(),
  primary key (user_id, ticker)
);

-- Watchlist gained per-row notes + an optional price alert after the base schema was written.
alter table watchlist add column if not exists notes text;
alter table watchlist add column if not exists alert_price numeric;
