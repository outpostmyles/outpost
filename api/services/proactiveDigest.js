/**
 * Proactive AI Digest — scans a user's portfolio + watchlist + adherence patterns
 * and surfaces what the agent noticed without being asked. Generated once daily.
 *
 * Signal kinds (priority order):
 *   high   — position_below_stop, position_past_target, big_mover (>=10%)
 *   medium — position_near_stop, position_near_target, concentration_warn,
 *            watchlist_alert, big_mover (>=5%)
 *   low    — adherence_pattern (when applicable to current open positions)
 *
 * Claude Haiku turns the raw signals into a 3-5 sentence morning read.
 * If there are zero signals, returns a "quiet day" placeholder.
 *
 * Cost profile: ~$0.001 per generation, one per user per day. Cached for 24h.
 */

import { supabase } from '../db.js';
import { getPrices } from './pricePool.js';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { todayStr } from '../utils/marketHours.js';
import { recordClaudeUsage } from './aiUsage.js';

const anthropic = new Anthropic({ apiKey: config.anthropicKey });
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';

// Tunables
const NEAR_PCT = 10;          // within 10% of stated target/stop = "near"
const CONCENTRATION_PCT = 25; // single position ≥ 25% of portfolio
const BIG_MOVE_PCT = 5;       // |dayChangePct| ≥ 5%
const WATCHLIST_NEAR_PCT = 5; // within 5% of stated alert price
const PROSE_TIMEOUT_MS = 20000;

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * Pure signal detection. No external calls. Exported for unit tests.
 *
 * @param {object} input
 * @param {Array} input.positions   — enriched with currentPrice, currentValue, todayChangePercent
 * @param {Array} input.watchlist   — raw watchlist rows with last_price, alert_price
 * @param {string} input.adherenceSummary — pre-formatted plan-adherence summary string ('' if not applicable)
 * @returns {Array<{kind,ticker?,priority,detail}>}
 */
export function detectSignals({ positions = [], watchlist = [], adherenceSummary = '' }) {
  const signals = [];

  const totalValue = positions.reduce((sum, p) => sum + (p.currentValue ?? 0), 0);

  for (const p of positions) {
    const live = p.currentPrice;
    if (!live || live <= 0) continue;
    const target = numOrNull(p.price_target);
    const stop = numOrNull(p.stop_loss);
    const dayPct = p.todayChangePercent ?? 0;
    const positionValue = p.currentValue ?? (live * (p.shares ?? 0));

    // Big mover (high priority if ≥10%, medium otherwise)
    if (Math.abs(dayPct) >= BIG_MOVE_PCT) {
      signals.push({
        kind: 'big_mover',
        ticker: p.ticker,
        priority: Math.abs(dayPct) >= 10 ? 'high' : 'medium',
        detail: `${p.ticker} ${dayPct > 0 ? 'up' : 'down'} ${Math.abs(dayPct).toFixed(1)}% today (your $${positionValue.toFixed(0)} position)`,
      });
    }

    // Target proximity
    if (target && target > 0) {
      const distPct = ((target - live) / live) * 100;
      if (distPct < 0) {
        signals.push({
          kind: 'position_past_target',
          ticker: p.ticker,
          priority: 'high',
          detail: `${p.ticker} broke past your $${target} target — now $${live.toFixed(2)} (+${Math.abs(distPct).toFixed(1)}% past target). Take some off, or let it run?`,
        });
      } else if (distPct <= NEAR_PCT) {
        signals.push({
          kind: 'position_near_target',
          ticker: p.ticker,
          priority: 'medium',
          detail: `${p.ticker} is ${distPct.toFixed(1)}% from your $${target} target.`,
        });
      }
    }

    // Stop proximity
    if (stop && stop > 0) {
      if (live < stop) {
        const breachPct = ((stop - live) / stop) * 100;
        signals.push({
          kind: 'position_below_stop',
          ticker: p.ticker,
          priority: 'high',
          detail: `${p.ticker} broke below your $${stop} stop — now $${live.toFixed(2)} (${breachPct.toFixed(1)}% past stop). Your plan said exit here.`,
        });
      } else {
        const distPct = ((live - stop) / live) * 100;
        if (distPct <= NEAR_PCT) {
          signals.push({
            kind: 'position_near_stop',
            ticker: p.ticker,
            priority: 'high',
            detail: `${p.ticker} is ${distPct.toFixed(1)}% above your $${stop} stop.`,
          });
        }
      }
    }

    // Concentration
    if (totalValue > 0) {
      const concPct = (positionValue / totalValue) * 100;
      if (concPct >= CONCENTRATION_PCT) {
        signals.push({
          kind: 'concentration_warn',
          ticker: p.ticker,
          priority: 'medium',
          detail: `${p.ticker} is ${concPct.toFixed(0)}% of your portfolio. One bad day on one ticker hits hard.`,
        });
      }
    }
  }

  // Watchlist alerts
  for (const w of watchlist) {
    const alertPrice = numOrNull(w.alert_price);
    const lastPrice = numOrNull(w.last_price);
    if (!alertPrice || !lastPrice) continue;
    const distPct = Math.abs(((alertPrice - lastPrice) / alertPrice) * 100);
    if (distPct <= WATCHLIST_NEAR_PCT) {
      signals.push({
        kind: 'watchlist_alert',
        ticker: w.ticker,
        priority: 'medium',
        detail: `${w.ticker} on your watchlist is at $${lastPrice.toFixed(2)}, near your $${alertPrice} target.`,
      });
    }
  }

  // Plan adherence pattern (single low-priority signal — only if open positions could repeat the pattern)
  if (adherenceSummary && positions.length > 0) {
    signals.push({
      kind: 'adherence_pattern',
      priority: 'low',
      detail: adherenceSummary,
    });
  }

  // Sort: high → medium → low
  signals.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  return signals;
}

/**
 * Generate a fresh digest for one user. Uses live data + Claude Haiku.
 */
// Gather the day's signals for a user WITHOUT generating prose. Shared by the
// in-app proactive opener so it sees exactly the same signals the morning digest
// would. (Mirrors the fetch in generateDigestForUser; kept separate so the
// production digest path is left untouched.)
// A saved screen that turned up new names the user has not seen becomes a
// low-priority opener nudge, so the agent can walk them through it. Returns one
// signal (the screen with the most new names) or null. This is the pull side of
// living screens: the screen works overnight, and the agent reaches out about it.
async function buildScreenerSignal(userId) {
  try {
    const { data: screens } = await supabase.from('screeners').select('name, query, results').eq('user_id', userId);
    const withNew = (screens ?? []).map(s => {
      const tickers = (Array.isArray(s.results) ? s.results : []).filter(r => r.isNew).map(r => r.ticker).filter(Boolean);
      return { name: s.name || s.query, tickers };
    }).filter(s => s.tickers.length > 0).sort((a, b) => b.tickers.length - a.tickers.length);
    if (!withNew.length) return null;
    const s = withNew[0];
    const n = s.tickers.length;
    const names = s.tickers.slice(0, 3).join(', ');
    return { kind: 'screener_new', priority: 1, detail: `Your "${s.name}" screen turned up ${n} new name${n === 1 ? '' : 's'} since you last looked: ${names}` };
  } catch { return null; }
}

export async function gatherSignalsForUser(userId) {
  const [posRes, watchRes] = await Promise.allSettled([
    supabase.from('positions').select('*').eq('user_id', userId),
    supabase.from('watchlist').select('*').eq('user_id', userId),
  ]);
  const rawPositions = posRes.status === 'fulfilled' ? (posRes.value.data ?? []) : [];
  const watchlistRows = watchRes.status === 'fulfilled' ? (watchRes.value.data ?? []) : [];

  const screenerSignal = await buildScreenerSignal(userId);

  if (rawPositions.length === 0) {
    return { signals: screenerSignal ? [screenerSignal] : [], hasPositions: false };
  }

  const tickers = rawPositions.map(p => p.ticker);
  const priceMap = getPrices(tickers);
  const positions = rawPositions.map(p => {
    const live = priceMap[p.ticker]?.price ?? 0;
    return { ...p, currentPrice: live, currentValue: live * (p.shares ?? 0), todayChangePercent: priceMap[p.ticker]?.changePercent ?? 0 };
  });
  const watchlist = watchlistRows.map(w => ({ ...w, last_price: priceMap[w.ticker]?.price ?? w.last_price }));

  let adherenceSummary = '';
  try {
    const { getAdherenceSummaryForAgent } = await import('./planAdherence.js');
    const raw = await getAdherenceSummaryForAgent(userId);
    if (raw) adherenceSummary = raw.replace(/^PLAN ADHERENCE PATTERNS[^:]*: /, '').replace(/\.$/, '');
  } catch {}

  const signals = detectSignals({ positions, watchlist, adherenceSummary });
  if (screenerSignal) signals.push(screenerSignal); // lowest priority: a position alert always wins the opener
  return { signals, hasPositions: true };
}

export async function generateDigestForUser(userId) {
  // Pull positions + watchlist in parallel
  const [posRes, watchRes] = await Promise.allSettled([
    supabase.from('positions').select('*').eq('user_id', userId),
    supabase.from('watchlist').select('*').eq('user_id', userId),
  ]);
  const rawPositions = posRes.status === 'fulfilled' ? (posRes.value.data ?? []) : [];
  const watchlistRows = watchRes.status === 'fulfilled' ? (watchRes.value.data ?? []) : [];

  if (rawPositions.length === 0) {
    return {
      available: false,
      reason: 'Add a position and the agent will start watching it for you overnight.',
      generatedAt: new Date().toISOString(),
    };
  }

  // Enrich with live prices
  const tickers = rawPositions.map(p => p.ticker);
  const priceMap = getPrices(tickers);
  const positions = rawPositions.map(p => {
    const live = priceMap[p.ticker]?.price ?? 0;
    return {
      ...p,
      currentPrice: live,
      currentValue: live * (p.shares ?? 0),
      todayChangePercent: priceMap[p.ticker]?.changePercent ?? 0,
    };
  });

  // Enrich watchlist with live prices too (the social/watchlist endpoint does this on read,
  // but the cron path needs it inline)
  const watchlist = watchlistRows.map(w => {
    const live = priceMap[w.ticker]?.price ?? w.last_price;
    return { ...w, last_price: live };
  });

  // Plan adherence summary — one-liner that the digest can fold in
  let adherenceSummary = '';
  try {
    const { getAdherenceSummaryForAgent } = await import('./planAdherence.js');
    const raw = await getAdherenceSummaryForAgent(userId);
    if (raw) adherenceSummary = raw.replace(/^PLAN ADHERENCE PATTERNS[^:]*: /, '').replace(/\.$/, '');
  } catch {}

  const signals = detectSignals({ positions, watchlist, adherenceSummary });

  // Quiet day — no prose generation needed
  if (signals.length === 0) {
    return {
      available: true,
      digest: 'Nothing pressing across your positions today. Quiet days are fine — sometimes the best trade is no trade.',
      signals: [],
      quiet: true,
      generatedAt: new Date().toISOString(),
    };
  }

  // Build prose via Claude Haiku
  const signalLines = signals.slice(0, 8).map((s, i) => `${i + 1}. ${s.detail}`).join('\n');

  let prose;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROSE_TIMEOUT_MS);
  try {
    const msg = await anthropic.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 350,
      system: `You are writing a personal morning digest for a trader — what their watchful AI partner noticed about their portfolio while they slept. The trader sees this once a day.

RULES:
1. 3-5 sentences max. Conversational, like a sharp friend who actually watched the tape.
2. Lead with the most actionable signal first (broken stops, broken targets, big movers).
3. Reference specific tickers and numbers from the signals — never "some of your positions". Say which ones.
4. End with ONE concrete observation or question, not a list. Like "worth checking the AMD news" or "are you taking some off?" Never "be careful" alone.
5. Plain text only. No markdown, asterisks, headers, bullets.
6. Tone: direct, observant, slightly informal. Not corporate, not preachy.
7. Do NOT prefix with "Good morning" or any greeting — the UI provides the framing.`,
      messages: [{
        role: 'user',
        content: `Today's noticed signals (already sorted by priority):\n\n${signalLines}\n\nWrite the morning digest now.`,
      }],
    }, { signal: controller.signal });
    recordClaudeUsage({ feature: 'proactive_digest', model: msg.model, usage: msg.usage, userId });
    prose = msg.content[0].text.trim();
  } catch (err) {
    console.error('[ProactiveDigest] Claude call failed:', err.message);
    // Fallback: return the top 3 signals as standalone lines
    prose = signals.slice(0, 3).map(s => s.detail).join(' ');
  } finally {
    clearTimeout(timeout);
  }

  return {
    available: true,
    digest: prose,
    signals,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get cached digest for today, generating if missing (or if force=true).
 */
export async function getDigestForUser(userId, force = false) {
  const cacheKey = `proactive_digest_${userId}_${todayStr()}`;

  if (!force) {
    try {
      const { data: cached } = await supabase
        .from('ai_cache')
        .select('result, created_at')
        .eq('cache_key', cacheKey)
        .maybeSingle();
      if (cached?.result) {
        try {
          return { ...JSON.parse(cached.result), cached: true };
        } catch {}
      }
    } catch {}
  }

  const fresh = await generateDigestForUser(userId);

  // Persist (best-effort; failure here doesn't break the response)
  try {
    const payload = JSON.stringify(fresh);
    const { data: existing } = await supabase
      .from('ai_cache').select('id').eq('cache_key', cacheKey).maybeSingle();
    if (existing) {
      await supabase.from('ai_cache')
        .update({ result: payload, created_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase.from('ai_cache')
        .insert({ cache_key: cacheKey, result: payload, created_at: new Date().toISOString() });
    }
  } catch (err) {
    console.error('[ProactiveDigest] Cache write failed:', err.message);
  }

  return fresh;
}

/**
 * Cron entry — generate digests for all active users (last login ≤ 7 days).
 * Called from runner.js at 7:00 AM ET on weekdays.
 */
export async function generateAllDigests() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: users } = await supabase
    .from('user_profiles')
    .select('id')
    .gt('last_login', sevenDaysAgo);
  if (!users?.length) {
    console.log('[ProactiveDigest] No active users to generate for');
    return;
  }

  let generated = 0;
  let quiet = 0;
  for (const u of users) {
    try {
      const result = await getDigestForUser(u.id, true);
      if (result.available) {
        if (result.quiet) quiet++;
        else generated++;
      }
    } catch (err) {
      console.error(`[ProactiveDigest] Failed for ${u.id}:`, err.message);
    }
  }
  console.log(`[ProactiveDigest] ${generated} digests + ${quiet} quiet across ${users.length} active users`);
}

// ---- helpers ----

function numOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
