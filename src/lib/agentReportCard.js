// The founder Report Card: one synthesized weekly verdict that sits on top of
// the raw founder dashboard. It answers three questions at a glance (did the
// agent land with users, was it accurate, what did it cost) plus the single most
// important thing to look at this week. Every input is data the app already
// captures; this layer only synthesizes it.
//
// FOUNDER-ONLY. Like the rest of the founder surface this is observation only:
// it never reaches a user and nothing here changes the app until the founder
// decides. It is deliberately honest about thin data, so a quiet pre-beta week
// reads as "too early to grade", never as a false "all good".
//
// Pure and testable. The dashboard gathers the inputs and renders the output.

const PRE_BETA_USERS = 25;

function num(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

// Map a value to a state band. Default is higher-is-better; pass invert:true for
// lower-is-better signals like a flag rate.
function band(value, { good, warn, invert = false }) {
  if (value == null) return 'none';
  if (invert) return value <= good ? 'good' : value <= warn ? 'warn' : 'bad';
  return value >= good ? 'good' : value >= warn ? 'warn' : 'bad';
}

/**
 * Build the report card from already-gathered dashboard signals. Never throws.
 * @param {object} signals
 *   approvalRate7d, thumbsUp7d, thumbsDown7d  user thumbs (7d)
 *   qualityTrend { graded, flaggedPct, recent:{graded,flaggedPct}, flagRateDelta }  grader output
 *   adviceLift { lift, advised:{n}, selfDirected:{n} }  the reward signal
 *   projectedMonthly, cost7d  AI spend
 *   errors7d, active7d, totalUsers  operations + scale
 *   topObservation  the #1 "what to look at" line from the founder brief
 * @returns { status, statusLabel, headline, vitals[], topAction, sample }
 */
export function buildAgentReportCard(signals = {}) {
  const s = signals || {};
  const thumbsUp = num(s.thumbsUp7d) || 0;
  const thumbsDown = num(s.thumbsDown7d) || 0;
  const votes = thumbsUp + thumbsDown;
  const approval = num(s.approvalRate7d);

  const qt = s.qualityTrend || {};
  const recentGraded = num(qt.recent?.graded) || 0;
  const graded = num(qt.graded) || 0;
  // Prefer the recent (7d) flag rate when there is a recent sample, else fall
  // back to the whole window so a low-traffic week still reads something.
  const flaggedPct = recentGraded >= 5 ? num(qt.recent?.flaggedPct)
    : graded > 0 ? num(qt.flaggedPct) : null;
  const gradedForState = recentGraded >= 5 ? recentGraded : graded;

  const lift = s.adviceLift || {};
  const liftN = (num(lift.advised?.n) || 0) + (num(lift.selfDirected?.n) || 0);
  const liftPts = liftN >= 10 ? num(lift.lift) : null;

  const projectedMonthly = num(s.projectedMonthly);
  const cost7d = num(s.cost7d);
  const errors7d = num(s.errors7d) || 0;
  const totalUsers = num(s.totalUsers) || 0;
  const active7d = num(s.active7d) || 0;
  const preBeta = totalUsers < PRE_BETA_USERS;

  // Each vital needs a real sample before it grades, so we never react to noise.
  const landedState = votes >= 5 ? band(approval, { good: 70, warn: 50 }) : 'none';
  const accuracyState = gradedForState >= 10 ? band(flaggedPct, { good: 10, warn: 25, invert: true }) : 'none';
  const helpingState = liftPts == null ? 'none' : liftPts > 0 ? 'good' : liftPts < 0 ? 'bad' : 'warn';
  const costState = projectedMonthly == null ? 'none' : projectedMonthly >= 100 ? 'warn' : 'good';

  const vitals = [
    {
      key: 'landed', label: 'Did it land',
      value: votes >= 5 && approval != null ? `${approval}%` : 'no votes yet',
      sub: votes >= 5 ? `${thumbsUp} up, ${thumbsDown} down, 7d` : `${votes} of 5 thumbs needed`,
      state: landedState,
    },
    {
      key: 'accurate', label: 'Was it accurate',
      value: gradedForState >= 10 && flaggedPct != null ? `${Math.max(0, 100 - flaggedPct)}% clean` : 'too few graded',
      sub: gradedForState >= 10 ? `${flaggedPct}% flagged of ${gradedForState} graded` : `${gradedForState} of 10 graded needed`,
      state: accuracyState,
    },
    {
      key: 'helping', label: 'Is it helping',
      value: liftPts != null ? `${liftPts >= 0 ? '+' : ''}${liftPts} pts` : 'too thin',
      sub: liftPts != null ? `advised vs self, ${liftN} resolved` : `${liftN} of 10 resolved needed`,
      state: helpingState,
    },
    {
      key: 'cost', label: 'What it costs',
      value: projectedMonthly != null ? `$${Math.round(projectedMonthly)}/mo` : 'nothing yet',
      sub: cost7d != null ? `$${cost7d.toFixed(2)} last 7d` : 'projected from 7d',
      state: costState,
    },
  ];

  const hasSignal = votes >= 5 || gradedForState >= 10 || liftPts != null;

  // Pre-beta data is sparse and partly seeded, so we never present it as a real
  // verdict no matter how much volume the seed creates. The vitals still compute
  // (a wiring check that the machine works end to end), but the card stays in the
  // neutral tone and says it is seeded, matching the founder brief's discipline.
  // Only once we are past pre-beta do the real verdict bands kick in.
  let status, statusLabel;
  if (preBeta) {
    status = 'thin';
    statusLabel = hasSignal ? 'Pre-beta (seeded)' : 'Too early to grade';
  } else if (vitals.some(v => v.state === 'bad') || errors7d >= 10) {
    status = 'attention';
    statusLabel = 'Needs you';
  } else if (vitals.some(v => v.state === 'warn') || errors7d > 0) {
    status = 'watch';
    statusLabel = 'Worth a look';
  } else {
    status = 'healthy';
    statusLabel = 'Healthy';
  }

  const headline = buildHeadline({
    status, preBeta, hasSignal, accuracyState, landedState, helpingState,
    approval, flaggedPct, liftPts, errors7d, votes, gradedForState,
  });

  return {
    status, statusLabel, headline,
    vitals,
    topAction: typeof s.topObservation === 'string' && s.topObservation.trim() ? s.topObservation.trim() : null,
    sample: { votes, graded: gradedForState, liftN, active7d, totalUsers, errors7d, preBeta },
  };
}

function buildHeadline({ status, preBeta, hasSignal, accuracyState, landedState, helpingState, approval, flaggedPct, liftPts, errors7d, votes, gradedForState }) {
  if (status === 'thin') {
    if (preBeta && hasSignal) {
      return 'These vitals compute on seeded, pre-beta data, so they confirm the machine works end to end but are not real signal yet. Real beta users are the unlock.';
    }
    return 'Not enough real usage to grade yet. The instruments are wired and reading, they just need beta traffic to mean anything.';
  }
  if (status === 'attention') {
    if (errors7d >= 10) return `Errors are elevated, ${errors7d} in the last 7 days. Check the logs before anything else.`;
    if (accuracyState === 'bad') return `Accuracy slipped this week, ${flaggedPct}% of graded reads were flagged. That is the thing to fix first.`;
    if (helpingState === 'bad') return `Advice lift went negative (${liftPts} pts). The recommendations need a rethink before you lean on them.`;
    if (landedState === 'bad') return `Approval is low, only ${approval}% of thumbs were up this week. Read the misses below.`;
    return 'Something needs your eyes this week. See the vitals below.';
  }
  if (status === 'watch') {
    if (accuracyState === 'warn') return `Mostly clean, but the flag rate is creeping, ${flaggedPct}% this week. Worth a glance at the worst surface.`;
    if (landedState === 'warn') return `Reads are landing okay, ${approval}% up, but not great. Read a few misses to see why.`;
    if (helpingState === 'warn') return 'Advice lift is flat this week. Not bad, not proven. Keep watching it.';
    return 'A couple of soft spots this week, nothing on fire. Glance at the vitals below.';
  }
  // healthy
  const clean = gradedForState >= 10 ? `no real accuracy flags across ${gradedForState} graded` : 'no errors';
  const thinBits = [];
  if (votes < 5) thinBits.push('approval');
  if (liftPts == null) thinBits.push('advice lift');
  const tail = thinBits.length
    ? ` ${cap(thinBits.join(' and '))} ${thinBits.length === 1 ? 'is' : 'are'} still too thin to read, so watch ${thinBits.length === 1 ? 'it' : 'them'} as traffic grows.`
    : ' All four vitals look good.';
  return `Clean week. ${cap(clean)}, and nothing on fire.${tail}`;
}

function cap(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : str; }
