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
import { summarizeDecisions, detectBehaviorPatterns, gradeDecision, aggregateRetail, aggregateBehavior, decisionQualityIndex, aggregateQuality, adviceLift, pctOfBookForDecision } from '../../src/lib/decisionLedger.js';

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
      meta: d.meta ?? null,
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

/** The founder-only anonymized aggregate across all users (crowding + traps). */
export async function getAggregate({ days = 30, limit = 5000 } = {}) {
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase.from('decisions')
      .select('user_id, type, ticker, thesis, source, pct_of_book, today_change_pct, outcome_status, outcome_pnl_pct, outcome_hold_days, thesis_played_out, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false }).limit(limit);
    const decisions = (data ?? []).map(rowToDecision).filter(Boolean);
    return {
      windowDays: days,
      ...aggregateRetail(decisions),
      behavior: aggregateBehavior(decisions),
      quality: aggregateQuality(decisions),   // the objective: are users getting better
      adviceLift: adviceLift(decisions),       // the reward: does our advice help
    };
  } catch (e) {
    return { windowDays: days, totalDecisions: 0, tickersTracked: 0, crowded: [], retailTraps: [], behavior: { totalUsers: 0, patterns: [] }, quality: { users: 0, scored: 0, avgIndex: null }, adviceLift: { advised: { n: 0, winRate: null }, selfDirected: { n: 0, winRate: null }, lift: null }, error: 'unavailable' };
  }
}
