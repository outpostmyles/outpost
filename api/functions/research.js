// Research surface: one ticker, everything needed to actually decide, personalized
// to the user's book. The screener finds names; this is where you research one.
// Reusable beyond screeners (Discover, watchlist) since it is keyed only on ticker.
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { sanitizeTicker } from '../middleware/validate.js';
import { buildDossier } from '../services/researchDossier.js';

const router = express.Router();

// GET /dossier/:ticker — the personalized research dossier for one name.
router.get('/dossier/:ticker', requireAuth, rateLimit(40), async (req, res) => {
  try {
    const ticker = sanitizeTicker(req.params.ticker);
    if (!ticker) return res.status(400).json({ error: 'Valid ticker required' });
    const dossier = await buildDossier(ticker, req.user.id);
    if (!dossier || dossier.price == null) {
      return res.status(404).json({ error: `Could not pull research for ${ticker} right now` });
    }
    res.json({ dossier });
  } catch (e) {
    console.error(`[req:${req.requestId}] [Research] dossier failed:`, e.message);
    res.status(500).json({ error: 'Research failed, try again' });
  }
});

export default router;
