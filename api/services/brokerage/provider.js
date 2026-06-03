// Provider-agnostic brokerage seam.
//
// The rest of the app talks to a brokerage through THIS interface, never to a
// specific vendor, so SnapTrade (the first target) can be swapped for Plaid or
// anything else without touching consumers. A provider implements:
//
//   id: string
//   isConfigured(): boolean
//   getConnectUrl(userId, opts): Promise<{ url }>           start the connect flow
//   completeConnection(userId, query): Promise<{ accountId }>  finish the callback
//   getHoldings(userId): Promise<rawHolding[]>              current positions
//   getBalances(userId): Promise<rawBalance[]>              cash balances
//   disconnect(userId): Promise<void>
//
// The default is the 'manual' provider: never connected, no sync. It exists so
// the seam is always satisfiable and the app runs exactly as today when
// brokerage sync is off (which it is until a provider's keys are set).
import { config } from '../../config.js';

export const manualProvider = {
  id: 'manual',
  isConfigured() { return false; },
  async getConnectUrl() { throw new Error('brokerage_sync_disabled'); },
  async completeConnection() { throw new Error('brokerage_sync_disabled'); },
  async getHoldings() { return []; },
  async getBalances() { return []; },
  async disconnect() {},
};

let _cached = null;

/**
 * Resolve the active provider from config. SnapTrade is loaded lazily (dynamic
 * import) only when selected AND configured, so its SDK is never pulled in while
 * sync is off. Falls back to the manual provider otherwise.
 */
export async function getActiveProvider() {
  if (_cached) return _cached;
  if (config.brokerage?.provider === 'snaptrade' && config.brokerage?.enabled) {
    const { snaptradeProvider } = await import('./snaptrade.js');
    _cached = snaptradeProvider;
  } else {
    _cached = manualProvider;
  }
  return _cached;
}

// Test/utility hook: forget the memoized provider (e.g. after a config change).
export function _resetActiveProvider() { _cached = null; }
