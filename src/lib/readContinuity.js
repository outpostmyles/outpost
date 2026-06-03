// "Since you were last here": the memory that turns the Portfolio read from a
// fresh hello every time into a voice that remembers. We snapshot the shape of
// the book each visit (weights, plans, theses, P&L, thesis verdicts), and on the
// next visit we diff against the last snapshot to surface what YOU did and what
// MOVED: you set a stop, you wrote a thesis, a name grew into a concentration, a
// loser fell further, your thesis slipped. Pure and deterministic, so the
// relationship is reliable, free, and testable (no second model call).

import { pctOfBookOf } from './bookStats.js';

const VERDICT_RANK = { strengthening: 0, intact: 1, weakening: 2, broken: 3 };
const VERDICT_LABEL = { strengthening: 'strengthening', intact: 'intact', weakening: 'weakening', broken: 'breaking' };

/**
 * Compact, serializable snapshot of the book's shape right now. Small keys keep
 * the stored JSON tiny. `at` is stamped by the caller (or the server on write).
 */
export function snapshotReadState({ positions, totalValue = 0, thesisWatches = {}, at = null }) {
  const holdings = {};
  for (const p of (Array.isArray(positions) ? positions : [])) {
    const t = p?.ticker;
    if (!t) continue;
    const price = p.currentPrice ?? 0;
    // One weight source: the server-tagged pctOfBook, else the shared formula.
    const pct = p.pctOfBook != null ? p.pctOfBook : (pctOfBookOf(p, totalValue) ?? 0);
    const pnl = (p.avg_cost > 0 && price) ? ((price - p.avg_cost) / p.avg_cost) * 100 : 0;
    const w = thesisWatches[t] || thesisWatches[String(t).toUpperCase()];
    holdings[t] = {
      sh: Number(p.shares) || 0,
      pct: Math.round(pct),
      stop: !!(p.stop_loss > 0),
      tgt: !!(p.price_target > 0),
      th: !!(p.entry_thesis && String(p.entry_thesis).trim()),
      pnl: Math.round(pnl),
      px: price > 0 ? Math.round(price * 100) / 100 : 0, // price at this visit, for grading decisions later
      v: w?.verdict || null,
    };
  }
  return { at, holdings };
}

/**
 * Diff two snapshots into a few human "since last time" lines, prioritized so the
 * most meaningful (a breaking thesis, a deepening loss) lead and the rest fall off
 * the cap. Returns { lines: string[] }. Empty (no strip) when there is no prior
 * snapshot or nothing material changed.
 */
export function diffReadState(prior, curr) {
  const out = [];
  const P = prior?.holdings, C = curr?.holdings;
  if (!P || !C) return { lines: [] };

  for (const t of Object.keys(C)) {
    const c = C[t], p = P[t];
    if (!p) { out.push({ pri: 3, text: `You added ${t}.` }); continue; }

    // Things you did since last time (acknowledge the action).
    if (!p.th && c.th) out.push({ pri: 5, text: `You wrote a thesis on ${t}.` });
    if (!p.stop && c.stop) out.push({ pri: 5, text: `You set a stop on ${t}.` });
    if (!p.tgt && c.tgt) out.push({ pri: 4, text: `You set a target on ${t}.` });
    const trimmed = p.sh && c.sh && c.sh <= p.sh * 0.85;
    if (trimmed) out.push({ pri: 4, text: `You trimmed ${t}.` });
    else if (p.sh && c.sh && c.sh >= p.sh * 1.15) out.push({ pri: 3, text: `You added to ${t}.` });

    // Things that moved on you (the heads-up).
    if (p.v && c.v && p.v !== c.v) {
      const worse = (VERDICT_RANK[c.v] ?? 1) > (VERDICT_RANK[p.v] ?? 1);
      out.push({
        pri: worse ? 8 : 4,
        text: worse
          ? `Your ${t} thesis slipped to ${VERDICT_LABEL[c.v] || c.v}.`
          : `Your ${t} thesis firmed up to ${VERDICT_LABEL[c.v] || c.v}.`,
      });
    }
    if (c.pnl - p.pnl <= -8) {
      // Only call it a "fall" when the name is actually underwater. A winner giving
      // back some gain is a pullback, not a loss, and saying otherwise reads wrong.
      out.push(c.pnl < 0
        ? { pri: 7, text: `${t} fell further, now ${c.pnl}% from cost.` }
        : { pri: 6, text: `${t} pulled back, now +${c.pnl}% from cost.` });
    }
    // Suppress "grew to" when we just said "You trimmed" this name, so the pair does
    // not read as a contradiction (you can sell shares yet rise in weight if the
    // rest of the book fell).
    if (!trimmed && c.pct - p.pct >= 3 && c.pct >= 15) out.push({ pri: 6, text: `${t} grew to ${c.pct}% of your book.` });
  }

  for (const t of Object.keys(P)) {
    if (!C[t]) out.push({ pri: 4, text: `You closed ${t}.` });
  }

  // Highest priority first; one line per distinct sentence; keep it short.
  out.sort((a, b) => b.pri - a.pri);
  const seen = new Set();
  const lines = [];
  for (const o of out) {
    if (seen.has(o.text)) continue;
    seen.add(o.text);
    lines.push(o.text);
    if (lines.length >= 3) break;
  }
  return { lines };
}

/**
 * Should the stored anchor be replaced with the current snapshot? We re-anchor on
 * a genuinely new visit (no anchor yet, a different calendar day, or more than
 * `maxAgeMs` since the last anchor), and otherwise leave it put so a within-session
 * reload still shows "you just set that stop" instead of swallowing it.
 */
export function shouldReanchor(priorAt, now = Date.now(), maxAgeMs = 6 * 60 * 60 * 1000) {
  const t = Date.parse(priorAt);
  if (!Number.isFinite(t)) return true;
  if ((now - t) > maxAgeMs) return true;
  return new Date(t).toDateString() !== new Date(now).toDateString();
}
