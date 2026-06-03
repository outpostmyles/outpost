// Orchestrates one brokerage sync: pull holdings + cash from the active provider,
// reconcile against the last saved sync state, and write the result into the
// EXISTING positions table and cash balance (so thesis watch, decision memory,
// composure, North Star and tax all just work on synced data).
//
// Inert until brokerage sync is enabled: with the manual provider it returns
// { connected: false } and touches nothing, so callers can invoke it freely.
//
// No schema migration (the project's standing constraint): the per-user sync
// state lives in agent_memory as a JSON singleton, and synced holdings reconcile
// into `positions` by (user_id, ticker). The broker is the source of truth for
// any ticker it reports; manual-only tickers are left untouched.
import { supabase } from '../../db.js';
import { config } from '../../config.js';
import { getActiveProvider } from './provider.js';
import { reconcileHoldings, buildSyncState, totalCashFromBalances } from '../../../src/lib/brokerageSync.js';
import { setCashBalance } from '../cashBalance.js';

const SYNC_STATE_TYPE = 'brokerage_sync_state';

export function isBrokerageEnabled() {
  return !!config.brokerage?.enabled;
}

async function getSyncState(userId) {
  const empty = { accountId: null, lastSyncedAt: null, holdings: [] };
  try {
    const { data } = await supabase.from('agent_memory')
      .select('content').eq('user_id', userId).eq('memory_type', SYNC_STATE_TYPE)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!data?.content) return empty;
    return JSON.parse(data.content);
  } catch { return empty; }
}

async function saveSyncState(userId, state) {
  await supabase.from('agent_memory').delete().eq('user_id', userId).eq('memory_type', SYNC_STATE_TYPE);
  await supabase.from('agent_memory').insert({
    user_id: userId, memory_type: SYNC_STATE_TYPE,
    content: JSON.stringify(state), created_at: new Date().toISOString(),
  });
}

/**
 * Run a sync for one user. Returns { connected, synced, upserted, closed, trades }.
 * No-op ({ connected:false }) when sync is disabled or the provider is manual.
 */
export async function syncBrokerage(userId) {
  if (!isBrokerageEnabled()) return { connected: false, synced: false };
  const provider = await getActiveProvider();
  if (provider.id === 'manual') return { connected: false, synced: false };

  const [holdings, balances] = await Promise.all([
    provider.getHoldings(userId),
    provider.getBalances(userId),
  ]);

  const prev = await getSyncState(userId);
  const { upserts, closes, trades } = reconcileHoldings(prev.holdings, holdings);

  // Upsert every current broker holding (write-through, matching the rest of the
  // codebase: select id, then update or insert). Broker wins for its tickers.
  for (const u of upserts) {
    const { data: existing } = await supabase.from('positions')
      .select('id').eq('user_id', userId).eq('ticker', u.ticker).maybeSingle();
    const row = { shares: u.shares, avg_cost: u.avgCost ?? null };
    if (existing) await supabase.from('positions').update(row).eq('id', existing.id);
    else await supabase.from('positions').insert({ user_id: userId, ticker: u.ticker, ...row, created_at: new Date().toISOString() });
  }

  // Cash from the broker is the account's real cash.
  await setCashBalance(userId, totalCashFromBalances(balances));

  // NOTE: `closes` (tickers the broker no longer holds = sold out) are returned
  // but NOT auto-deleted here. A proper close should record a closed_trade with
  // the real fill price so the track record and decision memory stay honest, and
  // that price comes from the provider's ACTIVITIES feed, not the holdings
  // snapshot. Wire that in when finishing the adapter (see snaptrade.js finish
  // list); until then we surface them rather than silently destroy history.

  await saveSyncState(userId, buildSyncState(holdings, { accountId: prev.accountId, at: new Date().toISOString() }));

  return { connected: true, synced: true, upserted: upserts.length, closed: closes.length, closes, trades };
}
