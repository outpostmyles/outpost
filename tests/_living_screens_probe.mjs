// One-off live probe for living screeners (NOT in npm test). Verifies the full
// loop end to end against a running server + live Claude/market data:
//   create -> simulate the nightly job (forces newcomers) -> GET shows NEW ->
//   /seen clears it -> /refine reshapes the query and re-runs.
// Creates a throwaway account and deletes it. Makes real AI + market-data calls.
import { persistScreenerRun } from '../api/functions/screeners.js';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3099';
const stamp = Date.now();
const PASSWORD = 'E2eTest1234';

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null; const t = await res.text(); try { json = JSON.parse(t); } catch {}
  return { status: res.status, json };
}

let failures = 0;
function check(label, cond) { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; }

const su = await api('POST', '/api/auth/signup', { body: { email: `live+${stamp}@example.com`, password: PASSWORD, displayName: 'Live' } });
const tok = su.json?.token;
console.log('signup:', su.status, tok ? 'ok' : 'FAILED');
if (!tok) process.exit(1);

// 1. Create (silent run): results land, nothing flagged new.
const created = await api('POST', '/api/screeners', { token: tok, body: { query: 'AI infrastructure stocks' } });
const screen = created.json?.screener;
const r0 = screen?.results || [];
console.log(`\ncreate: ${created.status}, ${r0.length} results`);
check('create flags nothing as new (user is looking)', r0.every(r => !r.isNew));

// 2. Simulate the nightly job on THIS screen with an empty prior, so every fresh
//    name counts as a newcomer. This drives the silent=false path + DB write.
console.log('\nsimulating nightly job (forcing newcomers)...');
await persistScreenerRun({ id: screen.id, user_id: screen.user_id, query: screen.query, results: [] }, { silent: false });

const afterJob = await api('GET', '/api/screeners', { token: tok });
const jobbed = (afterJob.json?.screeners || []).find(s => s.id === screen.id);
const newCount = (jobbed?.results || []).filter(r => r.isNew).length;
console.log(`after job: ${jobbed?.results?.length || 0} results, ${newCount} flagged NEW`);
check('nightly job flags newcomers, GET surfaces them', newCount > 0);

// 3. Opening the screen clears the flags.
await api('POST', `/api/screeners/${screen.id}/seen`, { token: tok });
const afterSeen = await api('GET', '/api/screeners', { token: tok });
const seen = (afterSeen.json?.screeners || []).find(s => s.id === screen.id);
const stillNew = (seen?.results || []).filter(r => r.isNew).length;
check('seen clears the NEW flags', stillNew === 0);

// 4. Refine in plain English: query is reshaped and the screen re-runs.
console.log('\nrefining with "only ones under $200"...');
const refined = await api('POST', `/api/screeners/${screen.id}/refine`, { token: tok, body: { refinement: 'only ones under $200' } });
const rq = refined.json?.screener?.query || '';
const rr = refined.json?.screener?.results || [];
console.log(`refine: ${refined.status}\n  new query: "${rq}"\n  ${rr.length} results: ${rr.map(r => `${r.ticker} $${r.price}`).join(', ')}`);
check('refine changed the saved query', rq && rq !== 'AI infrastructure stocks');
check('refine returned vetted results', rr.length > 0);
check('refine respected the under-$200 constraint', rr.every(r => r.price == null || r.price < 200));

// cleanup
await api('DELETE', `/api/screeners/${screen.id}`, { token: tok });
await api('DELETE', '/api/settings/account', { token: tok, body: { password: PASSWORD } });
console.log('\ncleaned up.');
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures > 0 ? 1 : 0);
