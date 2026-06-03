// Brokerage connection + sync routes.
//
// All endpoints are live but DORMANT: until brokerage sync is enabled (a provider
// selected and its keys present), they return 503 'not enabled yet'. This lets
// the path ship now and light up the day the SnapTrade account exists, with no
// behavior change in the meantime.
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { getActiveProvider } from '../services/brokerage/provider.js';
import { syncBrokerage, isBrokerageEnabled } from '../services/brokerage/sync.js';

const router = express.Router();
const DISABLED = { error: 'Brokerage sync is not enabled yet' };

// Is sync available at all, and which provider is active?
router.get('/status', requireAuth, async (req, res) => {
  try {
    const provider = await getActiveProvider();
    res.json({ enabled: isBrokerageEnabled(), provider: provider.id });
  } catch {
    res.json({ enabled: false, provider: 'manual' });
  }
});

// Begin the connect flow; returns a URL for the user to open (their broker's
// own login, so we never handle their credentials).
router.post('/connect', requireAuth, rateLimit(10), async (req, res) => {
  if (!isBrokerageEnabled()) return res.status(503).json(DISABLED);
  try {
    const provider = await getActiveProvider();
    const { url } = await provider.getConnectUrl(req.user.id, { redirect: req.body?.redirect });
    res.json({ url });
  } catch (e) {
    const code = e.message === 'brokerage_not_configured' ? 503 : 500;
    res.status(code).json({ error: 'Could not start brokerage connection' });
  }
});

// Finish the connect flow after the broker redirect.
router.post('/callback', requireAuth, rateLimit(10), async (req, res) => {
  if (!isBrokerageEnabled()) return res.status(503).json(DISABLED);
  try {
    const provider = await getActiveProvider();
    const result = await provider.completeConnection(req.user.id, req.body || {});
    res.json({ connected: true, ...result });
  } catch {
    res.status(503).json({ error: 'Could not complete brokerage connection' });
  }
});

// Pull the latest holdings + cash and reconcile into the account.
router.post('/sync', requireAuth, rateLimit(10), async (req, res) => {
  if (!isBrokerageEnabled()) return res.status(503).json(DISABLED);
  try {
    res.json(await syncBrokerage(req.user.id));
  } catch {
    res.status(500).json({ error: 'Brokerage sync failed' });
  }
});

export default router;
