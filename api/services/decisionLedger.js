// The decision ledger, IO layer.
//
// recordDecision is the single capture point: it snapshots the market context at
// the moment of a decision and writes one immutable row. It is FAIL-SAFE: any
// error (including the table not existing because the migration has not been run)
// is swallowed and logged, so a user action is NEVER broken by the ledger. The
// pure brain (src/lib/decisionLedger.js) does all the analysis; this file only
// reads and writes.
import { supabase } from '../db.js';
import { getMarketData } from './marketData.js';
import { getPrices } from './pricePool.js';
import { summarizeDecisions, detectBehaviorPatterns, gradeDecision, aggregateRetail, aggregateBehavior, decisionQualityIndex, aggregateQuality, adviceLift, pctOfBookForDecision, setupBaseRates, formatUserPatterns } from '../../src/lib/decisionLedger.js';
import { buildTraderModel, formatTraderModel } from '../../src/lib/traderModel.js';
import { summarizeCounterfactuals, formatCounterfactual } from '../../src/lib/counterfactual.js';
import { classifyEmotion } from '../../src/lib/emotionRead.js';

const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

// Map a DB row (snake_case) to the normalized shape the pure brain expects.
function rowToDecision(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    type: r.type,
    ticker: r.ticker,
    shares: num(r.shares),
    price: num(r.price),
    thesis: r.thesis ?? null,
    source: r.source ?? null,
    aiAdvice: r.ai_advice ?? null,
    pctOfBook: num(r.pct_of_book),
    todayChangePct: num(r.today_change_pct),
    marketRegime: r.market_regime ?? null,
    vix: num(r.vix),
    fearGreed: num(r.fear_greed),
    spyPrice: num(r.spy_price),
    composure: num(r.composure),
    outcomeStatus: r.outcome_status ?? null,
    outcomePnl: num(r.outcome_pnl),
    outcomePnlPct: num(r.outcome_pnl_pct),
    outcomeHoldDays: num(r.outcome_hold_days),
    thesisPlayedOut: r.thesis_played_out ?? null,
    resolvedAt: r.resolved_at ?? null,
    createdAt: r.created_at ?? null,
  };
}

// Snapshot the market backdrop right now. Cheap (in-memory regime + pooled SPY).
function marketContext() {
  try {
    const m = getMarketData();
    const spy = getPrices(['SPY'])?.SPY?.price ?? null;
    return { regime: m?.regime ?? null, vix: num(m?.vix?.value), fearGreed: num(m?.fearGreed?.value), spy: num(spy) };
  } catch { return { regime: null, vix: null, fearGreed: null, spy: null }; }
}

/**
 * Record one decision. `d` is camelCase: { type, ticker, shares, price, thesis,
 * source, aiAdvice, pctOfBook, outcomeStatus, outcomePnl, outcomePnlPct,
 * outcomeHoldDays, thesisPlayedOut, meta }. Context (regime/vix/fg/spy and the
 * ticker's today move) is snapshotted here. Never throws.
 */
export async function recordDecision(userId, d) {
  if (!userId || !d?.type) return null;
  try {
    const ctx = marketContext();
    // The ticker's move on the day, to catch chasing. Best-effort from the pool.
    let todayChangePct = num(d.todayChangePct);
    if (todayChangePct == null && d.ticker) {
      todayChangePct = num(getPrices([d.ticker])?.[d.ticker]?.changePercent);
    }

    // How big this position is in the book, so the size-based grade and the
    // "betting too big" pattern actually fire. Computed from the user's current
    // holdings; best-effort, never blocks (this runs fire-and-forget).
    let pctOfBook = num(d.pctOfBook);
    if (pctOfBook == null && d.ticker) {
      try {
        const { data: positions } = await supabase.from('positions').select('ticker, shares').eq('user_id', userId);
        const tickers = [...new Set([...(positions ?? []).map(p => p.ticker), d.ticker])];
        const prices = tickers.length ? getPrices(tickers) : {};
        pctOfBook = pctOfBookForDecision({ ticker: d.ticker, price: d.price, shares: d.shares, type: d.type }, positions ?? [], prices);
      } catch { /* leave null */ }
    }
    // Frontier #5: tag the emotional shape of this decision (FOMO / panic) from the
    // snapshot, so the Machine can see how much of someone's trading is emotional.
    const emotion = classifyEmotion({ type: d.type, ticker: d.ticker, todayChangePct }, { regime: ctx.regime, fearGreed: ctx.fearGreed });
    const row = {
      user_id: userId,
      type: d.type,
      ticker: d.ticker ? String(d.ticker).toUpperCase() : null,
      shares: num(d.shares),
      price: num(d.price),
      thesis: d.thesis ? String(d.thesis).slice(0, 2000) : null,
      source: d.source ?? null,
      ai_advice: d.aiAdvice ? String(d.aiAdvice).slice(0, 2000) : null,
      pct_of_book: pctOfBook,
      today_change_pct: todayChangePct,
      market_regime: ctx.regime,
      vix: ctx.vix,
      fear_greed: ctx.fearGreed,
      spy_price: ctx.spy,
      composure: num(d.composure),
      outcome_status: d.outcomeStatus ?? null,
      outcome_pnl: num(d.outcomePnl),
      outcome_pnl_pct: num(d.outcomePnlPct),
      outcome_hold_days: num(d.outcomeHoldDays),
      thesis_played_out: d.thesisPlayedOut ?? null,
      resolved_at: d.outcomeStatus ? new Date().toISOString() : null,
      meta: emotion.kind !== 'calm' ? { ...(d.meta || {}), emotion: emotion.kind } : (d.meta ?? null),
      created_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('decisions').insert(row);
    if (error) {
      // Almost always "relation decisions does not exist" before the migration
      // is run. Log once-ish and move on; never break the user's action.
      console.warn('[DecisionLedger] capture skipped:', error.message);
      return null;
    }
    return true;
  } catch (e) {
    console.warn('[DecisionLedger] capture failed:', e.message);
    return null;
  }
}

const statusFromPnl = (pnl) => (pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'even');

/**
 * Close the loop: when a position is sold, stamp the outcome onto the user's
 * still-open buy decisions for that ticker, so the original BUY gets graded by
 * how it actually turned out. Fail-safe.
 */
export async function resolveOpenDecisions(userId, ticker, { pnl, pnlPercent, holdDays, thesisPlayedOut } = {}) {
  if (!userId || !ticker) return;
  try {
    await supabase.from('decisions')
      .update({
        outcome_status: statusFromPnl(num(pnl) ?? 0),
        outcome_pnl: num(pnl),
        outcome_pnl_pct: num(pnlPercent),
        outcome_hold_days: num(holdDays),
        thesis_played_out: thesisPlayedOut ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('ticker', String(ticker).toUpperCase())
      .is('outcome_status', null)
      .in('type', ['open', 'add']);
  } catch (e) {
    console.warn('[DecisionLedger] resolve failed:', e.message);
  }
}

/** A user's own ledger, newest first. Returns [] (never throws) if unavailable. */
export async function getUserDecisions(userId, { limit = 500 } = {}) {
  try {
    const { data } = await supabase.from('decisions')
      .select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(limit);
    return (data ?? []).map(rowToDecision).filter(Boolean);
  } catch { return []; }
}

/** The user's "receipts": their decisions, summary, behavioral patterns, and a
 *  per-decision grade on the most recent few. */
export async function getUserReceipts(userId) {
  const decisions = await getUserDecisions(userId);
  return {
    summary: summarizeDecisions(decisions),
    quality: decisionQualityIndex(decisions),
    patterns: detectBehaviorPatterns(decisions),
    recent: decisions.slice(0, 25).map(d => ({ ...d, grade: gradeDecision(d) })),
  };
}

const INTEL_KEY = 'decision_intelligence';
const INTEL_TTL_MS = 6 * 3600 * 1000; // serve a cached build for up to 6 hours

const EMPTY_INTEL = (days) => ({
  windowDays: days, totalDecisions: 0, tickersTracked: 0, crowded: [], retailTraps: [],
  behavior: { totalUsers: 0, patterns: [] },
  quality: { users: 0, scored: 0, avgIndex: null },
  adviceLift: { advised: { n: 0, winRate: null }, selfDirected: { n: 0, winRate: null }, lift: null },
  baseRates: { overall: { setup: 'all buys', n: 0, winRate: null }, buckets: [] },
});

// THE MACHINE: pull the ledger and roll it into the whole intelligence picture
// (crowding, behavior, the objective, the reward, and the setup base rates). One
// place so the live read and the scheduled build can never diverge.
async function computeFromDb({ days = 30, limit = 20000 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data } = await supabase.from('decisions')
    .select('user_id, type, ticker, thesis, source, pct_of_book, today_change_pct, market_regime, outcome_status, outcome_pnl_pct, outcome_hold_days, thesis_played_out, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false }).limit(limit);
  const decisions = (data ?? []).map(rowToDecision).filter(Boolean);
  return {
    windowDays: days,
    ...aggregateRetail(decisions),
    behavior: aggregateBehavior(decisions),
    quality: aggregateQuality(decisions),   // the objective: are users getting better
    adviceLift: adviceLift(decisions),       // the reward: does our advice help
    baseRates: setupBaseRates(decisions),    // the institutional edge: per-setup win rates
    generatedAt: new Date().toISOString(),
  };
}

async function writeIntel(payload) {
  try {
    const { data: existing } = await supabase.from('ai_cache').select('id').eq('cache_key', INTEL_KEY).maybeSingle();
    const row = { result: JSON.stringify(payload), created_at: payload.generatedAt };
    if (existing) await supabase.from('ai_cache').update(row).eq('id', existing.id);
    else await supabase.from('ai_cache').insert({ cache_key: INTEL_KEY, ...row });
  } catch { /* cache is best-effort */ }
}

/**
 * The nightly job: recompute the whole intelligence picture and cache it. The
 * jobs runner calls this so reads are instant and the data is never older than a
 * day. Returns the payload.
 */
export async function buildDecisionIntelligence() {
  const payload = await computeFromDb({ days: 30 });
  await writeIntel(payload);
  return payload;
}

/**
 * Read-only: the last cached intelligence build, or null. For consumers like the
 * pre-trade check that need the base rates cheaply and must never trigger a heavy
 * recompute on a user's hot path.
 */
export async function getCachedIntelligence() {
  try {
    const { data } = await supabase.from('ai_cache').select('result').eq('cache_key', INTEL_KEY).maybeSingle();
    return data?.result ? JSON.parse(data.result) : null;
  } catch { return null; }
}

/**
 * A compact "this trader's real patterns" block for the agent's context (decision
 * quality + top self-sabotage habits), or '' when there is no graded history.
 * Fail-safe: the agent never breaks or invents a pattern that is not there.
 */
export async function getUserPatternBlock(userId) {
  try {
    const decisions = await getUserDecisions(userId, { limit: 500 });
    const patterns = formatUserPatterns({
      quality: decisionQualityIndex(decisions),
      patterns: detectBehaviorPatterns(decisions),
    });
    // Frontier #4: their specific edge and leak, so the agent coaches from where
    // THIS person makes money vs bleeds, not just generic self-sabotage flags.
    const model = formatTraderModel(buildTraderModel(decisions));
    // Frontier #3: what their recent selling actually cost or saved vs holding,
    // computed against live prices. Makes "cutting winners" a real dollar figure.
    let counterfactual = '';
    const sells = decisions.filter(d => (d.type === 'close' || d.type === 'trim') && d.ticker).slice(0, 40);
    if (sells.length >= 2) {
      const tickers = [...new Set(sells.map(d => d.ticker))];
      counterfactual = formatCounterfactual(summarizeCounterfactuals(sells, tickers.length ? getPrices(tickers) : {}));
    }
    return [patterns, model, counterfactual].filter(Boolean).join('\n\n');
  } catch { return ''; }
}

/**
 * The founder read. Cache-first (serves the last build for up to 6h), recomputes
 * and warms the cache on a miss, so the first visit after a deploy is correct and
 * every visit after is instant. Never throws.
 */
export async function getAggregate({ days = 30 } = {}) {
  try {
    const { data: cached } = await supabase.from('ai_cache')
      .select('result, created_at').eq('cache_key', INTEL_KEY).maybeSingle();
    if (cached?.result && cached?.created_at && (Date.now() - new Date(cached.created_at).getTime()) < INTEL_TTL_MS) {
      try { return { ...JSON.parse(cached.result), cached: true }; } catch { /* recompute below */ }
    }
    const payload = await computeFromDb({ days });
    writeIntel(payload).catch(() => {});
    return payload;
  } catch {
    return EMPTY_INTEL(days);
  }
}
