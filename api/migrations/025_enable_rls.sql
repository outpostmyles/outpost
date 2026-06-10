-- 025: Enable Row Level Security on every public table (deny-all, no policies).
-- DEFENSE IN DEPTH for the direct-database attack surface.
--
-- Outpost enforces per-user isolation in the Express layer, and the backend connects
-- with the service_role key, which BYPASSES row level security. So enabling RLS does
-- NOT change a single server query: every read and write the app makes still works
-- exactly as before. What it DOES change: the anon and authenticated roles (the
-- auto-exposed Supabase Data API at /rest/v1) get deny-all, because there are no
-- policies. That closes the direct-to-database door, so the only path to data is
-- through the Express API where isolation is enforced.
--
-- Why this is needed: with RLS OFF plus Supabase's default grants, anyone holding the
-- project URL and the PUBLIC anon key could read or write every table directly through
-- the Data API, bypassing the app entirely (including user_profiles, which holds
-- password hashes and session tokens). RLS-off was the old design intent; it protected
-- the Express path but left the direct path open. This shuts it.
--
-- Why it is safe to flip on: api/db.js builds exactly one client, with service_role;
-- no frontend code and no backend code ever queries with the anon key, so deny-all for
-- anon breaks nothing. The Supabase dashboard uses a privileged role, so you can still
-- view and edit rows there.
--
-- Re-run safe: enabling RLS on an already-enabled table is a no-op. This sweep covers
-- every existing public table; a future migration that creates a NEW table should
-- enable RLS on it too (or just re-run this block).
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;
