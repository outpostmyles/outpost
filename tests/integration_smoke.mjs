// Integration smoke test: boots the REAL Express app (all middleware + routes
// wired exactly as in production) on an ephemeral port and exercises the
// request lifecycle. Deliberately hermetic: every assertion here is answered by
// the middleware chain BEFORE any handler touches the database or an external
// API (auth gate, 404, security headers, request id, body-parse), so it needs
// no live DB or API keys and stays deterministic.
import assert from 'node:assert/strict';
import { app } from '../api/server.js';

const server = app.listen(0);
await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

async function req(method, path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  let body;
  if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json); }
  if (opts.raw !== undefined) { headers['Content-Type'] = 'application/json'; body = opts.raw; }
  const res = await fetch(`${base}${path}`, { method, headers, body });
  let json = null; const text = await res.text();
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, headers: res.headers };
}

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('unknown API route returns a JSON 404 (not Express HTML)', async () => {
  const r = await req('GET', '/api/this-does-not-exist');
  assert.equal(r.status, 404);
  assert.ok(r.json && r.json.error, 'expected a JSON body with an error field');
});

test('a protected route with no token returns 401 (gated before any DB call)', async () => {
  const r = await req('GET', '/api/portfolio/value');
  assert.equal(r.status, 401);
  assert.ok(r.json && r.json.error);
});

test('every response carries an X-Request-Id header', async () => {
  const r = await req('GET', '/api/this-does-not-exist');
  assert.ok(r.headers.get('x-request-id'), 'expected X-Request-Id to be set');
});

test('security headers are present on responses', async () => {
  const r = await req('GET', '/api/this-does-not-exist');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('a malformed JSON body returns 400, not 500', async () => {
  const r = await req('POST', '/api/auth/login', { raw: '{ this is not json' });
  assert.equal(r.status, 400);
  assert.ok(r.json && r.json.error);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { await t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
server.close();
process.exit(fail > 0 ? 1 : 0);
