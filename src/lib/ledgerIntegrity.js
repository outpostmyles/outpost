// LEDGER INTEGRITY: keep the reward signal honest about its own bias.
//
// The base rates and the advice-lift number are computed over RESOLVED decisions
// only (a buy resolves when the user sells). But the user chooses when to sell, and
// that choice correlates with the outcome: the app itself detects that retail cuts
// winners fast and holds losers. So the resolved set is skewed toward realized
// winners while the losers sit unresolved. Every resolved-only win rate is biased
// HIGH, and the advice-lift comparison breaks if advised and self-directed trades
// resolve at different rates.
//
// This module does not "fix" the bias (you cannot, without forcing sells). It
// MEASURES it, so the founder brief can caveat a number instead of trusting it
// blind. Pure and point-in-time: pass `now` so it is deterministic and never reads
// the future. Founder-internal; nothing here is shown to a user.
import { AI_SOURCES } from './decisionLedger.js';

const AI_SET = new Set(AI_SOURCES);
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const opensOnly = (decisions) => (Array.isArray(decisions) ? decisions : []).filter(d => d?.type === 'open' || d?.type === 'add');

/**
 * How much of the user's buying has actually resolved, and how old the unresolved
 * pile is. The unresolved age is the tell: positions held well past how long the
 * user holds winners are disproportionately losers being held.
 */
export function resolutionProfile(decisions, { now = 0 } = {}) {
  const list = opensOnly(decisions);
  const resolved = list.filter(d => d?.outcomeStatus);
  const unresolved = list.filter(d => !d?.outcomeStatus);
  const ages = unresolved
    .map(d => Date.parse(d?.createdAt))
    .filter(t => Number.isFinite(t))
    .map(t => (now - t) / 86400000)
    .filter(a => a >= 0)
    .sort((a, b) => a - b);
  const median = ages.length ? ages[Math.floor((ages.length - 1) / 2)] : null;
  return {
    total: list.length,
    resolved: resolved.length,
    unresolved: unresolved.length,
    resolutionRate: list.length ? resolved.length / list.length : null,
    unresolvedMedianAgeDays: median == null ? null : Math.round(median),
  };
}

/**
 * Is the resolved-only win rate biased high right now? It is when resolution is
 * incomplete AND the unresolved pile has aged past how long the user holds winners
 * (so those positions are likely held losers, not yet realized as losses).
 * Conservative: needs a real resolved sample and a pile at least two weeks old, so
 * it never cries bias on noise.
 */
export function winRateBias(decisions, { now = 0, minSample = 6 } = {}) {
  const opens = opensOnly(decisions);
  const resolved = opens.filter(d => d?.outcomeStatus);
  const wins = resolved.filter(d => d.outcomeStatus === 'win');
  const losses = resolved.filter(d => d.outcomeStatus === 'loss');
  const prof = resolutionProfile(opens, { now });

  const out = {
    resolutionRate: prof.resolutionRate == null ? null : Math.round(prof.resolutionRate * 100),
    resolved: resolved.length,
    unresolved: prof.unresolved,
    unresolvedMedianAgeDays: prof.unresolvedMedianAgeDays,
    resolvedWinHoldDays: null,
    resolvedLossHoldDays: null,
    biasedHigh: false,
    why: '',
  };
  if (resolved.length < minSample) { out.why = 'too few resolved buys to judge bias yet.'; return out; }

  const avgHold = (g) => { const v = g.map(d => num(d.outcomeHoldDays)).filter(n => n != null); return v.length ? v.reduce((s, n) => s + n, 0) / v.length : null; };
  const winHold = avgHold(wins);
  const lossHold = avgHold(losses);
  out.resolvedWinHoldDays = winHold == null ? null : Math.round(winHold);
  out.resolvedLossHoldDays = lossHold == null ? null : Math.round(lossHold);

  const lowResolution = prof.resolutionRate != null && prof.resolutionRate < 0.6 && prof.unresolved >= 3;
  const agingPile = winHold != null
    && prof.unresolvedMedianAgeDays != null
    && prof.unresolvedMedianAgeDays >= 14
    && prof.unresolvedMedianAgeDays > winHold * 1.5;

  if (lowResolution && agingPile) {
    out.biasedHigh = true;
    out.why = `${out.resolutionRate}% of buys are resolved, and the unresolved ones have aged ~${prof.unresolvedMedianAgeDays}d, well past the ~${out.resolvedWinHoldDays}d winners get held. Those are likely held losers, so the resolved win rate reads high.`;
  } else if (lowResolution) {
    out.why = `only ${out.resolutionRate}% of buys are resolved; the win rate is computed on the sold ones and may not represent the rest.`;
  } else {
    out.why = 'resolution looks complete enough to read the win rate close to face value.';
  }
  return out;
}

/**
 * Whether the advised-vs-self advice-lift comparison can be trusted. It cannot when
 * either group is thin, or when the two groups resolve at very different rates (then
 * one side has sold more of its winners and the comparison is not apples to apples).
 * Returns the per-group resolution rates plus a trust flag and a plain caveat.
 */
export function adviceLiftHonesty(decisions, { minSample = 5 } = {}) {
  const opens = opensOnly(decisions);
  const advised = opens.filter(d => AI_SET.has(d?.source));
  const self = opens.filter(d => !AI_SET.has(d?.source));
  const resolvedCount = (g) => g.filter(d => d?.outcomeStatus).length;
  const rate = (g) => g.length ? resolvedCount(g) / g.length : null;

  const advisedRes = rate(advised);
  const selfRes = rate(self);
  const advisedResolved = resolvedCount(advised);
  const selfResolved = resolvedCount(self);

  let trust = true;
  let caveat = '';
  if (advisedResolved < minSample || selfResolved < minSample) {
    trust = false;
    caveat = `thin: ${advisedResolved} advised and ${selfResolved} self-directed resolved, need ~${minSample} each.`;
  } else if (advisedRes != null && selfRes != null && Math.abs(advisedRes - selfRes) >= 0.25) {
    trust = false;
    const higher = advisedRes > selfRes ? 'advised' : 'self-directed';
    caveat = `the groups resolve at very different rates (advised ${Math.round(advisedRes * 100)}% vs self ${Math.round(selfRes * 100)}%); the ${higher} side has realized more of its book, so their win rates are not apples to apples.`;
  } else if ((advisedRes != null && advisedRes < 0.5) || (selfRes != null && selfRes < 0.5)) {
    trust = false;
    caveat = 'under half of one group is resolved, so both win rates are skewed toward sold winners.';
  }

  return {
    advisedResolution: advisedRes == null ? null : Math.round(advisedRes * 100),
    selfResolution: selfRes == null ? null : Math.round(selfRes * 100),
    advisedResolved,
    selfResolved,
    trust,
    caveat,
  };
}
