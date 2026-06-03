// Decision memory: the tab remembers the calls you make, then grades them by what
// the price actually did since. Opening a position, adding, trimming, setting a
// stop, writing a thesis, exiting: each is a decision with a price and a date, and
// weeks later Outpost tells you how it played out. That closes the feedback loop
// retail never gets, and it turns the Portfolio tab into your story instead of a
// snapshot.
//
// It rides the continuity snapshots (which already capture the book's shape each
// visit): detecting a decision is a diff of two snapshots, grading it is a price
// comparison. Both pure and deterministic, so the track record is honest and free.

const signed = (n) => `${n >= 0 ? '+' : ''}${Math.round(n)}`;
const money = (n) => (Number.isFinite(n) ? `$${(+n).toFixed(2)}` : '');

/**
 * Diff two book snapshots into the decisions taken between them. Each event carries
 * the price at the time (px) so it can be graded later. Pure. `prior`/`curr` are
 * snapshotReadState outputs (holdings carry sh, stop, tgt, th, px).
 */
export function detectDecisions(prior, curr, at) {
  const events = [];
  const P = prior?.holdings, C = curr?.holdings;
  if (!C) return events;

  for (const t of Object.keys(C)) {
    const c = C[t], p = P?.[t];
    if (!p) { events.push({ kind: 'opened', ticker: t, at, px: c.px }); continue; }
    if (!p.th && c.th) events.push({ kind: 'wrote_thesis', ticker: t, at, px: c.px });
    if (!p.stop && c.stop) events.push({ kind: 'set_stop', ticker: t, at, px: c.px });
    if (!p.tgt && c.tgt) events.push({ kind: 'set_target', ticker: t, at, px: c.px });
    if (p.sh && c.sh && c.sh <= p.sh * 0.85) events.push({ kind: 'trim', ticker: t, at, px: c.px });
    else if (p.sh && c.sh && c.sh >= p.sh * 1.15) events.push({ kind: 'add', ticker: t, at, px: c.px });
  }
  if (P) for (const t of Object.keys(P)) {
    if (!C[t]) events.push({ kind: 'closed', ticker: t, at, px: P[t].px });
  }
  return events;
}

// One graded line per decision. `since` is the % move since the call; `tone`
// drives the color (good = the call is looking right, learn = a teachable miss,
// watch = needs an eye, neutral = too early or flat).
function gradeOne(ev, live, now) {
  const px = +ev?.px;
  const at = Date.parse(ev?.at);
  if (!ev?.ticker || !Number.isFinite(px) || px <= 0 || !Number.isFinite(live) || live <= 0 || !Number.isFinite(at)) return null;
  const since = ((live - px) / px) * 100;
  const ageDays = Math.max(0, Math.floor((now - at) / 86400000));
  const up = since >= 0;
  const s = `${signed(since)}%`;
  let text, tone;

  switch (ev.kind) {
    case 'opened':
      text = `You opened ${ev.ticker} near ${money(px)}. ${s} since.`;
      tone = since >= 5 ? 'good' : since <= -5 ? 'watch' : 'neutral';
      break;
    case 'add':
      text = `You added to ${ev.ticker} near ${money(px)}. ${s} since.`;
      tone = since >= 5 ? 'good' : since <= -5 ? 'watch' : 'neutral';
      break;
    case 'trim':
      text = since >= 5
        ? `You trimmed ${ev.ticker} near ${money(px)}. It is ${s} since, so that cut left some on the table.`
        : since <= -5
          ? `You trimmed ${ev.ticker} near ${money(px)}. It is ${s} since, a good cut.`
          : `You trimmed ${ev.ticker} near ${money(px)}. Roughly flat since.`;
      tone = since <= -5 ? 'good' : since >= 5 ? 'learn' : 'neutral';
      break;
    case 'set_stop':
      text = up
        ? `Your stop on ${ev.ticker} (set near ${money(px)}) has stayed clear, ${s} since.`
        : `${ev.ticker} is ${s} since you set your stop. Watch the line.`;
      tone = up ? 'good' : 'watch';
      break;
    case 'set_target':
      text = `You set a target on ${ev.ticker} near ${money(px)}. ${s} since.`;
      tone = since >= 5 ? 'good' : 'neutral';
      break;
    case 'wrote_thesis':
      text = `You wrote your ${ev.ticker} thesis near ${money(px)}. ${s} since.`;
      tone = since >= 5 ? 'good' : since <= -5 ? 'watch' : 'neutral';
      break;
    case 'closed':
      text = since >= 8
        ? `You exited ${ev.ticker} near ${money(px)}. It is ${s} since, it kept running.`
        : since <= -8
          ? `You exited ${ev.ticker} near ${money(px)}. It is ${s} since, you got out ahead of the drop.`
          : `You exited ${ev.ticker} near ${money(px)}. Roughly flat since.`;
      tone = since <= -8 ? 'good' : since >= 8 ? 'learn' : 'neutral';
      break;
    default:
      return null;
  }
  return { ticker: ev.ticker, kind: ev.kind, at: ev.at, since: Math.round(since), ageDays, text, tone };
}

/**
 * Grade a list of logged decisions against live prices. Returns the gradeable ones
 * newest first (capped), skipping any without a usable price. Pure.
 */
export function gradeDecisions(events, livePrices = {}, now = Date.now(), limit = 8) {
  const list = (Array.isArray(events) ? events : [])
    .map(ev => gradeOne(ev, +livePrices?.[ev?.ticker], now))
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return list.slice(0, limit);
}

/** A short, honest age label for a graded call ("today", "3d", "2w", "4mo"). */
export function callAge(ageDays) {
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 'today';
  if (ageDays < 7) return `${ageDays}d`;
  if (ageDays < 30) return `${Math.round(ageDays / 7)}w`;
  if (ageDays < 365) return `${Math.round(ageDays / 30)}mo`;
  return `${Math.round(ageDays / 365)}y`;
}

/** Append new events to a capped, append-only log (newest last). Pure. */
export function appendDecisions(log, events, cap = 40) {
  const base = Array.isArray(log) ? log : [];
  const add = Array.isArray(events) ? events : [];
  const next = [...base, ...add];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
