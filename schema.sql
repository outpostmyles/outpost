-- Outpost v2 Database Schema
-- Run this in Supabase SQL Editor

create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  password_hash text not null,
  password_salt text not null,
  session_token text,
  session_expires timestamptz,
  plan text default 'free',
  credits_remaining integer default 50,
  credits_used_this_month integer default 0,
  billing_date integer default 1,
  risk_tolerance text default 'moderate',
  trading_style text default 'swing',
  onboarding_complete boolean default false,
  onboarding_style text,
  onboarding_assets text,
  stripe_customer_id text,
  stripe_subscription_id text,
  last_login timestamptz,
  weekly_bonus_last_given timestamptz,
  email_daily_digest boolean default true,
  email_weekly_summary boolean default true,
  created_at timestamptz default now()
);

create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  token text unique not null,
  expires_at timestamptz not null,
  used boolean default false,
  created_at timestamptz default now()
);

create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  ticker text not null,
  company_name text,
  shares numeric not null,
  avg_cost numeric default 0,
  current_price numeric default 0,
  current_value numeric default 0,
  pnl numeric default 0,
  pnl_percent numeric default 0,
  last_updated timestamptz,
  created_at timestamptz default now(),
  unique(user_id, ticker)
);

create table if not exists portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  total_value numeric not null,
  total_pnl numeric default 0,
  date text not null,
  created_at timestamptz default now(),
  unique(user_id, date)
);

create table if not exists portfolio_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  ticker text not null,
  analysis_type text not null,
  analysis_text text not null,
  date text not null,
  generated_at timestamptz default now()
);

create table if not exists watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  ticker text not null,
  company_name text,
  last_price numeric,
  change_percent numeric,
  last_sentiment text,
  last_mention_count integer,
  added_at timestamptz default now(),
  unique(user_id, ticker)
);

create table if not exists futures_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  instrument text not null,
  direction text not null,
  outcome text not null,
  pnl numeric default 0,
  entry_price numeric,
  exit_price numeric,
  contracts integer default 1,
  setup_type text,
  session text default 'rth',
  notes text,
  date text not null,
  created_at timestamptz default now()
);

create table if not exists agent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  role text not null,
  content text not null,
  conversation_id text,                          -- multiple-conversations feature (see migration 027)
  created_at timestamptz default now()
);

create table if not exists ai_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text unique not null,
  result text not null,
  created_at timestamptz default now()
);

create table if not exists price_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text unique not null,
  data text not null,
  fetched_at timestamptz default now()
);

create table if not exists market_summary (
  id uuid primary key default gen_random_uuid(),
  summary_text text not null,
  generated_at timestamptz default now()
);

create table if not exists analytics_daily (
  id uuid primary key default gen_random_uuid(),
  date text not null,
  data text not null,
  created_at timestamptz default now(),
  unique(date)
);

create table if not exists ai_response_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete set null,
  feature text not null,
  ticker text,
  variant text,
  input_preview text,
  output text not null,
  score integer,
  failures text[],
  grader_notes text,
  reviewed boolean default false,
  review_verdict text,
  created_at timestamptz default now()
);

create table if not exists ai_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  feature text not null,
  rating text not null,
  reason text,
  response_preview text,
  variant text,
  created_at timestamptz default now()
);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  type text not null,
  description text not null,
  created_at timestamptz default now()
);

create table if not exists errors (
  id uuid primary key default gen_random_uuid(),
  endpoint text,
  user_id uuid,
  error_message text,
  stack text,
  timestamp timestamptz default now()
);

-- Indexes for performance
create index if not exists idx_positions_user on positions(user_id);
create index if not exists idx_watchlist_user on watchlist(user_id);
create index if not exists idx_futures_trades_user on futures_trades(user_id);
create index if not exists idx_agent_messages_user on agent_messages(user_id);
create index if not exists idx_portfolio_analyses_user_date on portfolio_analyses(user_id, date);
create index if not exists idx_portfolio_snapshots_user on portfolio_snapshots(user_id);
create index if not exists idx_ai_cache_key on ai_cache(cache_key);
create index if not exists idx_price_cache_key on price_cache(cache_key);
create index if not exists idx_user_session on user_profiles(session_token);

-- Disable RLS (using custom auth)
alter table user_profiles disable row level security;
alter table positions disable row level security;
alter table portfolio_snapshots disable row level security;
alter table portfolio_analyses disable row level security;
alter table watchlist disable row level security;
alter table futures_trades disable row level security;
alter table agent_messages disable row level security;
alter table ai_cache disable row level security;
alter table price_cache disable row level security;
alter table market_summary disable row level security;
alter table ai_feedback disable row level security;
alter table feedback disable row level security;
alter table errors disable row level security;
alter table password_reset_tokens disable row level security;
alter table analytics_daily disable row level security;
