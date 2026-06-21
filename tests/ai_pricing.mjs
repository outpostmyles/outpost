// Pins the Claude cost math (src/lib/aiPricing.js): tier resolution by model
// substring, per-token pricing including the cheap cached tokens, and the
// never-under-report fallback for an unknown model.
import assert from 'node:assert/strict';
import { rateForModel, priceUsage } from '../src/lib/aiPricing.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('resolves model ids to the right tier by substring', () => {
  assert.equal(rateForModel('claude-sonnet-4-20250514').tier, 'sonnet');
  assert.equal(rateForModel('claude-haiku-4-5-20251001').tier, 'haiku');
  assert.equal(rateForModel('claude-3-opus-20240229').tier, 'opus');
});

test('an unknown model falls back to the sonnet tier and never under-reports', () => {
  const r = rateForModel('some-future-model');
  assert.equal(r.tier, 'unknown');
  assert.equal(r.input, 3);   // sonnet input rate
  assert.equal(r.output, 15); // sonnet output rate
});

test('prices plain input + output at the model rate', () => {
  // 1,000,000 input + 1,000,000 output on sonnet = $3 + $15 = $18
  const p = priceUsage('claude-sonnet-4-20250514', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.ok(close(p.costUsd, 18));
  assert.equal(p.inputTokens, 1_000_000);
  assert.equal(p.outputTokens, 1_000_000);
});

test('opus is priced at the current 4.x list rate ($5 in / $25 out), not the legacy $15/$75', () => {
  const r = rateForModel('claude-opus-4-8');
  assert.equal(r.tier, 'opus');
  assert.equal(r.input, 5);   // Opus 4.x input rate (was wrongly $15 — legacy Claude-3 Opus)
  assert.equal(r.output, 25); // Opus 4.x output rate (was wrongly $75)
  // 1M input + 1M output on opus = $5 + $25 = $30
  const p = priceUsage('claude-opus-4-8', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.ok(close(p.costUsd, 30), `expected $30, got ${p.costUsd}`);
  // cache rates follow the 1.25x-write / 0.1x-read convention off the $5 input: 6.25 + 0.5 = $6.75
  const c = priceUsage('claude-opus-4-8', { cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 });
  assert.ok(close(c.costUsd, 6.75), `expected $6.75, got ${c.costUsd}`);
});

test('haiku is cheaper than sonnet for the same usage', () => {
  const u = { input_tokens: 500_000, output_tokens: 200_000 };
  const haiku = priceUsage('claude-haiku-4-5-20251001', u).costUsd;
  const sonnet = priceUsage('claude-sonnet-4-20250514', u).costUsd;
  assert.ok(haiku < sonnet, `expected haiku ${haiku} < sonnet ${sonnet}`);
  // haiku: 0.5*1 + 0.2*5 = 0.5 + 1.0 = $1.50
  assert.ok(close(haiku, 1.5));
});

test('cached tokens are priced at the cache rates, not full input', () => {
  // sonnet: cache_read 0.3/Mtok, cache_write 3.75/Mtok
  const p = priceUsage('claude-sonnet-4-20250514', {
    input_tokens: 0, output_tokens: 0,
    cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000,
  });
  // 1*0.3 + 1*3.75 = $4.05
  assert.ok(close(p.costUsd, 4.05));
  assert.equal(p.cacheReadTokens, 1_000_000);
  assert.equal(p.cacheWriteTokens, 1_000_000);
});

test('missing or junk usage prices to zero, never NaN', () => {
  assert.equal(priceUsage('claude-sonnet-4-20250514', {}).costUsd, 0);
  assert.equal(priceUsage('claude-sonnet-4-20250514').costUsd, 0);
  const p = priceUsage('claude-haiku-4-5-20251001', { input_tokens: 'abc', output_tokens: -5 });
  assert.equal(p.costUsd, 0);
  assert.equal(p.inputTokens, 0);
  assert.equal(p.outputTokens, 0);
});

test('a realistic small Haiku call rounds to a sane sub-cent cost', () => {
  // 1,200 input + 400 output on haiku = 1200*1 + 400*5 = 1200 + 2000 = 3200 / 1e6 = $0.0032
  const p = priceUsage('claude-haiku-4-5-20251001', { input_tokens: 1200, output_tokens: 400 });
  assert.ok(close(p.costUsd, 0.0032));
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
