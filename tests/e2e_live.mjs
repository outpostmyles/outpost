// LIVE end-to-end test. NOT hermetic and NOT part of `npm test`.
//
// Drives the running server against the REAL Supabase to prove the things a
// hermetic test cannot: that auth, own-data CRUD, and CROSS-USER ISOLATION hold
// end to end. Since RLS is intentionally off and isolation is enforced only in
// the Express layer, this is the single most important safety property in the
// app, and this is the only test that actually exercises it against the live DB.
//
// It creates two throwaway accounts (clearly-fake @example.com emails) and
// DELETES them and all their data at the end, even if an assertion fails.
//
// Run it with the server up:
//   npm run server             # terminal 1 (loads .env -> real Supabase)
//   node tests/e2e_live.mjs    # terminal 2
// Point at a different host with E2E_BASE=http://127.0.0.1:3001

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:3001';
const stamp = Date.now();
const PASSWORD = 'E2eTest1234';

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { status: 0, json: null, netError: e.message };
  }
  let json = null; const text = await res.text();
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log(`ok    ${label}`); passed++; }
  else { console.log(`FAIL  ${label}`); failed++; }
}

const accounts = []; // { token, password } captured for cleanup

async function main() {
  // Preflight: is the server reachable?
  const health = await api('GET', '/api/health');
  if (health.status === 0) {
    console.log(`Server not reachable at ${BASE}. Start it with: npm run server`);
    failed++;
    return;
  }

  const aEmail = `e2e+a-${stamp}@example.com`;
  const bEmail = `e2e+b-${stamp}@example.com`;

  // 1. Two throwaway signups -> real tokens
  const aSignup = await api('POST', '/api/auth/signup', { body: { email: aEmail, password: PASSWORD, displayName: 'E2E A' } });
  check('signup A returns a token', aSignup.status === 200 && !!aSignup.json?.token);
  const aTok = aSignup.json?.token;
  if (aTok) accounts.push({ token: aTok, password: PASSWORD });

  const bSignup = await api('POST', '/api/auth/signup', { body: { email: bEmail, password: PASSWORD, displayName: 'E2E B' } });
  check('signup B returns a token', bSignup.status === 200 && !!bSignup.json?.token);
  const bTok = bSignup.json?.token;
  if (bTok) accounts.push({ token: bTok, password: PASSWORD });

  if (!aTok || !bTok) { console.log('Cannot continue without both tokens.'); return; }

  // 2. A adds a position (SPY validates against the real price feed)
  const add = await api('POST', '/api/portfolio/positions', { token: aTok, body: { ticker: 'SPY', shares: 1, avgCost: 100 } });
  check('A can add a position', add.status === 200 && !!add.json?.position?.id);
  const posId = add.json?.position?.id;
  if (add.status !== 200) console.log(`      (add error: ${JSON.stringify(add.json)})`);

  // 3. A reads it back
  const aVal = await api('GET', '/api/portfolio/value', { token: aTok });
  check('A sees their own position', (aVal.json?.positions ?? []).some(p => p.id === posId));

  // 4. ISOLATION (read): B must not see A's position
  const bVal = await api('GET', '/api/portfolio/value', { token: bTok });
  check("ISOLATION: B cannot SEE A's position", !(bVal.json?.positions ?? []).some(p => p.id === posId));

  // 5. ISOLATION (modify): B's PATCH must not touch A's row (proof = A re-reads unchanged)
  await api('PATCH', `/api/portfolio/positions/${posId}`, { token: bTok, body: { entryThesis: 'INJECTED BY B' } });
  const aAfterPatch = await api('GET', '/api/portfolio/value', { token: aTok });
  const aPos = (aAfterPatch.json?.positions ?? []).find(p => p.id === posId);
  check("ISOLATION: B cannot MODIFY A's position", !!aPos && aPos.entry_thesis !== 'INJECTED BY B');

  // 6. ISOLATION (delete): B's DELETE must not remove A's row
  await api('DELETE', `/api/portfolio/positions/${posId}`, { token: bTok });
  const aAfterDel = await api('GET', '/api/portfolio/value', { token: aTok });
  check("ISOLATION: B cannot DELETE A's position", (aAfterDel.json?.positions ?? []).some(p => p.id === posId));

  // 7. A can modify their own
  await api('PATCH', `/api/portfolio/positions/${posId}`, { token: aTok, body: { entryThesis: 'my real thesis' } });
  const aOwn = await api('GET', '/api/portfolio/value', { token: aTok });
  check('A can modify their own position', (aOwn.json?.positions ?? []).find(p => p.id === posId)?.entry_thesis === 'my real thesis');

  // 8. A can delete their own
  await api('DELETE', `/api/portfolio/positions/${posId}`, { token: aTok });
  const aGone = await api('GET', '/api/portfolio/value', { token: aTok });
  check('A can delete their own position', !(aGone.json?.positions ?? []).some(p => p.id === posId));
}

async function cleanup() {
  console.log('\n--- cleanup ---');
  for (const acct of accounts) {
    const r = await api('DELETE', '/api/settings/account', { token: acct.token, body: { password: acct.password } });
    console.log(`  account delete: ${r.status === 200 ? 'ok' : `FAILED (status ${r.status}) — may need manual cleanup`}`);
  }
}

try {
  await main();
} catch (e) {
  console.log(`\nUnexpected error: ${e.message}`);
  failed++;
} finally {
  await cleanup();
}

console.log('\n' + '='.repeat(52));
console.log(`${passed}/${passed + failed} checks passed`);
if (failed === 0 && passed > 0) console.log('AUTH + OWN-DATA CRUD + CROSS-USER ISOLATION HOLD END TO END');
process.exit(failed > 0 ? 1 : 0);
