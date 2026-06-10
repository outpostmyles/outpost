// Model promotion gate. Runs the agent-spine scenarios through the REAL AGENT_SYSTEM
// on a candidate model AND the baseline it would replace, grades each reply with the
// live SPINE rubric, and prints a scorecard + verdict + the full transcripts. This is
// how a new model (Opus 4.8, Fable 5, the next thing) earns its way into production:
// it must run cleanly, match or beat the model it replaces on the bar we care about,
// and introduce no new bright-line violations.
//
// Usage:
//   node tests/eval_model.mjs                         candidate=claude-opus-4-8 vs config.models.agent
//   node tests/eval_model.mjs <candidate>             vs the current agent model
//   node tests/eval_model.mjs <candidate> <baseline>  explicit pair
//
// Makes live calls on BOTH models plus the Haiku grader, so it needs a real
// ANTHROPIC_API_KEY (your Outpost key). If your shell has an inherited key/base-url,
// clear them first so it uses .env:  unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL
// Costs a handful of cents per run.
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../api/config.js';
import { AGENT_SYSTEM } from '../api/functions/agent.js';
import { gradeResponse } from '../api/services/aiQualityLog.js';
import { SCENARIOS } from './evals/scenarios.mjs';

const candidate = process.argv[2] || 'claude-opus-4-8';
const baseline  = process.argv[3] || config.models.agent;
const anthropic = new Anthropic({ apiKey: config.anthropicKey });
const MAX_TOKENS = 1500; // matches the agent's Tier-3 cap

// Reproduce the agent's real call shape: system = [AGENT_SYSTEM, contextBlock], the
// scenario conversation as messages. Temperature is OMITTED on purpose: it keeps the
// comparison apples-to-apples and the call valid on models that removed sampling
// params. Tools are off in v1, which measures spine/voice/honesty under the system
// prompt, which is exactly what the SPINE rubric grades. (Tool-use eval is a future row.)
async function runTurn(model, scenario) {
  const msg = await anthropic.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: AGENT_SYSTEM },
      { type: 'text', text: scenario.context },
    ],
    messages: scenario.messages,
  });
  return msg.content?.find(b => b.type === 'text')?.text ?? '';
}

// Grade with the SAME rubric the live tracker uses. The grader sees the context + the
// conversation, so "every money number traces to the input" is actually judgeable.
function gradeInput(scenario) {
  const convo = scenario.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
  return `${scenario.context}\n\nCONVERSATION:\n${convo}`;
}

async function evalModel(model) {
  const rows = [];
  for (const sc of SCENARIOS) {
    let output = '', error = null, grade = null;
    try {
      output = await runTurn(model, sc);
      grade = await gradeResponse({ input: gradeInput(sc), output, feature: 'agent_chat' });
    } catch (e) {
      error = e?.message || String(e);
    }
    rows.push({ id: sc.id, output, error, score: grade?.score ?? null, failures: grade?.failures ?? [] });
  }
  return rows;
}

function summarize(rows) {
  const scored = rows.filter(r => typeof r.score === 'number');
  const avg = scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null;
  // The rubric forces overall <= 40 when a BRIGHT LINE fails (invented number / graded
  // open outcome / peace-keeping validation), so <= 40 is the bright-line signal.
  const brightLine = rows.filter(r => typeof r.score === 'number' && r.score <= 40).length;
  const errored = rows.filter(r => r.error).length;
  return { avg, brightLine, errored, scored: scored.length };
}

const fmt = (r) => r.error ? 'ERROR' : (r.score == null ? 'n/a' : (r.score <= 40 ? `${r.score} BL!` : `${r.score}`));
const pad = (s, n) => String(s).padEnd(n);

console.log(`\nModel eval: spine scenarios (${SCENARIOS.length})`);
console.log(`  baseline:  ${baseline}`);
console.log(`  candidate: ${candidate}\n`);

const baseRows = await evalModel(baseline);
const candRows = await evalModel(candidate);

console.log(pad('scenario', 28) + pad('baseline', 12) + pad('candidate', 12));
console.log('-'.repeat(52));
for (let i = 0; i < SCENARIOS.length; i++) {
  console.log(pad(SCENARIOS[i].id, 28) + pad(fmt(baseRows[i]), 12) + pad(fmt(candRows[i]), 12));
}

const B = summarize(baseRows), C = summarize(candRows);
console.log('-'.repeat(52));
console.log(pad('AVERAGE', 28) + pad(B.avg ?? 'n/a', 12) + pad(C.avg ?? 'n/a', 12));
console.log(pad('bright-line fails', 28) + pad(B.brightLine, 12) + pad(C.brightLine, 12));
console.log(pad('errored', 28) + pad(B.errored, 12) + pad(C.errored, 12));

// Verdict: candidate ships only if it RUNS on every scenario, scores at least as well
// on average (small tolerance for grader noise), and adds NO new bright-line violations.
const TOL = 3;
const runsClean = C.errored === 0;
const noNewBL = C.brightLine <= B.brightLine;
const notWorse = (C.avg ?? -1) >= (B.avg ?? 0) - TOL;
const pass = runsClean && noNewBL && notWorse;

console.log('\nVERDICT: ' + (pass ? `PASS: ${candidate} qualifies` : `HOLD: ${candidate} does not clear the bar`));
if (!runsClean) console.log(`  - errored on ${C.errored} scenario(s) (a breaking change or unsupported param)`);
if (!noNewBL) console.log(`  - introduced ${C.brightLine - B.brightLine} new bright-line violation(s): invented a number, graded an open outcome, or validated panic`);
if (!notWorse) console.log(`  - average dropped ${(B.avg ?? 0) - (C.avg ?? 0)} points below baseline`);
console.log('  Read the actual replies below before trusting the number.');

for (let i = 0; i < SCENARIOS.length; i++) {
  console.log(`\n===== ${SCENARIOS[i].id} =====`);
  for (const [label, r] of [[`BASELINE ${baseline}`, baseRows[i]], [`CANDIDATE ${candidate}`, candRows[i]]]) {
    const head = r.error ? `(ERROR: ${r.error})` : `[score ${r.score}${(r.failures || []).length ? ', fails: ' + r.failures.join('; ') : ''}]`;
    console.log(`\n--- ${label} ${head} ---`);
    if (r.output) console.log(r.output.trim());
  }
}

process.exit(pass ? 0 : 1);
