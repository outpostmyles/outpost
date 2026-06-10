// Per-model request-param compatibility, so a model swap behind config never 400s.
//
// Anthropic removed the sampling parameters (temperature / top_p / top_k) on the
// newer frontier models: Opus 4.7, Opus 4.8, and Fable 5 reject them with a 400.
// Older models (Sonnet 4.x, Haiku 4.5, Opus 4.5/4.6) still accept them. A call site
// that wants to pass temperature should gate it on acceptsTemperature(model) so that
// flipping AGENT_MODEL to a newer model is a one-line config change, not a 400.
//
// This list is the one place that encodes "which models dropped sampling." When the
// model-watch job flags a NEW model, check its capabilities and update this regex if
// it dropped sampling too. Unknown/older ids default to ACCEPTS (current behavior).
const NO_SAMPLING_PARAMS = /claude-(opus-4-[789]|fable-)/i;

export function acceptsTemperature(model) {
  return !NO_SAMPLING_PARAMS.test(String(model || ''));
}
