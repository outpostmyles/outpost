-- THE DECISION LEDGER
--
-- The canonical, append-only record of every meaningful decision a user makes,
-- with the full context at the moment they made it and the outcome once it
-- resolves. This is the spine of Outpost's data moat: the per-user "receipts",
-- the behavioral patterns, and the anonymized retail aggregate are all just
-- views of this one table.
--
-- Capture in the app is FAIL-SAFE: if this migration has not been run yet, the
-- app keeps working and simply records nothing. Run this in the Supabase SQL
-- editor to turn the brain on.

create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null,                 -- open | add | trim | close | plan_set | thesis_write
  ticker text,
  shares numeric,
  price numeric,                      -- the decision/execution price per share

  -- WHY + CONTEXT, snapshotted at the moment of the decision
  thesis text,
  source text,                        -- manual | deploy_cash | sync | screener | dossier
  ai_advice text,                     -- what Outpost suggested at that moment, if any
  pct_of_book numeric,                -- how big this position was in their book at decision time
  today_change_pct numeric,           -- the ticker's move on the day (to catch chasing)
  market_regime text,                 -- Risk On | Risk Off | Neutral | Unknown
  vix numeric,
  fear_greed numeric,
  spy_price numeric,
  composure integer,                  -- their composure score that day, if known

  -- OUTCOME, stamped when the decision resolves (e.g. when the position closes)
  outcome_status text,                -- null (unresolved) | win | loss | even
  outcome_pnl numeric,
  outcome_pnl_pct numeric,
  outcome_hold_days integer,
  thesis_played_out text,             -- yes | partially | no
  grade text,                         -- a process + outcome grade for the decision
  resolved_at timestamptz,

  meta jsonb,                         -- extensible bag for anything not yet its own column
  created_at timestamptz not null default now()
);

create index if not exists idx_decisions_user_created on decisions (user_id, created_at desc);
create index if not exists idx_decisions_user_ticker  on decisions (user_id, ticker);
create index if not exists idx_decisions_type         on decisions (type);
-- Fast lookup of a user's still-open decisions on a ticker, for outcome stamping.
create index if not exists idx_decisions_unresolved   on decisions (user_id, ticker) where outcome_status is null;
-- Recent-activity scans for the anonymized retail aggregate.
create index if not exists idx_decisions_ticker_created on decisions (ticker, created_at desc);
