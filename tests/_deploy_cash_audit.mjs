// Deploy Cash filter-matrix audit. Tests the highest-risk combinations
// across multiple portfolio shapes and ASSERTS that the safety rules hold:
//
//   R1. horizon=this_year → ALL options must be cash-equivalents (no stocks)
//   R2. goal=preserve → NO speculative growth picks; only income / fixed-income / cash-eq
//   R3. ADD TO EXISTING positions: resulting concentration must be ≤ cap
//      (20% aggressive, 15% default)
//   R4. Each option (non-cash-eq) deploys ≥70% of amount OR action_summary
//      includes a "uses only $X / stays in cash" callout
//   R5. Tickers already over the cap should NOT be recommended for ADD TO EXISTING
//
// Run: node tests/_deploy_cash_audit.mjs
// Requires the test backend running on PORT=3002 BETA_ALLOWLIST_OPEN=true.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const API = process.env.AUDIT_API || 'http://localhost:3002';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const CASH_EQUIVALENTS = new Set(['SGOV', 'BIL', 'SHV', 'VBIL', 'CASH']);
const INCOME_OR_FIXED = new Set(['BND', 'SCHD', 'VYM', 'AGG', 'TLT', 'IEF', 'KO', 'JNJ', 'PG', 'VZ', 'MO', 'PEP']);
const PRESERVATION_OK = new Set([...CASH_EQUIVALENTS, ...INCOME_OR_FIXED]);

let pass = 0, fail = 0;
const failures = [];

function check(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

async function signupTestUser(label) {
  const email = `audit-${label}-${Date.now()}@outpost-test.local`;
  const password = 'AuditPwd1!';
  const res = await fetch(`${API}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName: `Audit ${label}` }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`signup failed: ${JSON.stringify(data)}`);
  // Bump to elite + credits so we can spam deploy-cash
  await sb.from('user_profiles').update({ plan: 'elite', credits_remaining: 50000 }).eq('email', email);
  return { token: data.token, email, password };
}

async function addPosition(token, p) {
  const res = await fetch(`${API}/api/portfolio/positions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(p),
  });
  return res.json();
}

async function deployCash(token, body) {
  const res = await fetch(`${API}/api/ai/deploy-cash`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function cleanupUser(token, password) {
  await fetch(`${API}/api/settings/account`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  });
}

async function getValue(token) {
  const res = await fetch(`${API}/api/portfolio/value`, { headers: { Authorization: `Bearer ${token}` } });
  return res.json();
}

// Asserts a single deploy-cash response against the rules.
function assertSafety(label, response, opts) {
  const { horizon, goal, amount, currentPositions } = opts;
  const isAggressive = goal === 'grow_aggressively';
  const cap = isAggressive ? 0.20 : 0.15;
  const options = response?.options ?? [];

  check(options.length >= 2 && options.length <= 3, `${label}: returns 2-3 options`, `got ${options.length}`);

  // R1 — this_year → cash-equivalents only
  if (horizon === 'this_year') {
    const allCashEq = options.every(o => CASH_EQUIVALENTS.has((o.ticker || '').toUpperCase()));
    check(allCashEq, `${label}: R1 this_year → cash-equivalents only`,
      allCashEq ? '' : `non-cash tickers: ${options.filter(o => !CASH_EQUIVALENTS.has((o.ticker||'').toUpperCase())).map(o => o.ticker).join(',')}`);
  }

  // R2 — preserve → no speculative growth picks
  if (goal === 'preserve') {
    const allSafe = options.every(o => {
      const t = (o.ticker || '').toUpperCase();
      // Allow either preservation-approved OR cash-equivalent
      return PRESERVATION_OK.has(t);
    });
    check(allSafe, `${label}: R2 preserve → only income/fixed-income/cash-eq`,
      allSafe ? '' : `non-preservation tickers: ${options.filter(o => !PRESERVATION_OK.has((o.ticker||'').toUpperCase())).map(o => o.ticker).join(',')}`);
  }

  // R3 + R5 — for ADD TO EXISTING options, check resulting concentration ≤ cap
  // and tickers already over cap should never be recommended
  const projectedTotal = (response.options.reduce((s,o) => s, 0) || 0); // placeholder
  const portfolioTotal = currentPositions.reduce((s, p) => s + p.value, 0);
  const projected = portfolioTotal + amount;
  for (const opt of options) {
    const t = (opt.ticker || '').toUpperCase();
    const existing = currentPositions.find(p => p.ticker === t);
    if (existing) {
      const currentPct = existing.value / portfolioTotal;
      const proposedAdd = opt.estimated_cost || 0;
      const resultingPct = (existing.value + proposedAdd) / projected;
      check(resultingPct <= cap + 0.005, `${label}: R3 ${t} resulting concentration ≤ ${(cap*100).toFixed(0)}%`,
        `resulting ${(resultingPct*100).toFixed(1)}%`);
      check(currentPct < cap + 0.005, `${label}: R5 ${t} not recommended despite being already over cap`,
        `current ${(currentPct*100).toFixed(1)}%`);
    }
  }

  // R4 — each non-cash-eq option deploys ≥70% of amount OR notes the sub-deploy
  for (const opt of options) {
    const t = (opt.ticker || '').toUpperCase();
    if (CASH_EQUIVALENTS.has(t)) continue;
    const deployed = opt.estimated_cost || 0;
    const ratio = deployed / amount;
    const hasNote = /uses only \$|stays in cash/i.test(opt.action_summary || '');
    const ok = ratio >= 0.7 || hasNote;
    check(ok, `${label}: R4 ${t} deploys ≥70% or notes sub-deploy`,
      `deployed $${deployed} of $${amount} (${(ratio*100).toFixed(0)}%) ${hasNote ? '+note' : 'NO NOTE'}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// PORTFOLIO SHAPES
// ───────────────────────────────────────────────────────────────────────────

const PORTFOLIO_SHAPES = {
  empty: { name: 'empty (new user)', positions: [] },

  concentrated: {
    name: 'highly concentrated (one 60%+ name)',
    positions: [
      { ticker: 'AAPL', shares: 20, avgCost: 180 },   // dominant position
      { ticker: 'MSFT', shares: 2, avgCost: 380 },
    ],
  },

  diversified: {
    name: 'diversified (5 names ~equal)',
    positions: [
      { ticker: 'AAPL', shares: 3, avgCost: 200 },
      { ticker: 'MSFT', shares: 2, avgCost: 380 },
      { ticker: 'GOOGL', shares: 4, avgCost: 150 },
      { ticker: 'JPM', shares: 4, avgCost: 180 },
      { ticker: 'XOM', shares: 6, avgCost: 110 },
    ],
  },

  allBonds: {
    name: 'all bonds (preservation-style)',
    positions: [
      { ticker: 'BND', shares: 30, avgCost: 73 },
      { ticker: 'SCHD', shares: 60, avgCost: 32 },
    ],
  },
};

const CASES = [
  // R1 — this_year scenarios across multiple goals
  { label: 'this_year × aggressive (CONFLICT)',     shape: 'diversified', body: { amount: 1000, time_horizon: 'this_year', goal: 'grow_aggressively' } },
  { label: 'this_year × build_steadily',            shape: 'diversified', body: { amount: 1000, time_horizon: 'this_year', goal: 'build_steadily' } },
  { label: 'this_year × preserve',                   shape: 'diversified', body: { amount: 1000, time_horizon: 'this_year', goal: 'preserve' } },
  { label: 'this_year × open',                       shape: 'diversified', body: { amount: 1000, time_horizon: 'this_year', goal: 'open' } },

  // R2 — preserve goal across horizons
  { label: 'preserve × never',                       shape: 'concentrated', body: { amount: 1000, time_horizon: 'never', goal: 'preserve' } },
  { label: 'preserve × 5plus',                       shape: 'concentrated', body: { amount: 1000, time_horizon: '5plus', goal: 'preserve' } },
  { label: 'preserve × 1to5',                        shape: 'concentrated', body: { amount: 1000, time_horizon: '1to5', goal: 'preserve' } },

  // R3 + R5 — aggressive on a concentrated portfolio (compound concentration)
  { label: 'aggressive × never on CONCENTRATED book',  shape: 'concentrated', body: { amount: 1000, time_horizon: 'never', goal: 'grow_aggressively' } },
  { label: 'aggressive × 5plus on CONCENTRATED book',  shape: 'concentrated', body: { amount: 1000, time_horizon: '5plus', goal: 'grow_aggressively' } },

  // Empty portfolio (no positions to add to)
  { label: 'aggressive × never on EMPTY book',         shape: 'empty', body: { amount: 1000, time_horizon: 'never', goal: 'grow_aggressively' } },
  { label: 'steady × 5plus on EMPTY book',             shape: 'empty', body: { amount: 1000, time_horizon: '5plus', goal: 'build_steadily' } },

  // Bond portfolio + aggressive (opposite-direction holdings)
  { label: 'aggressive × never on ALL-BONDS book',     shape: 'allBonds', body: { amount: 1000, time_horizon: 'never', goal: 'grow_aggressively' } },

  // Amount variation
  { label: 'amount=$100 aggressive never diversified', shape: 'diversified', body: { amount: 100, time_horizon: 'never', goal: 'grow_aggressively' } },
  { label: 'amount=$5000 aggressive never diversified',shape: 'diversified', body: { amount: 5000, time_horizon: 'never', goal: 'grow_aggressively' } },
];

// ───────────────────────────────────────────────────────────────────────────
// RUN
// ───────────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\nDeploy Cash audit — ${CASES.length} cases\n`);

  // Test each portfolio shape with the relevant cases. Group by shape so we
  // don't re-create the user portfolio for each case.
  const grouped = {};
  for (const c of CASES) { (grouped[c.shape] ||= []).push(c); }

  for (const [shapeKey, cases] of Object.entries(grouped)) {
    const shape = PORTFOLIO_SHAPES[shapeKey];
    console.log(`\n━━━ Portfolio: ${shape.name} ━━━`);
    const user = await signupTestUser(shapeKey);
    try {
      // Seed positions
      for (const p of shape.positions) {
        await addPosition(user.token, p);
      }
      // Fetch live values once so we can assert concentration
      const value = await getValue(user.token);
      const currentPositions = (value.positions || []).map(p => ({ ticker: p.ticker, value: p.currentValue }));

      // Run each case
      for (const c of cases) {
        console.log(`\n[${c.label}]`);
        try {
          const resp = await deployCash(user.token, c.body);
          if (resp.error) {
            check(false, `${c.label}: endpoint returned error`, resp.error);
            continue;
          }
          // Pretty-print options
          for (const o of resp.options || []) {
            console.log(`    [${o.ticker || '?'}] ${o.title || '?'} — $${o.estimated_cost || 0}`);
          }
          assertSafety(c.label, resp, {
            horizon: c.body.time_horizon,
            goal: c.body.goal,
            amount: c.body.amount,
            currentPositions,
          });
        } catch (err) {
          check(false, `${c.label}: case crashed`, err.message);
        }
      }
    } finally {
      await cleanupUser(user.token, user.password).catch(() => {});
    }
  }

  console.log(`\n━━━ Summary ━━━`);
  console.log(`Passed: ${pass}`);
  console.log(`Failed: ${fail}`);
  if (failures.length) {
    console.log(`\nFailures:`);
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
