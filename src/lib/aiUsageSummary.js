// Roll a flat list of ai_usage rows into the founder cost picture: rolling
// totals, per-feature and per-model breakdowns, top users, a daily series, and a
// projected monthly run-rate. Pure and time-injectable so it is testable. The
// rows are FOUNDER-ONLY; none of this is shown to a user.

const DAY = 86400000;
const n = (v) => { const x = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(x) ? x : 0; };
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r2 = (x) => Math.round(x * 100) / 100;

function bump(map, key, cost, inTok, outTok) {
  if (key == null) return;
  const v = map.get(key) || { key, cost: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
  v.cost += cost; v.calls += 1; v.inputTokens += inTok; v.outputTokens += outTok;
  map.set(key, v);
}
const rank = (map, label) => [...map.values()]
  .map(v => ({ [label]: v.key, cost: r4(v.cost), calls: v.calls, inputTokens: v.inputTokens, outputTokens: v.outputTokens }))
  .sort((a, b) => b.cost - a.cost);

/**
 * @param rows  [{ feature, tier, cost_usd, input_tokens, output_tokens, user_id, created_at(ISO) }]
 * @param opts  { now: ms, days: number (window for breakdowns + daily series) }
 */
export function summarizeUsage(rows, { now = 0, days = 30 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const w24 = now - DAY, w7 = now - 7 * DAY, wWin = now - days * DAY;
  const totals = { last24h: { cost: 0, calls: 0 }, last7d: { cost: 0, calls: 0 }, lastWindow: { cost: 0, calls: 0 } };
  const featureMap = new Map(), modelMap = new Map(), userMap = new Map(), dayMap = new Map();

  for (const row of list) {
    const t = Date.parse(row?.created_at);
    if (!Number.isFinite(t)) continue;
    const cost = n(row.cost_usd), inTok = n(row.input_tokens), outTok = n(row.output_tokens);
    if (t >= w24) { totals.last24h.cost += cost; totals.last24h.calls += 1; }
    if (t >= w7) { totals.last7d.cost += cost; totals.last7d.calls += 1; }
    if (t >= wWin) {
      totals.lastWindow.cost += cost; totals.lastWindow.calls += 1;
      bump(featureMap, row.feature || 'unknown', cost, inTok, outTok);
      bump(modelMap, row.tier || 'unknown', cost, inTok, outTok);
      if (row.user_id) bump(userMap, row.user_id, cost, inTok, outTok);
      const date = new Date(t).toISOString().slice(0, 10);
      const d = dayMap.get(date) || { date, cost: 0, calls: 0 };
      d.cost += cost; d.calls += 1; dayMap.set(date, d);
    }
  }

  return {
    generatedAtMs: now,
    windowDays: days,
    totals: {
      last24h: { cost: r4(totals.last24h.cost), calls: totals.last24h.calls },
      last7d: { cost: r4(totals.last7d.cost), calls: totals.last7d.calls },
      lastWindow: { cost: r4(totals.lastWindow.cost), calls: totals.lastWindow.calls },
    },
    // Run-rate from the trailing 7 days, the most representative recent signal.
    projectedMonthly: r2((totals.last7d.cost / 7) * 30),
    byFeature: rank(featureMap, 'feature'),
    byModel: rank(modelMap, 'tier'),
    topUsers: rank(userMap, 'userId').slice(0, 10),
    daily: [...dayMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map(d => ({ date: d.date, cost: r4(d.cost), calls: d.calls })),
  };
}
