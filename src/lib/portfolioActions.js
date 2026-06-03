// "What needs you" — the prioritized action list at the top of the Portfolio tab.
// The point is to replace "read everything and figure out what matters" with a
// short list of the few things that actually need a decision right now, each with
// the single action to take. It is deliberately proactive: it flags a winner with
// no stop, a name creeping past a quarter of your book, or a name approaching its
// target BEFORE those bite, not after. Pure and deterministic so it is testable,
// and it picks ONE action per name (the most important) so nothing repeats.
import { computePositionStatus } from './positionStatus.js';

const MAX_ACTIONS = 5;

export function buildPortfolioActions(positions, totalValue = 0) {
  const list = Array.isArray(positions) ? positions : [];
  const items = [];

  for (const p of list) {
    const ticker = p?.ticker;
    const price = p?.currentPrice;
    if (!ticker || !price) continue;

    const st = computePositionStatus(p, totalValue);
    const pnlPct = (p.avg_cost > 0) ? ((price - p.avg_cost) / p.avg_cost) * 100 : (p.pnlPercent ?? 0);
    const pct = totalValue > 0 ? (price * (p.shares || 0) / totalValue) * 100 : 0;
    const hasStop = !!(p.stop_loss && p.stop_loss > 0);
    const hasPlan = hasStop || !!(p.price_target && p.price_target > 0);
    const hasThesis = !!(p.entry_thesis && String(p.entry_thesis).trim());

    // Exactly one action per name: the most important thing about it today.
    let item = null;
    if (st.status === 'below_stop') {
      item = { severity: 100, text: `${ticker} broke its stop ($${p.stop_loss}). Decide on purpose: honor it, or move it.`, actionType: 'research', actionLabel: 'REVIEW' };
    } else if (st.status === 'target_hit') {
      item = { severity: 95, text: `${ticker} hit your target ($${p.price_target}). Take profits, trim, or raise the target.`, actionType: 'research', actionLabel: 'DECIDE' };
    } else if (pnlPct <= -20) {
      item = { severity: 85, text: `${ticker} is down ${Math.abs(Math.round(pnlPct))}% from your cost. Is the reason you bought it still true?`, actionType: 'research', actionLabel: 'REVIEW' };
    } else if (pnlPct >= 30 && !hasStop) {
      item = { severity: 80, text: `${ticker} is up ${Math.round(pnlPct)}% with no stop. One bad day gives a lot of that back, set a line to protect it.`, actionType: 'ask', actionLabel: 'SET A STOP', askMessage: `${ticker} is up ${Math.round(pnlPct)}% and I have no stop on it. Help me set a sensible stop and target to protect the gain, given how I trade.` };
    } else if (pct >= 25) {
      item = { severity: 70 + Math.min(20, pct - 25), text: `${ticker} is ${Math.round(pct)}% of your book. A bad day there moves your whole portfolio.`, actionType: 'ask', actionLabel: 'TRIM?', askMessage: `${ticker} is ${Math.round(pct)}% of my book. Walk me through whether I should trim it down, and to what.` };
    } else if (st.status === 'near_target' && p.price_target) {
      const dist = ((p.price_target - price) / price) * 100;
      item = { severity: 65, text: `${ticker} is ${dist.toFixed(1)}% from your target ($${p.price_target}). Have your plan ready.`, actionType: 'research', actionLabel: 'REVIEW' };
    } else if (!hasThesis && pct >= 4) {
      item = { severity: 45, text: `${ticker} has no thesis on record. Write why you own it, or it is hard to know when it stops working.`, actionType: 'ask', actionLabel: 'WRITE WHY', askMessage: `Help me write a one-line thesis for why I hold ${ticker}, plus one thing that would tell me I'm wrong.` };
    } else if (!hasPlan && pct >= 6) {
      item = { severity: 40, text: `${ticker} is ${Math.round(pct)}% of your book with no exit plan. Set a target and a stop.`, actionType: 'ask', actionLabel: 'SET A PLAN', askMessage: `Help me set a target and a stop for ${ticker} given how I trade.` };
    }

    if (item) items.push({ id: `${ticker}:${st.status}`, ticker, ...item });
  }

  items.sort((a, b) => b.severity - a.severity);
  return items.slice(0, MAX_ACTIONS);
}
