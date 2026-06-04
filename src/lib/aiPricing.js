// Token pricing for Claude calls, so the founder can see real dollar cost per
// feature instead of a hand-typed guess. Pure and testable. FOUNDER-ONLY data;
// nothing here is ever shown to a user.
//
// Rates are US dollars per MILLION tokens and are LIST PRICES that must be kept
// in sync with https://www.anthropic.com/pricing when Anthropic changes them or
// you switch models. Matching is by substring, so dated model ids like
// "claude-sonnet-4-20250514" resolve to the right tier without editing anything.
// Cached input is billed differently: cache_read is cheap, cache_creation costs a
// little more than normal input. The Anthropic usage object splits these out, and
// input_tokens already excludes the cached portion, so each is priced separately.

const PER_MTOK = {
  opus:   { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3,  output: 15, cacheWrite: 3.75,  cacheRead: 0.3 },
  haiku:  { input: 1,  output: 5,  cacheWrite: 1.25,  cacheRead: 0.1 },
};
// Unknown model: assume the pricier mainstream tier so we never UNDER-report cost.
const FALLBACK = { tier: 'unknown', ...PER_MTOK.sonnet };

const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** Resolve a model id (any version string) to its pricing tier. */
export function rateForModel(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('opus')) return { tier: 'opus', ...PER_MTOK.opus };
  if (m.includes('haiku')) return { tier: 'haiku', ...PER_MTOK.haiku };
  if (m.includes('sonnet')) return { tier: 'sonnet', ...PER_MTOK.sonnet };
  return { ...FALLBACK };
}

/**
 * Price one Claude call from its `usage` object.
 * @returns { tier, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, costUsd }
 */
export function priceUsage(model, usage = {}) {
  const r = rateForModel(model);
  const inputTokens = num(usage.input_tokens);
  const outputTokens = num(usage.output_tokens);
  const cacheWriteTokens = num(usage.cache_creation_input_tokens);
  const cacheReadTokens = num(usage.cache_read_input_tokens);
  const costUsd = round6(
    (inputTokens * r.input + outputTokens * r.output + cacheWriteTokens * r.cacheWrite + cacheReadTokens * r.cacheRead) / 1e6,
  );
  return { tier: r.tier, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, costUsd };
}
