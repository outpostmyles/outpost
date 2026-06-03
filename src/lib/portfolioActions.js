// "What needs you": the prioritized action list at the top of the Portfolio tab.
// The point is to replace "read everything and figure out what matters" with a
// short list of the few things that actually need a decision right now, each with
// the single action to take. It is deliberately proactive: it flags a name whose
// thesis is breaking, a winner with no stop, a name creeping past a quarter of
// your book, or a name approaching its target BEFORE those bite, not after. The
// thesis verdicts come from the living thesis watch (passed in as a ticker map).
//
// Crucially it does NOT repeat: signals that would otherwise be the same sentence
// over and over (several winners with no stop, several holdings with no thesis or
// no plan) are GROUPED into one summarized action that names the tickers. Specific,
// urgent, one-off signals (a broken stop, a target hit, a deep drawdown, a single
// over-weight name) stay as their own line. Pure and deterministic, so it is
// testable and instant.
import { computePositionStatus } from './positionStatus.js';
import { pctOfBookOf } from './bookStats.js';

const MAX_ACTIONS = 5;

function preview(names, n = 3) {
  return names.slice(0, n).join(', ') + (names.length > n ? `, +${names.length - n} more` : '');
}

export function buildPortfolioActions(positions, totalValue = 0, thesisWatches = {}) {
  const list = Array.isArray(positions) ? positions : [];
  const watches = thesisWatches || {};
  const individual = [];          // specific, urgent, one-off
  const winnersNoStop = [];       // { ticker, pnlPct }
  const noThesis = [];            // { ticker }
  const noPlan = [];              // { ticker, pct }

  for (const p of list) {
    const ticker = p?.ticker;
    const price = p?.currentPrice;
    if (!ticker || !price) continue;

    const st = computePositionStatus(p, totalValue);
    const pnlPct = (p.avg_cost > 0) ? ((price - p.avg_cost) / p.avg_cost) * 100 : (p.pnlPercent ?? 0);
    // Same weight the rest of the app shows: prefer the server-tagged pctOfBook,
    // else the one shared formula. Coalesce to 0 for an empty book.
    const pct = p.pctOfBook != null ? p.pctOfBook : (pctOfBookOf(p, totalValue) ?? 0);
    const hasStop = !!(p.stop_loss && p.stop_loss > 0);
    const hasPlan = hasStop || !!(p.price_target && p.price_target > 0);
    const hasThesis = !!(p.entry_thesis && String(p.entry_thesis).trim());
    const watch = watches[ticker] || watches[String(ticker).toUpperCase()];

    if (st.status === 'below_stop') {
      individual.push({ id: `${ticker}:stop`, ticker, severity: 100, actionType: 'research', actionLabel: 'REVIEW', text: `${ticker} broke its stop ($${p.stop_loss}). Decide on purpose: honor it, or move it.` });
    } else if (st.status === 'target_hit') {
      individual.push({ id: `${ticker}:target`, ticker, severity: 95, actionType: 'research', actionLabel: 'DECIDE', text: `${ticker} hit your target ($${p.price_target}). Take profits, trim, or raise the target.` });
    } else if (watch?.verdict === 'broken') {
      // The reason you own it may be gone. That outranks most price-based flags.
      individual.push({ id: `${ticker}:thesis`, ticker, severity: 92, actionType: 'research', actionLabel: 'REVIEW', text: `Your ${ticker} thesis may be breaking. ${watch.headline}` });
    } else if (pnlPct <= -20) {
      individual.push({ id: `${ticker}:dd`, ticker, severity: 85, actionType: 'research', actionLabel: 'REVIEW', text: `${ticker} is down ${Math.abs(Math.round(pnlPct))}% from your cost. Is the reason you bought it still true?` });
    } else if (pnlPct >= 30 && !hasStop) {
      winnersNoStop.push({ ticker, pnlPct });
    } else if (pct >= 25) {
      individual.push({ id: `${ticker}:conc`, ticker, severity: 70 + Math.min(20, pct - 25), actionType: 'ask', actionLabel: 'TRIM?', text: `${ticker} is ${Math.round(pct)}% of your book. A bad day there moves your whole portfolio.`, askMessage: `${ticker} is ${Math.round(pct)}% of my book. Walk me through whether I should trim it down, and to what.` });
    } else if (watch?.verdict === 'weakening') {
      individual.push({ id: `${ticker}:thesis`, ticker, severity: 76, actionType: 'research', actionLabel: 'REVIEW', text: `Your ${ticker} thesis is weakening. ${watch.headline}` });
    } else if (st.status === 'near_target' && p.price_target) {
      const dist = ((p.price_target - price) / price) * 100;
      individual.push({ id: `${ticker}:near`, ticker, severity: 65, actionType: 'research', actionLabel: 'REVIEW', text: `${ticker} is ${dist.toFixed(1)}% from your target ($${p.price_target}). Have your plan ready.` });
    } else if (!hasThesis && pct >= 4) {
      noThesis.push({ ticker });
    } else if (!hasPlan && pct >= 6) {
      noPlan.push({ ticker, pct });
    }
  }

  const items = [...individual];

  // Winners with no stop: one line if one, a single grouped line if several.
  if (winnersNoStop.length === 1) {
    const w = winnersNoStop[0];
    items.push({ id: 'winner_no_stop', ticker: w.ticker, severity: 80, actionType: 'ask', actionLabel: 'SET A STOP',
      text: `${w.ticker} is up ${Math.round(w.pnlPct)}% with no stop. One bad day gives a lot of that back, set a line to protect it.`,
      askMessage: `${w.ticker} is up ${Math.round(w.pnlPct)}% and I have no stop on it. Help me set a sensible stop and target to protect the gain, given how I trade.` });
  } else if (winnersNoStop.length > 1) {
    const g = [...winnersNoStop].sort((a, b) => b.pnlPct - a.pnlPct);
    const names = g.map(x => x.ticker);
    items.push({ id: 'winners_no_stop', severity: 82, actionType: 'ask', actionLabel: 'SET STOPS',
      text: `${g.length} winners are running with no stop (${preview(names)}). One bad day gives a lot of that back, set lines to protect them.`,
      askMessage: `Help me set sensible stops and targets on my winners that have none: ${names.join(', ')}. Base it on how I trade.` });
  }

  // No thesis on record.
  if (noThesis.length === 1) {
    const t = noThesis[0].ticker;
    items.push({ id: 'no_thesis', ticker: t, severity: 45, actionType: 'ask', actionLabel: 'WRITE WHY',
      text: `${t} has no thesis on record. Write why you own it, or it is hard to know when it stops working.`,
      askMessage: `Help me write a one-line thesis for why I hold ${t}, plus one thing that would tell me I'm wrong.` });
  } else if (noThesis.length > 1) {
    const names = noThesis.map(x => x.ticker);
    items.push({ id: 'no_thesis_group', severity: 47, actionType: 'ask', actionLabel: 'WRITE THEM',
      text: `${names.length} holdings have no thesis on record (${preview(names)}). Hard to know if they are working without one.`,
      askMessage: `Help me write a one-line thesis for each of these I hold with no reason on record: ${names.join(', ')}.` });
  }

  // No exit plan.
  if (noPlan.length === 1) {
    const o = noPlan[0];
    items.push({ id: 'no_plan', ticker: o.ticker, severity: 40, actionType: 'ask', actionLabel: 'SET A PLAN',
      text: `${o.ticker} is ${Math.round(o.pct)}% of your book with no exit plan. Set a target and a stop.`,
      askMessage: `Help me set a target and a stop for ${o.ticker} given how I trade.` });
  } else if (noPlan.length > 1) {
    const names = [...noPlan].sort((a, b) => b.pct - a.pct).map(x => x.ticker);
    items.push({ id: 'no_plan_group', severity: 42, actionType: 'ask', actionLabel: 'SET PLANS',
      text: `${names.length} holdings have no exit plan (${preview(names)}). A target and stop on each keeps you from flying on feel.`,
      askMessage: `Help me set a target and a stop for each of these I hold with no plan: ${names.join(', ')}.` });
  }

  items.sort((a, b) => b.severity - a.severity);
  return items.slice(0, MAX_ACTIONS);
}
