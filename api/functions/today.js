/**
 * Routes for the TODAY surface — Outpost's curated picks card.
 * Service logic lives in api/services/today.js.
 */
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { buildTodayFeed } from '../services/today.js';

const router = express.Router();

// GET /api/ai/today — top 5 ranked picks for the user's day.
// Free for all users. No Claude calls — pure aggregation over cached data.
router.get('/', requireAuth, rateLimit(20), async (req, res) => {
  try {
    const data = await buildTodayFeed(req.user.id);
    res.json({
      ...data,
      disclaimer: 'For informational purposes only. Not financial advice.',
    });
  } catch (err) {
    console.error('[Today] API error:', err);
    res.status(500).json({ error: 'Today feed unavailable' });
  }
});

export default router;
