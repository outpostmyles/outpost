// The model tripwire. Anthropic ships new models and retires old ones faster than we
// can hand-track (we found the agent on a deprecated May-2024 Sonnet by accident). This
// watches the live /v1/models endpoint and tells the founder when:
//   - a model we USE is gone from the API (that tier is broken NOW), or
//   - a model we USE is deprecated and retiring (evaluate a replacement before the date), or
//   - a NEW model we don't recognize has appeared (go qualify it with the eval gate).
//
// Runs daily in the jobs worker (quiet unless there's something to say) and on demand
// via tests/_model_watch.mjs. Pairs with the eval gate (npm run eval:model): the watch
// tells you WHEN to look, the eval tells you WHETHER to switch.
import { config } from '../config.js';

// Every model id we currently recognize. Anything the live endpoint returns that is NOT
// in here is treated as NEW and worth evaluating. Update this when you adopt or
// acknowledge a model (the watch tells you when a new one appears).
export const KNOWN_MODELS = new Set([
  'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
  'claude-opus-4-5-20251101', 'claude-opus-4-1-20250805', 'claude-opus-4-20250514',
  'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001',
]);

// Models that are deprecated (still served, but retiring on the given date). The
// /v1/models endpoint does NOT expose deprecation, so this is maintained by hand from
// Anthropic's deprecation notices. The NEW-model alerts are your prompt to check the
// catalog and update this map.
export const KNOWN_DEPRECATED = {
  'claude-sonnet-4-20250514': '2026-06-15',
  'claude-opus-4-20250514': '2026-06-15',
};

/**
 * Pure: given the live model ids and the models we use, produce the findings. Separated
 * from the network fetch so it is unit-tested.
 *   gone       - a model we USE that the API no longer serves (broken now, fix urgently)
 *   deprecated - a model we USE that is retiring (evaluate a replacement before the date)
 *   newModels  - a live model we don't recognize (evaluate it)
 */
export function analyzeModels({ liveIds, used, known = KNOWN_MODELS, deprecated = KNOWN_DEPRECATED }) {
  const live = new Set(liveIds || []);
  const gone = [];
  const deprecatedHits = [];
  for (const [tier, id] of Object.entries(used || {})) {
    if (!id) continue;
    if (!live.has(id)) gone.push({ tier, id });
    else if (deprecated[id]) deprecatedHits.push({ tier, id, retires: deprecated[id] });
  }
  const newModels = (liveIds || []).filter(id => !known.has(id));
  return { gone, deprecated: deprecatedHits, newModels };
}

export function hasAlerts(f) {
  return (f.gone.length + f.deprecated.length + f.newModels.length) > 0;
}

export function formatFindings({ findings }) {
  const lines = [];
  for (const g of findings.gone) {
    lines.push(`GONE: '${g.id}' (your ${g.tier} model) is no longer served. That tier is broken until you change config.models.${g.tier}.`);
  }
  for (const d of findings.deprecated) {
    lines.push(`DEPRECATED: '${d.id}' (your ${d.tier} model) retires ${d.retires}. Qualify a replacement: npm run eval:model <candidate>`);
  }
  for (const n of findings.newModels) {
    lines.push(`NEW: '${n}' is available and unrecognized. Qualify it before switching: npm run eval:model ${n}`);
  }
  return lines.length ? lines.join('\n') : 'All models current: nothing you use is retiring, nothing new has appeared.';
}

async function fetchLiveModelIds() {
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`/v1/models returned ${res.status}`);
    const json = await res.json();
    return (json.data || []).map(m => m.id).filter(Boolean);
  } finally {
    clearTimeout(tm);
  }
}

/** Fetch the live list and analyze it against config.models. Returns { findings, liveIds, used }. */
export async function runModelWatch() {
  const liveIds = await fetchLiveModelIds();
  const used = { agent: config.models.agent, reads: config.models.reads, cheap: config.models.cheap };
  return { findings: analyzeModels({ liveIds, used }), liveIds, used };
}
