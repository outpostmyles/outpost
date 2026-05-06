/**
 * Portfolio Explainer — "Why did my portfolio move today?"
 *
 * One-tap daily recap. After market close, synthesizes a user's biggest
 * dollar-impact winners and losers into plain English with stock-specific
 * reasoning pulled from recent news.
 *
 * Data reuse:
 *   - Positions from `positions` table
 *   - Live prices from pricePool
 *   - Ticker news from Polygon getNews (already cached)
 *   - Market context from existing sentiment/sector data
 *
 * Cache key: `move_explainer_{userId}_{YYYY-MM-DD}`
 * Runs via scheduled job at 16:45 ET weekdays, also on-demand when users
 * open the app (cached response).
 */
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { getPrices } from '../services/pricePool.js';
import { getNews, getSnapshot } from '../utils/polygon.js';
import { getTickerNews, isFinnhubAvailable } from '../utils/finnhub.js';
import { todayStr, isWeekday } from '../utils/marketHours.js';
import { config } from '../config.js';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: config.anthropicKey });
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';

const PLAIN_TEXT_RULE = 'CRITICAL: Respond in plain text only. No markdown, no asterisks, no bold, no italic, no headers, no bullet dashes.';

// ============ CORE ============

/**
 * Compute dollar-impact movers for a user from their positions and live prices.
 * Returns { totalChange, totalChangePct, winners, losers, positionCount } or null
 * if no positions.
 */
async function computeMovers(userId) {
  const { data: positions } = await supabase
    .from('positions')
    .select('ticker, shares, avg_cost')
    .eq('user_id', userId);

  if (!positions?.length) return null;

  const tickers = positions.map(p => p.ticker);
  const priceMap = getPrices(tickers);

  let totalChange = 0;
  let totalValue = 0;
  const enriched = [];

  for (const p of positions) {
    const live = priceMap[p.ticker];
    const currentPrice = live?.price ?? p.avg_cost ?? 0;
    const changePct = live?.changePercent ?? 0;
    const currentValue = currentPrice * (p.shares ?? 0);
    const prevValue = changePct !== 0 ? currentValue / (1 + changePct / 100) : currentValue;
    const dollarImpact = currentValue - prevValue;

    totalChange += dollarImpact;
    totalValue += currentValue;

    enriched.push({
      ticker: p.ticker,
      shares: p.shares,
      currentPrice: parseFloat(currentPrice.toFixed(2)),
      changePct: parseFloat(changePct.toFixed(2)),
      dollarImpact: parseFloat(dollarImpact.toFixed(2)),
      currentValue: parseFloat(currentValue.toFixed(2)),
    });
  }

  const prevTotalValue = totalValue - totalChange;
  const totalChangePct = prevTotalValue > 0 ? (totalChange / prevTotalValue) * 100 : 0;

  // Sort by absolute dollar impact so we rank "what actually moved the needle"
  // rather than biggest-% (which favors small positions).
  const sortedByImpact = [...enriched].sort(
    (a, b) => Math.abs(b.dollarImpact) - Math.abs(a.dollarImpact)
  );

  // Winners = positive dollar impact, top 3 by magnitude
  // Losers  = negative dollar impact, top 3 by magnitude
  const winners = sortedByImpact
    .filter(p => p.dollarImpact > 0.01)
    .slice(0, 3);
  const losers = sortedByImpact
    .filter(p => p.dollarImpact < -0.01)
    .slice(0, 3);

  return {
    totalChange: parseFloat(totalChange.toFixed(2)),
    totalChangePct: parseFloat(totalChangePct.toFixed(2)),
    totalValue: parseFloat(totalValue.toFixed(2)),
    positionCount: positions.length,
    winners,
    losers,
  };
}

/**
 * Fetch 2-3 recent headlines per mover. Uses Polygon news (already cached).
 * Falls back to Finnhub ticker news if Polygon returns nothing.
 */
async function fetchNewsForMovers(movers) {
  const results = {};
  // Only consider headlines from the last 48 hours — anything older is almost
  // never what moved the stock TODAY. Prevents Claude from latching onto stale
  // "strong February performance" type articles and pretending they explain
  // today's move.
  const cutoff = Date.now() - 48 * 3600 * 1000;

  const isFresh = (publishedAt) => {
    if (!publishedAt) return false;
    const t = new Date(publishedAt).getTime();
    return Number.isFinite(t) && t >= cutoff;
  };

  await Promise.all(
    movers.map(async (m) => {
      try {
        const polygonNews = await getNews(m.ticker, 10);
        let headlines = (polygonNews || [])
          .map(n => ({ title: n.title, source: n.source, publishedAt: n.publishedUtc }))
          .filter(h => isFresh(h.publishedAt))
          .slice(0, 4);

        // Fallback: Finnhub ticker news (different source, often catches different stories)
        if (headlines.length < 2 && isFinnhubAvailable()) {
          const fh = await getTickerNews(m.ticker, 2);
          const extra = (fh || [])
            .map(n => ({ title: n.title, source: n.source, publishedAt: n.publishedAt }))
            .filter(h => isFresh(h.publishedAt))
            .slice(0, 4 - headlines.length);
          headlines = [...headlines, ...extra];
        }

        results[m.ticker] = headlines;
      } catch {
        results[m.ticker] = [];
      }
    })
  );
  return results;
}

/**
 * Get SPY performance as a benchmark for "did my portfolio outperform?".
 */
async function getBenchmark() {
  try {
    const snap = await getSnapshot('SPY');
    if (snap?.changePercent != null) {
      return { changePct: parseFloat(snap.changePercent.toFixed(2)) };
    }
  } catch {}
  return null;
}

/**
 * Call Claude Haiku once with ALL movers + headlines and get back a structured
 * JSON with a one-sentence "why" per ticker plus a one-sentence portfolio
 * summary. Single call is efficient and lets the model cross-reference movers.
 */
async function generateExplanations(movers, newsMap, benchmark, portfolioSummary) {
  const allMovers = [...movers.winners, ...movers.losers];
  if (allMovers.length === 0) return null;

  const moverLines = allMovers
    .map((m) => {
      const headlines = newsMap[m.ticker] || [];
      const newsBlock = headlines.length > 0
        ? headlines.slice(0, 3).map(h => `  - ${h.title}${h.source ? ` (${h.source})` : ''}`).join('\n')
        : '  - (no recent news found)';
      const direction = m.dollarImpact >= 0 ? 'up' : 'down';
      return `${m.ticker}: ${direction} ${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(2)}% (${m.dollarImpact >= 0 ? '+' : ''}$${m.dollarImpact.toFixed(2)} dollar impact, ${m.shares} shares)\nHeadlines:\n${newsBlock}`;
    })
    .join('\n\n');

  const spyLine = benchmark
    ? `SPY: ${benchmark.changePct >= 0 ? '+' : ''}${benchmark.changePct.toFixed(2)}% today`
    : 'SPY: unavailable';

  const portfolioLine = `Portfolio: ${portfolioSummary.totalChangePct >= 0 ? '+' : ''}${portfolioSummary.totalChangePct.toFixed(2)}% (${portfolioSummary.totalChange >= 0 ? '+' : ''}$${portfolioSummary.totalChange.toFixed(2)}) across ${portfolioSummary.positionCount} positions`;

  const systemPrompt = `You are a financial recap writer. Your job is to tell a retail investor, in plain English, WHY each of their big movers moved today. You have access to recent headlines for each ticker.

RULES:
1. For each ticker, write ONE sentence (max 20 words) explaining the move. Use the headlines as evidence.
2. If the headlines clearly explain the move (earnings, analyst action, product news), say so specifically.
3. If the headlines don't explain it, say "moved with [sector/market]" or "no stock-specific catalyst — followed [sector/market]" — do NOT invent reasons.
4. Never hallucinate. If you're not sure, admit the move was general.
5. For the overall summary: one sentence placing the portfolio day in context (outperforming/lagging SPY, broad risk-on/risk-off, etc.)
6. Tone: direct, no hype, like a friend who reads the market for you.
7. ${PLAIN_TEXT_RULE}
8. Return ONLY valid JSON, no markdown fences.`;

  const userMsg = `Today's portfolio recap inputs:

${portfolioLine}
${spyLine}

MOVERS (ranked by dollar impact):

${moverLines}

Return JSON in this exact shape:
{
  "summary": "one sentence summarizing the day in context",
  "explanations": [
    { "ticker": "XYZ", "why": "one sentence why it moved" }
  ]
}`;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 800,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMsg }],
    });

    const text = msg.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (err) {
    console.error('[PortfolioExplainer] Claude call failed:', err.message);
    return null;
  }
}

/**
 * Full generation pipeline for a single user.
 * Returns the explainer object, or null if nothing to explain.
 */
export async function generateExplainerForUser(userId) {
  const date = todayStr();

  // Compute movers from live portfolio
  const movers = await computeMovers(userId);
  if (!movers) return null;
  if (movers.winners.length === 0 && movers.losers.length === 0) {
    // Flat day with no meaningful movement
    return {
      date,
      generatedAt: new Date().toISOString(),
      portfolioSummary: {
        totalChange: movers.totalChange,
        totalChangePct: movers.totalChangePct,
        positionCount: movers.positionCount,
      },
      benchmark: null,
      summary: 'Quiet day — no meaningful single-position moves.',
      winners: [],
      losers: [],
    };
  }

  // Fetch news + benchmark in parallel
  const allMovers = [...movers.winners, ...movers.losers];
  const [newsMap, benchmark] = await Promise.all([
    fetchNewsForMovers(allMovers),
    getBenchmark(),
  ]);

  // Ask Claude for explanations (one call)
  const aiResult = await generateExplanations(
    movers,
    newsMap,
    benchmark,
    {
      totalChange: movers.totalChange,
      totalChangePct: movers.totalChangePct,
      positionCount: movers.positionCount,
    }
  );

  // Attach explanations back to each mover. If Claude failed, fall back to a
  // generic "moved with market" string so the card still renders.
  function explainFor(ticker) {
    if (!aiResult) return 'Moved with broader market activity.';
    const found = aiResult.explanations?.find(e => e.ticker === ticker);
    return found?.why || 'Moved with broader market activity.';
  }

  const winners = movers.winners.map(w => ({ ...w, why: explainFor(w.ticker) }));
  const losers = movers.losers.map(l => ({ ...l, why: explainFor(l.ticker) }));

  return {
    date,
    generatedAt: new Date().toISOString(),
    portfolioSummary: {
      totalChange: movers.totalChange,
      totalChangePct: movers.totalChangePct,
      positionCount: movers.positionCount,
    },
    benchmark: benchmark
      ? {
          ticker: 'SPY',
          changePct: benchmark.changePct,
          vs: parseFloat((movers.totalChangePct - benchmark.changePct).toFixed(2)),
        }
      : null,
    summary: aiResult?.summary || `Portfolio ${movers.totalChangePct >= 0 ? 'up' : 'down'} ${Math.abs(movers.totalChangePct).toFixed(2)}% on the day.`,
    winners,
    losers,
  };
}

/**
 * Get cached explainer for a user/date, regenerating if stale or missing.
 */
async function getExplainer(userId, force = false) {
  const date = todayStr();
  const cacheKey = `move_explainer_${userId}_${date}`;

  if (!force) {
    try {
      const { data: cached } = await supabase
        .from('ai_cache')
        .select('*')
        .eq('cache_key', cacheKey)
        .maybeSingle();
      if (cached?.result) {
        try {
          return JSON.parse(cached.result);
        } catch {}
      }
    } catch {}
  }

  const fresh = await generateExplainerForUser(userId);
  if (!fresh) return null;

  // Persist cache
  try {
    const payload = JSON.stringify(fresh);
    const { data: existing } = await supabase
      .from('ai_cache')
      .select('id')
      .eq('cache_key', cacheKey)
      .maybeSingle();
    if (existing) {
      await supabase
        .from('ai_cache')
        .update({ result: payload, created_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase.from('ai_cache').insert({
        cache_key: cacheKey,
        result: payload,
        created_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[PortfolioExplainer] Cache write failed:', err.message);
  }

  return fresh;
}

// ============ SCHEDULED JOB ============

/**
 * Generate explainers for every active user with positions. Called from the
 * runner at 16:45 ET on weekdays.
 */
export async function generateAllExplainers() {
  if (!isWeekday()) return;
  console.log('[PortfolioExplainer] Generating daily explainers...');

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: users } = await supabase
    .from('user_profiles')
    .select('id')
    .gt('last_login', sevenDaysAgo);

  if (!users?.length) return;

  let count = 0;
  for (const u of users) {
    try {
      const result = await getExplainer(u.id, true); // force fresh
      if (result) count++;
    } catch (err) {
      console.error(`[PortfolioExplainer] Failed for ${u.id}:`, err.message);
    }
  }
  console.log(`[PortfolioExplainer] Generated ${count} explainers for ${users.length} users`);
}

// ============ ROUTES ============

// GET /api/ai/move-explainer
router.get('/', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const data = await getExplainer(req.user.id, force);

    if (!data) {
      return res.json({
        available: false,
        reason: 'No positions or nothing to explain yet.',
        disclaimer: 'Educational purposes only. Not financial advice.',
      });
    }

    res.json({
      available: true,
      ...data,
      disclaimer: 'Educational purposes only. Not financial advice.',
    });
  } catch (err) {
    console.error('[PortfolioExplainer] API error:', err);
    res.status(500).json({ error: 'Explainer unavailable' });
  }
});

export default router;
