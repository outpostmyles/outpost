// Behavior-outcome attribution: win rate cut by whether the user wrote a thesis,
// set a stop, set a target, or logged a reflection. The point is to make the
// discipline measurable, "my win rate is X% with a thesis vs Y% without", so the
// framework is shown, not preached.
//
// Honesty rules, learned the hard way:
//  - Need >= MIN_TRADES_FOR_ATTRIBUTION closed trades before showing anything.
//  - A cut is only "comparable" when BOTH sides have >= MIN_PER_BUCKET trades.
//    Otherwise one seeded losing trade with no thesis can manufacture a scary
//    "without a thesis loses" claim. Below the floor we say "nothing to compare
//    yet" rather than grade on noise.
//
// Pure and dependency-light (only the scorecard math) so it is unit-testable.

import { computeScorecard } from './tradeScorecard.js';

export const MIN_TRADES_FOR_ATTRIBUTION = 5;
export const MIN_PER_BUCKET = 5;

const round1 = (n) => parseFloat((Number(n) || 0).toFixed(1));

// Win rate + avg pnl% + avg hold for a subset of trades.
export function aggregate(trades) {
  if (!trades?.length) return { count: 0, winRate: null, avgPnlPercent: null, avgHoldDays: null };
  const wins = trades.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate = round1((wins / trades.length) * 100);
  const totalPnl = trades.reduce((s, t) => s + (t.pnl_percent ?? 0), 0);
  const avgPnlPercent = round1(totalPnl / trades.length);
  const withHold = trades.filter(t => t.hold_days != null);
  const avgHoldDays = withHold.length > 0
    ? Math.round(withHold.reduce((s, t) => s + (t.hold_days ?? 0), 0) / withHold.length)
    : null;
  return { count: trades.length, winRate, avgPnlPercent, avgHoldDays };
}

// Build one with/without cut. `comparable` gates BOTH the lift number AND whether
// the UI should render the comparison at all, so the two never disagree.
function buildCut(withArr, withoutArr) {
  const w = aggregate(withArr);
  const wo = aggregate(withoutArr);
  const comparable = w.count >= MIN_PER_BUCKET && wo.count >= MIN_PER_BUCKET;
  const lift = (comparable && w.winRate != null && wo.winRate != null)
    ? round1(w.winRate - wo.winRate)
    : null;
  return { with: w, without: wo, comparable, lift };
}

const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * @param trades closed_trades rows
 * @returns { ready:false, totalTrades, minRequired } when too few, otherwise
 *   { ready:true, totalTrades, minRequired, scorecard, patterns, execution }
 */
export function computeBehaviorPatterns(trades) {
  const all = (Array.isArray(trades) ? trades : []).filter(Boolean);
  if (all.length < MIN_TRADES_FOR_ATTRIBUTION) {
    return { ready: false, totalTrades: all.length, minRequired: MIN_TRADES_FOR_ATTRIBUTION };
  }

  const hasThesis = t => hasText(t.entry_thesis);
  const hasStop = t => t.stop_loss != null && t.stop_loss > 0;
  const hasTarget = t => t.price_target != null && t.price_target > 0;
  const hasReflection = t => hasText(t.exit_reflection) || hasText(t.reflection_lesson) || hasText(t.reflection_what_happened);

  const cut = (pred) => buildCut(all.filter(pred), all.filter(t => !pred(t)));

  return {
    ready: true,
    totalTrades: all.length,
    minRequired: MIN_TRADES_FOR_ATTRIBUTION,
    scorecard: computeScorecard(all),
    patterns: {
      thesis: cut(hasThesis),
      stopLoss: cut(hasStop),
      priceTarget: cut(hasTarget),
      reflection: cut(hasReflection),
    },
    execution: computeExecution(all),
  };
}

// Execution rating (1-5) summary: avg, distribution, and win rate when the user
// executed well (4-5) vs poorly (1-2). Null when fewer than 3 rated trades.
export function computeExecution(all) {
  const rated = all.filter(t => t.execution_rating != null);
  if (rated.length < 3) return null;
  const avg = rated.reduce((s, t) => s + t.execution_rating, 0) / rated.length;
  const distribution = [1, 2, 3, 4, 5].map(score => ({ score, count: rated.filter(t => t.execution_rating === score).length }));
  const whenHigh = aggregate(rated.filter(t => t.execution_rating >= 4));
  const whenLow = aggregate(rated.filter(t => t.execution_rating <= 2));
  return {
    rated: rated.length,
    unrated: all.length - rated.length,
    avgRating: parseFloat(avg.toFixed(2)),
    distribution,
    whenHigh,
    whenLow,
    lift: (whenHigh.winRate != null && whenLow.winRate != null && whenHigh.count >= 2 && whenLow.count >= 2)
      ? round1(whenHigh.winRate - whenLow.winRate)
      : null,
  };
}
