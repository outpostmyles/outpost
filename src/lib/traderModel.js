// Frontier #4: a model of YOU. Where this specific person actually makes money
// (edges) and where they bleed (leaks), measured against their OWN baseline win
// rate, so it is "you are +17 points better when you write a thesis", not a
// generic lecture. Pure and testable; it sharpens with every resolved decision.
//
// Operates on resolved BUY decisions (open/add with an outcome stamped on close).
// A dimension only surfaces with enough sample and a meaningful gap from baseline,
// so a thin record honestly returns nothing rather than a fake insight.

const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const r1 = (n) => Math.round(n * 10) / 10;
const isOpen = (d) => d?.type === 'open' || d?.type === 'add';
const hasThesis = (d) => !!(d?.thesis && String(d.thesis).trim());
const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);

const MEANINGFUL_DELTA = 8; // points of win rate vs the user's own baseline

export function buildTraderModel(decisions, { minSample = 4 } = {}) {
  const list = Array.isArray(decisions) ? decisions : [];
  const opens = list.filter(d => isOpen(d) && (d.outcomeStatus === 'win' || d.outcomeStatus === 'loss'));
  if (opens.length < minSample) return { hasModel: false, sample: opens.length };

  const winsOf = (g) => g.filter(d => d.outcomeStatus === 'win').length;
  const baseline = Math.round((winsOf(opens) / opens.length) * 100);
  const dims = [];
  const bucket = (label, pred) => {
    const g = opens.filter(pred);
    if (g.length < minSample) return;
    const winRate = Math.round((winsOf(g) / g.length) * 100);
    dims.push({ label, n: g.length, winRate, avgPnlPct: r1(mean(g.map(d => num(d.outcomePnlPct) ?? 0))), delta: winRate - baseline });
  };

  bucket('when you write a thesis first', d => hasThesis(d));
  bucket('when you buy with no reason', d => !hasThesis(d));
  bucket('when you chase a green day', d => (num(d.todayChangePct) ?? 0) >= 10);
  bucket('when you size it sanely', d => num(d.pctOfBook) != null && num(d.pctOfBook) <= 20);
  bucket('when you go oversized', d => (num(d.pctOfBook) ?? 0) > 35);
  bucket('in a risk-off market', d => /off/i.test(String(d.marketRegime || '')));
  bucket('in a risk-on market', d => /on/i.test(String(d.marketRegime || '')));
  bucket('when you hold for weeks or more', d => (num(d.outcomeHoldDays) ?? 0) >= 20);
  bucket('when you flip within days', d => num(d.outcomeHoldDays) != null && num(d.outcomeHoldDays) < 5);

  const sorted = [...dims].sort((a, b) => b.delta - a.delta);
  const edges = sorted.filter(d => d.delta >= MEANINGFUL_DELTA).slice(0, 2);
  const leaks = sorted.filter(d => d.delta <= -MEANINGFUL_DELTA).slice(-2).reverse();

  return { hasModel: true, sample: opens.length, baselineWinRate: baseline, edges, leaks };
}

/** A compact prose block for the agent's context, or '' when there is no model. */
export function formatTraderModel(model) {
  if (!model?.hasModel || (!model.edges?.length && !model.leaks?.length)) return '';
  const lines = [`THIS TRADER'S EDGE AND LEAK (from their own resolved trades, baseline win rate ${model.baselineWinRate}%):`];
  for (const e of model.edges) lines.push(`- EDGE: ${e.label}, ${e.winRate}% win (${e.delta >= 0 ? '+' : ''}${e.delta} vs baseline, ${e.n} trades).`);
  for (const l of model.leaks) lines.push(`- LEAK: ${l.label}, ${l.winRate}% win (${l.delta} vs baseline, ${l.n} trades).`);
  lines.push('Coach from these specifically. Lean them toward their edge, name the leak when they are about to repeat it.');
  return lines.join('\n');
}
