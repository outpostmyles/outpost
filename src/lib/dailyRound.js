// Step-composition for the Daily Round.
//
// The round is a reframe of data the app already produces, not a new system. It
// takes the TODAY feed items, the user's positions, and their behavior-
// attribution, and sorts them into the round's narrative steps:
//   - safety:      the items that actually need a decision (alerts)
//   - opportunity: a rationed 1-2 ideas worth a look that they don't already hold
//   - sharpen:     one contextual, skippable ask, or nothing (never a nag)
//
// Standing (P&L + pulse) and the close screen are pure presentation, handled in
// the UI. This module is the decision logic, kept pure so it is unit-testable.

import { buildCoaching } from './coaching.js';

const OPPORTUNITY_TYPES = new Set(['bargain', 'catalyst', 'heat', 'watch']);

function clean(s) { return (s == null ? '' : String(s)).trim(); }
function upper(s) { return clean(s).toUpperCase(); }

// Pick the one contextual "get sharper" prompt. Order is deliberate: the most
// valuable, lowest-effort ask first (a missing thesis feeds the edge stats),
// then a genuine insight from their own record, then nothing at all. We never
// invent a task just to have one.
const DAY_MS = 86400000;
function hasReflection(t) {
  return !!(clean(t.reflection_lesson) || clean(t.reflection_what_happened) || clean(t.exit_reflection));
}

function chooseSharpen(positions, attribution, adherence, closedTrades, reflectedIds, nowMs) {
  // 1. A trade closed recently with no reflection logged: lock in the lesson
  //    while it's fresh. Highest priority, this is where getting better happens.
  const skip = new Set((Array.isArray(reflectedIds) ? reflectedIds : []).map(String));
  const recentUnreflected = (Array.isArray(closedTrades) ? closedTrades : [])
    .filter(t => t && t.id != null && t.ticker && !skip.has(String(t.id)) && !hasReflection(t))
    .filter(t => {
      const closed = t.closed_at ? Date.parse(t.closed_at) : NaN;
      return Number.isFinite(closed) && nowMs - closed >= 0 && nowMs - closed <= 10 * DAY_MS;
    })
    .sort((a, b) => Date.parse(b.closed_at) - Date.parse(a.closed_at));
  if (recentUnreflected[0]) {
    const t = recentUnreflected[0];
    return {
      kind: 'reflection',
      ticker: upper(t.ticker),
      tradeId: t.id,
      prompt: `You closed ${upper(t.ticker)} recently and never wrote down what you learned. Lock in the lesson while it's fresh?`,
    };
  }

  // 2. A holding with no written thesis.
  const noThesis = (Array.isArray(positions) ? positions : []).find(p => p && p.ticker && !clean(p.entry_thesis));
  if (noThesis) {
    return {
      kind: 'thesis',
      ticker: upper(noThesis.ticker),
      positionId: noThesis.id ?? null,
      prompt: `You hold ${upper(noThesis.ticker)} but never wrote down why. One line, what's the thesis?`,
    };
  }

  // 3. Otherwise the coach's read on their behavior (broke stops, early exits,
  //    thesis edge, hold-time skew), synthesized once in buildCoaching so the
  //    round and the Patterns coach card always say the same thing. We surface
  //    the fix first, then a strength, so a quiet round still ends on a nudge.
  const coaching = buildCoaching({ attribution, adherence });
  if (coaching.fix) return { kind: 'insight', prompt: coaching.fix };
  if (coaching.strength) return { kind: 'insight', prompt: coaching.strength };
  return { kind: 'none', prompt: '' };
}

export function buildRound(input) {
  const { todayItems = [], positions = [], attribution = null, adherence = null, closedTrades = [], reflectedIds = [], nowMs = Date.now() } = input || {};
  const items = (Array.isArray(todayItems) ? todayItems : []).filter(Boolean);
  const held = new Set((Array.isArray(positions) ? positions : []).filter(Boolean).map(p => upper(p.ticker)));

  // Safety: the "needs a decision" items. Alerts are exactly these (stop broken,
  // target hit, deep/moderate drawdown).
  const safetyItems = items.filter(it => it.type === 'alert');

  // Opportunity: ideas worth a look that they do not already hold. Rationed to
  // two so it is a daily dose, not a firehose. Highest priority first.
  const opportunity = items
    .filter(it => OPPORTUNITY_TYPES.has(it.type) && it.ticker && !held.has(upper(it.ticker)))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, 2);

  return {
    safety: {
      items: safetyItems,
      allClear: safetyItems.length === 0,
      checked: (Array.isArray(positions) ? positions : []).filter(Boolean).length,
    },
    opportunity,
    sharpen: chooseSharpen(positions, attribution, adherence, closedTrades, reflectedIds, nowMs),
  };
}
