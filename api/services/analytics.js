/**
 * Analytics Service — the app's "brain"
 *
 * Tracks how users interact with every feature, aggregates patterns,
 * and generates actionable insights for the developer.
 *
 * Two layers:
 * 1. In-memory rolling counters (real-time, resets on restart)
 * 2. Supabase persistence (survives restarts, powers the daily digest)
 *
 * Privacy: tracks feature usage counts, NOT content. We never store
 * what users type or what the AI responds — just "user X used feature Y."
 */

import { supabase } from '../db.js';

// ============ IN-MEMORY ROLLING COUNTERS ============

const counters = {
  // Feature usage (today)
  features: {
    agent: 0,
    analysis_quick: 0,
    analysis_deep: 0,
    brief: 0,
    opportunity: 0,
    news: 0,
    journal_coach: 0,
    sector_radar: 0,
    catalyst: 0,
    social_buzz: 0,
    add_position: 0,
    close_position: 0,
    edit_position: 0,
    watchlist_add: 0,
    snapshot: 0,
    clear_chat: 0,
    stock_details: 0,
    agent_fundamentals: 0,
  },

  // AI quality
  feedback: {
    thumbsUp: 0,
    thumbsDown: 0,
    byFeature: {}, // { agent: { up: 5, down: 1 }, analysis: { up: 3, down: 2 } }
  },

  // User engagement
  engagement: {
    uniqueUsers: new Set(),     // unique user IDs seen today
    sessions: 0,                // login count today
    newUsers: 0,                // signups today
    creditLimitHits: 0,         // users who ran out of credits
    planGateHits: 0,            // free users blocked by plan gate
  },

  // Retention signals
  retention: {
    usersWithTradePlans: new Set(), // users who set targets/stops
    usersWhoAskedAgent: new Set(),
    returningUsers: new Set(),     // users who come back (not first session)
  },

  resetAt: new Date().toISOString(),
};

// ============ TRACKING FUNCTIONS ============

/**
 * Track a feature usage event.
 */
export function trackFeature(feature, userId = null) {
  if (counters.features[feature] !== undefined) {
    counters.features[feature]++;
  }
  if (userId) {
    counters.engagement.uniqueUsers.add(userId);
  }
}

/**
 * Track AI feedback (thumbs up/down).
 */
export function trackFeedback(feature, isPositive, userId = null) {
  if (isPositive) counters.feedback.thumbsUp++;
  else counters.feedback.thumbsDown++;

  if (!counters.feedback.byFeature[feature]) {
    counters.feedback.byFeature[feature] = { up: 0, down: 0 };
  }
  if (isPositive) counters.feedback.byFeature[feature].up++;
  else counters.feedback.byFeature[feature].down++;

  // Persist to DB for long-term tracking (non-blocking)
  if (userId) {
    supabase.from('ai_feedback').insert({
      user_id: userId,
      feature,
      positive: isPositive,
      created_at: new Date().toISOString(),
    }).then(() => {}).catch(e => console.error('[Analytics] Failed to persist feedback:', e.message));
  }
}

/**
 * Track a login/session start.
 */
export function trackSession(userId, isNew = false) {
  counters.engagement.sessions++;
  counters.engagement.uniqueUsers.add(userId);
  if (isNew) counters.engagement.newUsers++;
}

/**
 * Track when a user hits their credit limit.
 */
export function trackCreditLimit(userId) {
  counters.engagement.creditLimitHits++;
}

/**
 * Track when a free user is blocked by a plan gate.
 */
export function trackPlanGate(userId) {
  counters.engagement.planGateHits++;
}

/**
 * Track when a user sets a trade plan (target/stop/thesis).
 */
export function trackTradePlan(userId) {
  counters.retention.usersWithTradePlans.add(userId);
}

/**
 * Track agent usage for retention.
 */
export function trackAgentUsage(userId) {
  counters.retention.usersWhoAskedAgent.add(userId);
}

// ============ INSIGHTS GENERATION ============

/**
 * Generate the daily insights digest.
 * This is what you check every morning to understand your app.
 */
export function generateInsights() {
  const features = counters.features;
  const feedback = counters.feedback;
  const engagement = counters.engagement;

  const insights = [];
  const suggestions = [];

  // --- Feature adoption insights ---
  const totalFeatureUses = Object.values(features).reduce((s, v) => s + v, 0);
  const sortedFeatures = Object.entries(features)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const deadFeatures = Object.entries(features)
    .filter(([, v]) => v === 0)
    .map(([k]) => k);

  if (sortedFeatures.length > 0) {
    insights.push(`Most used feature: ${sortedFeatures[0][0]} (${sortedFeatures[0][1]} uses)`);
  }
  if (deadFeatures.length > 0 && totalFeatureUses > 10) {
    insights.push(`Unused features today: ${deadFeatures.join(', ')}`);
    suggestions.push(`Consider improving visibility of: ${deadFeatures.slice(0, 3).join(', ')} — nobody used them today`);
  }

  // --- AI quality insights ---
  const totalFeedback = feedback.thumbsUp + feedback.thumbsDown;
  if (totalFeedback > 0) {
    const approvalRate = ((feedback.thumbsUp / totalFeedback) * 100).toFixed(0);
    insights.push(`AI approval rate: ${approvalRate}% (${feedback.thumbsUp} up / ${feedback.thumbsDown} down)`);

    if (parseInt(approvalRate) < 70) {
      suggestions.push(`AI quality is below 70% approval — review recent thumbs-down responses`);
    }

    // Per-feature AI quality
    for (const [feat, fb] of Object.entries(feedback.byFeature)) {
      const total = fb.up + fb.down;
      if (total >= 3) {
        const rate = ((fb.up / total) * 100).toFixed(0);
        if (parseInt(rate) < 60) {
          suggestions.push(`${feat} has low approval (${rate}%) — prompt may need tuning`);
        }
      }
    }
  }

  // --- Engagement insights ---
  const uniqueCount = engagement.uniqueUsers.size;
  insights.push(`Active users today: ${uniqueCount}`);
  if (engagement.newUsers > 0) {
    insights.push(`New signups: ${engagement.newUsers}`);
  }

  // --- Monetization signals ---
  if (engagement.creditLimitHits > 0) {
    insights.push(`${engagement.creditLimitHits} users hit their credit limit`);
    if (engagement.creditLimitHits >= 3) {
      suggestions.push(`Multiple users running out of credits — consider increasing limits or adding a buy-more option`);
    }
  }
  if (engagement.planGateHits > 0) {
    insights.push(`${engagement.planGateHits} free users blocked by plan gates`);
    if (engagement.planGateHits >= 5) {
      suggestions.push(`Lots of free users hitting paywalls — they want to use the features. Make upgrade flow smoother`);
    }
  }

  // --- Retention signals ---
  const agentUsers = counters.retention.usersWhoAskedAgent.size;
  const planUsers = counters.retention.usersWithTradePlans.size;
  if (uniqueCount > 0 && agentUsers === 0) {
    suggestions.push(`No one used the AI agent today — consider a prompt or nudge to try it`);
  }
  if (uniqueCount > 3 && planUsers === 0) {
    suggestions.push(`No users set trade plans today — this feature drives retention. Add onboarding tips`);
  }

  // --- Feature ratio insights ---
  if (features.analysis_quick > 0 && features.analysis_deep > 0) {
    const deepRatio = ((features.analysis_deep / (features.analysis_quick + features.analysis_deep)) * 100).toFixed(0);
    insights.push(`Deep analysis adoption: ${deepRatio}% of analyses are deep`);
  }

  return {
    date: new Date().toISOString(),
    period: `Since ${counters.resetAt}`,
    summary: {
      activeUsers: uniqueCount,
      newUsers: engagement.newUsers,
      totalFeatureUses,
      aiApprovalRate: totalFeedback > 0 ? Math.round((feedback.thumbsUp / totalFeedback) * 100) : null,
      creditLimitHits: engagement.creditLimitHits,
    },
    features: Object.fromEntries(sortedFeatures),
    unusedFeatures: deadFeatures,
    feedback: {
      total: totalFeedback,
      positive: feedback.thumbsUp,
      negative: feedback.thumbsDown,
      byFeature: feedback.byFeature,
    },
    insights,
    suggestions,
  };
}

/**
 * Get raw counters for the health endpoint.
 */
export function getAnalyticsSummary() {
  return {
    activeUsers: counters.engagement.uniqueUsers.size,
    sessions: counters.engagement.sessions,
    newUsers: counters.engagement.newUsers,
    totalFeatureUses: Object.values(counters.features).reduce((s, v) => s + v, 0),
    topFeature: Object.entries(counters.features).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
    aiApproval: counters.feedback.thumbsUp + counters.feedback.thumbsDown > 0
      ? Math.round((counters.feedback.thumbsUp / (counters.feedback.thumbsUp + counters.feedback.thumbsDown)) * 100)
      : null,
    creditLimitHits: counters.engagement.creditLimitHits,
    since: counters.resetAt,
  };
}

/**
 * Reset daily counters. Call at midnight.
 */
export function resetDailyCounters() {
  // Persist today's summary before resetting (non-blocking)
  const summary = generateInsights();
  supabase.from('analytics_daily').insert({
    date: new Date().toISOString().split('T')[0],
    data: JSON.stringify(summary),
    created_at: new Date().toISOString(),
  }).then(() => {}).catch(e => console.error('[Analytics] Failed to persist daily summary:', e.message));

  // Reset
  for (const key of Object.keys(counters.features)) counters.features[key] = 0;
  counters.feedback.thumbsUp = 0;
  counters.feedback.thumbsDown = 0;
  counters.feedback.byFeature = {};
  counters.engagement.uniqueUsers = new Set();
  counters.engagement.sessions = 0;
  counters.engagement.newUsers = 0;
  counters.engagement.creditLimitHits = 0;
  counters.engagement.planGateHits = 0;
  counters.retention.usersWithTradePlans = new Set();
  counters.retention.usersWhoAskedAgent = new Set();
  counters.retention.returningUsers = new Set();
  counters.resetAt = new Date().toISOString();
}
