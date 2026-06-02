// Research surface: one ticker, everything needed to actually decide, personalized
// to the user's book. The screener finds names; this is where you research one.
// Reusable beyond screeners (Discover, watchlist) since it is keyed only on ticker.
import express from 'express';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { sanitizeTicker } from '../middleware/validate.js';
import { buildDossier, compareForBook } from '../services/researchDossier.js';

const router = express.Router();

// Where you are on a name in your own research, persisted globally per ticker so
// your verdict shows everywhere that name appears (screeners, dossier).
const STATUSES = new Set(['researching', 'watching', 'passed', 'bought']);

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

// GET /compare?tickers=A,B,C — 2 or 3 dossiers plus a personalized best-fit pick.
router.get('/compare', requireAuth, rateLimit(20), async (req, res) => {
  try {
    const tickers = String(req.query.tickers || '').split(',').map(t => sanitizeTicker(t)).filter(Boolean).slice(0, 3);
    if (tickers.length < 2) return res.status(400).json({ error: 'Pick 2 or 3 names to compare' });
    const dossiers = (await Promise.all(tickers.map(t => buildDossier(t, req.user.id).catch(() => null))))
      .filter(d => d && d.price != null);
    if (dossiers.length < 2) return res.status(404).json({ error: 'Could not pull enough data to compare right now' });
    res.json({ dossiers, best: compareForBook(dossiers) }); // each dossier already carries momentum1m
  } catch (e) {
    console.error(`[req:${req.requestId}] [Research] compare failed:`, e.message);
    res.status(500).json({ error: 'Compare failed, try again' });
  }
});

// GET /status — the user's research verdicts, as a { ticker: status } map.
router.get('/status', requireAuth, rateLimit(60), async (req, res) => {
  try {
    const { data } = await supabase.from('research_status').select('ticker, status').eq('user_id', req.user.id);
    const statuses = {};
    for (const r of data ?? []) statuses[r.ticker] = r.status;
    res.json({ statuses });
  } catch {
    res.json({ statuses: {} }); // fail-safe: pre-migration or table hiccup -> no statuses, not a crash
  }
});

// POST /status { ticker, status } — set or clear (null) your verdict on a name.
router.post('/status', requireAuth, rateLimit(60), async (req, res) => {
  try {
    const ticker = sanitizeTicker(req.body.ticker);
    if (!ticker) return res.status(400).json({ error: 'Valid ticker required' });
    const status = req.body.status || null;
    if (status && !STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' });
    const { error } = !status
      ? await supabase.from('research_status').delete().eq('user_id', req.user.id).eq('ticker', ticker)
      : await supabase.from('research_status')
          .upsert({ user_id: req.user.id, ticker, status, updated_at: new Date().toISOString() }, { onConflict: 'user_id,ticker' });
    if (error) {
      console.error(`[req:${req.requestId}] [Research] status write failed:`, error.message);
      return res.status(500).json({ error: 'Could not save your call' });
    }
    res.json({ ok: true, ticker, status });
  } catch (e) {
    console.error(`[req:${req.requestId}] [Research] status failed:`, e.message);
    res.status(500).json({ error: 'Could not save your call' });
  }
});

export default router;
