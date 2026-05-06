/**
 * SnapTrade — broker sync scaffold (NOT WIRED UP YET).
 *
 * SnapTrade is a third-party API that lets users connect real brokerage
 * accounts (Robinhood, Fidelity, Schwab, Webull, IBKR, etc.) and pull
 * positions, balances, and trade history. Their free tier covers up to
 * 100 connected users, then it's $0.99/user/mo after that — worth
 * activating once we have paying users who want "automatic" portfolio
 * sync instead of manual entry.
 *
 * Docs: https://docs.snaptrade.com
 *
 * ─── What this file will do once wired ────────────────────────────────
 *
 * 1. registerUser(userId)
 *    One-time: create a SnapTrade user record for an Outpost user. Stores
 *    the returned SnapTrade user secret in user_profiles.snaptrade_secret.
 *
 * 2. getConnectionPortalUrl(userId)
 *    Returns a signed URL the frontend opens in a popup. User logs into
 *    their broker there — credentials never touch our servers.
 *
 * 3. listAccounts(userId)
 *    Returns all brokerage accounts the user has connected.
 *
 * 4. syncAccount(userId, accountId)
 *    Pulls current positions + cash balance from a connected account and
 *    upserts them into our positions table. Runs on demand and on a
 *    daily schedule.
 *
 * 5. handleWebhook(body)
 *    SnapTrade fires webhooks when holdings change (trade execution,
 *    dividend, etc.). We re-sync the affected account in response.
 *
 * ─── Why it's scaffolded but not live ─────────────────────────────────
 *
 * - Needs SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY in .env.
 * - Needs a user_profiles.snaptrade_secret column (migration).
 * - Needs a positions.source column to distinguish 'manual' vs
 *   'snaptrade' rows so manual edits don't get clobbered by sync.
 * - Needs UI flow: Settings → Connect Broker → popup → confirm.
 * - Needs graceful conflict handling when both manual + synced data
 *   exist for the same ticker.
 *
 * Ship Outpost with manual entry first. Turn this on after we have
 * enough paying users to justify the UX work.
 */

import { config } from '../config.js';

const SNAPTRADE_ENABLED = Boolean(config.snaptradeClientId && config.snaptradeConsumerKey);

export function isSnapTradeEnabled() {
  return SNAPTRADE_ENABLED;
}

// Stubs — every function throws until we implement. Importing this file is
// safe; calling any function before wiring up creds will fail loudly so we
// don't silently no-op in production.

export async function registerUser(/* userId */) {
  throw new Error('SnapTrade not wired up — set SNAPTRADE_CLIENT_ID and SNAPTRADE_CONSUMER_KEY in .env, then implement snapTrade.registerUser.');
}

export async function getConnectionPortalUrl(/* userId */) {
  throw new Error('SnapTrade not wired up — see api/services/snapTrade.js header comment.');
}

export async function listAccounts(/* userId */) {
  throw new Error('SnapTrade not wired up — see api/services/snapTrade.js header comment.');
}

export async function syncAccount(/* userId, accountId */) {
  throw new Error('SnapTrade not wired up — see api/services/snapTrade.js header comment.');
}

export async function handleWebhook(/* body */) {
  throw new Error('SnapTrade not wired up — see api/services/snapTrade.js header comment.');
}
