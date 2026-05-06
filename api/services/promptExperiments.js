/**
 * Prompt experiments framework.
 *
 * Lets us A/B-test prompt variants for AI features without changing the
 * call sites every time. The model:
 *
 *   - An experiment is a `{ key, variants[], default }` registered in
 *     EXPERIMENTS below. Each variant has a deterministic id and a builder.
 *   - `assignVariant(userId, key)` returns the variant for a user, sticky
 *     across calls (same user always sees the same variant for a given key).
 *   - Call sites pass the user id in, ask for the variant, and use whatever
 *     the variant exposes (a system prompt builder, a model name, knobs).
 *   - Feedback is logged with the variant id (see migration 011) so the
 *     founder dashboard can show approval rate by variant.
 *
 * Why deterministic, not random?
 *   - We need stickiness: a user shouldn't flip variants between requests
 *     or they'd see inconsistent behavior.
 *   - We need it free of state: no DB lookup on every call, no in-memory
 *     map that breaks across restarts. A SHA-256 hash of (userId + key)
 *     mod number-of-variants gives both for free.
 *
 * Adding an experiment:
 *   1. Add an entry to EXPERIMENTS below with stable variant ids.
 *   2. At the call site, do:
 *        const variant = assignVariant(userId, 'my_experiment_key');
 *        const prompt = variant.build(args);
 *   3. When feedback is captured for that feature, pass the variant id
 *      through to ai_feedback.variant.
 *
 * Removing/promoting a variant:
 *   - Don't reuse old variant ids for new variants — past feedback rows
 *     would be misattributed. Pick fresh ids, or rename the experiment key.
 */
import { createHash } from 'crypto';
import { buildWelcomeSystemPrompt } from './welcomeMoment.js';

// ============ REGISTRY ============

/**
 * Each experiment:
 *   key: machine identifier (lower_snake)
 *   description: short string for the dashboard
 *   variants: ordered array. Adding a variant SHIFTS assignments for users
 *             whose hash bucket lands on the new variant — that's expected
 *             when you onboard a new arm into a running experiment.
 *   defaultId: which id to fall back to when assignment fails (e.g. no userId)
 */
export const EXPERIMENTS = {
  welcome_system: {
    key: 'welcome_system',
    description: 'Welcome message system prompt — controls the tone and shape of the new-user AI greeting.',
    defaultId: 'baseline',
    variants: [
      {
        id: 'baseline',
        label: 'Baseline (warm coach, 3 sentences)',
        build: () => buildWelcomeSystemPrompt(),
      },
      {
        id: 'mentor',
        label: 'Mentor — sharper, leads with one specific market observation',
        build: () => [
          'You are Outpost, a personal trading coach.',
          'You are speaking to a brand-new user who just finished onboarding.',
          'Lead with ONE specific observation about today\'s market that matters for their style.',
          'Then give ONE concrete next step they can take in Outpost right now.',
          'Tone: experienced mentor — confident but not flashy. Never hyped.',
          'CRITICAL: Plain text only. No markdown, no asterisks, no bullets, no headers.',
          'CRITICAL: Maximum 3 sentences. Always under 60 words.',
        ].join(' '),
      },
      {
        id: 'concise',
        label: 'Concise — 2 sentences, lower word count',
        build: () => [
          'You are Outpost, a personal trading coach.',
          'Greet a new user in EXACTLY 2 sentences. Sentence 1: a single concrete market read for their style. Sentence 2: a single next step in Outpost.',
          'Tone: warm but minimal — every word earns its place.',
          'CRITICAL: Plain text only. No markdown, no asterisks, no bullets, no headers.',
          'CRITICAL: Maximum 2 sentences. Always under 40 words.',
        ].join(' '),
      },
    ],
  },
};

// ============ PURE HELPERS ============

/**
 * Pick a stable bucket [0, n) for a user + experiment pair.
 * Deterministic across calls, evenly distributed.
 */
export function bucketFor(userId, experimentKey, n) {
  if (!n || n <= 0) return 0;
  if (!userId) return 0;                                // anonymous → first bucket
  const h = createHash('sha256').update(`${userId}|${experimentKey}`).digest();
  // Use the leading 4 bytes as an unsigned int — plenty of range, fast.
  const seed = h.readUInt32BE(0);
  return seed % n;
}

/**
 * Resolve a variant for (userId, experimentKey). Returns the variant object
 * with `.id`, `.label`, and `.build`.
 */
export function assignVariant(userId, experimentKey) {
  const exp = EXPERIMENTS[experimentKey];
  if (!exp) throw new Error(`Unknown experiment: ${experimentKey}`);
  const variants = exp.variants || [];
  if (variants.length === 0) throw new Error(`Experiment ${experimentKey} has no variants`);

  const idx = bucketFor(userId, experimentKey, variants.length);
  return variants[idx] || variants.find(v => v.id === exp.defaultId) || variants[0];
}

/**
 * Look up a variant by id without doing assignment. Useful for the
 * dashboard that aggregates feedback rows already tagged with a variant.
 */
export function getVariantById(experimentKey, variantId) {
  const exp = EXPERIMENTS[experimentKey];
  if (!exp) return null;
  return (exp.variants || []).find(v => v.id === variantId) || null;
}

/**
 * Lightweight registry summary the founder dashboard can render — no
 * builder functions, just labels and ids.
 */
export function listExperiments() {
  return Object.values(EXPERIMENTS).map(exp => ({
    key: exp.key,
    description: exp.description,
    variants: (exp.variants || []).map(v => ({ id: v.id, label: v.label })),
  }));
}

/**
 * Pure: aggregate ai_feedback rows into a per-variant approval breakdown.
 * Input rows look like: { feature, variant, rating } (rating is 'up' | 'down').
 * Returns an object: { [feature]: { [variantId]: { up, down, total, approval } } }.
 *
 * Rows missing `variant` are bucketed under the literal key 'untagged' so
 * pre-experiment data still shows up rather than silently disappearing.
 */
export function aggregateFeedbackByVariant(rows) {
  const out = {};
  for (const row of rows ?? []) {
    const feat = row.feature || 'unknown';
    const variant = row.variant || 'untagged';
    if (!out[feat]) out[feat] = {};
    if (!out[feat][variant]) out[feat][variant] = { up: 0, down: 0, total: 0, approval: null };
    if (row.rating === 'up') out[feat][variant].up++;
    else if (row.rating === 'down') out[feat][variant].down++;
  }
  for (const feat of Object.keys(out)) {
    for (const variant of Object.keys(out[feat])) {
      const v = out[feat][variant];
      v.total = v.up + v.down;
      v.approval = v.total > 0 ? Math.round((v.up / v.total) * 100) : null;
    }
  }
  return out;
}
