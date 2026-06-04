// THE BRAIN: pure processing over the decision ledger.
//
// The ledger (one row per decision, captured at the moment it happens, with
// context and, once it resolves, an outcome) is just raw rows. This file is what
// turns those rows into meaning, and it is deliberately pure so the whole thing
// is testable without a database and the same logic powers every surface:
//   - gradeDecision:        score ONE decision on process first, luck second.
//   - summarizeDecisions:   a user's "receipts" (are you actually getting better).
//   - detectBehaviorPatterns: the recurring self-sabotage, the real enemy.
//   - aggregateRetail:      the anonymized cross-user view (the flywheel seed,
//                           "is the crowd the mark here").
//
// Decisions are expected in a normalized camelCase shape (the service maps DB
// rows to it): { type, ticker, thesis, pctOfBook, todayChangePct, outcomeStatus,
// outcomePnlPct, outcomeHoldDays, thesisPlayedOut, grade, createdAt, ... }.

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function arr(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
const round1 = (n) => Math.round(n * 10) / 10;

const OPENISH = new Set(['open', 'add']);

// ── Grading ────────────────────────────────────────────────────────────────
// A decision is graded on PROCESS first (the part the trader controls: did you
// have a reason, did you size it sanely, did you avoid chasing) and OUTCOME
// second (luck-contaminated). A no-thesis, oversized lucky win should NOT grade
// well, that is the whole point. Returns { score 0..100, letter, reasons[] } or
// null when there is nothing to grade.
export function gradeDecision(d) {
  if (!d || typeof d !== 'object') return null;
  const reasons = [];
  let score = 50; // neutral baseline

  const hasThesis = !!(d.thesis && String(d.thesis).trim());
  if (OPENISH.has(d.type)) {
    if (hasThesis) { score += 15; reasons.push('had a written reason'); }
    else { score -= 15; reasons.push('no thesis on record'); }

    const pct = num(d.pctOfBook);
    if (pct != null) {
      if (pct > 35) { score -= 15; reasons.push(`oversized at ${round1(pct)}% of book`); }
      else if (pct <= 20) { score += 8; reasons.push('sized sanely'); }
    }
    const today = num(d.todayChangePct);
    if (today != null && today >= 10) { score -= 15; reasons.push(`chased a name already up ${round1(today)}% on the day`); }
  }

  // Outcome, if the decision has resolved.
  if (d.outcomeStatus) {
    if (d.outcomeStatus === 'win') { score += 15; reasons.push('it worked out'); }
    else if (d.outcomeStatus === 'loss') { score -= 5; reasons.push('it lost'); }
    if (d.thesisPlayedOut === 'yes') { score += 15; reasons.push('thesis played out'); }
    else if (d.thesisPlayedOut === 'no') { score -= 10; reasons.push('thesis was wrong'); }
    // Discipline asymmetry: a small loss is good risk control; a giant one is not.
    const op = num(d.outcomePnlPct);
    if (op != null && op <= -25) { score -= 15; reasons.push('let a loss run past -25%'); }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const letter = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
  return { score, letter, reasons };
}

function gradePointsOf(d) {
  const g = gradeDecision(d);
  return g ? g.score : null;
}

// ── Receipts: a user's own track record ──────────────────────────────────────
// The honest scoreboard: how many decisions, how many resolved, the win rate,
// the average PROCESS grade, the trend (are recent decisions better graded than
// older ones), and the process hygiene (thesis coverage, oversize rate). This is
// the screen no broker will ever show you.
export function summarizeDecisions(decisions) {
  const list = arr(decisions);
  const byType = {};
  for (const d of list) byType[d.type] = (byType[d.type] || 0) + 1;

  const resolved = list.filter(d => d.outcomeStatus);
  const wins = resolved.filter(d => d.outcomeStatus === 'win').length;
  const losses = resolved.filter(d => d.outcomeStatus === 'loss').length;

  const opens = list.filter(d => OPENISH.has(d.type));
  const withThesis = opens.filter(d => d.thesis && String(d.thesis).trim()).length;
  const oversized = opens.filter(d => num(d.pctOfBook) != null && num(d.pctOfBook) > 35).length;

  // Average grade, and a trend: most-recent third vs oldest third by score.
  const graded = list.map(gradePointsOf).filter(v => v != null);
  const avgGrade = graded.length ? Math.round(graded.reduce((s, v) => s + v, 0) / graded.length) : null;

  // list is assumed newest-first (the service orders by created_at desc).
  let trend = 'flat';
  if (graded.length >= 6) {
    const third = Math.floor(graded.length / 3);
    const recent = graded.slice(0, third);
    const older = graded.slice(-third);
    const ra = recent.reduce((s, v) => s + v, 0) / recent.length;
    const oa = older.reduce((s, v) => s + v, 0) / older.length;
    if (ra - oa >= 6) trend = 'improving';
    else if (oa - ra >= 6) trend = 'slipping';
  }

  return {
    total: list.length,
    byType,
    resolved: resolved.length,
    wins,
    losses,
    winRate: resolved.length ? Math.round((wins / resolved.length) * 100) : null,
    avgGrade,            // 0..100 process+outcome score
    trend,               // improving | slipping | flat
    thesisCoverage: opens.length ? Math.round((withThesis / opens.length) * 100) : null,
    oversizedRate: opens.length ? Math.round((oversized / opens.length) * 100) : null,
  };
}

// ── Behavioral patterns: the recurring self-sabotage (the real enemy) ────────
// Retail's enemy is retail. This scans a user's ledger for the repeatable
// mistakes that actually lose money, each backed by a stat so it is honest, not
// vibes. Returns a severity-sorted list of findings.
export function detectBehaviorPatterns(decisions) {
  const list = arr(decisions);
  const findings = [];
  const opens = list.filter(d => OPENISH.has(d.type));

  // 1) Buying without a reason.
  if (opens.length >= 4) {
    const noThesis = opens.filter(d => !(d.thesis && String(d.thesis).trim())).length;
    const rate = noThesis / opens.length;
    if (rate >= 0.4) {
      findings.push({ key: 'no_thesis', severity: 70, label: 'Buying without a reason',
        stat: `${Math.round(rate * 100)}% of your buys have no thesis`,
        detail: 'When you have not written why, you cannot know when it stops working, so you hold too long.' });
    }
  }

  // 2) Chasing names that already ran on the day.
  const chased = opens.filter(d => num(d.todayChangePct) != null && num(d.todayChangePct) >= 10);
  if (opens.length >= 4 && chased.length / opens.length >= 0.25) {
    findings.push({ key: 'chasing', severity: 80, label: 'Chasing green days',
      stat: `${chased.length} of your buys were names already up 10%+ that day`,
      detail: 'Buying after a big up-day usually means buying near the top of the move.' });
  }

  // 3) Over-concentration.
  const big = opens.filter(d => num(d.pctOfBook) != null && num(d.pctOfBook) > 35);
  if (big.length >= 2) {
    findings.push({ key: 'concentration', severity: 65, label: 'Betting too big',
      stat: `${big.length} buys put a single name over 35% of your book`,
      detail: 'One bad day in an oversized name moves your whole account.' });
  }

  // 4) Holding losers longer than winners (the classic).
  const closedWins = list.filter(d => d.type === 'close' && d.outcomeStatus === 'win' && num(d.outcomeHoldDays) != null);
  const closedLosses = list.filter(d => d.type === 'close' && d.outcomeStatus === 'loss' && num(d.outcomeHoldDays) != null);
  if (closedWins.length >= 2 && closedLosses.length >= 2) {
    const avgWin = closedWins.reduce((s, d) => s + num(d.outcomeHoldDays), 0) / closedWins.length;
    const avgLoss = closedLosses.reduce((s, d) => s + num(d.outcomeHoldDays), 0) / closedLosses.length;
    if (avgLoss >= avgWin * 1.4) {
      findings.push({ key: 'hold_losers', severity: 85, label: 'Holding losers, cutting winners',
        stat: `you hold losers ~${round1(avgLoss)}d vs winners ~${round1(avgWin)}d`,
        detail: 'Letting losers run and snatching small wins is the most expensive habit in trading.' });
    }
  }

  return findings.sort((a, b) => b.severity - a.severity);
}

// ── Aggregate: the anonymized cross-user view (the flywheel seed) ─────────────
// Operates on decisions from MANY users (no PII, just the decision rows). Tells
// the founder where the retail crowd is piling in and how retail tends to fare
// on a name, the actionable version of "know the competition": is the crowd the
// mark here. recentDays bounds the crowding window.
export function aggregateRetail(decisions, { minSample = 3, topN = 20 } = {}) {
  const list = arr(decisions);
  const byTicker = new Map();
  for (const d of list) {
    if (!OPENISH.has(d.type) && d.type !== 'close') continue;
    const t = String(d.ticker || '').toUpperCase();
    if (!t) continue;
    if (!byTicker.has(t)) byTicker.set(t, { ticker: t, opens: 0, resolved: 0, wins: 0, users: new Set() });
    const row = byTicker.get(t);
    if (OPENISH.has(d.type)) row.opens++;
    if (d.userId != null) row.users.add(d.userId);
    if (d.outcomeStatus) { row.resolved++; if (d.outcomeStatus === 'win') row.wins++; }
  }

  const rows = [...byTicker.values()]
    .map(r => ({
      ticker: r.ticker,
      opens: r.opens,
      uniqueUsers: r.users.size,
      resolved: r.resolved,
      retailWinRate: r.resolved >= minSample ? Math.round((r.wins / r.resolved) * 100) : null,
    }))
    .filter(r => r.opens > 0);

  const crowded = [...rows].sort((a, b) => b.uniqueUsers - a.uniqueUsers || b.opens - a.opens).slice(0, topN);
  // Where retail reliably gets hurt: enough resolved trades, low win rate.
  const retailTraps = rows
    .filter(r => r.resolved >= minSample && r.retailWinRate != null && r.retailWinRate <= 35)
    .sort((a, b) => a.retailWinRate - b.retailWinRate)
    .slice(0, topN);

  return { totalDecisions: list.length, tickersTracked: rows.length, crowded, retailTraps };
}

// ── Aggregate behavior: what is the user BASE doing wrong, at scale ───────────
// Groups decisions by user, runs the per-user pattern detector on each, and
// reports how prevalent each self-sabotage pattern is across the population.
// This is the founder's most actionable read: if 60% of users chase green days,
// that is a guardrail to build, not a coincidence. Privacy-safe (only counts and
// pattern keys, no per-user identity leaves this function).
export function aggregateBehavior(decisions) {
  const list = arr(decisions);
  const byUser = new Map();
  for (const d of list) {
    if (d.userId == null) continue;
    if (!byUser.has(d.userId)) byUser.set(d.userId, []);
    byUser.get(d.userId).push(d);
  }
  const counts = new Map();
  for (const ds of byUser.values()) {
    const seen = new Set();
    for (const p of detectBehaviorPatterns(ds)) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      if (!counts.has(p.key)) counts.set(p.key, { key: p.key, label: p.label, users: 0 });
      counts.get(p.key).users++;
    }
  }
  const totalUsers = byUser.size;
  const patterns = [...counts.values()]
    .map(c => ({ ...c, pctOfUsers: totalUsers ? Math.round((c.users / totalUsers) * 100) : 0 }))
    .sort((a, b) => b.users - a.users);
  return { totalUsers, patterns };
}

// Compute how big this decision's position is in the book, at decision time, so
// the size-based grade and the "betting too big" pattern actually fire. positions
// is the user's current holdings [{ticker, shares}], prices is {ticker:{price}}.
// For a close, the position is already gone from `positions`, so we add its value
// back to the denominator to reflect the book at the moment of the decision.
export function pctOfBookForDecision(decision, positions, prices) {
  const d = decision || {};
  const t = String(d.ticker || '').toUpperCase();
  if (!t) return null;
  const px = num(d.price) ?? num(prices?.[t]?.price);
  if (px == null || px <= 0) return null;
  let book = 0;
  let mineVal = null;
  for (const p of arr(positions)) {
    const pt = String(p?.ticker || '').toUpperCase();
    const sh = num(p?.shares);
    const ppx = num(prices?.[pt]?.price);
    if (!pt || sh == null || sh <= 0 || ppx == null || ppx <= 0) continue;
    const v = ppx * sh;
    book += v;
    if (pt === t) mineVal = v;
  }
  if (mineVal == null) {
    const sh = num(d.shares); // close: value it from the decision's own shares
    if (sh == null || sh <= 0) return null;
    mineVal = px * sh;
    book += mineVal;
  }
  return book > 0 ? Math.round((mineVal / book) * 10000) / 100 : null;
}

// ── THE OBJECTIVE: the product's loss function ───────────────────────────────
// One number per user for "are they making better decisions": process quality
// (average grade) penalized by active self-sabotage. Deliberately process-first,
// not P&L (luck-contaminated). 0..100, or null when there is nothing graded yet.
// Every future product change is measured against whether this moves.
export function decisionQualityIndex(decisions) {
  const list = arr(decisions);
  const s = summarizeDecisions(list);
  if (s.avgGrade == null) {
    return { index: null, avgGrade: null, sabotagePenalty: 0, winRate: s.winRate, trend: s.trend, sample: s.total, patterns: [] };
  }
  const found = detectBehaviorPatterns(list);
  const penalty = Math.min(30, found.reduce((p, f) => p + (f.severity >= 80 ? 10 : f.severity >= 65 ? 6 : 3), 0));
  const index = Math.max(0, Math.min(100, Math.round(s.avgGrade - penalty)));
  return { index, avgGrade: s.avgGrade, sabotagePenalty: penalty, winRate: s.winRate, trend: s.trend, sample: s.total, patterns: found.map(f => f.key) };
}

// Population view of the objective: the average decision-quality index across
// users who have enough activity to score. The product's north-star number.
export function aggregateQuality(decisions) {
  const list = arr(decisions);
  const byUser = new Map();
  for (const d of list) {
    if (d.userId == null) continue;
    if (!byUser.has(d.userId)) byUser.set(d.userId, []);
    byUser.get(d.userId).push(d);
  }
  const indices = [];
  for (const ds of byUser.values()) {
    const q = decisionQualityIndex(ds);
    if (q.index != null) indices.push(q.index);
  }
  const avgIndex = indices.length ? Math.round(indices.reduce((s, v) => s + v, 0) / indices.length) : null;
  return { users: byUser.size, scored: indices.length, avgIndex };
}

// ── THE REWARD SIGNAL: does following our advice actually help ────────────────
// Compares resolved decisions the AI prompted (deploy cash, a screener pick, a
// dossier handoff) against self-directed ones. If advised trades do not beat
// self-directed ones, the product is not earning its keep, and we would rather
// know. The honest test of whether Outpost helps.
const AI_SOURCES = new Set(['deploy_cash', 'screener', 'dossier']);
export function adviceLift(decisions) {
  const resolved = arr(decisions).filter(d => d.outcomeStatus && (OPENISH.has(d.type) || d.type === 'close'));
  const grp = (pred) => {
    const g = resolved.filter(pred);
    const wins = g.filter(d => d.outcomeStatus === 'win').length;
    return { n: g.length, winRate: g.length ? Math.round((wins / g.length) * 100) : null };
  };
  const advised = grp(d => AI_SOURCES.has(d.source));
  const selfDirected = grp(d => !AI_SOURCES.has(d.source));
  const lift = (advised.winRate != null && selfDirected.winRate != null) ? advised.winRate - selfDirected.winRate : null;
  return { advised, selfDirected, lift };
}

// ── BASE RATES BY SETUP: the probabilistic edge institutions live by ─────────
// Not "how did AAPL do" but "how does THIS KIND of buy work out": no thesis,
// chasing a green day, oversized, bought into a risk-off tape. Buckets resolved
// buys by setup and reports each bucket's win rate. This is the intelligence
// retail can never assemble for itself, and the spine of a real pre-trade check.
// A win rate is withheld below minSample so we never claim an edge we cannot back.
export function setupBaseRates(decisions, { minSample = 5 } = {}) {
  const resolved = arr(decisions).filter(d => OPENISH.has(d.type) && d.outcomeStatus);
  const bucket = (setup, pred) => {
    const g = resolved.filter(pred);
    const wins = g.filter(d => d.outcomeStatus === 'win').length;
    return { setup, n: g.length, winRate: g.length >= minSample ? Math.round((wins / g.length) * 100) : null };
  };
  const hasThesis = (d) => !!(d.thesis && String(d.thesis).trim());
  const overall = bucket('all buys', () => true);
  const buckets = [
    bucket('no thesis', d => !hasThesis(d)),
    bucket('has thesis', d => hasThesis(d)),
    bucket('chasing (up 10%+ that day)', d => num(d.todayChangePct) != null && num(d.todayChangePct) >= 10),
    bucket('oversized (>35% of book)', d => num(d.pctOfBook) != null && num(d.pctOfBook) > 35),
    bucket('bought in risk-off', d => d.marketRegime === 'Risk Off'),
    bucket('bought in risk-on', d => d.marketRegime === 'Risk On'),
  ].filter(b => b.n > 0);
  // Worst win rate first (the traps lead), unknowns last.
  buckets.sort((a, b) => (a.winRate ?? 999) - (b.winRate ?? 999));
  return { overall, buckets };
}
