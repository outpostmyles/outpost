-- Reset the public schema to empty: drop every app table (CASCADE takes the foreign
-- keys and indexes with it). SAFE ONLY on a database with no data you want to keep.
--
-- Use this to start the production setup over from a clean slate, e.g. if a partial
-- run or a repeated run of prod_setup_bundle.sql left the schema half-built. The
-- bundle is a ONE-SHOT (a journal migration drops + recreates tables, so it is not
-- safe to re-run on top of itself); this gives you the clean slate to run it once.
--
-- After this: run prod_setup_bundle.sql ONCE, then verify (node tests/_schema_check.mjs).
-- Functions/RPCs are left as-is; the bundle redefines them with CREATE OR REPLACE.
-- Supabase internals (auth, storage, realtime, ...) live in other schemas: untouched.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('drop table if exists public.%I cascade;', r.tablename);
  end loop;
end $$;
