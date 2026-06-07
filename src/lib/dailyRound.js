// Step-composition for the Daily Round.
//
// The round is a reframe of data the app already produces, not a new system, and
// it is deliberately RUTHLESS about an experienced trader's time. It surfaces
// only what is about THEIR book and time-sensitive, and gets out of the way when
// nothing is:
//   - safety:      what needs your eyes today. Alerts (a real decision: stop
//                  broken, target hit, drawdown) first, then big moves on names
//                  you actually hold (what changed on your book), deduped by
//                  ticker. The round used to drop held movers entirely.
//   - opportunity: at most ONE idea worth a look that they do not already hold,
//                  rationed hard so the round is about their book, not a feed.
//   - sharpen:     one OPTIONAL ask, and only a reflection on a recent close
//                  (lock the lesson while it is fresh). Never manufactured: the
//                  thesis nudge lives in Home notices, the behavior insight in
//                  the morning digest, so the round never invents a task.
//
// Standing (P&L + pulse) is pure presentation, handled in the UI. This module is
// the decision logic, kept pure so it is unit-testable.

const OPPORTUNITY_TYPES = new Set(['bargain', 'catalyst', 'heat', 'watch']);
const DAY_MS = 86400000;

function clean(s) { return (s == null ? '' : String(s)).trim(); }
function upper(s) { return clean(s).toUpperCase(); }
function hasReflection(t) {
  return !!(clean(t.reflection_lesson) || clean(t.reflection_what_happened) || clean(t.exit_reflection));
}

// The one optional "get sharper" ask: ONLY a reflection on a recent close, the
// single time-sensitive ask where getting better actually happens. We never
// manufacture an ask, so a quiet round simply ends instead of inventing a task.
function chooseSharpen(closedTrades, reflectedIds, nowMs) {
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
  return { kind: 'none', prompt: '' };
}

export function buildRound(input) {
  const { todayItems = [], positions = [], closedTrades = [], reflectedIds = [], nowMs = Date.now() } = input || {};
  const items = (Array.isArray(todayItems) ? todayItems : []).filter(Boolean);
  const held = new Set((Array.isArray(positions) ? positions : []).filter(Boolean).map(p => upper(p.ticker)));

  // Needs your eyes: alerts (a decision) first, then big moves on names you hold.
  // A held name moving hard is exactly what an experienced trader wants flagged,
  // and the round used to drop it. Deduped by ticker so a stop break and its move
  // are never both listed.
  const alerts = items.filter(it => it.type === 'alert');
  const alertTickers = new Set(alerts.map(it => upper(it.ticker)).filter(Boolean));
  const movers = items
    .filter(it => it.type === 'mover' && it.ticker && !alertTickers.has(upper(it.ticker)))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const safetyItems = [...alerts, ...movers].slice(0, 6);

  // Opportunity: at most ONE idea worth a look they do not already hold. Rationed
  // hard (was two) so the round stays about their book, not a discovery firehose.
  const opportunity = items
    .filter(it => OPPORTUNITY_TYPES.has(it.type) && it.ticker && !held.has(upper(it.ticker)))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, 1);

  return {
    safety: {
      items: safetyItems,
      allClear: safetyItems.length === 0,
      checked: (Array.isArray(positions) ? positions : []).filter(Boolean).length,
    },
    opportunity,
    sharpen: chooseSharpen(closedTrades, reflectedIds, nowMs),
  };
}
