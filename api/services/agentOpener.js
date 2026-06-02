// The agent's proactive opener: turns the day's top signal (from detectSignals)
// into a short, conversational message that INVITES a reply. The point is to
// start the one thing that actually pulls users in, the conversation loop,
// instead of waiting for them to type. The other surfaces show information; the
// agent speaks it and asks a question back.
//
// Deliberately deterministic and instant: the opener is a cheap hook, the depth
// comes from the real agent (full context + tools) once the user replies. So we
// spend no AI latency on app open. Pure, so it is unit-testable.

const INVITES = {
  big_mover: "Want to dig into what's moving it?",
  position_past_target: 'Want to think through taking some off versus letting it run?',
  position_near_target: 'Want to think through whether to take profits or let it run?',
  position_below_stop: 'Want to talk through whether to honor the stop or hold?',
  position_near_stop: 'Want to game out your plan if it keeps sliding?',
  concentration_warn: 'Want to look at trimming it down?',
  watchlist_alert: 'Want to pressure-test the entry before it gets there?',
  adherence_pattern: 'Want to look at how to break that pattern?',
  screener_new: 'Want me to run through the new names with you?',
};

/**
 * Build the agent's proactive opener from the sorted signal list.
 * @param {Array} signals - output of detectSignals (already priority-sorted)
 * @param {object} [opts]
 * @param {boolean} [opts.hasPositions] - false when the user holds nothing yet
 * @returns {string} a conversational opener ending in a question
 */
export function buildAgentOpener(signals, { hasPositions = true } = {}) {
  const list = Array.isArray(signals) ? signals : [];

  if (list.length === 0) {
    return hasPositions
      ? "Quiet across your book today, nothing flashing red or sitting near a target. Anything on your mind? A position you're second-guessing, or a name you're weighing?"
      : "Once you add a few holdings I'll watch them and flag what actually matters. For now, what's on your radar?";
  }

  const top = list[0];
  const detail = String(top?.detail || '').trim();
  if (!detail) return "I noticed something worth a look on your book. Want to dig in?";

  const invite = INVITES[top.kind] || 'Want to think it through together?';
  // Don't stack two questions if the signal's detail already ends in one.
  return /\?\s*$/.test(detail) ? detail : `${detail} ${invite}`;
}
