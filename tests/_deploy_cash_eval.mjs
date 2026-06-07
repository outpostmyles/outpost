// Deploy Cash QUALITY eval (founder tool). Runs the recommendation across the
// goal x horizon x portfolio-shape matrix on a live test backend, grades each
// response with Claude using the deploy-cash rubric, and prints a per-cell
// quality report so you can see WHERE the response is weak (by goal, by horizon,
// the worst cells) and fix the prompt there.
//
// Complements tests/_deploy_cash_audit.mjs, which proves the safety RULES hold.
// This one grades how GOOD the answer is. NOT in the hermetic suite: it needs a
// live backend + Claude + a service-role key. The grading CORE is unit-tested in
// tests/deploy_cash_eval.mjs.
//
// Run: PORT=3002 BETA_ALLOWLIST_OPEN=true npm run server   (one terminal)
//      node tests/_deploy_cash_eval.mjs                     (another)
//      EVAL_QUICK=1 node tests/_deploy_cash_eval.mjs        (fast 6-cell pass)

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import {
  DEPLOY_CASH_RUBRIC, buildDeployCashGradePrompt, parseDeployCashGrade, summarizeDeployCashEval,
} from '../api/services/deployCashEval.js';

const API = process.env.AUDIT_API || 'http://localhost:3002';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GRADER_MODEL = 'claude-haiku-4-5-20251001';

// Coarse safe/unsafe gate so the pass rate never rewards a polished answer that
// violates a hard rule. The full rule set lives in _deploy_cash_audit.mjs.
const CASH_EQUIVALENTS = new Set(['SGOV', 'BIL', 'SHV', 'VBIL', 'CASH']);
const INCOME_OR_FIXED = new Set(['BND', 'SCHD', 'VYM', 'AGG', 'TLT', 'IEF', 'KO', 'JNJ', 'PG', 'VZ', 'MO', 'PEP']);
const PRESERVATION_OK = new Set([...CASH_EQUIVALENTS, ...INCOME_OR_FIXED]);
function safetyOk(goal, horizon, options) {
  const tk = (o) => (o.ticker || '').toUpperCase();
  if (horizon === 'this_year') return options.every(o => CASH_EQUIVALENTS.has(tk(o)));
  if (goal === 'preserve') return options.every(o => PRESERVATION_OK.has(tk(o)));
  return true;
}

const PORTFOLIO_SHAPES = {
  empty: [],
  concentrated: [{ ticker: 'AAPL', shares: 20, avgCost: 180 }, { ticker: 'MSFT', shares: 2, avgCost: 380 }],
  diversified: [
    { ticker: 'AAPL', shares: 3, avgCost: 200 }, { ticker: 'MSFT', shares: 2, avgCost: 380 },
    { ticker: 'GOOGL', shares: 4, avgCost: 150 }, { ticker: 'JPM', shares: 4, avgCost: 180 }, { ticker: 'XOM', shares: 6, avgCost: 110 },
  ],
  allBonds: [{ ticker: 'BND', shares: 30, avgCost: 73 }, { ticker: 'SCHD', shares: 60, avgCost: 32 }],
};

const GOALS = ['preserve', 'build_steadily', 'grow_aggressively', 'open'];
const HORIZONS = ['this_year', '1to5', '5plus', 'never'];

// Full goal x horizon grid on a representative book, plus a few stress shapes on
// the highest-risk combos. EVAL_QUICK trims to a fast smoke pass.
function buildMatrix() {
  const cells = [];
  for (const goal of GOALS) for (const horizon of HORIZONS) cells.push({ shape: 'diversified', goal, horizon, amount: 1000 });
  cells.push({ shape: 'concentrated', goal: 'grow_aggressively', horizon: 'never', amount: 1000 });
  cells.push({ shape: 'allBonds', goal: 'grow_aggressively', horizon: 'never', amount: 1000 });
  cells.push({ shape: 'empty', goal: 'build_steadily', horizon: '5plus', amount: 1000 });
  return process.env.EVAL_QUICK ? cells.slice(0, 6) : cells;
}

const authed = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });
async function signup(label) {
  const email = `eval-${label}-${Date.now()}@outpost-test.local`, password = 'EvalPwd1!';
  const res = await fetch(`${API}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, displayName: `Eval ${label}` }) });
  const data = await res.json();
  if (!data.token) throw new Error(`signup failed: ${JSON.stringify(data)}`);
  await sb.from('user_profiles').update({ plan: 'elite', credits_remaining: 50000 }).eq('email', email);
  return { token: data.token, password };
}
async function addPosition(token, p) { return (await fetch(`${API}/api/portfolio/positions`, { method: 'POST', headers: authed(token), body: JSON.stringify(p) })).json(); }
async function deployCash(token, body) { return (await fetch(`${API}/api/ai/deploy-cash`, { method: 'POST', headers: authed(token), body: JSON.stringify(body) })).json(); }
async function getValue(token) { return (await fetch(`${API}/api/portfolio/value`, { headers: authed(token) })).json(); }
async function cleanup(token, password) { await fetch(`${API}/api/settings/account`, { method: 'DELETE', headers: authed(token), body: JSON.stringify({ password }) }).catch(() => {}); }

async function grade(caseInfo) {
  try {
    const msg = await anthropic.messages.create({
      model: GRADER_MODEL, max_tokens: 500, system: DEPLOY_CASH_RUBRIC,
      messages: [{ role: 'user', content: buildDeployCashGradePrompt(caseInfo) }],
    });
    return parseDeployCashGrade(msg.content?.[0]?.text);
  } catch (e) { console.error('  grade failed:', e.message); return null; }
}

async function run() {
  const matrix = buildMatrix();
  console.log(`\nDeploy Cash quality eval - ${matrix.length} cells\n`);
  const byShape = {};
  for (const c of matrix) (byShape[c.shape] ||= []).push(c);

  const cells = [];
  for (const [shape, cases] of Object.entries(byShape)) {
    const user = await signup(shape);
    try {
      for (const p of PORTFOLIO_SHAPES[shape]) await addPosition(user.token, p);
      const value = await getValue(user.token);
      const portfolio = (value.positions || []).map(p => ({ ticker: p.ticker, value: p.currentValue }));
      for (const c of cases) {
        const label = `${c.goal} x ${c.horizon} / ${shape}`;
        const resp = await deployCash(user.token, { amount: c.amount, time_horizon: c.horizon, goal: c.goal });
        const options = resp?.options || [];
        if (resp?.error || options.length === 0) {
          console.log(`   --  ${label}: no options (${resp?.error || 'empty'})`);
          cells.push({ label, goal: c.goal, horizon: c.horizon, safetyOk: false, quality: null });
          continue;
        }
        const quality = await grade({ amount: c.amount, goal: c.goal, horizon: c.horizon, portfolio, options });
        const safe = safetyOk(c.goal, c.horizon, options);
        cells.push({ label, goal: c.goal, horizon: c.horizon, safetyOk: safe, quality });
        console.log(`  ${quality ? String(quality.overall).padStart(3) : ' --'}  ${safe ? '   ' : 'UNSAFE'}  ${label}${quality?.notes ? ` - ${quality.notes}` : ''}`);
      }
    } finally { await cleanup(user.token, user.password); }
  }

  const s = summarizeDeployCashEval(cells, { qualityThreshold: 80 });
  console.log(`\n=== Deploy Cash quality matrix ===`);
  console.log(`Graded ${s.graded}/${s.total}, avg ${s.avgScore ?? 'n/a'}, pass rate ${s.passRate}% (safe AND >=80)`);
  console.log(`By goal:    ${Object.entries(s.byGoal).map(([k, v]) => `${k} ${v}`).join('   ')}`);
  console.log(`By horizon: ${Object.entries(s.byHorizon).map(([k, v]) => `${k} ${v}`).join('   ')}`);
  if (s.unsafe.length) console.log(`Unsafe cells: ${s.unsafe.join(', ')}`);
  if (s.weakest.length) { console.log(`Weakest cells (fix these prompts first):`); s.weakest.forEach(w => console.log(`  ${w.overall}  ${w.label}${w.notes ? ` - ${w.notes}` : ''}`)); }
}

run().catch(err => { console.error(err); process.exit(1); });
