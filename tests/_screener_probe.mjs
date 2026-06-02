// One-off live probe for the screener engine (NOT in npm test). Creates a
// throwaway account, runs a real screener against live data + Claude, prints the
// vetted results, then deletes the account. Makes real AI + market-data calls.
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

const su = await api('POST', '/api/auth/signup', { body: { email: `scrn+${stamp}@example.com`, password: PASSWORD, displayName: 'Scr' } });
const tok = su.json?.token;
console.log('signup:', su.status, tok ? 'ok' : 'FAILED');
if (!tok) process.exit(1);

console.log('creating screener "AI infrastructure stocks" (runs the live pipeline)...');
const created = await api('POST', '/api/screeners', { token: tok, body: { query: 'AI infrastructure stocks' } });
console.log('create:', created.status);
const results = created.json?.screener?.results || [];
console.log(`\nVETTED RESULTS (${results.length}):`);
for (const r of results) console.log(`  ${r.ticker}  $${r.price}  ${r.changePercent != null ? (r.changePercent >= 0 ? '+' : '') + Number(r.changePercent).toFixed(1) + '%' : ''}\n    ${r.thesis}`);

const list = await api('GET', '/api/screeners', { token: tok });
console.log(`\nlist returns ${(list.json?.screeners || []).length} screener(s)`);

await api('DELETE', `/api/screeners/${created.json?.screener?.id}`, { token: tok });
await api('DELETE', '/api/settings/account', { token: tok, body: { password: PASSWORD } });
console.log('cleaned up.');
process.exit(results.length > 0 ? 0 : 2);
