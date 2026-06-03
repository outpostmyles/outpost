// SnapTrade adapter (STUB).
//
// Implements the brokerage provider interface, but every network call throws
// 'brokerage_not_configured' until the SnapTrade SDK is added and
// SNAPTRADE_CLIENT_ID / SNAPTRADE_CONSUMER_KEY are set. The real call shapes are
// sketched in the comments so finishing this is a small, well-scoped job, not a
// research project.
//
// FINISH LIST (the day the SnapTrade account exists):
//   1. npm i snaptrade-typescript-sdk
//   2. const client = new Snaptrade({ clientId: config.snaptradeClientId,
//                                     consumerKey: config.snaptradeConsumerKey })
//   3. Per user, registerUser(userId) once -> store the returned userSecret in
//      agent_memory ('brokerage_connection'); it is required to authenticate
//      every later call on that user's behalf. Treat it as a secret.
//   4. getConnectUrl: client.authentication.loginSnapTradeUser({ userId,
//      userSecret, immediateRedirect: true, customRedirect }) -> { redirectURI }.
//      The user logs in at THEIR broker; we never see their password.
//   5. completeConnection: after the redirect, list accounts and save the chosen
//      account id into the connection record.
//   6. getHoldings: client.accountInformation.getUserHoldings({ userId,
//      userSecret, accountId }).positions, each mapped through normalizeHolding
//      as { symbol: p.symbol.symbol.symbol, units: p.units,
//      average_purchase_price: p.average_purchase_price }.
//   7. getBalances: client.accountInformation.getUserAccountBalance(...) mapped
//      to [{ cash }]. (For closed-trade history with real fill prices, also pull
//      getUserAccountActivities and feed them to the close path, see sync.js.)
import { config } from '../../config.js';

const NOT_READY = 'brokerage_not_configured';

export const snaptradeProvider = {
  id: 'snaptrade',
  isConfigured() {
    return !!(config.snaptradeClientId && config.snaptradeConsumerKey);
  },
  async getConnectUrl(/* userId, opts */) {
    throw new Error(NOT_READY);
  },
  async completeConnection(/* userId, query */) {
    throw new Error(NOT_READY);
  },
  async getHoldings(/* userId */) {
    throw new Error(NOT_READY);
  },
  async getBalances(/* userId */) {
    throw new Error(NOT_READY);
  },
  async disconnect(/* userId */) {
    throw new Error(NOT_READY);
  },
};
