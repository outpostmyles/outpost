# Brokerage sync (rails laid, dormant until keys exist)

The architecture for auto-syncing a user's real brokerage (positions, cash,
trades) is built and tested, but OFF. Today the app uses the `manual` provider
(hand-entered positions), exactly as before. This doc is the finish list for the
day a SnapTrade account exists.

## Why this matters
Every tracker dies when people stop hand-updating it. Once positions and cash
sync automatically, everything already built (thesis watch, decision memory,
composure, North Star, tax) becomes real-time and effortless, and the "AI that
has watched your whole trading history" moat compounds.

## What already exists
- `src/lib/brokerageSync.js`: pure reconciliation engine (normalize holdings,
  diff vs last sync, emit upserts / closes / trades, sum cash). Fully unit-tested
  in `tests/brokerage_sync.mjs` (13 assertions, in the SUITE).
- `api/services/brokerage/provider.js`: provider-agnostic seam + `manual`
  default + lazy `getActiveProvider()`.
- `api/services/brokerage/snaptrade.js`: SnapTrade adapter STUB (throws
  `brokerage_not_configured`; real call shapes are in its FINISH LIST comment).
- `api/services/brokerage/sync.js`: `syncBrokerage(userId)`: reconciles into the
  existing `positions` table + cash balance. Inert when disabled.
- `api/functions/brokerage.js`: routes `GET /api/brokerage/status`,
  `POST /connect`, `POST /callback`, `POST /sync` (return 503 until enabled).
- `api/config.js`: optional `SNAPTRADE_CLIENT_ID` / `SNAPTRADE_CONSUMER_KEY`
  (not required, app boots without them) and `config.brokerage { provider,
  enabled }`.

## How it turns on
1. Get a SnapTrade account; set `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`,
   and `BROKERAGE_PROVIDER=snaptrade` in the backend env.
2. `npm i snaptrade-typescript-sdk`.
3. Fill in `api/services/brokerage/snaptrade.js` (its FINISH LIST has the exact
   SDK calls): register user + store `userSecret`, login redirect URL, list
   accounts, get holdings, get balances.
4. That is it. `config.brokerage.enabled` flips true automatically, the routes
   go live, and `syncBrokerage` starts reconciling.

## Design choices (kept on purpose)
- No schema migration: connection + sync state live in `agent_memory`; synced
  holdings reconcile into `positions` by `(user_id, ticker)`.
- Broker is the source of truth for any ticker it reports; manual-only tickers
  are untouched.
- Read-only first. No order execution (stays clear of broker-dealer territory);
  the user logs in at their own broker so we never touch their password.
- Live price moves are never treated as trades; the diff is on shares.

## Still TODO when finishing (not yet built, by design)
- Closed-trade history: when a holding disappears from the broker (sold out),
  record a `closed_trade` with the real fill price. That price comes from the
  provider ACTIVITIES feed, not the holdings snapshot, so `sync.js` currently
  surfaces `closes` rather than auto-deleting (it will not silently destroy
  history). Wire activities -> close path when finishing the adapter.
- A periodic/auto sync trigger (e.g. on app open and/or a scheduled job).
- A "Connect your brokerage" entry in Settings (intentionally not added yet).
- Encrypt the stored `userSecret` at rest.
