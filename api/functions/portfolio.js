import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { sanitizeTicker, sanitizeNumber, sanitizeString } from '../middleware/validate.js';
import { getPrices, isPoolMarketOpen, requestRefresh } from '../services/pricePool.js';
import { trackFeature, trackTradePlan } from '../services/analytics.js';
import { getSnapshot, getPrevClose } from '../utils/polygon.js';
import { todayStr } from '../utils/marketHours.js';
import { getUserHistory } from '../services/historyAggregator.js';
import { getFinancials, getAnalystRating } from '../services/fmp.js';
import { getEarningsForTickers } from '../utils/finnhub.js';
import { lookupStock } from '../services/agentTools.js';
import { config } from '../config.js';
import { getTaxInsights } from '../services/taxInsights.js';
import { getPlanAdherence } from '../services/planAdherence.js';
import { getPerformanceAttribution } from '../services/performanceAttribution.js';
import { getPortfolioSynthesis } from '../services/portfolioSynthesis.js';

/**
 * Validate ticker exists on a real exchange and prices pass sanity checks.
 * Returns { ok: true, price } or { ok: false, error }.
 */
async function validateTickerAndPrices({ ticker, avgCost, priceTarget, stopLoss }) {
  let lookup;
  try {
    lookup = await lookupStock({ ticker });
  } catch (e) {
    return { ok: false, error: `Ticker unavailable — "${ticker}" isn't a valid US stock symbol` };
  }
  if (lookup?.error || !lookup?.price) {
    return { ok: false, error: `Ticker unavailable — "${ticker}" isn't a valid US stock symbol` };
  }
  const livePrice = lookup.price;
  // Sanity checks — avg cost is lenient (stocks can 100x over time), target/stop are tighter (forward-looking)
  const checkAvgCost = (val) => {
    if (val == null || val === 0) return null;
    if (val > livePrice * 100) return `Avg cost ($${val}) seems too high relative to the current price ($${livePrice}). Double-check that number.`;
    // No lower bound on avg cost — you might have bought years ago at a fraction of today's price
    return null;
  };
  const checkForwardPrice = (val, label) => {
    if (val == null || val === 0) return null;
    if (val > livePrice * 20) return `${label} ($${val}) is more than 20x the current price ($${livePrice}). Double-check that number.`;
    if (val < livePrice / 20) return `${label} ($${val}) is less than 1/20 the current price ($${livePrice}). Double-check that number.`;
    return null;
  };
  const err = checkAvgCost(avgCost) || checkForwardPrice(priceTarget, 'Price target') || checkForwardPrice(stopLoss, 'Stop loss');
  if (err) return { ok: false, error: err };
  return { ok: true, price: livePrice };
}

const router = express.Router();
const anthropic = new Anthropic({ apiKey: config.anthropicKey });
const POSITION_LIMITS = { free: 10, starter: 25, pro: 50, elite: 100 };

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 3 — TICKER HISTORY (powers "Your history with this" on position cards
// and Watchlist items)
// ═══════════════════════════════════════════════════════════════════════════
// GET /api/portfolio/history/:ticker — compact history feed for a single
// ticker. Tighter limit than the Timeline endpoint since this surfaces inline
// in a card. Returns the same event shape as the Timeline.
router.get('/history/:ticker', requireAuth, rateLimit(30), async (req, res) => {
  try {
    const ticker = sanitizeTicker(req.params.ticker);
    if (!ticker) return res.status(400).json({ error: 'Valid ticker required' });
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 6), 20);
    const events = await getUserHistory({
      userId: req.user.id,
      ticker,
      limit,
    });
    res.json({ ticker, events, count: events.length });
  } catch (err) {
    console.error('[Portfolio] /history/:ticker failed:', err.message);
    res.status(500).json({ error: 'History unavailable' });
  }
});

router.get('/value', requireAuth, rateLimit(20), async (req, res) => {
  try {
    const { data: positions } = await supabase.from('positions').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    const pos = positions ?? [];

    if (!pos.length) {
      return res.json({ totalValue: 0, totalPnl: 0, totalPnlPercent: 0, todayChange: 0, todayChangePercent: 0, positions: [] });
    }

    const marketOpen = isPoolMarketOpen();
    const tickers = pos.map(p => p.ticker);
    const priceMap = getPrices(tickers);

    // For any ticker NOT in the pool, fetch directly from Polygon
    // This prevents falling back to stale cost basis
    const missingTickers = tickers.filter(t => !priceMap[t]?.price);
    if (missingTickers.length > 0) {
      // Try snapshots first
      const fetches = await Promise.allSettled(missingTickers.map(t => getSnapshot(t)));
      fetches.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value?.price) {
          priceMap[missingTickers[i]] = result.value;
        }
      });

      // For any STILL missing, try previous day aggregates as last resort
      const stillMissing = missingTickers.filter(t => !priceMap[t]?.price);
      if (stillMissing.length > 0) {
        console.warn(`[Portfolio] Falling back to prev-close for: ${stillMissing.join(', ')}`);
        const prevFetches = await Promise.allSettled(stillMissing.map(t => getPrevClose(t)));
        prevFetches.forEach((result, i) => {
          if (result.status === 'fulfilled' && result.value?.price) {
            priceMap[stillMissing[i]] = result.value;
          }
        });
      }
    }

    // ⚠️ Earnings feature disabled (2026-04-15) — free-tier data sources
    // (Finnhub, FMP) don't reliably serve forward earnings dates on our
    // current tier. Leaving earningsMap as an empty object so the enrichment
    // code below still works; it'll just always be empty until we re-enable.
    // Re-enable by uncommenting the getEarningsForTickers call.
    const earningsMap = {};

    let totalValue = 0, totalCost = 0, totalTodayChange = 0;
    let staleCount = 0;
    const enriched = pos.map(p => {
      const live = priceMap[p.ticker];
      const currentPrice = live?.price ?? p.avg_cost ?? 0;
      const hasLivePrice = !!live?.price;
      const priceAgeMs = live?.updatedAt ? Date.now() - live.updatedAt : null;
      const priceAgeMin = priceAgeMs ? Math.round(priceAgeMs / 60000) : null;
      if (!hasLivePrice) staleCount++;
      const currentValue = currentPrice * p.shares;
      const costBasis = (p.avg_cost ?? 0) * p.shares;
      const pnl = currentValue - costBasis;
      const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;

      // Show today's change ALWAYS if we have data — even after hours
      // This shows the last trading session's change, which is what users expect
      const todayChangePercent = live?.changePercent ?? 0;
      // Calculate dollar change from PREVIOUS value (not current) for accuracy.
      // If stock is up 5% to $105, the change is $5 (5% of $100), not $5.25 (5% of $105).
      // Guard against changePercent === -100 (denominator → 0) which would
      // produce Infinity and propagate through totals. Also guard against
      // any non-finite value upstream.
      const denom = 1 + (todayChangePercent / 100);
      const prevValue = (todayChangePercent !== 0 && denom > 0 && Number.isFinite(denom))
        ? currentValue / denom
        : currentValue;
      const todayChange = currentValue - prevValue;

      totalValue += currentValue;
      totalCost += costBasis;
      totalTodayChange += todayChange;

      // Earnings data (if available)
      const earnings = earningsMap[p.ticker] || null;

      return {
        ...p,
        currentPrice: parseFloat(currentPrice.toFixed(2)),
        currentValue: parseFloat(currentValue.toFixed(2)),
        pnl: parseFloat(pnl.toFixed(2)),
        pnlPercent: parseFloat(pnlPercent.toFixed(2)),
        todayChange: parseFloat(todayChange.toFixed(2)),
        todayChangePercent: parseFloat(todayChangePercent.toFixed(2)),
        marketOpen,
        priceStale: !hasLivePrice,
        priceAgeMin,
        earnings, // { date, upcoming, epsEstimate, time } or null
      };
    });

    const totalPnl = totalValue - totalCost;
    const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    const prevTotalValue = totalValue - totalTodayChange;
    const todayChangePercent = prevTotalValue > 0 ? (totalTodayChange / prevTotalValue) * 100 : 0;

    res.json({
      totalValue: parseFloat(totalValue.toFixed(2)),
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      totalPnlPercent: parseFloat(totalPnlPercent.toFixed(2)),
      todayChange: parseFloat(totalTodayChange.toFixed(2)),
      todayChangePercent: parseFloat(todayChangePercent.toFixed(2)),
      marketOpen,
      positions: enriched,
      staleCount,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Portfolio] /value endpoint failed:', err.message);
    res.status(500).json({ error: 'Portfolio data unavailable' });
  }
});

/**
 * Portfolio synthesis — 2-3 sentence advisor read on the whole book.
 * Cached 4h per user. Pass ?force=true to regenerate.
 *
 * Frontend calls this separately from /value so the value payload returns
 * fast and the synthesis loads in alongside (or after) it. This also lets
 * the user hit a refresh on just the synthesis without reloading every
 * position price.
 */
router.get('/synthesis', requireAuth, rateLimit(15), async (req, res) => {
  try {
    const force = req.query.force === 'true';

    // Reuse the same query shape as /value so the summary aggregator gets
    // the same enriched fields. Keep it cheap by skipping earnings/etc.
    const { data: positions } = await supabase
      .from('positions')
      .select('id, ticker, shares, avg_cost, price_target, stop_loss, entry_thesis')
      .eq('user_id', req.user.id);
    const pos = positions ?? [];

    if (pos.length === 0) {
      return res.json({ text: null, generatedAt: null, fromCache: false, summary: null, empty: true });
    }

    const tickers = pos.map(p => p.ticker);
    const priceMap = getPrices(tickers);

    let totalValue = 0, totalCost = 0, totalTodayChange = 0;
    const enriched = pos.map(p => {
      const live = priceMap[p.ticker];
      const currentPrice = live?.price ?? p.avg_cost ?? 0;
      const currentValue = currentPrice * p.shares;
      const costBasis = (p.avg_cost ?? 0) * p.shares;
      const pnl = currentValue - costBasis;
      const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
      const todayChangePercent = live?.changePercent ?? 0;
      const prevValue = todayChangePercent !== 0 ? currentValue / (1 + todayChangePercent / 100) : currentValue;
      const todayChange = currentValue - prevValue;
      totalValue += currentValue;
      totalCost += costBasis;
      totalTodayChange += todayChange;
      return {
        ...p,
        currentPrice,
        currentValue,
        pnl,
        pnlPercent,
        todayChange,
        todayChangePercent,
      };
    });

    const totalPnl = totalValue - totalCost;
    const result = await getPortfolioSynthesis({
      userId: req.user.id,
      positions: enriched,
      totals: { totalValue, totalPnl, todayChange: totalTodayChange },
      force,
    });

    res.json(result);
  } catch (err) {
    console.error('[Portfolio] /synthesis endpoint failed:', err.message);
    res.status(500).json({ error: 'Synthesis unavailable' });
  }
});

router.post('/positions', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const ticker = sanitizeTicker(req.body.ticker);
    if (!ticker) return res.status(400).json({ error: 'Valid ticker required (1-5 letters)' });

    const shares = sanitizeNumber(req.body.shares, 0.001, 1000000);
    if (!shares) return res.status(400).json({ error: 'Valid shares amount required' });

    const avgCost = sanitizeNumber(req.body.avgCost, 0, 1000000);
    const companyName = sanitizeString(req.body.companyName || ticker, 100);

    // Purchase date — optional but recommended for tax tracking
    const purchasedAt = req.body.purchasedAt;
    let purchaseDate = null;
    if (purchasedAt) {
      purchaseDate = new Date(purchasedAt);
      if (isNaN(purchaseDate.getTime())) return res.status(400).json({ error: 'Invalid purchase date' });
      if (purchaseDate > new Date()) return res.status(400).json({ error: 'Purchase date cannot be in the future' });
    }

    // Trade plan fields (optional) — parse first so validator sees them
    const entryThesis = sanitizeString(req.body.entryThesis || '', 500);
    const reversalCondition = sanitizeString(req.body.reversalCondition || '', 500);
    const priceTarget = req.body.priceTarget ? sanitizeNumber(req.body.priceTarget, 0, 1000000) : null;
    const stopLoss = req.body.stopLoss ? sanitizeNumber(req.body.stopLoss, 0, 1000000) : null;
    const tradeNotes = sanitizeString(req.body.tradeNotes || '', 1000);

    // Phase 4 — provenance ('manual' | 'deploy_cash' | 'import' | 'screenshot')
    const VALID_SOURCES = ['manual', 'deploy_cash', 'import', 'screenshot'];
    const source = VALID_SOURCES.includes(req.body.source) ? req.body.source : 'manual';

    // Validate ticker is a real stock + prices pass sanity checks
    const validation = await validateTickerAndPrices({ ticker, avgCost, priceTarget, stopLoss });
    if (!validation.ok) return res.status(400).json({ error: validation.error });

    const plan = req.user.plan ?? 'free';
    const limit = POSITION_LIMITS[plan] ?? 3;
    const { data: existing } = await supabase.from('positions').select('id').eq('user_id', req.user.id);
    if ((existing?.length ?? 0) >= limit) {
      return res.status(403).json({ error: `Position limit reached (${limit} max on ${plan} plan) — upgrade to add more` });
    }

    const { data: dup } = await supabase.from('positions').select('id').eq('user_id', req.user.id).eq('ticker', ticker).maybeSingle();
    if (dup) return res.status(409).json({ error: `${ticker} is already in your portfolio` });

    const insertData = {
      user_id: req.user.id,
      ticker,
      company_name: companyName,
      shares,
      avg_cost: avgCost ?? 0,
      purchased_at: purchaseDate ? purchaseDate.toISOString() : null,
      created_at: new Date().toISOString(),
    };
    // Only include trade plan fields if they have values (avoids errors if columns don't exist yet)
    if (entryThesis) {
      insertData.entry_thesis = entryThesis;
      // Stamp thesis_written_at on first capture so we can show "thesis from N days ago"
      insertData.thesis_written_at = new Date().toISOString();
    }
    if (reversalCondition) insertData.reversal_condition = reversalCondition;
    if (priceTarget) insertData.price_target = priceTarget;
    if (stopLoss) insertData.stop_loss = stopLoss;
    if (tradeNotes) insertData.trade_notes = tradeNotes;
    if (source && source !== 'manual') insertData.source = source;

    const { data: position, error } = await supabase.from('positions').insert(insertData).select().single();

    if (error) {
      // Handle duplicate from race condition (unique constraint on user_id + ticker)
      if (error.code === '23505') return res.status(409).json({ error: `${ticker} is already in your portfolio` });
      return res.status(500).json({ error: 'Failed to add position' });
    }
    requestRefresh(); // Tell price pool to pick up the new ticker
    trackFeature('add_position', req.user.id);
    if (entryThesis || priceTarget || stopLoss) trackTradePlan(req.user.id);
    res.json({ success: true, position });
  } catch (err) {
    console.error('[Portfolio] /positions POST failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ CSV IMPORT ============
// POST /api/portfolio/import — bulk import positions from broker CSV
router.post('/import', requireAuth, rateLimit(3), async (req, res) => {
  try {
    const { positions: rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'No positions to import' });
    }
    if (rows.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 positions per import' });
    }

    const plan = req.user.plan ?? 'free';
    const limit = POSITION_LIMITS[plan] ?? 3;
    const { data: existing } = await supabase.from('positions').select('id,ticker').eq('user_id', req.user.id);
    const existingTickers = new Set((existing ?? []).map(p => p.ticker));
    const currentCount = existing?.length ?? 0;

    const results = { added: 0, skipped: [], errors: [] };

    for (const row of rows) {
      const ticker = sanitizeTicker(row.ticker);
      if (!ticker) { results.errors.push(`Invalid ticker: ${row.ticker}`); continue; }

      // Skip duplicates
      if (existingTickers.has(ticker)) { results.skipped.push(ticker); continue; }

      // Check position limit
      if (currentCount + results.added >= limit) {
        results.errors.push(`Position limit reached (${limit} on ${plan} plan) — skipped remaining`);
        break;
      }

      const shares = sanitizeNumber(row.shares, 0.001, 10000000);
      if (!shares) { results.errors.push(`${ticker}: invalid shares (${row.shares})`); continue; }

      const avgCost = sanitizeNumber(row.avgCost, 0, 10000000) ?? 0;
      const companyName = sanitizeString(row.companyName || ticker, 100);

      // Parse purchase date — null if not provided (don't assume today for imported positions)
      let purchasedAt = null;
      if (row.purchasedAt) {
        const d = new Date(row.purchasedAt);
        if (!isNaN(d.getTime()) && d <= new Date()) purchasedAt = d.toISOString();
      }

      try {
        const { error: insertErr } = await supabase.from('positions').insert({
          user_id: req.user.id,
          ticker,
          company_name: companyName,
          shares,
          avg_cost: avgCost,
          purchased_at: purchasedAt,
          created_at: new Date().toISOString(),
        });
        if (insertErr) {
          if (insertErr.code === '23505') { results.skipped.push(ticker); existingTickers.add(ticker); }
          else results.errors.push(`${ticker}: ${insertErr.message}`);
        } else {
          results.added++;
          existingTickers.add(ticker);
        }
      } catch (e) {
        results.errors.push(`${ticker}: ${e.message}`);
      }
    }

    // Refresh price pool to pick up new tickers
    if (results.added > 0) requestRefresh();
    trackFeature('csv_import', req.user.id);

    res.json({
      success: true,
      added: results.added,
      skipped: results.skipped,
      errors: results.errors,
    });
  } catch (err) {
    console.error('[Portfolio] /import failed:', err.message);
    res.status(500).json({ error: 'Import failed' });
  }
});

// Screenshot parse calls Claude Haiku vision (~$0.005/call). 5/hour caps abuse
// at ~$0.60/day per user without ever inconveniencing a legit user (typical
// onboarding uses 1-3 parses, and the rare retry-heavy user gets 5/hour).
router.post('/parse-screenshot', requireAuth, rateLimit(5, 60 * 60 * 1000), async (req, res) => {
  try {
    const { image } = req.body;

    // Validate image exists
    if (!image) {
      return res.status(400).json({ error: 'Image is required' });
    }

    // Validate base64 data URI format
    const dataUriRegex = /^data:image\/(jpeg|jpg|png|gif|webp);base64,/;
    if (!dataUriRegex.test(image)) {
      return res.status(400).json({ error: 'Invalid image format. Must be a base64 data URI (e.g., data:image/png;base64,...)' });
    }

    // Extract base64 data and media type
    const matches = image.match(/^data:image\/([^;]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid base64 image format' });
    }

    const imageType = matches[1];
    const base64Data = matches[2];

    // Validate max 10MB
    const sizeBytes = (base64Data.length * 3) / 4; // Rough conversion from base64
    if (sizeBytes > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image must be less than 10MB' });
    }

    // Map image type to media type
    const mediaTypeMap = {
      'jpeg': 'image/jpeg',
      'jpg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
    };
    const mediaType = mediaTypeMap[imageType] || `image/${imageType}`;

    // Claude vision prompt for portfolio parsing
    const PARSE_PROMPT = `Analyze this brokerage portfolio screenshot and extract stock positions.

Look for ANY brokerage format (Webull, Robinhood, Fidelity, Schwab, E*TRADE, etc.).

Extract the following for EACH STOCK POSITION:
- Ticker symbol (e.g., AAPL, MSFT)
- Number of shares (handle fractional shares like 3.22587)
- Average cost per share (if visible; use 0 if not shown)
- Company name (if visible)

RULES:
- Extract ONLY stocks. Skip options, ETFs, crypto, and anything labeled as derivatives
- Return valid JSON array only: [{"ticker":"AAPL","shares":10,"avgCost":150.50,"companyName":"Apple Inc"}]
- If no portfolio data found, return empty array: []
- Ticker must be uppercase letters only, max 5 characters
- Shares must be > 0
- Average cost can be 0 if not visible
- Omit company name if not visible (but include ticker, shares, avgCost)

Output ONLY the JSON array, no other text.`;

    // Call Claude Haiku with vision (45s — vision parsing can be slow)
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 45000);
    let msg;
    try {
      msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: PARSE_PROMPT,
            },
          ],
        }],
      }, { signal: ctrl.signal });
    } finally { clearTimeout(tm); }

    // Parse Claude's response
    const responseText = msg.content[0]?.text || '';
    let parsedData = [];

    try {
      // Extract JSON from response (in case Claude adds extra text)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsedData = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.error('[Portfolio] Failed to parse Claude response:', parseErr.message);
      return res.status(400).json({ error: 'Could not parse portfolio data from image. The image may not contain a clear portfolio screenshot.' });
    }

    // Validate and sanitize each entry
    if (!Array.isArray(parsedData)) {
      return res.status(400).json({ error: 'Invalid response format from image analysis' });
    }

    const sanitized = [];
    for (const entry of parsedData) {
      if (!entry.ticker || !entry.shares) {
        continue; // Skip invalid entries
      }

      const ticker = sanitizeTicker(entry.ticker);
      const shares = parseFloat(entry.shares);
      const avgCost = entry.avgCost ? parseFloat(entry.avgCost) : 0;

      // Validate ticker and shares. Number.isFinite catches Infinity AND NaN
      // (both of which slip past `shares <= 0` because NaN comparisons are
      // always false and Infinity > 0). Also cap at a sane upper bound so
      // a hallucinated "1e30 shares" doesn't poison the confirmation UI.
      if (!ticker || !Number.isFinite(shares) || shares <= 0 || shares > 1_000_000) continue;
      if (!Number.isFinite(avgCost) || avgCost < 0 || avgCost > 1_000_000) continue;

      sanitized.push({
        ticker,
        shares,
        avgCost,
        companyName: entry.companyName || null,
      });
    }

    // Track the feature for analytics
    trackFeature('screenshot_import', req.user.id);

    res.json({
      success: true,
      positions: sanitized,
      message: `Found ${sanitized.length} stock position${sanitized.length !== 1 ? 's' : ''} in screenshot`,
    });
  } catch (err) {
    console.error('[Portfolio] /parse-screenshot failed:', err.message);
    res.status(500).json({ error: 'Screenshot parsing failed. Please check the image and try again.' });
  }
});

router.patch('/positions/:id', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const { data: pos } = await supabase.from('positions').select('id,ticker').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
    if (!pos) return res.status(404).json({ error: 'Position not found' });

    // If any price field is being updated, run sanity check against live price
    const touchingPrice = req.body.avgCost !== undefined || req.body.priceTarget !== undefined || req.body.stopLoss !== undefined;
    if (touchingPrice) {
      const validation = await validateTickerAndPrices({
        ticker: pos.ticker,
        avgCost: req.body.avgCost != null ? parseFloat(req.body.avgCost) : null,
        priceTarget: req.body.priceTarget != null ? parseFloat(req.body.priceTarget) : null,
        stopLoss: req.body.stopLoss != null ? parseFloat(req.body.stopLoss) : null,
      });
      if (!validation.ok) return res.status(400).json({ error: validation.error });
    }

    const updates = {};
    if (req.body.shares !== undefined) {
      const shares = sanitizeNumber(req.body.shares, 0.001, 1000000);
      if (!shares) return res.status(400).json({ error: 'Invalid shares' });
      updates.shares = shares;
    }
    if (req.body.avgCost !== undefined) {
      const avgCost = sanitizeNumber(req.body.avgCost, 0, 1000000);
      if (avgCost === null) return res.status(400).json({ error: 'Invalid avg cost' });
      updates.avg_cost = avgCost;
    }
    if (req.body.companyName !== undefined) {
      updates.company_name = sanitizeString(req.body.companyName, 100);
    }
    // Trade plan fields
    if (req.body.entryThesis !== undefined) {
      const cleaned = sanitizeString(req.body.entryThesis, 500) || null;
      updates.entry_thesis = cleaned;
      // Only stamp thesis_written_at when entry_thesis is moving from empty → set.
      // If the user just edits an existing thesis we keep the original timestamp
      // so the "thesis from 23 days ago" age stays meaningful.
      if (cleaned) {
        const { data: existing } = await supabase.from('positions')
          .select('entry_thesis,thesis_written_at')
          .eq('id', req.params.id)
          .maybeSingle();
        if (!existing?.entry_thesis && !existing?.thesis_written_at) {
          updates.thesis_written_at = new Date().toISOString();
        }
      }
    }
    if (req.body.reversalCondition !== undefined) {
      updates.reversal_condition = sanitizeString(req.body.reversalCondition, 500) || null;
    }
    if (req.body.priceTarget !== undefined) {
      updates.price_target = req.body.priceTarget ? sanitizeNumber(req.body.priceTarget, 0, 1000000) : null;
    }
    if (req.body.stopLoss !== undefined) {
      updates.stop_loss = req.body.stopLoss ? sanitizeNumber(req.body.stopLoss, 0, 1000000) : null;
    }
    if (req.body.tradeNotes !== undefined) {
      updates.trade_notes = sanitizeString(req.body.tradeNotes, 1000) || null;
    }

    const { data: updated, error: updateErr } = await supabase.from('positions').update(updates).eq('id', req.params.id).eq('user_id', req.user.id).select().maybeSingle();
    if (updateErr) throw updateErr;
    if (!updated) return res.status(404).json({ error: 'Position not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[Portfolio] /positions PATCH failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/positions/:id', requireAuth, rateLimit(10), async (req, res) => {
  try {
    // We need the position's current data (live price, shares, avg_cost,
    // purchased_at) to compute pnl / hold_days BEFORE we call the atomic
    // close_position RPC. Read-then-RPC-close is safe against double-close
    // because the RPC's DELETE...RETURNING is what actually wins the race —
    // the read here is just to compute derived values, not to gate the delete.
    const { data: pos, error: readErr } = await supabase
      .from('positions')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!pos) return res.status(404).json({ error: 'Position not found' });

    const livePrice = getPrices([pos.ticker])?.[pos.ticker]?.price;
    const rawSell = req.body?.sellPrice ? parseFloat(req.body.sellPrice) : null;
    const sellPrice = (rawSell && isFinite(rawSell) && rawSell > 0) ? rawSell : (livePrice ?? pos.avg_cost ?? 0);
    const costBasis = (pos.avg_cost ?? 0) * (pos.shares ?? 0);
    const proceeds = sellPrice * (pos.shares ?? 0);
    const pnl = proceeds - costBasis;
    const pnlPercent = costBasis > 0 ? ((pnl / costBasis) * 100) : 0;
    // Calendar-day diff anchored on UTC midnight — matches IRS-style day counting.
    // Use ONLY the user-provided purchased_at. If it's missing we leave hold_days
    // as null rather than pretending the row's created_at (when added to our DB)
    // is when the user actually bought. A wrong number is worse than a missing one.
    let holdDays = null;
    if (pos.purchased_at) {
      const startDay = Math.floor(new Date(pos.purchased_at).getTime() / 86400000);
      const endDay = Math.floor(Date.now() / 86400000);
      holdDays = Math.max(0, endDay - startDay);
    }

    // Phase 2 — structured close-time reflection. Three fields:
    //   thesis_played_out: 'yes' | 'partially' | 'no' | null
    //   reflection_what_happened: narrative of what played out
    //   reflection_lesson: the takeaway for next time
    // Legacy fields (exit_reflection, exit_outcome) are still written for
    // backward compat with the agent's get_closed_trade_reflection tool.
    const reflectionWhatHappened = sanitizeString(req.body?.reflectionWhatHappened, 1000) || null;
    const reflectionLesson = sanitizeString(req.body?.reflectionLesson, 1000) || null;
    const VALID_PLAYED_OUT = ['yes', 'partially', 'no'];
    const rawPlayedOut = typeof req.body?.thesisPlayedOut === 'string' ? req.body.thesisPlayedOut : null;
    const thesisPlayedOut = VALID_PLAYED_OUT.includes(rawPlayedOut) ? rawPlayedOut : null;

    // Legacy fields — accept if provided (old UI), otherwise derive a
    // backward-compat exit_outcome from new fields when possible.
    let exitReflection = sanitizeString(req.body?.exitReflection, 500) || null;
    if (!exitReflection) exitReflection = reflectionWhatHappened?.slice(0, 500) || null;
    const rawOutcome = typeof req.body?.exitOutcome === 'string' ? req.body.exitOutcome : null;
    const VALID_OUTCOMES = ['win_thesis_right', 'win_thesis_wrong', 'loss_thesis_right', 'loss_thesis_wrong'];
    let exitOutcome = VALID_OUTCOMES.includes(rawOutcome) ? rawOutcome : null;
    if (!exitOutcome && thesisPlayedOut && pnl != null) {
      const win = pnl > 0;
      if (thesisPlayedOut === 'yes') exitOutcome = win ? 'win_thesis_right' : 'loss_thesis_right';
      else if (thesisPlayedOut === 'no') exitOutcome = win ? 'win_thesis_wrong' : 'loss_thesis_wrong';
      // 'partially' doesn't map cleanly to the 4-state legacy enum — leave null.
    }

    // Atomic close: migration 016 DELETE + INSERT in one transaction.
    // If the INSERT fails (constraint violation, etc) the DELETE rolls back
    // and the position is preserved. Previous pattern silently lost the
    // closed_trades row when the async archive INSERT failed — that data is
    // needed for tax reporting and the My Theses retrospective.
    const { data: closed, error: rpcErr } = await supabase.rpc('close_position', {
      p_position_id: req.params.id,
      p_user_id: req.user.id,
      p_sell_price: parseFloat(sellPrice.toFixed(2)),
      p_pnl: parseFloat(pnl.toFixed(2)),
      p_pnl_percent: parseFloat(pnlPercent.toFixed(2)),
      p_hold_days: holdDays,
      p_reflection_what_happened: reflectionWhatHappened,
      p_reflection_lesson: reflectionLesson,
      p_thesis_played_out: thesisPlayedOut,
      p_exit_reflection: exitReflection,
      p_exit_outcome: exitOutcome,
    });
    if (rpcErr) throw rpcErr;
    // Null return = position was already deleted between our read and the RPC
    // (double-close race). Treat as 404 — caller's first attempt won.
    if (!closed) return res.status(404).json({ error: 'Position not found' });

    res.json({ success: true });
  } catch (err) {
    console.error('[Portfolio] /positions DELETE failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/portfolio/closed-trades — trade history
router.get('/closed-trades', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const { data: trades } = await supabase.from('closed_trades')
      .select('*')
      .eq('user_id', req.user.id)
      .order('closed_at', { ascending: false })
      .limit(50);

    const allTrades = trades ?? [];
    const winners = allTrades.filter(t => t.pnl > 0);
    const losers = allTrades.filter(t => t.pnl < 0);
    const totalPnl = allTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const avgHoldDays = allTrades.length > 0 ? Math.round(allTrades.reduce((s, t) => s + (t.hold_days ?? 0), 0) / allTrades.length) : 0;

    res.json({
      trades: allTrades,
      stats: {
        totalTrades: allTrades.length,
        winners: winners.length,
        losers: losers.length,
        winRate: allTrades.length > 0 ? parseFloat(((winners.length / allTrades.length) * 100).toFixed(1)) : 0,
        totalPnl: parseFloat(totalPnl.toFixed(2)),
        avgHoldDays,
      },
    });
  } catch (err) {
    console.error('[Portfolio] /closed-trades endpoint failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/snapshots', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const { data: snapshots } = await supabase.from('portfolio_snapshots').select('*').eq('user_id', req.user.id).order('date', { ascending: true }).limit(90);
    const snaps = snapshots ?? [];

    // Add SPY benchmark data for comparison
    // Fetch SPY historical prices for the same date range as snapshots
    let spyData = [];
    if (snaps.length >= 2) {
      try {
        const fromDate = snaps[0].date;
        const toDate = snaps[snaps.length - 1].date;
        const spyUrl = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&apiKey=${config.polygonKey}`;
        const spyRes = await fetch(spyUrl);
        if (spyRes.ok) {
          const spyJson = await spyRes.json();
          const bars = spyJson?.results ?? [];
          if (bars.length > 0) {
            const spyStart = bars[0].c;
            const portfolioStart = snaps[0].total_value;
            if (spyStart && spyStart > 0) {
              // Normalize SPY to start at the same value as portfolio
              spyData = bars.map(bar => {
                try {
                  const d = bar.t ? new Date(bar.t) : null;
                  if (!d || isNaN(d.getTime())) return null;
                  return {
                    date: d.toISOString().split('T')[0],
                    spy_value: portfolioStart > 0 ? parseFloat((portfolioStart * (bar.c / spyStart)).toFixed(2)) : bar.c,
                  };
                } catch { return null; }
              }).filter(Boolean);
            }
          }
        }
      } catch (e) { console.error('[Portfolio] SPY benchmark fetch failed:', e.message); }
    }

    res.json({ snapshots: snaps, spyBenchmark: spyData });
  } catch (err) {
    console.error('[Portfolio] /snapshots endpoint failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/portfolio/snapshot — take a snapshot right now
router.post('/snapshot', requireAuth, rateLimit(5), async (req, res) => {
  try {
    const today = todayStr();

    // Check if already snapshotted today
    const { data: existing } = await supabase.from('portfolio_snapshots').select('id').eq('user_id', req.user.id).eq('date', today).maybeSingle();
    if (existing) return res.json({ success: true, message: 'Already snapshotted today', alreadyExists: true });

    const { data: positions } = await supabase.from('positions').select('ticker,shares,avg_cost').eq('user_id', req.user.id);
    if (!positions?.length) return res.status(400).json({ error: 'No positions to snapshot' });

    const tickers = positions.map(p => p.ticker);
    const priceMap = getPrices(tickers);

    let totalValue = 0;
    let totalCost = 0;
    let pricedCount = 0;
    for (const p of positions) {
      const live = priceMap[p.ticker]?.price;
      if (live) {
        totalValue += live * (p.shares ?? 0);
        pricedCount++;
      } else {
        // Use cost basis as fallback but track that it's stale
        totalValue += (p.avg_cost ?? 0) * (p.shares ?? 0);
      }
      totalCost += (p.avg_cost ?? 0) * (p.shares ?? 0);
    }

    // Don't snapshot if we couldn't get ANY live prices — the data would be meaningless
    if (pricedCount === 0) return res.status(400).json({ error: 'No live prices available — try again in a moment' });
    if (totalValue <= 0) return res.status(400).json({ error: 'Portfolio value is zero — check your positions' });

    const totalPnl = totalValue - totalCost;
    const { error: insertErr } = await supabase.from('portfolio_snapshots').insert({
      user_id: req.user.id,
      total_value: parseFloat(totalValue.toFixed(2)),
      total_pnl: parseFloat(totalPnl.toFixed(2)),
      date: today,
    });

    // Handle duplicate gracefully (unique constraint on user_id + date)
    if (insertErr?.code === '23505') {
      return res.json({ success: true, message: 'Already snapshotted today', alreadyExists: true });
    }
    if (insertErr) throw insertErr;

    res.json({ success: true, totalValue: parseFloat(totalValue.toFixed(2)), totalPnl: parseFloat(totalPnl.toFixed(2)) });
  } catch (err) {
    console.error('[Portfolio] /snapshot POST endpoint failed:', err.message);
    res.status(500).json({ error: 'Snapshot failed' });
  }
});

// GET /api/portfolio/stock-details/:ticker — fundamentals + analyst ratings
router.get('/stock-details/:ticker', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const ticker = sanitizeTicker(req.params.ticker);
    if (!ticker) return res.status(400).json({ error: 'Valid ticker required' });

    const [financials, analyst] = await Promise.allSettled([
      getFinancials(ticker),
      getAnalystRating(ticker),
    ]);

    trackFeature('stock_details', req.user.id);
    res.json({
      financials: financials.status === 'fulfilled' ? financials.value : null,
      analyst: analyst.status === 'fulfilled' ? analyst.value : null,
    });
  } catch (err) {
    console.error('[Portfolio] /stock-details endpoint failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch stock details' });
  }
});

router.get('/analyses', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const today = todayStr();
    const { data: analyses } = await supabase.from('portfolio_analyses').select('*').eq('user_id', req.user.id).eq('date', today).order('generated_at', { ascending: false });
    res.json({ analyses: analyses ?? [] });
  } catch (err) {
    console.error('[Portfolio] /analyses endpoint failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/portfolio/performance — comprehensive performance report with benchmarks
router.get('/performance', requireAuth, rateLimit(5), async (req, res) => {
  try {
    // Fetch snapshots, positions, and closed trades in parallel
    const [snapshotsResult, positionsResult, tradesResult] = await Promise.allSettled([
      supabase.from('portfolio_snapshots').select('*').eq('user_id', req.user.id).order('date', { ascending: true }).limit(90),
      supabase.from('positions').select('*').eq('user_id', req.user.id),
      supabase.from('closed_trades').select('*').eq('user_id', req.user.id).order('closed_at', { ascending: false }).limit(100),
    ]);

    const snapshots = snapshotsResult.status === 'fulfilled' ? (snapshotsResult.value.data ?? []) : [];
    const positions = positionsResult.status === 'fulfilled' ? (positionsResult.value.data ?? []) : [];
    const closedTrades = tradesResult.status === 'fulfilled' ? (tradesResult.value.data ?? []) : [];

    // Enrich positions with live prices
    const tickers = positions.map(p => p.ticker);
    const priceMap = tickers.length > 0 ? getPrices(tickers) : {};

    let totalValue = 0, totalCost = 0, todayChange = 0;
    const enrichedPositions = positions.map(p => {
      const live = priceMap[p.ticker];
      const currentPrice = live?.price ?? p.avg_cost ?? 0;
      const currentValue = currentPrice * (p.shares ?? 0);
      const costBasis = (p.avg_cost ?? 0) * (p.shares ?? 0);
      const pnl = currentValue - costBasis;
      const dayChange = (live?.changePercent ?? 0) / 100 * currentValue;
      totalValue += currentValue;
      totalCost += costBasis;
      todayChange += dayChange;
      return { ticker: p.ticker, shares: p.shares, avgCost: p.avg_cost, currentPrice, currentValue, pnl, pnlPercent: costBasis > 0 ? (pnl / costBasis) * 100 : 0 };
    });

    const totalPnl = totalValue - totalCost;
    const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    // Calculate time-period returns from snapshots
    const periodReturns = calculatePeriodReturns(snapshots);

    // Fetch SPY benchmark for comparison
    let benchmark = null;
    if (snapshots.length >= 2) {
      try {
        const fromDate = snapshots[0].date;
        const toDate = snapshots[snapshots.length - 1].date;
        const spyUrl = `https://api.polygon.io/v2/aggs/ticker/SPY/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&apiKey=${config.polygonKey}`;
        const spyRes = await fetch(spyUrl);
        if (spyRes.ok) {
          const spyJson = await spyRes.json();
          const bars = spyJson?.results ?? [];
          if (bars.length >= 2) {
            const spyStart = bars[0].c;
            const spyEnd = bars[bars.length - 1].c;
            if (spyStart && spyStart > 0) {
              const spyReturn = ((spyEnd - spyStart) / spyStart) * 100;
              const portfolioStart = snapshots[0].total_value;
              const portfolioEnd = snapshots[snapshots.length - 1].total_value;
              const portfolioReturn = portfolioStart > 0 ? ((portfolioEnd - portfolioStart) / portfolioStart) * 100 : 0;

              benchmark = {
                spy: parseFloat(spyReturn.toFixed(2)),
                portfolio: parseFloat(portfolioReturn.toFixed(2)),
                alpha: parseFloat((portfolioReturn - spyReturn).toFixed(2)),
                period: `${fromDate} to ${toDate}`,
                outperforming: portfolioReturn > spyReturn,
              };
            }
          }
        }
      } catch (e) { console.error('[Portfolio] SPY benchmark fetch failed:', e.message); }
    }

    // Trade stats
    const winners = closedTrades.filter(t => t.pnl > 0);
    const losers = closedTrades.filter(t => t.pnl < 0);
    const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.pnl_percent, 0) / winners.length : 0;
    const avgLoss = losers.length > 0 ? losers.reduce((s, t) => s + t.pnl_percent, 0) / losers.length : 0;
    const totalRealizedPnl = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);

    res.json({
      portfolio: {
        totalValue: parseFloat(totalValue.toFixed(2)),
        totalCost: parseFloat(totalCost.toFixed(2)),
        totalPnl: parseFloat(totalPnl.toFixed(2)),
        totalPnlPercent: parseFloat(totalPnlPercent.toFixed(2)),
        todayChange: parseFloat(todayChange.toFixed(2)),
        positionCount: positions.length,
      },
      periodReturns,
      benchmark,
      tradeStats: {
        totalTrades: closedTrades.length,
        winRate: closedTrades.length > 0 ? parseFloat(((winners.length / closedTrades.length) * 100).toFixed(1)) : 0,
        avgWinPercent: parseFloat(avgWin.toFixed(2)),
        avgLossPercent: parseFloat(avgLoss.toFixed(2)),
        profitFactor: Math.abs(avgLoss) > 0 ? parseFloat((avgWin / Math.abs(avgLoss)).toFixed(2)) : 0,
        totalRealizedPnl: parseFloat(totalRealizedPnl.toFixed(2)),
        avgHoldDays: closedTrades.length > 0 ? Math.round(closedTrades.reduce((s, t) => s + (t.hold_days ?? 0), 0) / closedTrades.length) : 0,
      },
      topPerformers: enrichedPositions.filter(p => p.pnl > 0).sort((a, b) => b.pnlPercent - a.pnlPercent).slice(0, 3),
      worstPerformers: enrichedPositions.filter(p => p.pnl < 0).sort((a, b) => a.pnlPercent - b.pnlPercent).slice(0, 3),
    });
  } catch (err) {
    console.error('[Portfolio] /performance endpoint failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

function calculatePeriodReturns(snapshots) {
  if (snapshots.length < 2) return null;

  const latest = snapshots[snapshots.length - 1];
  const returns = {};

  // Helper to find snapshot closest to N days ago
  const findSnapshot = (daysAgo) => {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - daysAgo);
    const targetStr = targetDate.toISOString().split('T')[0];
    // Find closest snapshot on or before target date
    for (let i = snapshots.length - 1; i >= 0; i--) {
      if (snapshots[i].date <= targetStr) return snapshots[i];
    }
    return null;
  };

  const periods = [
    { key: 'week', days: 7 },
    { key: 'month', days: 30 },
    { key: 'threeMonth', days: 90 },
  ];

  for (const { key, days } of periods) {
    const snap = findSnapshot(days);
    if (snap && snap.total_value > 0) {
      const ret = ((latest.total_value - snap.total_value) / snap.total_value) * 100;
      returns[key] = parseFloat(ret.toFixed(2));
    }
  }

  // All-time
  if (snapshots[0].total_value > 0) {
    returns.allTime = parseFloat(((latest.total_value - snapshots[0].total_value) / snapshots[0].total_value * 100).toFixed(2));
  }

  return returns;
}

// GET /api/portfolio/tax-insights — tax analysis for the user
router.get('/tax-insights', requireAuth, rateLimit(5), async (req, res) => {
  try {
    const insights = await getTaxInsights(req.user.id);
    res.json(insights);
  } catch (err) {
    console.error('[Portfolio] /tax-insights endpoint failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/portfolio/plan-adherence — compares stated trade plans vs actual exits
router.get('/plan-adherence', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const data = await getPlanAdherence(req.user.id);
    res.json(data);
  } catch (err) {
    console.error('[Portfolio] /plan-adherence endpoint failed:', err.message);
    res.status(500).json({ error: 'Failed to load plan adherence' });
  }
});

// GET /api/portfolio/performance-attribution — pattern recognition over closed + open trades
router.get('/performance-attribution', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const data = await getPerformanceAttribution(req.user.id);
    res.json(data);
  } catch (err) {
    console.error('[Portfolio] /performance-attribution endpoint failed:', err.message);
    res.status(500).json({ error: 'Failed to load performance attribution' });
  }
});

export default router;
