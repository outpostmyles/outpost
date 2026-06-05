/**
 * Founder dashboard endpoint.
 *
 * One JSON payload that powers /admin in the UI. Aggregates from:
 *   - user_profiles  (totals, plan mix, 7-day signups, active in 7d)
 *   - positions      (open trades across the user base)
 *   - watchlist      (universe of tickers the userbase is watching)
 *   - agent_messages (cumulative agent usage proxy)
 *   - ai_feedback    (last-7d up/down breakdown by feature)
 *   - errors         (last-24h / last-7d counts)
 *   - analytics_daily (last 14d trend)
 *   - in-memory analytics counters (today)
 *
 * Returns numbers, not raw rows, so payload stays tiny even at 10K users.
 *
 * Gated by requireAdmin middleware — check api/middleware/admin.js for the
 * allow-list mechanism.
 */
import express from 'express';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, parseAllowList, isAdminEmail } from '../middleware/admin.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { generateInsights, getAnalyticsSummary } from '../services/analytics.js';
import { listExperiments, aggregateFeedbackByVariant } from '../services/promptExperiments.js';
import { runFounderDigest } from '../services/founderDigest.js';
import { getAiUsageSummary } from '../services/aiUsage.js';
import { getAggregate } from '../services/decisionLedger.js';
import { getQualityAggregate } from '../services/aiQualityLog.js';
import { buildFounderBrief } from '../../src/lib/founderBrief.js';

const router = express.Router();

router.get('/dashboard', requireAuth, requireAdmin, rateLimit(20), async (req, res) => {
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Run independent queries concurrently — each one's small, total stays well under 1s.
    const [
      usersRes,
      positionsRes,
      watchlistRes,
      agentMessagesRes,
      feedbackRes,
      errors24Res,
      errors7dRes,
      dailyHistoryRes,
    ] = await Promise.all([
      // Pull only the cols we need for plan/active aggregations
      supabase.from('user_profiles').select('id,plan,created_at,last_login,credits_used_this_month'),
      supabase.from('positions').select('id', { count: 'exact', head: true }),
      supabase.from('watchlist').select('id', { count: 'exact', head: true }),
      supabase.from('agent_messages').select('id', { count: 'exact', head: true }),
      supabase.from('ai_feedback').select('feature,rating,variant,created_at').gte('created_at', sevenDaysAgo),
      supabase.from('errors').select('id', { count: 'exact', head: true }).gte('timestamp', oneDayAgo),
      supabase.from('errors').select('id', { count: 'exact', head: true }).gte('timestamp', sevenDaysAgo),
      supabase.from('analytics_daily').select('date,data').gte('date', fourteenDaysAgo).order('date', { ascending: true }),
    ]);

    const users = usersRes.data ?? [];
    const totalUsers = users.length;

    // Plan distribution
    const planCounts = users.reduce((acc, u) => {
      const p = u.plan || 'free';
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    }, {});

    // 7-day signups (trailing window) and a per-day series for the chart
    const signupsByDate = {};
    let signups7d = 0;
    let activeIn7d = 0;
    let activeIn24h = 0;
    let totalCreditsUsedThisMonth = 0;
    const sevenDaysMs = now.getTime() - 7 * 86400000;
    const oneDayMs = now.getTime() - 86400000;

    for (const u of users) {
      // Last-login activity
      const lastLogin = u.last_login ? new Date(u.last_login).getTime() : 0;
      if (lastLogin >= sevenDaysMs) activeIn7d++;
      if (lastLogin >= oneDayMs) activeIn24h++;
      // Signups window
      const created = u.created_at ? new Date(u.created_at).getTime() : 0;
      if (created >= sevenDaysMs) {
        signups7d++;
        const key = new Date(u.created_at).toISOString().split('T')[0];
        signupsByDate[key] = (signupsByDate[key] || 0) + 1;
      }
      totalCreditsUsedThisMonth += u.credits_used_this_month ?? 0;
    }

    // Build a contiguous 7-day signup series so the UI can chart it without gap-filling
    const signupSeries = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000).toISOString().split('T')[0];
      signupSeries.push({ date: d, count: signupsByDate[d] || 0 });
    }

    // AI feedback breakdown — last 7d, by feature
    const feedbackByFeature = {};
    let feedback7dUp = 0;
    let feedback7dDown = 0;
    for (const f of feedbackRes.data ?? []) {
      const feat = f.feature || 'unknown';
      if (!feedbackByFeature[feat]) feedbackByFeature[feat] = { up: 0, down: 0 };
      if (f.rating === 'up') { feedbackByFeature[feat].up++; feedback7dUp++; }
      else if (f.rating === 'down') { feedbackByFeature[feat].down++; feedback7dDown++; }
    }
    const totalFb = feedback7dUp + feedback7dDown;
    const approvalRate7d = totalFb > 0 ? Math.round((feedback7dUp / totalFb) * 100) : null;

    // Daily history — pull the cached generated insights for chart data
    const dailyHistory = (dailyHistoryRes.data ?? []).map(row => {
      let parsed = null;
      try { parsed = JSON.parse(row.data); } catch {}
      return {
        date: row.date,
        activeUsers: parsed?.summary?.activeUsers ?? null,
        newUsers: parsed?.summary?.newUsers ?? null,
        totalFeatureUses: parsed?.summary?.totalFeatureUses ?? null,
        aiApprovalRate: parsed?.summary?.aiApprovalRate ?? null,
      };
    });

    // Per-variant breakdown for the Experiments section.
    const variantBreakdown = aggregateFeedbackByVariant(feedbackRes.data ?? []);
    const experiments = listExperiments().map(exp => ({
      ...exp,
      // Surface only the buckets that actually have data so the dashboard
      // shows untouched experiments without inventing approval rates.
      results: variantBreakdown[exp.key] || {},
    }));

    // Live (today) — from the in-memory counters
    const live = getAnalyticsSummary();
    const insights = generateInsights();

    res.json({
      generatedAt: now.toISOString(),
      users: {
        total: totalUsers,
        signups7d,
        signupSeries,
        activeIn7d,
        activeIn24h,
        planMix: planCounts,
        totalCreditsUsedThisMonth,
      },
      engagement: {
        positions: positionsRes.count ?? 0,
        watchlistEntries: watchlistRes.count ?? 0,
        agentMessages: agentMessagesRes.count ?? 0,
      },
      aiQuality: {
        approvalRate7d,
        thumbsUp7d: feedback7dUp,
        thumbsDown7d: feedback7dDown,
        byFeature: feedbackByFeature,
      },
      errors: {
        last24h: errors24Res.count ?? 0,
        last7d: errors7dRes.count ?? 0,
      },
      live,
      insights: insights.insights ?? [],
      suggestions: insights.suggestions ?? [],
      experiments,
      dailyHistory,
    });
  } catch (err) {
    console.error('[Admin] dashboard:', err.message);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

/**
 * Cheap "am I admin?" probe — used by the frontend to decide whether to
 * render the Founder link in the header. Returns 200 { admin: true } if
 * the caller is on the allow list, 200 { admin: false } otherwise.
 * (We deliberately don't 403 here so the Settings page never shows the
 * confusing "Not found" toast for non-admins.)
 */
router.get('/check', requireAuth, rateLimit(30), async (req, res) => {
  const allow = parseAllowList(process.env.FOUNDER_EMAILS || '');
  res.json({ admin: isAdminEmail(allow, req.user?.email) });
});

/**
 * Review queue — flagged AI responses sorted by lowest score.
 * Pulls unreviewed entries with score < 80 by default, capped at 50.
 */
router.get('/review-queue', requireAuth, requireAdmin, rateLimit(30), async (req, res) => {
  try {
    const threshold = parseInt(req.query.threshold || '80', 10);
    const limit = Math.min(parseInt(req.query.limit || '30', 10), 100);

    const { data, error } = await supabase
      .from('ai_response_log')
      .select('id, feature, ticker, variant, input_preview, output, score, failures, grader_notes, reviewed, review_verdict, created_at')
      .eq('reviewed', false)
      .lte('score', threshold)
      .order('score', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    // Also pull aggregate counts for the dashboard
    const { count: totalUnreviewed } = await supabase
      .from('ai_response_log')
      .select('id', { count: 'exact', head: true })
      .eq('reviewed', false);

    const { count: lowQualityCount } = await supabase
      .from('ai_response_log')
      .select('id', { count: 'exact', head: true })
      .eq('reviewed', false)
      .lte('score', 50);

    res.json({
      items: data ?? [],
      totalUnreviewed: totalUnreviewed ?? 0,
      lowQualityCount: lowQualityCount ?? 0,
    });
  } catch (err) {
    console.error('[Admin] review-queue:', err.message);
    res.status(500).json({ error: 'Review queue unavailable' });
  }
});

/**
 * Mark a flagged response as reviewed with a verdict ('fine' | 'problem').
 */
router.post('/review-queue/:id', requireAuth, requireAdmin, rateLimit(30), async (req, res) => {
  try {
    const verdict = req.body?.verdict;
    if (!['fine', 'problem'].includes(verdict)) {
      return res.status(400).json({ error: 'verdict must be fine or problem' });
    }
    const { error } = await supabase
      .from('ai_response_log')
      .update({ reviewed: true, review_verdict: verdict })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] review-queue mark:', err.message);
    res.status(500).json({ error: 'Failed to mark reviewed' });
  }
});

/**
 * On-demand Founder Digest. Calls the same pipeline as the Monday cron.
 * Pass ?email=false in the query to get the markdown back without sending.
 * Useful for testing the digest mid-week or before launch.
 */
router.post('/founder-digest', requireAuth, requireAdmin, rateLimit(5), async (req, res) => {
  try {
    const sendEmail = req.query.email !== 'false';
    const result = await runFounderDigest({ email: sendEmail });
    res.json({
      success: true,
      emailed: result.email.sent,
      recipients: result.email.recipients,
      metrics: result.metrics,
      markdown: result.markdown,
    });
  } catch (err) {
    console.error('[Admin] founder-digest:', err.message);
    res.status(500).json({ error: 'Failed to run founder digest' });
  }
});

// GET /api/admin/ai-usage: FOUNDER ONLY. Real Claude API cost attributed by
// feature and model from captured token usage. This data is never exposed to a
// user; it exists so the founder can see where the AI spend concentrates.
router.get('/ai-usage', requireAuth, requireAdmin, rateLimit(20), async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90);
    res.json(await getAiUsageSummary({ days }));
  } catch (err) {
    console.error('[Admin] ai-usage failed:', err.message);
    res.status(500).json({ error: 'Could not load AI usage' });
  }
});

// GET /api/admin/brief: FOUNDER ONLY. Compile the internal data (decision
// intelligence, AI cost, AI quality, engagement) into one plain-text block the
// founder can copy or screenshot and hand to Claude, plus a recommendations list.
router.get('/brief', requireAuth, requireAdmin, rateLimit(20), async (req, res) => {
  try {
    const days = 30;
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const [intel, usage, quality, usersRes, activeRes, msgRes] = await Promise.all([
      getAggregate({ days }).catch(() => null),
      getAiUsageSummary({ days }).catch(() => null),
      getQualityAggregate({ days }).catch(() => null),
      supabase.from('user_profiles').select('id', { count: 'exact', head: true }),
      supabase.from('user_profiles').select('id', { count: 'exact', head: true }).gte('last_login', sevenDaysAgo),
      supabase.from('agent_messages').select('id', { count: 'exact', head: true }),
    ]);
    const engagement = { totalUsers: usersRes?.count ?? 0, active7d: activeRes?.count ?? 0, agentMessages: msgRes?.count ?? 0 };
    const generatedAt = new Date().toISOString();
    const brief = buildFounderBrief({ intel, usage, quality, engagement, generatedAt });
    res.json({ ...brief, generatedAt });
  } catch (err) {
    console.error('[Admin] brief failed:', err.message);
    res.status(500).json({ error: 'Could not build the brief' });
  }
});

export default router;
