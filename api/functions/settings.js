import express from 'express';
import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { supabase } from '../db.js';
import { requireAuth, invalidateAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { sanitizeString, sanitizeEnum, isDisplayNameAllowed } from '../middleware/validate.js';
import { trackFeedback } from '../services/analytics.js';

const router = express.Router();

router.patch('/user', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const updates = {};
    if (req.body.display_name !== undefined) {
      if (!isDisplayNameAllowed(req.body.display_name)) {
        return res.status(400).json({ error: 'Please choose a different display name' });
      }
      updates.display_name = sanitizeString(req.body.display_name, 50);
    }
    if (req.body.risk_tolerance !== undefined) updates.risk_tolerance = sanitizeEnum(req.body.risk_tolerance, ['conservative','moderate','aggressive']);
    if (req.body.trading_style !== undefined) updates.trading_style = sanitizeEnum(req.body.trading_style, ['day_trading','swing','investor']);
    if (req.body.onboarding_complete !== undefined) updates.onboarding_complete = Boolean(req.body.onboarding_complete);
    if (req.body.onboarding_style !== undefined) updates.onboarding_style = sanitizeString(req.body.onboarding_style, 50);
    if (req.body.onboarding_assets !== undefined) updates.onboarding_assets = sanitizeString(req.body.onboarding_assets, 200);
    if (req.body.email_daily_digest !== undefined) updates.email_daily_digest = Boolean(req.body.email_daily_digest);
    if (req.body.email_weekly_summary !== undefined) updates.email_weekly_summary = Boolean(req.body.email_weekly_summary);

    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields to update' });

    // Surface DB errors instead of swallowing them — without this, an unknown
    // column or constraint violation silently returns 200 with stale data.
    const { error: updateErr } = await supabase.from('user_profiles').update(updates).eq('id', req.user.id);
    if (updateErr) {
      console.error('[Settings] user update failed:', updateErr.message);
      return res.status(500).json({ error: 'Failed to update profile' });
    }
    // Bust the auth cache so subsequent /validate calls (and any req.user reads
    // within the 5-minute TTL) see the freshly-updated profile, not stale data.
    invalidateAuth(req.user.id);
    const { data: user } = await supabase.from('user_profiles').select('*').eq('id', req.user.id).maybeSingle();

    res.json({ success: true, user: sanitizeUser(user) });
  } catch (err) {
    console.error('[Settings] user:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/feedback', requireAuth, rateLimit(5), async (req, res) => {
  try {
    const type = sanitizeEnum(req.body.type, ['bug','feature','other']);
    const description = sanitizeString(req.body.description, 2000);
    if (!description) return res.status(400).json({ error: 'Description required' });

    await supabase.from('feedback').insert({
      user_id: req.user.id,
      type,
      description,
      created_at: new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[Settings] feedback:', err.message);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

router.post('/ai-feedback', requireAuth, rateLimit(20), async (req, res) => {
  try {
    const { feature, rating, reason, responsePreview, variant } = req.body;
    if (!feature || !rating) return res.status(400).json({ error: 'Feature and rating required' });

    const cleanFeature = sanitizeString(feature, 50);
    // Validate rating EXPLICITLY — sanitizeEnum coerces unknown values to the
    // first allowed option, which would silently record a 'down' as an 'up'.
    if (!['up','down'].includes(rating)) {
      return res.status(400).json({ error: 'Rating must be up or down' });
    }
    const cleanRating = rating;
    // Variant is optional — pre-experiment features won't pass it. Cap at 50
    // chars and treat empty as null so SQL stays clean.
    const cleanVariant = variant ? sanitizeString(variant, 50) || null : null;

    await supabase.from('ai_feedback').insert({
      user_id: req.user.id,
      feature: cleanFeature,
      rating: cleanRating,
      reason: sanitizeString(reason || '', 200),
      response_preview: sanitizeString(responsePreview || '', 500),
      variant: cleanVariant,
      created_at: new Date().toISOString(),
    });

    // Feed into analytics aggregation
    trackFeedback(cleanFeature, cleanRating === 'up', req.user.id);

    res.json({ success: true });
  } catch (err) {
    console.error('[Settings] ai-feedback:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/account', requireAuth, rateLimit(2), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required to delete account' });

    // Verify password (supports both bcrypt and legacy SHA-256)
    let passwordValid = false;
    if (req.user.password_salt === 'bcrypt') {
      passwordValid = await bcrypt.compare(password, req.user.password_hash);
    } else {
      const legacyHash = createHash('sha256').update(password + req.user.password_salt).digest('hex');
      passwordValid = legacyHash === req.user.password_hash;
    }
    if (!passwordValid) return res.status(401).json({ error: 'Incorrect password' });

    // Defense-in-depth: every user-owned table has ON DELETE CASCADE on user_id,
    // so deleting the user_profiles row would clean these up automatically. We
    // still delete explicitly so that if a cascade is ever accidentally dropped
    // in a migration, this code keeps the deletion complete. List must include
    // EVERY user-owned table in the schema.
    const tables = [
      'positions', 'watchlist', 'futures_trades', 'portfolio_snapshots',
      'portfolio_analyses', 'agent_messages', 'ai_feedback', 'feedback',
      'closed_trades', 'agent_memory', 'journal_notes', 'journal_entries',
      'journal_sections', 'price_alerts', 'password_reset_tokens',
    ];
    for (const table of tables) {
      await supabase.from(table).delete().eq('user_id', req.user.id);
    }

    await supabase.from('user_profiles').delete().eq('id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Settings] account:', err.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

function sanitizeUser(user) {
  return {
    id: user.id, email: user.email, display_name: user.display_name,
    plan: user.plan, credits_remaining: user.credits_remaining,
    credits_used_this_month: user.credits_used_this_month,
    risk_tolerance: user.risk_tolerance, trading_style: user.trading_style,
    onboarding_complete: user.onboarding_complete,
    onboarding_style: user.onboarding_style, onboarding_assets: user.onboarding_assets,
    email_daily_digest: user.email_daily_digest,
    email_weekly_summary: user.email_weekly_summary,
  };
}

export default router;
