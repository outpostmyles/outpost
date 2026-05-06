// Routes for the proactive AI digest.
// Service logic is in api/services/proactiveDigest.js — this file is just the HTTP surface.
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { getDigestForUser } from '../services/proactiveDigest.js';

const router = express.Router();

// GET /api/ai/proactive-digest — fetch today's digest (cached) or ?force=true to regenerate.
// Free tier — no credit gate. Cost is ~$0.001/call (Haiku).
router.get('/', requireAuth, rateLimit(5), async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const data = await getDigestForUser(req.user.id, force);
    res.json({
      ...data,
      disclaimer: 'For informational purposes only. Not financial advice.',
    });
  } catch (err) {
    console.error('[ProactiveDigest] API error:', err);
    res.status(500).json({ error: 'Digest unavailable' });
  }
});

export default router;
