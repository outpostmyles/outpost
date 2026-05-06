/**
 * Price Alerts — CRUD endpoints.
 *
 * Alerts fire once. When a user's threshold is crossed, the alertMonitor job
 * marks the alert triggered, captures the triggering price, and sends an
 * email via Resend. Users can create, list, toggle, and delete alerts from
 * the portfolio UI. A triggered alert stays visible in the list until deleted.
 *
 * Storage cost: one row per alert (tiny). Compute cost: one Polygon lookup
 * per unique active ticker per monitor tick (cached 60s by pricePool).
 */
import express from 'express';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { sanitizeTicker, sanitizeNumber, sanitizeString, sanitizeEnum } from '../middleware/validate.js';
import { lookupStock } from '../services/agentTools.js';

const router = express.Router();

const MAX_ALERTS_PER_USER = {
  free: 5,
  starter: 25,
  pro: 100,
  elite: 500,
};

// GET /api/alerts — list all alerts for user (active and triggered)
router.get('/', requireAuth, rateLimit(30), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('price_alerts')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ alerts: data ?? [] });
  } catch (err) {
    console.error('[Alerts] GET failed:', err.message);
    res.status(500).json({ error: 'Failed to load alerts' });
  }
});

// POST /api/alerts — create new alert
// Body: { ticker, direction: 'above'|'below'|'percent_change', threshold, note? }
router.post('/', requireAuth, rateLimit(20), async (req, res) => {
  try {
    const ticker = sanitizeTicker(req.body?.ticker);
    if (!ticker) return res.status(400).json({ error: 'Invalid ticker' });

    const direction = sanitizeEnum(req.body?.direction, ['above', 'below', 'percent_change']);
    if (!['above', 'below', 'percent_change'].includes(direction)) {
      return res.status(400).json({ error: 'Invalid direction' });
    }

    // Threshold sanity: price alerts must be > 0 and < 1M; % change alerts must be -100..+1000
    let threshold;
    if (direction === 'percent_change') {
      threshold = sanitizeNumber(req.body?.threshold, -100, 1000);
    } else {
      threshold = sanitizeNumber(req.body?.threshold, 0.01, 1000000);
    }
    if (threshold == null) return res.status(400).json({ error: 'Invalid threshold' });

    const note = sanitizeString(req.body?.note, 200);

    // Validate ticker exists on a real exchange (prevents typos feeding the monitor)
    try {
      const lookup = await lookupStock({ ticker });
      if (lookup?.error || !lookup?.price) {
        return res.status(400).json({ error: `Ticker "${ticker}" is not a valid US stock symbol` });
      }
    } catch {
      return res.status(400).json({ error: `Ticker "${ticker}" is not a valid US stock symbol` });
    }

    // Enforce per-plan cap on ACTIVE alerts (triggered alerts don't count)
    const { count } = await supabase
      .from('price_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', req.user.id)
      .eq('active', true)
      .eq('triggered', false);

    const cap = MAX_ALERTS_PER_USER[req.user.plan] ?? MAX_ALERTS_PER_USER.free;
    if ((count ?? 0) >= cap) {
      return res.status(403).json({ error: `Alert limit reached (${cap} for ${req.user.plan}). Delete an alert or upgrade your plan.` });
    }

    // Prevent exact duplicates (same ticker + direction + threshold, still active)
    const { data: existing } = await supabase
      .from('price_alerts')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('ticker', ticker)
      .eq('direction', direction)
      .eq('threshold', threshold)
      .eq('active', true)
      .eq('triggered', false)
      .maybeSingle();
    if (existing) return res.status(409).json({ error: 'You already have this exact alert active' });

    const { data: alert, error } = await supabase
      .from('price_alerts')
      .insert({
        user_id: req.user.id,
        ticker,
        direction,
        threshold,
        note: note || null,
        active: true,
        triggered: false,
      })
      .select()
      .single();
    if (error) throw error;

    res.json({ alert });
  } catch (err) {
    console.error('[Alerts] POST failed:', err.message);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

// PATCH /api/alerts/:id — toggle active state or reset a triggered alert
router.patch('/:id', requireAuth, rateLimit(30), async (req, res) => {
  try {
    const updates = {};
    if (typeof req.body?.active === 'boolean') updates.active = req.body.active;
    // Allow "re-arming" a triggered alert (resets trigger state so it can fire again)
    if (req.body?.reset === true) {
      updates.triggered = false;
      updates.triggered_at = null;
      updates.triggered_price = null;
      updates.notified_at = null;
      updates.active = true;
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No updates provided' });

    const { data, error } = await supabase
      .from('price_alerts')
      .update(updates)
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Alert not found' });
    res.json({ alert: data });
  } catch (err) {
    console.error('[Alerts] PATCH failed:', err.message);
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

// DELETE /api/alerts/:id
router.delete('/:id', requireAuth, rateLimit(30), async (req, res) => {
  try {
    const { error } = await supabase
      .from('price_alerts')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[Alerts] DELETE failed:', err.message);
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

export default router;
