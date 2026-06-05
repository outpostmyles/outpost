// Deterministic test runner. Runs the curated, hermetic suite (pure logic, or
// the in-process Express app on an ephemeral port, no live DB / network / API
// keys) and exits non-zero if anything fails. Invoked by `npm test`.
//
// Probes, evals, and anything needing real services live in tests/ too but are
// intentionally NOT in this suite (they hit Supabase, Polygon, or Claude). New
// hermetic tests should be added to SUITE below.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const SUITE = [
  'bargain_verdicts', 'trade_scorecard', 'accountability_nudge', 'pulse_context', 'plan_alerts',
  'daily_round', 'goal_progress', 'goal_projection', 'position_health', 'portfolio_risk', 'stress_test',
  'coaching', 'recurring_patterns', 'personalize_discover', 'sector_exposure', 'sector_gaps', 'growth_arc',
  'plan_credits', 'alert_rules', 'fuzz_robustness', 'validate_sanitizers', 'cache_dedup', 'market_hours',
  'format_helpers', 'memory_cache', 'trade_math', 'indicators', 'pre_trade_risk', 'price_sanitize',
  'plan_adherence', 'performance_attribution', 'market_regime', 'position_status', 'integration_smoke',
  'discover_ranker', 'ticker_extract', 'journal_search', 'note_match', 'patterns_resilient',
  'today_composite', 'injection_wrap', 'notices', 'history_recall', 'agent_opener',
  'screener_verdicts', 'screener_diff', 'screener_constraints', 'sector_map', 'research_dossier',
  'portfolio_actions', 'thesis_watch', 'read_continuity', 'decision_memory', 'journal_prompts',
  'composure', 'coach_reachout', 'quote_normalize', 'book_stats', 'ai_style', 'news_hygiene',
  'brokerage_sync', 'decision_ledger', 'agent_conversations', 'position_proposal',
  'ai_pricing', 'ai_usage_summary', 'synthesis_freshness', 'founder_brief', 'process_scorecard',
];

// Strip the harness-injected Anthropic vars so children load keys from .env via
// dotenv (some tests import modules that validate config on load).
const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_BASE_URL;

let pass = 0, fail = 0, assertions = 0;
const failed = [];
const t0 = process.hrtime.bigint();

for (const name of SUITE) {
  const file = path.join(here, `${name}.mjs`);
  const r = spawnSync('node', [file], { env, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+)\/(\d+) passed/);
  if (m) assertions += Number(m[2]);
  if (r.status === 0) {
    pass++;
    console.log(`ok    ${name}${m ? `  (${m[2]} assertions)` : ''}`);
  } else {
    fail++;
    failed.push(name);
    console.log(`FAIL  ${name}`);
    out.split('\n')
      .filter(l => /FAIL|Error|Cannot|not a function|not iterable/.test(l))
      .slice(0, 5)
      .forEach(l => console.log(`        ${l.trim()}`));
  }
}

// Surface hermetic-looking test files not in the suite, so new tests are not
// silently forgotten (probes/evals are expected to appear here).
const onDisk = readdirSync(here)
  .filter(f => f.endsWith('.mjs') && f !== 'run-all.mjs')
  .map(f => f.replace(/\.mjs$/, ''));
const notInSuite = onDisk.filter(n => !SUITE.includes(n));

const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
console.log('\n' + '-'.repeat(52));
console.log(`${pass}/${pass + fail} suite files passed, ~${assertions} assertions, ${ms}ms`);
if (notInSuite.length) {
  console.log(`(${notInSuite.length} file(s) outside the deterministic suite: ${notInSuite.join(', ')})`);
}
if (fail) console.log(`FAILED: ${failed.join(', ')}`);
process.exit(fail > 0 ? 1 : 0);
