// The Coach: turns the scattered behavior stats (the Patterns scorecard and
// plan-adherence numbers) into plain-language coaching. Not more charts, a
// verdict: the single most important thing to fix, and the single best thing
// to keep doing. A real coach tells you the one thing, not ten.
//
// Pure synthesis over data the app already computes, so it is unit-testable.
// Inputs:
//   attribution = { scorecard, patterns: { thesis: { with, without, lift } } }
//   adherence   = { summary: { stopBreachCount, earlyExitCount, heldPastCount,
//                              honoredStopCount, tradesWithPlan, ... } }

import { detectRecurring } from './recurringPatterns.js';

function r0(n) { const x = Number(n); return Number.isFinite(x) ? Math.round(x) : null; }

export function buildCoaching(input) {
  const { attribution = null, adherence = null } = input || {};
  const sc = attribution?.scorecard || null;
  const thesis = attribution?.patterns?.thesis || null;
  const sum = adherence?.summary || null;

  const enough = (sc?.totalTrades ?? 0) >= 5 || (sum?.tradesWithPlan ?? 0) >= 3;
  if (!enough) return { hasEnough: false, fix: null, strength: null };

  // The one thing to fix, hardest-hitting first. A behavior that recurs across
  // months outranks everything else: it is a habit, not a slip.
  const recurring = detectRecurring(adherence?.byTrade);
  let fix = null;
  if (recurring) {
    fix = recurring.message;
  } else if (sum && sum.stopBreachCount >= 2) {
    fix = `You broke your own stop on ${sum.stopBreachCount} of ${sum.tradesWithPlan} planned trades. A stop only protects you if you actually take it.`;
  } else if (thesis && thesis.lift != null && thesis.lift >= 15 && thesis.with?.winRate != null && thesis.without?.winRate != null) {
    fix = `You win ${r0(thesis.with.winRate)}% of trades with a written thesis and ${r0(thesis.without.winRate)}% without one. Write the thesis on every entry.`;
  } else if (sum && sum.earlyExitCount >= 2) {
    fix = `You take profits early. On average you sold about ${r0(sum.earlyExitAvgGapPct)}% before your own target. Let the plan finish.`;
  } else if (sc && sc.avgHoldWinners != null && sc.avgHoldLosers != null && sc.wins >= 2 && sc.losses >= 2 && sc.avgHoldLosers > sc.avgHoldWinners * 1.3) {
    fix = `You hold losers about ${sc.avgHoldLosers} days and winners only ${sc.avgHoldWinners}. Cutting losers sooner is the cheapest edge there is.`;
  }

  // The one thing to keep doing.
  let strength = null;
  if (sum && sum.heldPastCount >= 2) {
    strength = `You let winners run. You held ${sum.heldPastCount} past your target for an extra ${r0(sum.heldPastAvgOvershootPct)}% on average. That is rare discipline.`;
  } else if (sum && sum.honoredStopCount > 0 && sum.stopBreachCount === 0) {
    strength = `You honor your stops. Every losing trade exited at the line you set. Keep doing exactly that.`;
  } else if (thesis && thesis.with?.winRate != null && thesis.with.winRate >= 60 && (thesis.with?.count ?? 0) >= 3) {
    strength = `Your thesis-first trades win ${r0(thesis.with.winRate)}%. That discipline is your edge, lean into it.`;
  } else if (sc && sc.winRate != null && sc.winRate >= 55) {
    strength = `A ${r0(sc.winRate)}% win rate over ${sc.totalTrades} trades. You pick more right than wrong.`;
  }

  return { hasEnough: true, fix, strength };
}
