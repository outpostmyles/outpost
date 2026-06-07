// Pins the Deploy Cash quality-eval core: the grade parser fails closed, and the
// matrix rollup only counts a cell as passing when it is BOTH safe and high
// quality. Pure, no IO (the Claude call + live matrix run live in the founder
// tool tests/_deploy_cash_eval.mjs).
import { parseDeployCashGrade, summarizeDeployCashEval, buildDeployCashGradePrompt } from '../api/services/deployCashEval.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg || 'eq'}: expected ${B}, got ${A}`); }
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }

test('parse: a valid grade survives surrounding noise', () => {
  const g = parseDeployCashGrade('here you go {"scores":{"FILTER_FIT":1,"HONEST":0},"overall":85,"failures":["x"],"notes":"ok"} done');
  eq(g.overall, 85, 'overall');
  eq(g.scores.FILTER_FIT, 1, 'score');
  eq(g.failures, ['x'], 'failures');
});

test('parse: an out-of-range overall is rejected', () => {
  eq(parseDeployCashGrade('{"overall":140}'), null, 'too high');
  eq(parseDeployCashGrade('{"overall":-5}'), null, 'negative');
  eq(parseDeployCashGrade('{"overall":"high"}'), null, 'non-numeric');
});

test('parse: junk returns null, never a fake grade', () => {
  eq(parseDeployCashGrade('no json here'), null, 'no json');
  eq(parseDeployCashGrade(''), null, 'empty');
  eq(parseDeployCashGrade('{bad json'), null, 'broken');
});

test('parse: missing optional fields default cleanly', () => {
  const g = parseDeployCashGrade('{"overall":70}');
  eq(g.overall, 70, 'overall');
  eq(g.scores, {}, 'scores default');
  eq(g.failures, [], 'failures default');
});

test('summarize: avg, pass rate (safe AND high quality), and breakdowns', () => {
  const cells = [
    { label: 'a', goal: 'preserve', horizon: 'this_year', safetyOk: true, quality: { overall: 90, notes: '' } },
    { label: 'b', goal: 'preserve', horizon: 'never', safetyOk: true, quality: { overall: 70, notes: 'generic' } },
    { label: 'c', goal: 'grow_aggressively', horizon: 'never', safetyOk: false, quality: { overall: 95, notes: '' } }, // unsafe: cannot pass
    { label: 'd', goal: 'grow_aggressively', horizon: '5plus', safetyOk: true, quality: null }, // ungraded
  ];
  const s = summarizeDeployCashEval(cells, { qualityThreshold: 80 });
  eq(s.total, 4, 'total');
  eq(s.graded, 3, 'graded');
  eq(s.avgScore, 85, 'avg of graded'); // (90+70+95)/3
  eq(s.passRate, 25, 'only a passes (safe + >=80)'); // 1 of 4
  eq(s.byGoal.preserve, 80, 'preserve avg'); // (90+70)/2
  eq(s.byGoal.grow_aggressively, 95, 'aggressive avg (only graded one)');
  eq(s.unsafe, ['c'], 'unsafe list');
  eq(s.weakest[0].label, 'b', 'weakest first');
});

test('summarize: empty is safe', () => {
  const s = summarizeDeployCashEval([]);
  eq(s.total, 0, 'total'); eq(s.graded, 0, 'graded'); eq(s.avgScore, null, 'avg'); eq(s.passRate, 0, 'passRate');
});

test('prompt: carries goal, horizon, the book, and the options', () => {
  const p = buildDeployCashGradePrompt({
    amount: 1000, goal: 'preserve', horizon: 'this_year',
    portfolio: [{ ticker: 'AAPL', value: 5000 }],
    options: [{ ticker: 'SGOV', title: 'T-bills', estimated_cost: 1000, action_summary: 'park it safely' }],
  });
  ok(/preserve/.test(p), 'goal');
  ok(/this year/.test(p), 'horizon');
  ok(/SGOV/.test(p), 'option ticker');
  ok(/AAPL/.test(p), 'book');
  ok(/\$1000/.test(p), 'amount');
});

let pass = 0, fail = 0;
for (const { n, f } of tests) {
  try { f(); console.log(`ok   ${n}`); pass++; }
  catch (e) { console.log(`FAIL ${n}: ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
