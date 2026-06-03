// Express middleware wrapper around checkAndIncrementAiCall. Mount on any
// route that makes a Claude API call to enforce the per-user daily ceiling.
// Returns 429 with a clean error payload when over budget.
//
// Note: this MUST run AFTER requireAuth — it needs req.user.id. The middleware
// no-ops (passes through) if req.user is missing rather than crashing.
import { checkAndIncrementAiCall } from '../services/aiSpendCeiling.js';

export function dailyAiCeiling() {
  return (req, res, next) => {
    if (!req.user?.id) return next(); // unauth path: let requireAuth handle the 401
    // The 'unlimited' beta tier is exempt from the per-day cap, same as session
    // pacing, so a beta/founder account is never throttled mid-test.
    if (req.user.plan === 'unlimited') return next();
    const ceiling = checkAndIncrementAiCall(req.user.id);
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
