# Outpost — Codebase Map

Built during the final pre-launch audit. The map of what exists and where; the audit log (`AUDIT_LOG.md`) tracks findings.

## High-level shape

- **Backend**: Express + Supabase. Entry: `api/server.js`. Optional jobs runner: `api/jobs/runner.js`.
- **Frontend**: Vite + React (Tailwind-free, inline styles). Entry: `src/main.jsx` → `src/pages/App.jsx`.
- **DB**: Supabase Postgres. Schema in `schema.sql` + `supabase-setup.sql` + 14 numbered migrations (002-015). RLS intentionally disabled (custom session-token auth, not Supabase Auth).
- **Build**: `vite build` → `dist/`. Frontend deployed to Vercel; backend to Railway as two services (api + jobs).
- **External services**: Anthropic (Claude), Polygon (market data, branded "Massive" in marketing), Finnhub (backup), FMP (fundamentals), Resend (email), Supabase, Stripe (scaffold only), SnapTrade (scaffold only).

## Entry points

| File | Role |
|---|---|
| `api/server.js` | Express app, mounts routes at `/api/*`, runs alert monitor inline unless `JOBS_SEPARATE_PROCESS=true` |
| `api/jobs/runner.js` | Cron jobs (briefs, snapshots, digests, founder digest, credit resets, alert monitor). All ET-scheduled. |
| `src/main.jsx` | React root, mounts `<App />`. PWA service worker registered in production. |
| `src/pages/App.jsx` | Auth gate — routes to LandingPage/AuthScreen/ResetPasswordScreen/OnboardingScreen/AppShell depending on user state + `?token=` URL param |

## Backend directory

### Routes (api/functions/, mounted under `/api/<name>` in server.js)

| File | LOC | Routes |
|---|---|---|
| `auth.js` | 361 | `POST /signup`, `/login`, `/logout`, `GET /validate`, `POST /forgot-password`, `/reset-password`, `/change-password` |
| `ai.js` | 1590 | `/welcome`, `/summary`, `/analysis`, `/find-opportunity`, `/news`, `/brief`, `/journal-coach`, `/thesis-assist`, `/exit-reflection-assist`, `/deploy-cash`, `/deploy-cash/counter`, `/deploy-cash/choice` |
| `portfolio.js` | 1092 | `/value`, `/synthesis`, `/positions` (POST/PATCH/DELETE), `/import`, `/parse-screenshot`, `/closed-trades`, `/snapshots`, `/snapshot`, `/stock-details/:ticker`, `/analyses`, `/performance`, `/tax-insights`, `/plan-adherence`, `/performance-attribution`, `/history/:ticker` |
| `agent.js` | 1261 | `GET /messages`, `POST /messages`, `POST /stream`, `DELETE /messages`, `GET /memories`, `DELETE /memories`, `DELETE /memories/:id` |
| `market.js` | TBD | `/sentiment`, `/movers`, `/prices`, `/news` |
| `social.js` | 415 | `/buzz`, `/scan`, `/catalyst*`, `/watchlist` (CRUD) |
| `catalyst.js` | 633 | catalyst watch background scanner + endpoints |
| `journal.js` | TBD | `/notes` (CRUD), `/timeline` (Phase 3) |
| `alerts.js` | TBD | price alerts CRUD |
| `admin.js` | TBD | founder dashboard + review queue |
| `settings.js` | TBD | user prefs, ai-feedback, account deletion |
| `sectorRadar.js` | TBD | `/api/ai/sector-radar` |
| `bargainRadar.js` | 473 | `/api/ai/bargain-radar` |
| `portfolioExplainer.js` | 431 | `/api/ai/move-explainer` (Phase 1 voice rewrite, recent timeout fix) |
| `proactiveDigest.js` | TBD | `/api/ai/proactive-digest` |
| `today.js` | TBD | `/api/ai/today` |

### Middleware (api/middleware/)

| File | Purpose |
|---|---|
| `auth.js` | `requireAuth`, `optionalAuth`, `invalidateAuth`. 5-min in-memory cache. |
| `rateLimit.js` | Per-IP rate limiter, global + per-route |
| `sessionPacing.js` | Agent session pacing (paid users) |
| `admin.js` | Founder allowlist via `FOUNDER_EMAILS` env |
| `validate.js` | Input sanitizers: `sanitizeTicker`, `sanitizeNumber`, `sanitizeString`, `isValidEmail`, `isStrongEnoughPassword`, `isDisplayNameAllowed` |

### Services (api/services/)

| File | Purpose | Recently touched? |
|---|---|---|
| `agentMemory.js` | Persistent agent learning (agent_memory table) | No |
| `agentTools.js` | 19 agent tools (lookup, screen, fundamentals, technicals, etc. + `recall_history` Phase 3 + write-tool design discussed but not built) | Phase 3 added recall_history |
| `aiQualityLog.js` | Auto-grading of AI outputs → ai_response_log | No |
| `alertMonitor.js` | Price alert ticking every 5 min in market hours | No |
| `analytics.js` | Daily counters + insights | No |
| `fmp.js` | FMP API client | No |
| `founderDigest.js` | Monday founder email | Recent timeout fix |
| `historyAggregator.js` | Phase 3 — unifies events from agent_messages, positions, closed_trades, journal_notes, deploy_cash_sessions | Phase 3/4 work |
| `marketData.js` | VIX, F&G, RSI shared service | No |
| `memoryCache.js` | In-memory LRU for auth + cheap lookups | No |
| `monitor.js` | Error tracking, AI call success/failure metrics | No |
| `notifications.js` | Daily + weekly digest emails | Recent (verify pipeline) |
| `performanceAttribution.js` | Winners/losers contribution | No |
| `planAdherence.js` | Did trader follow stated plan? | No |
| `portfolioSynthesis.js` | "Outpost Read" generator | Phase 1 voice rewrite |
| `pricePool.js` | Batched price polling for all user tickers | No |
| `proactiveDigest.js` | Morning digest generator | No |
| `promptExperiments.js` | A/B variant assignment | No |
| `snapTrade.js` | SnapTrade scaffold (not wired) | No |
| `taxInsights.js` | Wash sale, harvest analysis | No |
| `today.js` | "Today" home card aggregator | No |
| `welcomeMoment.js` | First-AI-moment welcome msg | No |

### Utils (api/utils/)

| File | LOC | Purpose |
|---|---|---|
| `finnhub.js` | 413 | Finnhub API client |
| `marketHours.js` | TBD | ET time helpers, market open/close, weekday checks |
| `polygon.js` | 490 | Polygon API client (snapshots, prev close, news) |
| `promptEngine.js` | 434 | `buildAgentContext`, `buildBriefContext` — assembles agent's context block |
| `stockUniverse.js` | TBD | Curated tickers for screening |
| `ticker.js` | TBD | Ticker symbol helpers |

### DB schema files

| File | Purpose |
|---|---|
| `schema.sql` | Base tables: user_profiles, password_reset_tokens, positions, portfolio_snapshots, portfolio_analyses, watchlist, futures_trades, agent_messages, ai_cache, price_cache, market_summary, analytics_daily, ai_response_log, ai_feedback, feedback, errors |
| `supabase-setup.sql` | error_log, ai_feedback, closed_trades, indexes |
| `api/migrations/002_trade_plans_and_memory.sql` | Adds entry_thesis, price_target, stop_loss, trade_notes to positions + agent_memory table |
| `api/migrations/003_unique_constraints.sql` | Unique (user_id, ticker) on positions + agent_messages index |
| `api/migrations/004_purchased_at.sql` | positions.purchased_at column |
| `api/migrations/005_atomic_credits.sql` | `deduct_credits` and `refund_credits` RPCs |
| `api/migrations/006_journal.sql` | journal table (legacy?) |
| `api/migrations/007_journal_notes.sql` | journal_notes table |
| `api/migrations/008_alerts_and_reflection.sql` | price_alerts table + closed_trades.exit_reflection, exit_outcome |
| `api/migrations/009_email_notifications.sql` | email_daily_digest, email_weekly_summary booleans on user_profiles |
| `api/migrations/010_analytics_daily.sql` | analytics_daily extensions |
| `api/migrations/011_ai_feedback_variant.sql` | ai_feedback.variant column |
| `api/migrations/012_ai_response_log.sql` | ai_response_log table for auto-grading |
| `api/migrations/013_beta_allowlist.sql` | beta_allowlist table |
| `api/migrations/014_thesis_and_reflection.sql` | Phase 2: positions.reversal_condition, thesis_written_at + closed_trades.thesis_played_out, reflection_what_happened, reflection_lesson |
| `api/migrations/015_deploy_cash.sql` | Phase 4: deploy_cash_sessions table + positions.source column |

## Frontend directory

### Pages / shell

| File | Purpose |
|---|---|
| `src/main.jsx` | React root, ErrorBoundary, AuthProvider, App. SW registration in prod only. |
| `src/pages/App.jsx` | Auth-state-driven routing: landing → guide → auth → onboarding → AppShell. Reset-password URL handling. |
| `src/components/shared/AppShell.jsx` | 5 tabs (home/port/social/agent/journal), settings gear, market regime bar, toast, install prompt, urgent-alert dot |
| `src/components/shared/ErrorBoundary.jsx` | React error boundary at root |
| `src/components/shared/InstallPrompt.jsx` | PWA install banner |
| `src/components/shared/UI.jsx` | Modal, FormField, EmptyState, Spinner, DisclaimerBadge, FeedbackButtons, TickerIcon, SkeletonCard |

### Auth screens

| File | Purpose |
|---|---|
| `src/components/auth/LandingPage.jsx` | Marketing landing |
| `src/components/auth/FounderGuide.jsx` | Long-form "why Outpost" |
| `src/components/auth/AuthScreen.jsx` | Sign in/up, forgot password, legal modals |
| `src/components/auth/OnboardingScreen.jsx` | Style/risk/assets picker → welcome AI message |
| `src/components/auth/ResetPasswordScreen.jsx` | Phase-prep reset-password completion |

### Tabs

| File | LOC | Purpose |
|---|---|---|
| `src/components/home/HomeTab.jsx` | 592 | Today card, Deploy Cash card, Activation Checklist, Brief, Portfolio Explainer, Bargain Radar (older cards still defined but not rendered) |
| `src/components/portfolio/PortfolioTab.jsx` | 2864 | Position list, AddModal, PositionCard, ThesisSection, HistorySection, close form, ImportModal, ClosedTradesDrawer, ThesesDrawer (Phase 2 My Theses), GrowthChartInline |
| `src/components/social/SocialTab.jsx` | 962 | Discover view, Catalyst Watch, Bargain Radar, Buzz, Watchlist |
| `src/components/agent/AgentTab.jsx` | 466 | Streaming chat, memory display, scan/clear actions |
| `src/components/journal/JournalTab.jsx` | 648 | Notes + Timeline sub-tabs (Phase 3 Timeline view) |
| `src/components/settings/SettingsPage.jsx` | 381 | Account, prefs, notifications, legal, danger zone |
| `src/components/admin/FounderDashboard.jsx` | 419 | Founder analytics dashboard |

### Home cards (some defined-but-unused per HomeTab.jsx imports)

| File | Rendered? |
|---|---|
| `home/TodayCard.jsx` | Yes |
| `home/DeployCashFlow.jsx` | Yes (Phase 4) |
| `home/ActivationChecklist.jsx` | Yes |
| `home/PortfolioExplainerCard.jsx` | Yes |
| `home/BargainRadarCard.jsx` | Yes (Social tab) |
| `home/ConcentrationAlertCard.jsx` | No (deprecated per comment in HomeTab.jsx) |
| `home/ProactiveDigestCard.jsx` | No (deprecated per comment in HomeTab.jsx) |

### Portfolio surfaces (Phase 2 / 3 additions)

| File | Purpose |
|---|---|
| `portfolio/SynthesisCard.jsx` | "Outpost Read" — Phase 1 voice |
| `portfolio/PerformanceAttributionCard.jsx` | Winners/losers contribution |
| `portfolio/PlanAdherenceCard.jsx` | Plan adherence tracking |

### Lib

| File | Purpose |
|---|---|
| `src/lib/api.js` | Client wrapper for every endpoint. Bearer-token auth. 30s timeout, 1 retry on 5xx. |
| `src/lib/cache.js` | Client-side cache (cachedFetch, clearCachePrefix) |
| `src/hooks/useAuth.jsx` | React auth context |
| `src/utils/market.js` | Market status, color helpers, formatters |
| `src/utils/renderText.js` | Plain-text renderer (strips markdown) |

## Tests

| File | Purpose |
|---|---|
| `tests/audit_smoke.mjs` | Pure-logic regression suite. 215 assertions. |
| `tests/_deploy_cash_audit.mjs` | Phase 4 filter-matrix audit. 14 scenarios × 4 portfolios × 5 rules. |
| `tests/_verify_daily_email.mjs` | Email pipeline preview/send harness |
| `tests/_voice_test_*.mjs` | Voice rewrite verification harnesses (synthesis, summary, analysis, batch, thesis) |
| `tests/ai_stress_test.mjs` | AI quality stress test |
| `tests/eval_position_reads.mjs` | Position read evaluation |
| `tests/probe_closed_trades.mjs` | Closed trades schema probe |
| `tests/probe_fk_drift.mjs` | FK consistency probe |

## Background jobs (jobs/runner.js, ET schedule)

| Time | Job | Days |
|---|---|---|
| Every 30 min | Social buzz scan | Daily |
| 07:00 | Proactive digests | Weekdays |
| 07:30 | Pre-market briefs | Weekdays |
| 07:45 | Daily digest emails | Weekdays |
| 09:00 | Founder digest email | Mondays |
| 16:30 | Portfolio snapshots | Weekdays |
| 16:45 | Portfolio explainers | Weekdays |
| 17:00 | Bargain Radar nightly scan | Weekdays |
| 18:00 | Weekly summary emails | Sundays |
| 00:00 | Analytics daily reset | Daily |
| 00:01 | Credit resets | Daily |
| Every 5 min | Price alert monitor | Market hours |

## Environment variables

(See `.env.example` — also verified during audit.)

**Required:**
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `POLYGON_API_KEY`
- `RESEND_API_KEY`

**Optional but used:**
- `FINNHUB_API_KEY` (backup data, code degrades gracefully)
- `FMP_API_KEY` (fundamentals, degrades gracefully)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (scaffold)
- `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY` (scaffold)
- `ADMIN_SECRET` (admin endpoint key)
- `FOUNDER_EMAILS` (comma-separated)

**App:**
- `FRONTEND_URL`
- `PORT` (default 3001)
- `NODE_ENV`
- `BETA_ALLOWLIST_OPEN` (false default)
- `JOBS_SEPARATE_PROCESS` (false default, true for prod API service)

**Client-exposed:**
- `VITE_API_URL` (only thing bundled into frontend)
