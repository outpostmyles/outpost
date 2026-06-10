/**
 * Monitor Service — tracks errors, API performance, and AI quality metrics.
 *
 * Keeps rolling counters in memory. The /api/health endpoint exposes them
 * so monitoring services (UptimeRobot, Better Stack, etc.) can scrape.
 * Also logs critical errors to Supabase for review.
 */

import { supabase } from '../db.js';

// ============ ROLLING METRICS (in-memory, resets on restart) ============

const metrics = {
  // Request counters
  requestsTotal: 0,
  requestErrors: 0,

  // AI metrics
  aiCallsTotal: 0,
  aiCallsFailed: 0,
  aiToolCallsTotal: 0,
  aiToolCallsFailed: 0,
  aiTruncations: 0, // responses that hit max_tokens

  // Data freshness
  pricePoolRefreshes: 0,
  pricePoolErrors: 0,
  stalePriceCount: 0,

  // Per-endpoint error tracking (last 100 errors)
  recentErrors: [],

  // Uptime
  bootedAt: new Date().toISOString(),
};

/**
 * Track a request (called from middleware).
 */
export function trackRequest(success = true) {
  metrics.requestsTotal++;
  if (!success) metrics.requestErrors++;
}

/**
 * Track an AI call.
 */
export function trackAICall(success = true) {
  metrics.aiCallsTotal++;
  if (!success) metrics.aiCallsFailed++;
}

/**
 * Track AI tool usage.
 */
export function trackToolCall(success = true) {
  metrics.aiToolCallsTotal++;
  if (!success) metrics.aiToolCallsFailed++;
}

/**
 * Track an AI response that was truncated (hit max_tokens).
 */
export function trackTruncation() {
  metrics.aiTruncations++;
}

/**
 * Track a price pool refresh.
 */
export function trackPriceRefresh(success = true, staleCount = 0) {
  metrics.pricePoolRefreshes++;
  if (!success) metrics.pricePoolErrors++;
  metrics.stalePriceCount = staleCount;
}

/**
 * Track an error with context. Keeps last 100 in memory, and persists 'error' and
 * 'critical' to Supabase so they survive a restart (the in-memory ring is wiped on
 * every deploy). 'warn'/'info' stay in memory only. Without this, the single most
 * important failure class for a beta, the agent returning "unavailable" to a paying
 * user, was invisible the moment the process restarted.
 */
export function trackError(endpoint, error, severity = 'error') {
  const entry = {
    endpoint,
    message: error?.message || String(error),
    severity,
    timestamp: new Date().toISOString(),
  };

  // Keep rolling buffer
  metrics.recentErrors.push(entry);
  if (metrics.recentErrors.length > 100) {
    metrics.recentErrors.shift();
  }

  // Persist error+ to DB (non-blocking, fails silently if table doesn't exist).
  // warn/info are noise for durable storage and stay in the in-memory ring only.
  if (severity === 'critical' || severity === 'error') {
    try {
      supabase.from('error_log').insert({
        endpoint,
        message: entry.message,
        severity,
        created_at: entry.timestamp,
      }).then(() => {}).catch(e => console.error('[Monitor] Failed to log error to DB:', e.message));
    } catch (e) {
      console.error('[Monitor] Error log insert setup failed:', e.message);
    }
  }
}

/**
 * Get all metrics for the health endpoint.
 */
export function getMetrics() {
  const now = Date.now();
  const bootedAt = new Date(metrics.bootedAt).getTime();
  const uptimeHours = ((now - bootedAt) / (1000 * 60 * 60)).toFixed(1);

  // Calculate error rates
  const errorRate = metrics.requestsTotal > 0
    ? ((metrics.requestErrors / metrics.requestsTotal) * 100).toFixed(2)
    : '0.00';
  const aiErrorRate = metrics.aiCallsTotal > 0
    ? ((metrics.aiCallsFailed / metrics.aiCallsTotal) * 100).toFixed(2)
    : '0.00';
  const toolErrorRate = metrics.aiToolCallsTotal > 0
    ? ((metrics.aiToolCallsFailed / metrics.aiToolCallsTotal) * 100).toFixed(2)
    : '0.00';

  return {
    uptime: {
      hours: parseFloat(uptimeHours),
      bootedAt: metrics.bootedAt,
    },
    requests: {
      total: metrics.requestsTotal,
      errors: metrics.requestErrors,
      errorRate: parseFloat(errorRate),
    },
    ai: {
      calls: metrics.aiCallsTotal,
      failures: metrics.aiCallsFailed,
      errorRate: parseFloat(aiErrorRate),
      toolCalls: metrics.aiToolCallsTotal,
      toolFailures: metrics.aiToolCallsFailed,
      toolErrorRate: parseFloat(toolErrorRate),
      truncations: metrics.aiTruncations,
    },
    data: {
      priceRefreshes: metrics.pricePoolRefreshes,
      priceErrors: metrics.pricePoolErrors,
      staleTickers: metrics.stalePriceCount,
    },
    recentErrors: metrics.recentErrors.slice(-10), // last 10 only
  };
}
