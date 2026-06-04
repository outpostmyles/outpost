// Decision ledger routes: the user's own receipts, and the founder-only
// anonymized aggregate (the developer's view).
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { getUserReceipts, getAggregate } from '../services/decisionLedger.js';

const router = express.Router();

// GET /api/decisions: the user's own track record, summary, behavioral
// patterns, and the most recent decisions each with a process grade. This is the
// "show the receipts" surface. Safe before the migration is run (returns zeros).
router.get('/', requireAuth, rateLimit(30), async (req, res) => {
  try {
    res.json(await getUserReceipts(req.user.id));
  } catch (err) {
    console.error('[Decisions] receipts failed:', err.message);
    res.status(500).json({ error: 'Could not load your decisions' });
  }
});

// GET /api/decisions/aggregate: FOUNDER ONLY. The anonymized cross-user view of
// where the retail crowd is piling in, and where retail reliably gets hurt. This
// is the developer's window into the data asset.
router.get('/aggregate', requireAuth, requireAdmin, rateLimit(20), async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    res.json(await getAggregate({ days }));
  } catch (err) {
    console.error('[Decisions] aggregate failed:', err.message);
    res.status(500).json({ error: 'Could not load the aggregate' });
  }
});

export default router;
