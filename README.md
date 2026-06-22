# Outpost

**The trading partner who remembers.**

Outpost is an AI stock-intelligence app for self-directed retail investors. It captures your thesis at the moment you buy, and quotes it back to you when you are about to break your own plan. The agent refuses to validate panic and declines to give explicit buy or sell signals. It is a behavioral-accountability tool, not a tip service.

Status: private beta, deployed (Vercel · Railway · Supabase). This repository is published for review only. See "Usage" at the bottom.

## The idea

Most retail investors do not lose to a lack of information. They lose to themselves: panic-selling at the bottom, abandoning a thesis the first time it is tested, chasing hype they would have talked a friend out of. Outpost is the second brain that holds the line.

When you open a position you record your thesis and the condition that would prove you wrong. When the position moves and you come back rattled, Outpost returns your own words to you before you act. Every decision (open, add, trim, close) is logged with the market regime at the time, so the app accumulates a private record of how you actually behave and what your edge really is.

## Engineering highlights

This is the part worth reading. Outpost is a focused product surface sitting on a deliberately deep AI-systems layer. Everything below is implemented and tested.

### Decision-intelligence ledger ("the Machine")
An immutable ledger (`api/services/decisionLedger.js`) snapshots market context (VIX, Fear and Greed, regime) at every trade, then resolves the real outcome back onto the originating buy. A nightly job rolls it into advice-lift (advised vs self-directed win rate), per-setup base rates, and retail-trap stats, all behind sample-size gates, with explicit guards against endogenous-resolution bias (`ledgerIntegrity.js`). This is the asset that compounds with use and that a fast follower cannot shortcut.

### Async AI quality grading + per-user spend ceilings
Every Claude response is graded by a second cheap-tier model against a rubric and written to `ai_response_log` for a review queue (`api/services/aiQualityLog.js`). Grading is fire-and-forget, so the user never waits on it, and a regression alarm flags any feature whose grade drops across time windows. Separately, every call is priced from token usage into an append-only `ai_usage` table, and a per-user daily call ceiling (`aiSpendCeiling.js`) plus market-aware pacing keep spend bounded.

### Prompt-injection fencing
All user-supplied text that reaches a model is wrapped as quoted data through a single hardened boundary (`api/utils/fence.js`). The fence strips its own delimiter tags in a loop to defeat interleaved-tag reconstruction, and normalizes Unicode line separators. One boundary, pinned by tests, used everywhere user text meets the model.

### Intent-tier model routing + prompt caching
The agent classifies each message and routes it to the cheapest sufficient model: greetings to Haiku with no tools, lookups to Haiku with tools, real analysis to Opus with the full toolset (`api/functions/agent.js`). The system prompt is sent as a cached block so repeated turns do not re-pay for it. The agent runs a bounded tool-use loop (up to 5 rounds, 22 tools, parallel execution per round) and streams over Server-Sent Events.

### Atomic cash integrity
Paper-trade cash and position changes that must not tear on a crash (close plus credit, funded buy plus debit, cash adjust) run as single Postgres transactions under a per-user advisory lock (migrations 022 to 026), each with a JavaScript fallback so the app still runs before a migration is applied. This closed a real "cash drift" class of bug.

### Test discipline
The suite holds 92 deterministic, hermetic suites with roughly 892 assertions (`npm test`), plus a live cross-user isolation end-to-end test that exercises the tenant-isolation boundary the database deny-all RLS backstops. That is roughly one line of test for every two lines of backend code, on a solo build.

## Features (selected)

- **AI agent.** Portfolio-aware streaming chat with 22 tools (quotes, fundamentals, technicals, news, screening, risk and position sizing, trade-plan assessment, history recall). It can draft a buy or a position change, but nothing writes until you confirm.
- **Multi-agent reasoning.** A "think through a buy" trade-plan check, plus a Bull/Bear/Referee red-team and a multi-lens read (business, chart, story, and risk specialists with a lead synthesis).
- **Portfolio and paper-trading.** Positions carry a thesis, an invalidation, a target, and a stop. Import by screenshot (vision), paste, or broker CSV. Plan-status badges, performance attribution, stress tests, sector exposure, and a North Star goal.
- **Research and discovery.** Natural-language screeners vetted against live data, a personalized discover feed, a watchlist with notes and price alerts, catalyst and sector and bargain radars, and a stock dossier that compares a name to your holdings.
- **Behavioral coaching.** A process scorecard, a composure score, a mindset coach, and pattern detection across months (win rate sliced by whether you wrote a thesis, set a stop, or reflected on the close).
- **Proactive briefings.** A scheduled worker produces pre-market briefs, end-of-day snapshots, weekly summaries, and price-alert emails.

## Tech stack

- **Frontend:** React 18, Vite 5. No router library (auth-gated views with tab switching). React Context for auth, thin fetch wrappers over an in-memory TTL cache with in-flight dedup, Server-Sent Events for streaming, recharts, lucide-react, installable PWA.
- **Backend:** Node 20+, Express 4 (ESM). Two processes: an HTTP API and a scheduled-jobs worker. bcrypt password hashing, custom session-token auth.
- **Database:** Supabase Postgres via a service-role client. Row Level Security is on as deny-all; tenant isolation is enforced at the Express layer and proven by a live test.
- **AI:** Anthropic Claude in three swappable tiers (agent `claude-opus-4-8`, reads `claude-sonnet-4-6`, cheap `claude-haiku-4-5`), with intent routing, prompt caching, cost telemetry, and automated quality grading.
- **Data and email:** Polygon.io (primary market data), Finnhub and FMP (news, analyst, fundamentals; optional), Resend (transactional email).
- **Hosting:** Vercel (frontend), Railway (API plus worker), Supabase (Postgres).

By the numbers: about 59,000 lines across 383 files, 131 HTTP endpoints over 22 route groups, 29 tables, 38 React components, and a 92-suite test harness.

## Architecture

```
Browser (React PWA)
  -> src/lib/api.js   (fetch + bearer token, SSE for the agent)
  -> Express API
       requestId -> CORS -> JSON -> security headers -> global rate limit
       -> requireAuth (token hashed, looked up, cached briefly)
       -> per-route rate limit + AI spend pacing
       -> handler -> services:
            Supabase (service-role) · Anthropic Claude · market data · Resend
  <- JSON or SSE stream

Worker process (separate): cron-scheduled briefs, snapshots, scans, the
alert monitor, the decision-intelligence build, and quality/model watchdogs.
```

Shared market data (regime, movers, indicators) is refreshed on timers into an in-memory pool, so most requests make zero per-request data-provider calls.

## Running it locally

Requires Node 20+ and a Supabase project.

```
npm install
cp .env.example .env          # then fill in your own keys locally
# create the schema: paste schema.sql and api/migrations/*.sql into the Supabase SQL editor

npm run dev        # frontend (Vite) on http://localhost:5173
npm run server     # API on http://localhost:3001
npm run jobs       # background worker (optional locally)

npm test           # the deterministic test suite
```

## Environment variables (names only)

Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, `POLYGON_API_KEY`, `RESEND_API_KEY`.

Optional and feature flags: `FINNHUB_API_KEY`, `FMP_API_KEY`, `AGENT_MODEL`, `READS_MODEL`, `CHEAP_MODEL`, `AI_DAILY_CALL_CAP`, `AI_UNLIMITED_DAILY_CAP`, `ADMIN_SECRET`, `FOUNDER_EMAILS`, `FRONTEND_URL`, `PORT`, `NODE_ENV`, `BETA_ALLOWLIST_OPEN`, `JOBS_SEPARATE_PROCESS`, `SURFACE_RETAIL_INTEL`, `BROKERAGE_PROVIDER`, `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Frontend build: `VITE_API_URL`.

No secret values live in this repository. `.env` is gitignored, and only `.env.example` (placeholders) is tracked.

## Status

Private beta, deployed and running. Signups are invite-only behind an email allowlist. Billing tiers and a brokerage-sync seam are scaffolded but intentionally not wired during beta.

## Not financial advice

Outpost is an educational and behavioral tool. It is not financial advice and is not a registered investment adviser. The agent declines to issue explicit buy or sell signals and is built to refuse to validate panic. Markets carry risk, and you are responsible for your own decisions.

## Usage

All rights reserved. This source is published for review and evaluation only. No license is granted to use, copy, modify, or redistribute it. There is intentionally no LICENSE file.
