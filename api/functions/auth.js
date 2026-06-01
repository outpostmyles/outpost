import express from 'express';
import { randomBytes, createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { supabase } from '../db.js';
import { requireAuth, invalidateAuth } from '../middleware/auth.js';
import { sanitizeString, isDisplayNameAllowed, isValidEmail, isStrongEnoughPassword } from '../middleware/validate.js';
import { Resend } from 'resend';
import { config } from '../config.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = express.Router();
const resend = new Resend(config.resendKey);
const BCRYPT_ROUNDS = 12;

async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Generate a session token. Returns { raw, hashed }.
 * raw = sent to the client, hashed = stored in DB.
 * This way, if the DB is compromised, session tokens can't be reused.
 */
function generateToken() {
  const raw = randomBytes(48).toString('hex');
  const hashed = createHash('sha256').update(raw).digest('hex');
  return { raw, hashed };
}

// Monthly credit grant per plan. 'unlimited' is the beta tier: a balance so
// large it never depletes in practice. Gates pass because it's non-free, the
// agent is already free on any paid plan, and the 300/day AI ceiling stays as
// the cost guard. MIRRORED in api/jobs/runner.js resetCredits, keep in sync.
const PLAN_CREDITS = { free: 50, starter: 500, pro: 2500, elite: 10000, unlimited: 999_999_999 };

router.post('/signup', rateLimit(5), async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
    if (!isStrongEnoughPassword(password)) return res.status(400).json({ error: 'Password must be 8+ characters with a letter and a number' });

    const emailClean = email.toLowerCase().trim();

    // Validate display name doesn't contain slurs/profanity/reserved terms
    if (displayName && !isDisplayNameAllowed(displayName)) {
      return res.status(400).json({ error: 'Please choose a different display name' });
    }

    // Beta gate — Outpost is invite-only during private beta.
    // Allowlist is maintained in the beta_allowlist table; updateable without redeploy.
    // Set BETA_ALLOWLIST_OPEN=true to disable the gate (e.g. after public launch).
    if (process.env.BETA_ALLOWLIST_OPEN !== 'true') {
      const { data: allowed } = await supabase
        .from('beta_allowlist')
        .select('id')
        .eq('email', emailClean)
        .maybeSingle();
      if (!allowed) {
        return res.status(403).json({
          error: 'Outpost is in private beta. Email hello@outpostapp.co for access.',
        });
      }
    }

    const { data: existing } = await supabase.from('user_profiles').select('id').eq('email', emailClean).maybeSingle();
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const passwordHash = await hashPassword(password);
    const { raw: token, hashed: tokenHash } = generateToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const { data: user, error } = await supabase.from('user_profiles').insert({
      email: emailClean,
      display_name: sanitizeString(displayName || emailClean.split('@')[0], 50),
      password_hash: passwordHash,
      password_salt: 'bcrypt',
      session_token: tokenHash,
      session_expires: expires,
      plan: 'free',
      credits_remaining: PLAN_CREDITS.free,
      credits_used_this_month: 0,
      billing_date: new Date().getDate(),
      risk_tolerance: 'moderate',
      trading_style: 'swing',
      onboarding_complete: false,
      last_login: now,
      created_at: now,
    }).select().single();

    if (error) {
      console.error('[Auth] signup:', error.message);
      return res.status(500).json({ error: 'Failed to create account' });
    }

    res.json({ token, user: sanitizeUser(user) });
  } catch (err) {
    console.error('[Auth] signup:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', rateLimit(10), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data: user } = await supabase.from('user_profiles').select('*').eq('email', email.toLowerCase().trim()).maybeSingle();
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    // Support both legacy SHA-256 and new bcrypt hashes
    let passwordValid = false;
    if (user.password_salt === 'bcrypt') {
      passwordValid = await verifyPassword(password, user.password_hash);
    } else {
      // Legacy SHA-256 — verify then auto-migrate to bcrypt
      const { createHash } = await import('crypto');
      const legacyHash = createHash('sha256').update(password + user.password_salt).digest('hex');
      passwordValid = legacyHash === user.password_hash;
      if (passwordValid) {
        const newHash = await hashPassword(password);
        await supabase.from('user_profiles').update({ password_hash: newHash, password_salt: 'bcrypt' }).eq('id', user.id);
      }
    }
    if (!passwordValid) return res.status(401).json({ error: 'Invalid email or password' });

    const { raw: token, hashed: tokenHash } = generateToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    let credits = user.credits_remaining;
    let weeklyBonusLastGiven = user.weekly_bonus_last_given;
    if (!user.weekly_bonus_last_given || Date.now() - new Date(user.weekly_bonus_last_given).getTime() > 7 * 24 * 60 * 60 * 1000) {
      credits = Math.min(credits + 10, PLAN_CREDITS[user.plan] ?? 50);
      weeklyBonusLastGiven = now;
    }

    await supabase.from('user_profiles').update({
      session_token: tokenHash,
      session_expires: expires,
      last_login: now,
      credits_remaining: credits,
      weekly_bonus_last_given: weeklyBonusLastGiven,
    }).eq('id', user.id);

    res.json({ token, user: sanitizeUser({ ...user, credits_remaining: credits }) });
  } catch (err) {
    console.error('[Auth] login:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    await supabase.from('user_profiles').update({ session_token: null, session_expires: null }).eq('id', req.user.id);
    // Drop cached auth so the token can't be used for up to AUTH_CACHE_TTL more after logout
    invalidateAuth(req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[Auth] logout:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/validate', requireAuth, async (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

// Per-email rate limit on forgot-password (independent of the per-IP rateLimit
// middleware). Prevents an attacker rotating IPs from spamming password resets
// to one user's inbox. Counts every attempt regardless of registration so the
// rate limit itself doesn't reveal account existence.
const emailResetTimes = new Map();
const EMAIL_RESET_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_RESET_MAX = 3;
setInterval(() => {
  const cutoff = Date.now() - EMAIL_RESET_WINDOW_MS;
  for (const [email, times] of emailResetTimes.entries()) {
    const fresh = times.filter(t => t > cutoff);
    if (!fresh.length) emailResetTimes.delete(email);
    else emailResetTimes.set(email, fresh);
  }
}, EMAIL_RESET_WINDOW_MS);
function emailResetAllowed(email) {
  const now = Date.now();
  const times = (emailResetTimes.get(email) || []).filter(t => now - t < EMAIL_RESET_WINDOW_MS);
  if (times.length >= EMAIL_RESET_MAX) return false;
  times.push(now);
  emailResetTimes.set(email, times);
  return true;
}

router.post('/forgot-password', rateLimit(3), async (req, res) => {
  // Equalize response time so timing doesn't reveal whether the email is registered.
  // 800ms covers the DB + Resend latency of the existing-user path; the no-user path
  // is padded up to the same floor before responding.
  const start = Date.now();
  const MIN_RESPONSE_MS = 800;
  const padResponse = async () => {
    const elapsed = Date.now() - start;
    if (elapsed < MIN_RESPONSE_MS) await new Promise(r => setTimeout(r, MIN_RESPONSE_MS - elapsed));
  };

  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const emailClean = email.toLowerCase().trim();
    if (!emailResetAllowed(emailClean)) {
      // Pretend success — surfacing the rate limit would also leak existence
      await padResponse();
      return res.json({ success: true });
    }

    const { data: user } = await supabase.from('user_profiles').select('id,email,display_name').eq('email', emailClean).maybeSingle();

    if (user) {
      // Invalidate any previously-issued unused reset tokens for this user before
      // issuing a new one — prevents an attacker who scooped an old reset email
      // from using it after the user has requested a fresh one.
      await supabase.from('password_reset_tokens')
        .update({ used: true })
        .eq('user_id', user.id)
        .eq('used', false);

      // Token sent to user is the raw value; DB stores only its SHA-256 hash.
      // If the DB is leaked, in-flight reset tokens can't be used.
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await supabase.from('password_reset_tokens').insert({
        user_id: user.id,
        token: tokenHash,
        expires_at: expires,
        used: false,
        created_at: new Date().toISOString(),
      });

      const resetUrl = `${config.frontendUrl}/reset-password?token=${rawToken}`;
      await resend.emails.send({
        from: 'Outpost <noreply@outpostapp.co>',
        to: user.email,
        subject: 'Reset your Outpost password',
        html: `
          <div style="background:#08080c;color:#f1f1f3;padding:40px;font-family:monospace">
            <h1 style="color:#3b82f6;margin-bottom:16px">OUTPOST</h1>
            <p style="margin-bottom:16px">Hey ${user.display_name},</p>
            <p style="margin-bottom:24px">Click the link below to reset your password. This link expires in 1 hour.</p>
            <a href="${resetUrl}" style="background:#3b82f6;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:700;display:inline-block;margin-bottom:24px">RESET PASSWORD</a>
            <p style="color:rgba(255,255,255,0.4);font-size:12px">If you didn't request this, ignore this email.</p>
          </div>
        `,
      });
    }

    await padResponse();
    res.json({ success: true });
  } catch (err) {
    console.error('[Auth] forgot-password:', err.message);
    // Always respond 200 — surfacing 500 here would also leak whether the email
    // is registered (the no-user path can never hit this catch).
    await padResponse();
    res.json({ success: true });
  }
});

router.post('/reset-password', rateLimit(5), async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
    if (!isStrongEnoughPassword(password)) return res.status(400).json({ error: 'Password must be 8+ characters with a letter and a number' });

    // The token in the URL is the raw value; the DB stores only its SHA-256 hash. Hash before lookup.
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { data: resetToken } = await supabase.from('password_reset_tokens').select('*').eq('token', tokenHash).eq('used', false).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (!resetToken) return res.status(400).json({ error: 'Invalid or expired reset link' });

    const { data: user } = await supabase.from('user_profiles').select('id').eq('id', resetToken.user_id).maybeSingle();
    if (!user) return res.status(400).json({ error: 'User not found' });

    const passwordHash = await hashPassword(password);

    await Promise.all([
      supabase.from('user_profiles').update({
        password_hash: passwordHash,
        password_salt: 'bcrypt',
        session_token: null,
        session_expires: null,
      }).eq('id', user.id),
      supabase.from('password_reset_tokens').update({ used: true }).eq('id', resetToken.id),
    ]);
    // Invalidate any cached auth for this user
    invalidateAuth(user.id);

    res.json({ success: true });
  } catch (err) {
    console.error('[Auth] reset-password:', err.message);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

router.post('/change-password', requireAuth, rateLimit(5), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
    if (!isStrongEnoughPassword(newPassword)) return res.status(400).json({ error: 'Password must be 8+ characters with a letter and a number' });

    // Verify current password (supports both legacy and bcrypt)
    let currentValid = false;
    if (req.user.password_salt === 'bcrypt') {
      currentValid = await verifyPassword(currentPassword, req.user.password_hash);
    } else {
      const { createHash } = await import('crypto');
      const legacyHash = createHash('sha256').update(currentPassword + req.user.password_salt).digest('hex');
      currentValid = legacyHash === req.user.password_hash;
    }
    if (!currentValid) return res.status(401).json({ error: 'Current password is incorrect' });

    const passwordHash = await hashPassword(newPassword);
    const { raw: newToken, hashed: newTokenHash } = generateToken();
    const newExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from('user_profiles').update({
      password_hash: passwordHash,
      password_salt: 'bcrypt',
      session_token: newTokenHash,
      session_expires: newExpires,
    }).eq('id', req.user.id);

    // Invalidate old cached auth
    invalidateAuth(req.user.id);

    res.json({ success: true, token: newToken });
  } catch (err) {
    console.error('[Auth] change-password:', err.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    plan: user.plan,
    credits_remaining: user.credits_remaining,
    credits_used_this_month: user.credits_used_this_month,
    risk_tolerance: user.risk_tolerance,
    trading_style: user.trading_style,
    onboarding_complete: user.onboarding_complete,
    onboarding_style: user.onboarding_style,
    onboarding_assets: user.onboarding_assets,
    email_daily_digest: user.email_daily_digest,
    email_weekly_summary: user.email_weekly_summary,
    created_at: user.created_at,
  };
}

export default router;
