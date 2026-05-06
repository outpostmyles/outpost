-- Beta allowlist — gates /api/auth/signup during private beta.
-- Editable via Supabase SQL editor or dashboard without redeploys.

create table if not exists beta_allowlist (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  added_at timestamptz default now(),
  notes text
);

create index if not exists idx_beta_allowlist_email on beta_allowlist(lower(email));

-- RLS off — backend uses service-role key (custom auth, no auth.uid()).
alter table beta_allowlist disable row level security;
