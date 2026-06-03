/**
 * Session Pacing Middleware
 *
 * Market-aware rate limiting for agent messages.
 * Instead of monthly credit caps, this gives users generous per-window
 * message budgets that refresh automatically — feels unlimited, controls cost.
 *
 * SCALING TIERS — as user base grows and revenue supports it, bump SCALE_TIER:
 *
 *   Tier 'launch'  (0–500 users):    conservative, protect margins while proving product
 *   Tier 'growth'  (500–2000 users):  loosen limits, reward engagement
 *   Tier 'scale'   (2000–10000 users): generous limits, focus on retention
 *   Tier 'mature'  (10000+ users):    near-unlimited feel, volume pricing kicks in
 *
 * To scale up: just change SCALE_TIER below. That's it.
 *
 * Volatility exception: When VIX ≥ 30, window limit doubles (any tier).
 * Free users: still gated by monthly message count (handled in agent.js).
 */

import { supabase } from '../db.js';
import { isMarketHours, isPreMarket, getETTime } from '../utils/marketHours.js';
import { getMarketData } from '../services/marketData.js';
import { config } from '../config.js';

// ╔══════════════════════════════════════════════════════════╗
// ║  CHANGE THIS AS YOU SCALE — the only knob you need      ║
// ╚══════════════════════════════════════════════════════════╝
const SCALE_TIER = 'launch';

/**
 * Scaling config — each tier defines per-window limits.
 *
 * market:   { limit, windowHrs }  — 9:30–16:00 ET weekdays
 * extended: { limit, windowHrs }  — 4:00–9:30, 16:00–20:00 ET weekdays
 * off:      { limit, windowHrs }  — everything else (nights, weekends)
 *
 * As you scale:
 *   - More users = more revenue = can afford higher limits
 *   - Anthropic volume discounts kick in around 2000+ users
 *   - Prompt caching hit rate improves with more concurrent users
 *   - You can also raise prices at higher tiers if features justify it
 */
const TIER_CONFIG = {
  launch: {
    // Conservative — ~$4.87/user/month API cost, $20 price = healthy margin
    market:   { limit: 25, windowHrs: 2 },
    extended: { limit: 20, windowHrs: 3 },
    off:      { limit: 15, windowHrs: 4 },
  },
  growth: {
    // Revenue supports higher usage — users feel less friction
    market:   { limit: 40, windowHrs: 2 },
    extended: { limit: 30, windowHrs: 3 },
    off:      { limit: 20, windowHrs: 4 },
  },
  scale: {
    // Volume pricing from Anthropic, strong MRR — reward power users
    market:   { limit: 60, windowHrs: 2 },
    extended: { limit: 45, windowHrs: 2 },
    off:      { limit: 30, windowHrs: 3 },
  },
  mature: {
    // Near-unlimited — windows are really just burst protection now
    market:   { limit: 100, windowHrs: 1 },
    extended: { limit: 75, windowHrs: 1 },
    off:      { limit: 50, windowHrs: 2 },
  },
};

function isExtendedHours() {
  const et = getETTime();
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  // Pre-market: 4:00–9:30, After-hours: 16:00–20:00
  return (mins >= 240 && mins < 570) || (mins >= 960 && mins < 1200);
}

function getWindow() {
  const tier = TIER_CONFIG[SCALE_TIER] || TIER_CONFIG.launch;

  if (isMarketHours()) {
    return { type: 'market', limit: tier.market.limit, windowMs: tier.market.windowHrs * 60 * 60 * 1000 };
  }
  if (isExtendedHours()) {
    return { type: 'extended', limit: tier.extended.limit, windowMs: tier.extended.windowHrs * 60 * 60 * 1000 };
  }
  return { type: 'off', limit: tier.off.limit, windowMs: tier.off.windowHrs * 60 * 60 * 1000 };
}

export function sessionPacing() {
  return async (req, res, next) => {
    // Never pace on a local/dev server: you are testing your own app, you should
    // not be able to lock yourself out. Production (NODE_ENV=production) still
    // enforces the budget normally.
    if (config.nodeEnv !== 'production') return next();
    // Free users have their own gate, and the 'unlimited' beta tier is, by
    // definition, never paced. Everyone in between (starter/pro/elite) is.
    const plan = req.user?.plan ?? 'free';
    if (plan === 'free' || plan === 'unlimited') return next();

    const userId = req.user.id;
    const window = getWindow();

    // Volatility exception — double limits when market is stressed
    // Users need their trading partner most during high-VIX events
    try {
      const market = getMarketData();
      const vix = market.vix?.value;
      if (vix && vix >= 30) {
        window.limit = window.limit * 2;
      }
    } catch {
      // If market data unavailable, use normal limits
    }

    // Count user messages in the current window
    const windowStart = new Date(Date.now() - window.windowMs).toISOString();
    const { count, error } = await supabase
      .from('agent_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('role', 'user')
      .gte('created_at', windowStart);

    if (error) {
      console.error('[SessionPacing] Count query failed:', error.message);
      return next(); // Don't block on DB errors
    }

    const used = count ?? 0;

    if (used >= window.limit) {
      // Calculate when the oldest message in the window will expire
      const { data: oldest } = await supabase
        .from('agent_messages')
        .select('created_at')
        .eq('user_id', userId)
        .eq('role', 'user')
        .gte('created_at', windowStart)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      let refreshMinutes = Math.ceil(window.windowMs / 60000);
      if (oldest?.created_at) {
        const oldestTime = new Date(oldest.created_at).getTime();
        const expiresAt = oldestTime + window.windowMs;
        refreshMinutes = Math.max(1, Math.ceil((expiresAt - Date.now()) / 60000));
      }

      return res.status(429).json({
        error: `You're on a roll! Your session refreshes in about ${refreshMinutes} minute${refreshMinutes === 1 ? '' : 's'}, perfect time to review your positions.`,
        sessionLimit: true,
        refreshMinutes,
        windowType: window.type,
        scaleTier: SCALE_TIER,
      });
    }

    // Attach pacing info to request for downstream use
    req.pacing = {
      used,
      limit: window.limit,
      windowType: window.type,
      remaining: window.limit - used,
      nearLimit: (window.limit - used) <= 3,
    };

    next();
  };
}
