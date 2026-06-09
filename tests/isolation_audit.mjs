// Pins the isolation auditor: it flags a per-user-table query with no user_id
// scope nearby, and stays quiet for scoped queries, shared tables, and writes
// that carry user_id. This is the guard that keeps the RLS-off boundary tight.
import { findUnscopedUserQueries, USER_TABLES } from '../src/lib/isolationAudit.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error(`${msg || 'eq'}: expected ${B}, got ${A}`); }
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }

test('USER_TABLES covers the obvious per-user tables', () => {
  for (const t of ['positions', 'closed_trades', 'watchlist', 'agent_memory']) ok(USER_TABLES.includes(t), t);
});

test('a scoped single-line query is clean', () => {
  const src = `const { data } = await supabase.from('positions').select('*').eq('user_id', req.user.id);`;
  eq(findUnscopedUserQueries(src), [], 'no flags');
});

test('an unscoped query on a per-user table is flagged', () => {
  const src = `const { data } = await supabase.from('positions').select('*').limit(50);`;
  const flags = findUnscopedUserQueries(src);
  eq(flags.length, 1, 'one flag');
  eq(flags[0].table, 'positions', 'table');
  eq(flags[0].line, 1, 'line');
});

test('a multi-line chain scoped a few lines down is clean', () => {
  const src = [
    "const { data } = await supabase",
    "  .from('closed_trades')",
    "  .select('*')",
    "  .eq('user_id', userId)",
    "  .order('closed_at');",
  ].join('\n');
  eq(findUnscopedUserQueries(src), [], 'scope found in window');
});

test('an insert that carries user_id in the object is clean', () => {
  const src = `await supabase.from('watchlist').insert({ ticker, user_id: req.user.id });`;
  eq(findUnscopedUserQueries(src), [], 'user_id in the row');
});

test('a shared / non-user table is never flagged', () => {
  const src = `await supabase.from('market_summary').select('*'); await supabase.from('ai_cache').select('*');`;
  eq(findUnscopedUserQueries(src), [], 'shared tables ignored');
});

test('two unscoped per-user queries on one line are both caught', () => {
  const src = `supabase.from('positions').select('id'); supabase.from('watchlist').select('id');`;
  const flags = findUnscopedUserQueries(src);
  eq(flags.map(f => f.table), ['positions', 'watchlist'], 'both flagged');
});

test('garbage input never throws', () => {
  for (const bad of [null, undefined, 42, {}]) eq(findUnscopedUserQueries(bad), [], 'empty');
});

let pass = 0, fail = 0;
for (const { n, f } of tests) {
  try { f(); console.log(`ok   ${n}`); pass++; }
  catch (e) { console.log(`FAIL ${n}: ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
