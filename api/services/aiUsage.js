// AI usage capture + readback. recordClaudeUsage prices one Claude call from its
// `usage` object and appends a row to ai_usage. It is FAIL-SAFE: any error (table
// missing before the migration, transient DB issue) is swallowed so cost logging
// can never break a user action or a job. getAiUsageSummary is the founder-only
// readback for the dashboard. Nothing here is ever exposed to a user.
import { supabase } from '../db.js';
import { priceUsage } from '../../src/lib/aiPricing.js';
import { summarizeUsage } from '../../src/lib/aiUsageSummary.js';

let warnedMissing = false;

/**
 * Record the cost of one Claude call. Fire-and-forget friendly (it never throws
 * and never rejects). `usage` is the Anthropic response.usage object.
 *
 * @param {object} p
 * @param {string} p.feature  what drove the call: 'agent' | 'deploy_cash' | 'bargain_radar' | ...
 * @param {string} p.model    the model id the call used
 * @param {object} p.usage    response.usage { input_tokens, output_tokens, cache_* }
 * @param {string|null} p.userId  the user whose action drove it, or null for jobs
 * @param {object|null} p.meta    optional extra context
 */
export async function recordClaudeUsage({ feature, model, usage, userId = null, meta = null } = {}) {
  if (!feature || !usage) return;
  try {
    const p = priceUsage(model, usage);
    const { error } = await supabase.from('ai_usage').insert({
      feature: String(feature).slice(0, 60),
      model: model ? String(model).slice(0, 80) : null,
      tier: p.tier,
      input_tokens: p.inputTokens,
      output_tokens: p.outputTokens,
      cache_read_tokens: p.cacheReadTokens,
      cache_write_tokens: p.cacheWriteTokens,
      cost_usd: p.costUsd,
      user_id: userId || null,
      meta: meta || null,
    });
    if (error && !warnedMissing) {
      warnedMissing = true; // log once; before the migration this is "relation ai_usage does not exist"
      console.warn('[aiUsage] cost capture skipped:', error.message);
    }
  } catch (e) {
    if (!warnedMissing) { warnedMissing = true; console.warn('[aiUsage] cost capture failed:', e.message); }
  }
}

/** Founder-only: roll the last `days` of usage into the cost picture. Never throws. */
export async function getAiUsageSummary({ days = 30 } = {}) {
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data } = await supabase.from('ai_usage')
      .select('feature, tier, cost_usd, input_tokens, output_tokens, user_id, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(100000);
    return summarizeUsage(data ?? [], { now: Date.now(), days });
  } catch {
    return summarizeUsage([], { now: Date.now(), days });
  }
}
