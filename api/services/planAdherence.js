/**
 * Plan Adherence Service
 *
 * Compares stated trade plans (entry_thesis, price_target, stop_loss) against
 * actual exits in closed_trades. Surfaces patterns over time so users can see
 * how their actual behavior diverges from their stated rules.
 *
 * Categories per closed trade with a plan:
 *   - early_exit       — sold below target, but for a profit (took profits early)
 *   - held_past_target — sold above target (let winner run)
 *   - broke_stop       — sold below stop loss (didn't honor own rule)
 *   - honored_stop     — sold at/above stop loss for a loss
 *   - loss_no_stop     — loss with no stop set
 *   - profit_no_target — profit with no target set
 */

import { supabase } from '../db.js';

const MIN_TRADES_FOR_PATTERNS = 3;

/**
 * Get plan adherence analysis for a user.
 * Returns { summary, byTrade, patterns, hasEnoughData, message? }
 */
export async function getPlanAdherence(userId, limit = 50) {
  const { data: trades, error } = await supabase
    .from('closed_trades')
    .select('id, ticker, sell_price, avg_cost, pnl, pnl_percent, price_target, stop_loss, entry_thesis, exit_outcome, hold_days, closed_at')
    .eq('user_id', userId)
    .order('closed_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  if (!trades?.length) {
    return {
      summary: { totalTrades: 0, tradesWithPlan: 0 },
      byTrade: [],
      patterns: [],
      hasEnoughData: false,
      message: 'No closed trades yet — adherence patterns will surface as you build a track record.',
    };
  }

  // Per-trade analysis
  const byTrade = trades.map(analyzeTrade);

  // Filter to trades that had at least one plan field set
  const withPlan = byTrade.filter(t => t.hadPlan);
  const totalTrades = trades.length;
  const tradesWithPlan = withPlan.length;

  if (tradesWithPlan === 0) {
    return {
      summary: { totalTrades, tradesWithPlan: 0 },
      byTrade,
      patterns: [],
      hasEnoughData: false,
      message: 'You have closed trades but none with a stated price target or stop loss. Add plan fields when entering positions to see adherence patterns over time.',
    };
  }

  const summary = computeSummary(withPlan, totalTrades);
  const patterns = computePatterns(summary, withPlan);

  return {
    summary,
    byTrade,
    patterns,
    hasEnoughData: tradesWithPlan >= MIN_TRADES_FOR_PATTERNS,
  };
}

/**
 * Analyze a single trade against its plan. Pure function — exported for unit tests.
 */
export function analyzeTrade(t) {
  const target = numOrNull(t.price_target);
  const stop = numOrNull(t.stop_loss);
  const sell = numOrNull(t.sell_price);
  const hadTarget = target != null && target > 0;
  const hadStop = stop != null && stop > 0;
  const hadPlan = hadTarget || hadStop;
  const wasProfit = (t.pnl ?? 0) > 0;

  const base = {
    id: t.id,
    ticker: t.ticker,
    hadPlan,
    hadTarget,
    hadStop,
    pnl: t.pnl,
    pnlPercent: t.pnl_percent,
    sellPrice: sell,
    priceTarget: target,
    stopLoss: stop,
    closedAt: t.closed_at,
    entryThesis: t.entry_thesis,
    holdDays: t.hold_days,
    category: 'no_plan',
    detail: '',
    gapPct: null,
  };

  if (!hadPlan || sell == null) return base;

  // Decision tree — order matters. Stop breach is the most actionable, check first.
  if (hadStop && sell < stop) {
    base.category = 'broke_stop';
    base.gapPct = round2(((stop - sell) / stop) * 100);
    base.detail = `broke stop at $${stop}, exited at $${sell.toFixed(2)} (${base.gapPct.toFixed(1)}% past stop)`;
    return base;
  }

  if (hadTarget && sell >= target) {
    base.category = 'held_past_target';
    base.gapPct = round2(((sell - target) / target) * 100);
    base.detail = `held past $${target} target, exited at $${sell.toFixed(2)} (+${base.gapPct.toFixed(1)}%)`;
    return base;
  }

  if (hadTarget && wasProfit) {
    base.category = 'early_exit';
    base.gapPct = round2(((target - sell) / target) * 100);
    base.detail = `exited at $${sell.toFixed(2)}, ${base.gapPct.toFixed(1)}% before $${target} target`;
    return base;
  }

  if (hadStop && !wasProfit) {
    base.category = 'honored_stop';
    base.detail = `honored stop, exited at $${sell.toFixed(2)}`;
    return base;
  }

  if (hadTarget && !wasProfit) {
    base.category = 'loss_no_stop';
    base.detail = `loss without a stop set`;
    return base;
  }

  // Profit with no target was set
  base.category = 'profit_no_target';
  base.detail = `profit, no target set`;
  return base;
}

/**
 * Compute aggregate summary across trades with plans.
 */
export function computeSummary(withPlan, totalTrades = withPlan.length) {
  const total = withPlan.length;
  const earlyExits = withPlan.filter(t => t.category === 'early_exit');
  const heldPast = withPlan.filter(t => t.category === 'held_past_target');
  const stopBreaches = withPlan.filter(t => t.category === 'broke_stop');
  const honoredStops = withPlan.filter(t => t.category === 'honored_stop');

  const avgGap = (arr) => arr.length > 0
    ? round2(arr.reduce((s, t) => s + (t.gapPct ?? 0), 0) / arr.length)
    : 0;

  // Win rate when plan was honored vs not.
  // Honored = took profit at/past target OR honored stop.
  // Not honored = took profit early OR broke stop.
  const honoredTrades = withPlan.filter(t =>
    t.category === 'held_past_target' || t.category === 'honored_stop'
  );
  const violatedTrades = withPlan.filter(t =>
    t.category === 'early_exit' || t.category === 'broke_stop'
  );
  const honoredWinRate = honoredTrades.length > 0
    ? round2((honoredTrades.filter(t => (t.pnl ?? 0) > 0).length / honoredTrades.length) * 100)
    : null;
  const violatedWinRate = violatedTrades.length > 0
    ? round2((violatedTrades.filter(t => (t.pnl ?? 0) > 0).length / violatedTrades.length) * 100)
    : null;

  return {
    totalTrades,
    tradesWithPlan: total,
    earlyExitCount: earlyExits.length,
    earlyExitAvgGapPct: avgGap(earlyExits),
    heldPastCount: heldPast.length,
    heldPastAvgOvershootPct: avgGap(heldPast),
    stopBreachCount: stopBreaches.length,
    stopBreachAvgPct: avgGap(stopBreaches),
    honoredStopCount: honoredStops.length,
    honoredWinRate,
    violatedWinRate,
  };
}

/**
 * Surface up to 3 actionable patterns based on the summary.
 * Order by impact: stop breaches > early exits > held past > honored.
 */
export function computePatterns(summary, withPlan) {
  const patterns = [];
  const total = summary.tradesWithPlan;
  if (total < MIN_TRADES_FOR_PATTERNS) return patterns;

  // Stop breaches — most actionable, lead here
  if (summary.stopBreachCount >= 2 || (summary.stopBreachCount > 0 && summary.stopBreachCount / total >= 0.2)) {
    patterns.push({
      key: 'stop_breaches',
      severity: 'warning',
      headline: `Broke stop on ${summary.stopBreachCount} of ${total} trades`,
      detail: `Average ${summary.stopBreachAvgPct.toFixed(1)}% past your stated stop. Stops only protect you if you actually take them.`,
    });
  }

  // Early exits
  if (summary.earlyExitCount >= 2 || (summary.earlyExitCount > 0 && summary.earlyExitCount / total >= 0.3)) {
    patterns.push({
      key: 'early_exits',
      severity: 'info',
      headline: `Took profits early on ${summary.earlyExitCount} of ${total} trades`,
      detail: `Average ${summary.earlyExitAvgGapPct.toFixed(1)}% before your stated target. Could be discipline; could also be leaving money on the table.`,
    });
  }

  // Held past target — positive pattern worth reinforcing
  if (summary.heldPastCount >= 2) {
    patterns.push({
      key: 'held_past',
      severity: 'positive',
      headline: `Held ${summary.heldPastCount} winners past target`,
      detail: `Captured an extra ${summary.heldPastAvgOvershootPct.toFixed(1)}% on average. Letting winners run.`,
    });
  }

  // Honored stops cleanly — positive
  if (summary.honoredStopCount > 0 && summary.stopBreachCount === 0 && total >= MIN_TRADES_FOR_PATTERNS) {
    patterns.push({
      key: 'honored_stops',
      severity: 'positive',
      headline: `Honored stop on all ${summary.honoredStopCount} losing trades`,
      detail: `Disciplined risk management — keep it up.`,
    });
  }

  // Win-rate gap when plan honored vs not
  if (summary.honoredWinRate != null && summary.violatedWinRate != null) {
    const gap = summary.honoredWinRate - summary.violatedWinRate;
    if (Math.abs(gap) >= 15) {
      patterns.push({
        key: 'win_rate_gap',
        severity: gap > 0 ? 'positive' : 'warning',
        headline: gap > 0
          ? `Win rate ${summary.honoredWinRate.toFixed(0)}% when honoring plan vs ${summary.violatedWinRate.toFixed(0)}% when not`
          : `Win rate ${summary.violatedWinRate.toFixed(0)}% when violating plan vs ${summary.honoredWinRate.toFixed(0)}% when honoring`,
        detail: gap > 0
          ? `${Math.abs(gap).toFixed(0)}-point edge from sticking to your own rules.`
          : `Surprising — you've done better breaking your plan than honoring it. Either your plans are too conservative or the sample is too small.`,
      });
    }
  }

  return patterns.slice(0, 3);
}

/**
 * Compact summary for the agent's context block.
 * Returns a single-line string or '' if not enough data.
 */
export async function getAdherenceSummaryForAgent(userId) {
  try {
    const { summary, hasEnoughData } = await getPlanAdherence(userId, 20);
    if (!hasEnoughData) return '';
    const parts = [];
    if (summary.earlyExitCount > 0) {
      parts.push(`takes profits early on ${summary.earlyExitCount}/${summary.tradesWithPlan} trades (avg ${summary.earlyExitAvgGapPct.toFixed(0)}% before target)`);
    }
    if (summary.stopBreachCount > 0) {
      parts.push(`broke stop on ${summary.stopBreachCount}/${summary.tradesWithPlan}`);
    }
    if (summary.heldPastCount > 0) {
      parts.push(`held past target ${summary.heldPastCount}x (captured +${summary.heldPastAvgOvershootPct.toFixed(0)}% avg)`);
    }
    if (parts.length === 0) return '';
    return `PLAN ADHERENCE PATTERNS (use to ground feedback in their actual behavior, not generic advice): ${parts.join('; ')}.`;
  } catch {
    return '';
  }
}

// ---- helpers ----

function numOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function round2(n) {
  return parseFloat(n.toFixed(2));
}
