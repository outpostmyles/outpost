// The Progress page as a process scorecard. Pros grade themselves on HOW they
// traded (did I have a reason, did I size right, did I cut losers), not on whether
// it paid off, which is partly luck. Outpost already computes all of that in the
// decision ledger; this turns the receipts into a small, friendly view-model: one
// grade, one thing you are nailing, one thing to work on, and the trend. No form
// to fill, it is derived from the trades themselves. Pure and testable.

const letterFor = (n) => (n >= 85 ? 'A' : n >= 70 ? 'B' : n >= 55 ? 'C' : n >= 40 ? 'D' : 'F');

// The one positive process habit to reflect back, strongest first. Always returns
// something encouraging, even for a brand-new trader.
function pickStrength(summary, patterns) {
  const has = (k) => patterns.some(p => p.key === k);
  if ((summary.thesisCoverage ?? 0) >= 60) return `You write a reason on ${summary.thesisCoverage}% of your buys. That is the habit that compounds.`;
  if (patterns.length && !has('chasing')) return `You are not chasing green days. Buying calm is rare, and it pays.`;
  if ((summary.oversizedRate ?? 100) <= 20 && (summary.total ?? 0) >= 4) return `You keep your positions sized sanely, so one bad day never wrecks you.`;
  if (summary.trend === 'improving') return `Your process is trending up. Whatever you changed, keep doing it.`;
  return `You are showing up and logging your decisions. That alone puts you ahead of most.`;
}

/**
 * @param receipts { summary, quality, patterns, recent } from getUserReceipts
 * @returns a scorecard view-model the Progress tab renders
 */
export function buildProcessScorecard(receipts) {
  const quality = receipts?.quality || {};
  const summary = receipts?.summary || {};
  const patterns = Array.isArray(receipts?.patterns) ? [...receipts.patterns] : [];

  if (quality.index == null) {
    return {
      hasData: false,
      title: 'Your process score is coming',
      body: 'Make a few buys and sells, and Outpost grades HOW you traded: did you have a reason, did you size it right, did you cut the loser fast. Not whether it paid off, that part is partly luck. Process is the piece you control.',
    };
  }

  patterns.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));
  const focus = patterns[0]
    ? { label: patterns[0].label, stat: patterns[0].stat, detail: patterns[0].detail }
    : { label: 'Nothing major', stat: 'no self-sabotage pattern showing', detail: 'Keep your process consistent and the score takes care of itself.' };

  const sample = quality.sample ?? summary.total ?? 0;
  return {
    hasData: true,
    // On a thin record we have a number but not the right to slap a hard letter on
    // someone for three trades. Provisional softens the presentation (no scarlet F)
    // and reads as a starting line until there is a real track record.
    provisional: sample < 10,
    score: quality.index,
    letter: letterFor(quality.index),
    trend: quality.trend || 'flat',                 // improving | slipping | flat
    winRate: summary.winRate ?? null,               // shown small, secondary to process
    sample,
    strength: pickStrength(summary, patterns),
    focus,
  };
}
