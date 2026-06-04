/**
 * Bargain Radar — Daily oversold dip scanner for quality large-caps.
 *
 * Universe: S&P 500 + NASDAQ 100 (~540 tickers)
 *
 * Pipeline:
 *   1. QUICK SCAN — batch snapshot all tickers, filter to those down 10%+ from recent
 *      (cheap, single API call).
 *   2. QUALITY GATE — enrich survivors with market cap, analyst score, price target.
 *      Drop anything that's small, analyst-unloved, or lacking upside.
 *   3. OVERSOLD GATE — check RSI and 52-week high drawdown. Must be down 15%+ from 52w
 *      high AND RSI < 40.
 *   4. CLAUDE QUALITATIVE FILTER — for survivors, Claude writes a 1-sentence take
 *      distinguishing "temporary noise / buyable dip" from "real problem / avoid".
 *      Stocks flagged as real problems get dropped.
 *   5. RANK — conviction score = analyst upside + oversold magnitude - downgrades,
 *      return top 10.
 *
 * Runs once daily at 16:30 ET (30 min after close). Cached in ai_cache for 24h.
 */
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { getSnapshots, getFiftyTwoWeekHigh, getSMA200, getRSI } from '../utils/polygon.js';
import { applyBuyableVerdicts } from '../services/bargainVerdicts.js';
import {
  getAnalystRecommendation,
  getPriceTarget,
  getBasicFinancials,
  getUpgradeDowngrade,
  isFinnhubAvailable,
} from '../utils/finnhub.js';
import { SCAN_UNIVERSE } from '../utils/stockUniverse.js';
import { config } from '../config.js';
import { recordClaudeUsage } from '../services/aiUsage.js';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: config.anthropicKey });
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';

const CACHE_KEY = 'bargain_radar_v3';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// In-memory cache
let radarData = null;
let lastGenerated = null;

// ============ PIPELINE ============

/**
 * Concurrency limiter — runs an async fn over items with max N in flight.
 * Prevents overloading Finnhub/Polygon when enriching 30+ tickers at once.
 */
async function withLimit(items, fn, limit = 6) {
  const results = [];
  let i = 0;
  const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx]);
      } catch (err) {
        results[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * STAGE 1 — Quick scan: batch snapshot the whole universe, find tickers that
 * look "down today / down recently" enough to be worth looking at.
 * Uses Polygon's batched snapshot endpoint for efficiency.
 */
async function stage1QuickScan() {
  // Polygon batched snapshot supports comma-separated tickers. Split into chunks
  // of 50 to keep URL size reasonable.
  const CHUNK = 50;
  const chunks = [];
  for (let i = 0; i < SCAN_UNIVERSE.length; i += CHUNK) {
    chunks.push(SCAN_UNIVERSE.slice(i, i + CHUNK));
  }

  const snapshots = {};
  // Fetch snapshots in parallel but in small batches to avoid hammering
  const BATCH_PARALLEL = 4;
  for (let i = 0; i < chunks.length; i += BATCH_PARALLEL) {
    const batchSlice = chunks.slice(i, i + BATCH_PARALLEL);
    const results = await Promise.all(batchSlice.map(c => getSnapshots(c)));
    for (const r of results) Object.assign(snapshots, r);
  }

  const flagged = [];
  for (const ticker of SCAN_UNIVERSE) {
    const snap = snapshots[ticker];
    if (!snap?.price) continue;
    // Preliminary signal: any of
    //   a) down 1.5%+ today (fresh weakness)
    //   b) price non-trivial (>$5, avoid penny stuff)
    if (snap.price < 5) continue;
    flagged.push({
      ticker,
      price: snap.price,
      changePercent: snap.changePercent ?? 0,
      volume: snap.volume ?? 0,
      prevClose: snap.prevClose,
    });
  }

  // Sort by most negative intraday move so the list is weighted toward losers,
  // but keep the whole universe alive for 52w drawdown checks too.
  flagged.sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0));
  return flagged;
}

/**
 * STAGE 2 — Quality + oversold filter. For each candidate, fetch 52w high and
 * compute drawdown. Keep only those >=15% off 52w high.
 *
 * This is the big narrowing step — goes from ~540 to typically 30-80.
 * We use Polygon aggregates (which are cached), not Finnhub (which is rate-limited).
 */
async function stage2OversoldFilter(candidates) {
  console.log(`[BargainRadar] Stage 2 — checking 52w drawdown on ${candidates.length} tickers`);
  const enriched = await withLimit(candidates, async (c) => {
    const hi52 = await getFiftyTwoWeekHigh(c.ticker);
    if (!hi52 || hi52.pctOffHigh == null) return null;
    // Must be down 15%+ from 52-week high
    if (hi52.pctOffHigh > -15) return null;
    return { ...c, fiftyTwoWeekHigh: hi52.high, pctOffHigh: hi52.pctOffHigh };
  }, 8);

  return enriched.filter(Boolean);
}

/**
 * STAGE 3 — Add technicals (RSI) + analyst data.
 *
 * HARD REQUIREMENTS:
 *   - RSI < 40 (oversold)
 *   - Analyst score >= 3.5/5 (more buys than holds)
 *
 * SOFT REQUIREMENTS (use if data is available, skip otherwise):
 *   - Price target implies 15%+ upside (only checked if Finnhub returns a target)
 *   - Market cap > $5B (the universe is already S&P500+NDX100, so this is
 *     already guaranteed — we only use marketCap if Finnhub returns it, for display)
 *
 * Finnhub's free tier returns /stock/recommendation but /stock/price-target and
 * /stock/metric may return empty. That's fine — we fall back to drawdown-based
 * upside (recovery to 52w high implies the upside amount).
 */
async function stage3QualityEnrich(candidates) {
  console.log(`[BargainRadar] Stage 3 — quality enrichment on ${candidates.length} tickers`);

  const enriched = await withLimit(candidates, async (c) => {
    // Parallel fetch per ticker: RSI + recommendation + price target + financials
    const [rsi, reco, pt, fin] = await Promise.all([
      getRSI(c.ticker),
      isFinnhubAvailable() ? getAnalystRecommendation(c.ticker) : Promise.resolve(null),
      isFinnhubAvailable() ? getPriceTarget(c.ticker).catch(() => null) : Promise.resolve(null),
      isFinnhubAvailable() ? getBasicFinancials(c.ticker).catch(() => null) : Promise.resolve(null),
    ]);

    // HARD: RSI must be < 40 (deeply oversold)
    if (!rsi || rsi.value >= 40) return null;

    // SOFT: analyst score — if we HAVE the data, require >= 3.5. If the
    // endpoint is unavailable (free-tier restriction, rate limit), keep the
    // candidate with a neutral score. Universe is already large-cap quality.
    let analystScore = null;
    let analystCount = null;
    let strongBuyCount = null;
    if (reco) {
      if (reco.score < 3.5) return null;
      analystScore = reco.score;
      analystCount = reco.total;
      strongBuyCount = reco.strongBuy;
    }

    // SOFT: upside to analyst target — if we have a target, enforce 15%+ upside.
    // If we don't have one, use drawdown as the implied upside (getting back to 52w high).
    let upside;
    let targetMean = null;
    let upsideSource = 'analyst';
    if (pt?.targetMean && pt.targetMean > c.price) {
      upside = ((pt.targetMean - c.price) / c.price) * 100;
      targetMean = pt.targetMean;
      // If we HAVE analyst target data, require decent upside
      if (upside < 15) return null;
    } else {
      // Fall back to drawdown-implied upside: recovery to 52w high
      upside = Math.abs(c.pctOffHigh);
      upsideSource = 'drawdown';
      // Already passed stage2 (15%+ off high), so this will always be >= 15
    }

    // SOFT: market cap — display only, NOT a filter. Universe is already large-cap.
    const marketCap = fin?.marketCap ?? null;

    return {
      ...c,
      rsi: rsi.value,
      analystScore,
      analystCount,
      strongBuyCount,
      targetMean,
      upside: parseFloat(upside.toFixed(1)),
      upsideSource,
      marketCapB: marketCap != null ? parseFloat((marketCap / 1000).toFixed(1)) : null,
    };
  }, 3); // concurrency 3 — respects Finnhub free-tier rate limits (60/min)

  return enriched.filter(Boolean);
}

/**
 * STAGE 4 — Check for recent downgrades. Stocks with 2+ downgrades in last 14 days
 * get dropped (something's broken fundamentally).
 */
async function stage4DowngradeFilter(candidates) {
  console.log(`[BargainRadar] Stage 4 — downgrade check on ${candidates.length} tickers`);
  if (!isFinnhubAvailable()) return candidates;

  const filtered = await withLimit(candidates, async (c) => {
    const recent = await getUpgradeDowngrade(c.ticker).catch(() => null);
    if (!recent || recent.length === 0) return c;
    const twoWeeksAgo = Date.now() - 14 * 86400000;
    const recentDowngrades = recent.filter(u =>
      u.action === 'down' && new Date(u.date).getTime() > twoWeeksAgo
    );
    if (recentDowngrades.length >= 2) return null;
    return { ...c, recentDowngrades: recentDowngrades.length };
  }, 3);

  return filtered.filter(Boolean);
}

/**
 * STAGE 5 — Claude qualitative filter. For the ~10-30 survivors, ask Claude
 * to flag which ones are "real problems" (skip) vs "buyable dips" (keep).
 *
 * Batches all candidates into a single Claude call for efficiency.
 */
async function stage5ClaudeFilter(candidates) {
  console.log(`[BargainRadar] Stage 5 — Claude qualitative filter on ${candidates.length} tickers`);
  if (candidates.length === 0) return [];

  const lines = candidates.map((c, i) => {
    const analystStr = c.analystScore != null ? `, analyst ${c.analystScore}/5 (${c.analystCount} analysts)` : '';
    const ptStr = c.targetMean != null ? `, PT $${c.targetMean} (+${c.upside}% upside)` : `, +${c.upside}% to 52w high`;
    return `${i + 1}. ${c.ticker} — price $${c.price}, ${c.pctOffHigh.toFixed(1)}% off 52w high ($${c.fiftyTwoWeekHigh}), RSI ${c.rsi.toFixed(1)}${analystStr}${ptStr}`;
  }).join('\n');

  const systemPrompt = `You are Outpost — the friend in someone's phone who actually knows finance. You're looking at stocks that have dropped a lot and deciding which ones look like a real opportunity ("buyable dip") versus which ones are dropping for a good reason ("avoid").

BUYABLE DIP signals: the whole market is down and this stock got dragged along with it, a sector is out of favor, one bad earnings report that doesn't change the long-term story, fear over tariffs or rates that will pass.

AVOID signals: the business itself is fading (declining customers, products getting replaced), accounting problems, key executives leaving, a regulator just delivered a death blow, the company is losing its biggest customer, real questions about whether the company will survive.

For each stock, write the THESIS as one sentence a regular person would understand. Max 18 words. Plain English — never use "secular decline", "story intact", "going-concern", "broken thesis", "macro-driven", or "regulatory headwind". Say what's actually going on.

Good examples:
- "Got dragged down with the whole market — the company itself is still doing fine."
- "Tech sector is out of favor right now, but the business hasn't changed."
- "One bad earnings report overdone — the long-term story still works."
- "Customers are leaving for cheaper options — this looks like a real problem, not a dip."

Return ONLY valid JSON, no markdown. For each stock, output: ticker, verdict ("buyable" or "avoid"), and the plain-English thesis.`;

  try {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 30000);
    let msg;
    try {
      msg = await anthropic.messages.create({
        model: MODEL_HAIKU,
        max_tokens: 1500,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: `Evaluate these oversold large-caps. Which are buyable dips and which are real problems?\n\n${lines}\n\nReturn JSON:\n{\n  "verdicts": [\n    { "ticker": "XYZ", "verdict": "buyable" | "avoid", "thesis": "one sentence" }\n  ]\n}`,
        }],
      }, { signal: ctrl.signal });
      recordClaudeUsage({ feature: 'bargain_radar', model: msg.model, usage: msg.usage, userId: null });
    } finally { clearTimeout(tm); }

    const text = msg.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    let parsed = null;
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { parsed = null; }
    }

    // Fail closed: only names Claude explicitly marked "buyable" survive. If the
    // verification did not produce usable verdicts, applyBuyableVerdicts returns
    // [] rather than passing unvetted names through with a generic thesis.
    return applyBuyableVerdicts(candidates, parsed);
  } catch (err) {
    console.error('[BargainRadar] Claude filter failed:', err.message);
    // Fail closed: never present unverified names as vetted buyable dips. Better
    // to show an empty radar than a confident wrong one.
    return [];
  }
}

/**
 * Rank survivors by a conviction score and return top 10.
 * Higher is better. Factors:
 *  - upside to target (positive)
 *  - drawdown magnitude (bigger drop = more room to recover)
 *  - analyst strength (score >3.5)
 *  - oversold magnitude (lower RSI = deeper oversold)
 */
function rankAndSlice(candidates) {
  return candidates
    .map(c => {
      const analystBoost = c.analystScore != null ? (c.analystScore - 3) * 10 : 0;
      const convictionScore =
        c.upside * 0.4 +
        Math.abs(c.pctOffHigh) * 0.25 +
        analystBoost +
        Math.max(0, 40 - c.rsi) * 0.5;
      return { ...c, convictionScore: parseFloat(convictionScore.toFixed(1)) };
    })
    .sort((a, b) => b.convictionScore - a.convictionScore)
    .slice(0, 10);
}

/**
 * Full pipeline — generates a fresh bargain radar.
 */
export async function runBargainScan() {
  const t0 = Date.now();
  console.log('[BargainRadar] Starting scan...');

  try {
    // Stage 1: quick universe sweep
    const stage1 = await stage1QuickScan();
    console.log(`[BargainRadar] Stage 1 — ${stage1.length} with valid prices`);

    // Stage 2: 52w drawdown filter
    const stage2 = await stage2OversoldFilter(stage1);
    console.log(`[BargainRadar] Stage 2 — ${stage2.length} down 15%+ from 52w high`);

    // Stage 3: quality + technical enrichment
    const stage3 = await stage3QualityEnrich(stage2);
    console.log(`[BargainRadar] Stage 3 — ${stage3.length} passed quality gates`);

    // Stage 4: downgrade filter
    const stage4 = await stage4DowngradeFilter(stage3);
    console.log(`[BargainRadar] Stage 4 — ${stage4.length} after downgrade check`);

    // Limit Stage 5 input to 25 — more than that and the prompt gets unwieldy
    const stage4Trimmed = stage4
      .slice() // copy
      .sort((a, b) => b.upside - a.upside)
      .slice(0, 25);

    // Stage 5: Claude qualitative check
    const stage5 = await stage5ClaudeFilter(stage4Trimmed);
    console.log(`[BargainRadar] Stage 5 — ${stage5.length} passed Claude filter`);

    // Rank + top 10
    const top = rankAndSlice(stage5);

    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(`[BargainRadar] Scan complete in ${elapsed}s — ${top.length} picks`);

    const result = {
      picks: top,
      generatedAt: new Date().toISOString(),
      universeSize: SCAN_UNIVERSE.length,
      scanTimeSec: elapsed,
      stageCounts: {
        universe: SCAN_UNIVERSE.length,
        stage1: stage1.length,
        stage2: stage2.length,
        stage3: stage3.length,
        stage4: stage4.length,
        stage5: stage5.length,
      },
    };

    // Persist to cache
    radarData = result;
    lastGenerated = Date.now();

    try {
      const payload = JSON.stringify(result);
      const { data: existing } = await supabase.from('ai_cache').select('id').eq('cache_key', CACHE_KEY).maybeSingle();
      if (existing) {
        await supabase.from('ai_cache').update({ result: payload, created_at: new Date().toISOString() }).eq('id', existing.id);
      } else {
        await supabase.from('ai_cache').insert({ cache_key: CACHE_KEY, result: payload, created_at: new Date().toISOString() });
      }
    } catch (err) {
      console.error('[BargainRadar] Cache persist failed:', err.message);
    }

    return result;
  } catch (err) {
    console.error('[BargainRadar] Scan failed:', err);
    return null;
  }
}

/**
 * Get radar data with caching. Regenerates if stale.
 */
async function getRadar(force = false) {
  if (!force && radarData && lastGenerated && Date.now() - lastGenerated < CACHE_TTL_MS) {
    return radarData;
  }

  if (!force) {
    try {
      const { data: cached } = await supabase.from('ai_cache').select('*').eq('cache_key', CACHE_KEY).maybeSingle();
      if (cached?.result && Date.now() - new Date(cached.created_at).getTime() < CACHE_TTL_MS) {
        try {
          radarData = JSON.parse(cached.result);
          lastGenerated = new Date(cached.created_at).getTime();
          return radarData;
        } catch (parseErr) {
          console.warn('[BargainRadar] Corrupt cache:', parseErr.message);
        }
      }
    } catch {}
  }

  return await runBargainScan();
}

// ============ API ROUTES ============

// GET /api/ai/bargain-radar
router.get('/', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const data = await getRadar(force);

    if (!data) {
      return res.json({
        picks: [],
        generatedAt: null,
        disclaimer: 'Bargain Radar is for informational purposes only. Not financial advice.',
      });
    }

    res.json({
      ...data,
      disclaimer: 'Bargain Radar is for informational purposes only. Not financial advice.',
    });
  } catch (err) {
    console.error('[BargainRadar] API error:', err);
    res.status(500).json({ error: 'Bargain Radar unavailable' });
  }
});

export default router;
