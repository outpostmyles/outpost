// Express middleware wrapper around checkAndIncrementAiCall. Mount on any
// route that makes a Claude API call to enforce the per-user daily ceiling.
// Returns 429 with a clean error payload when over budget.
//
// Note: this MUST run AFTER requireAuth — it needs req.user.id. The middleware
// no-ops (passes through) if req.user is missing rather than crashing.
import { checkAndIncrementAiCall, UNLIMITED_DAILY_CAP } from '../services/aiSpendCeiling.js';
import { config } from '../config.js';

export function dailyAiCeiling() {
  return (req, res, next) => {
    if (!req.user?.id) return next(); // unauth path: let requireAuth handle the 401
    // Never cap on a local/dev server (you are testing your own app); production
    // still enforces it.
    if (config.nodeEnv !== 'production') return next();
    // The 'unlimited' beta tier gets a HIGH but finite cap (not a full exemption), so
    // a runaway client loop can't run an unbounded tab while normal use never hits it.
    // Free/paid plans keep the default cap.
    const ceiling = checkAndIncrementAiCall(req.user.id, req.user.plan === 'unlimited' ? UNLIMITED_DAILY_CAP : undefined);
    if (!ceiling.allowed) {
      // 429 not 402 — credits aren't the issue here, the per-day cap is.
      // The frontend's existing 429 handler shows a "slow down" toast.
      return res.status(429).json({
        error: `You've used a lot of AI today. The daily limit resets at midnight UTC. (limit ${ceiling.cap}, used ${ceiling.count}.)`,
        dailyCap: ceiling.cap,
        dailyCount: ceiling.count,
      });
    }
    next();
  };
}
