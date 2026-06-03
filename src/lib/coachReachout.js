// The coach reaching out first. A tracker waits for you to open it. We watch for
// the hard moments, a brutal day, a rough stretch, and surface a steadying word on
// Home before you break, with one tap into the coach. Being there before you ask is
// the difference between a tool and a corner man.
//
// Pure and deterministic: given how today and the week are going, decide whether to
// reach out and with what words. Tuned to fire only on genuinely hard moments, so
// it stays a kind hand on the shoulder, not noise on every red candle.

/**
 * @param {{ todayChangePct?: number|null, weekChangePct?: number|null }} signals
 * @returns {{ show: boolean, tone?: 'hard'|'soft', message?: string }}
 */
export function buildCoachReachout({ todayChangePct = null, weekChangePct = null } = {}) {
  const today = Number.isFinite(todayChangePct) ? todayChangePct : null;
  const week = Number.isFinite(weekChangePct) ? weekChangePct : null;

  // Most acute first, so a brutal day leads over a merely rough week.
  if (today != null && today <= -4) {
    return { show: true, tone: 'hard', message: `Down ${Math.abs(Math.round(today))}% today. Days like this are loud, and the urge to do something is strong. Want to talk it through before you act?` };
  }
  if (week != null && week <= -8) {
    return { show: true, tone: 'hard', message: `A rough stretch, down about ${Math.abs(Math.round(week))}% this week. You do not have to sit with it alone. Want to talk?` };
  }
  if (today != null && today <= -2.5) {
    return { show: true, tone: 'soft', message: `Red day, down ${Math.abs(Math.round(today))}%. If it is weighing on you, I am here.` };
  }
  return { show: false };
}
