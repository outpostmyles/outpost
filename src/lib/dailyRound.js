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

const OPPORTUNITY_TYPES = new Set(['bargain', 'catalyst', 'heat', 'watch']);

function clean(s) { return (s == null ? '' : String(s)).trim(); }
function upper(s) { return clean(s).toUpperCase(); }

// Pick the one contextual "get sharper" prompt. Order is deliberate: the most
// valuable, lowest-effort ask first (a missing thesis feeds the edge stats),
// then a genuine insight from their own record, then nothing at all. We never
// invent a task just to have one.
function chooseSharpen(positions, attribution) {
  const noThesis = (positions || []).find(p => p && p.ticker && !clean(p.entry_thesis));
  if (noThesis) {
    return {
      kind: 'thesis',
      ticker: upper(noThesis.ticker),
      positionId: noThesis.id ?? null,
      prompt: `You hold ${upper(noThesis.ticker)} but never wrote down why. One line, what's the thesis?`,
    };
  }

  const thesis = attribution?.patterns?.thesis;
  const lift = thesis?.lift;
  const withR = thesis?.with?.winRate;
  const withoutR = thesis?.without?.winRate;
  if (lift != null && Math.abs(lift) >= 10 && withR != null && withoutR != null) {
    return {
      kind: 'insight',
      prompt: `You win ${Math.round(withR)}% of trades when you write a thesis first, ${Math.round(withoutR)}% when you don't. Worth remembering today.`,
    };
  }

  const sc = attribution?.scorecard;
  if (sc && sc.avgHoldWinners != null && sc.avgHoldLosers != null
      && sc.wins >= 2 && sc.losses >= 2 && sc.avgHoldLosers > sc.avgHoldWinners * 1.3) {
    return {
      kind: 'insight',
      prompt: `You hold losers about ${sc.avgHoldLosers} days but winners only ${sc.avgHoldWinners}. The plan beats the hope.`,
    };
  }

  return { kind: 'none', prompt: '' };
}

export function buildRound({ todayItems = [], positions = [], attribution = null } = {}) {
  const items = (todayItems || []).filter(Boolean);
  const held = new Set((positions || []).filter(Boolean).map(p => upper(p.ticker)));

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
      checked: (positions || []).filter(Boolean).length,
    },
    opportunity,
    sharpen: chooseSharpen(positions, attribution),
  };
}
