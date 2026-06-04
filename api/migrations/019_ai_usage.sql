-- AI USAGE + COST LEDGER
--
-- One append-only row per Claude API call, so the founder can see the real
-- dollar cost of every feature and model instead of a hand-typed guess. This is
-- the spine of the AI cost panel on the founder dashboard.
--
-- FOUNDER-ONLY: this data is never exposed to a user. Append-only (no updates),
-- so the many concurrent calls the app makes can never race on a shared row.
--
-- Capture in the app is FAIL-SAFE: if this migration has not been run yet, the
-- app keeps working and simply records nothing. Run this in the Supabase SQL
-- editor to turn cost tracking on.

create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  feature text not null,              -- agent | deploy_cash | bargain_radar | briefs | explainer | screener | synthesis | quality_grader | ...
  model text,                         -- the exact model id the call used
  tier text,                          -- haiku | sonnet | opus | unknown (resolved from the model)

  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd numeric(12,6) not null default 0,

  user_id uuid,                       -- the user whose action drove the call, or null for background jobs
  meta jsonb
);

create index if not exists idx_ai_usage_created on ai_usage (created_at desc);
create index if not exists idx_ai_usage_feature_created on ai_usage (feature, created_at desc);
