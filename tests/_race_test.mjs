import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const API = 'http://localhost:3002';
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Wait for /signup rate limit to clear (60s window).
async function waitForRateLimit() {
  for (let i = 0; i < 90; i++) {
    const res = await fetch(`${API}/api/auth/signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.status === 400) return; // bad-input 400 means rate limit cleared
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('rate limit never cleared');
}

await waitForRateLimit();
console.log('rate limit cleared, proceeding');

const email = `race-${Date.now()}@outpost-test.local`;
const signupRes = await fetch(`${API}/api/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: 'GoodPass1234', displayName: 'Race' }),
});
const signup = await signupRes.json();
const token = signup.token;
if (!token) {
  console.error('no token returned:', signup);
  process.exit(1);
}

// Upgrade to elite + set credits to exactly 30
await sb.from('user_profiles').update({ plan: 'elite', credits_remaining: 30, credits_used_this_month: 0 }).eq('email', email);

console.log('═══ P0-2 RACE TEST ═══');
console.log('Starting credits: 30. Firing 12 concurrent /analysis (3 credits each).');
console.log('Atomic: 10 should succeed, 2 should hit insufficient-credits. Final remaining = 0.');
console.log('Pre-fix race: any of: negative balance, > 0 remaining despite 10 success, lost deductions.');
console.log('');

const FIRE = 12; // 12 × 3 = 36 attempted, but only 30 credits = 2 should be rejected
const results = await Promise.all(
  Array.from({ length: FIRE }, () =>
    fetch(`${API}/api/ai/analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ticker: 'AAPL', deep: false }),
    }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))
  )
);

let succeeded = 0, insufficient = 0, other = 0;
for (const r of results) {
  if (r.body?.analysis) succeeded++;
  else if (r.status === 402 || /not enough credits/i.test(r.body?.error || '')) insufficient++;
  else other++;
}
console.log(`Succeeded: ${succeeded}  Insufficient-credits: ${insufficient}  Other: ${other}`);

const { data: final } = await sb.from('user_profiles').select('credits_remaining,credits_used_this_month').eq('email', email).single();
console.log(`Final balance: remaining=${final.credits_remaining}, used=${final.credits_used_this_month}`);

const expected = succeeded * 3;
const ok = final.credits_remaining === 30 - expected && final.credits_used_this_month === expected;
console.log(ok ? '✓ ATOMIC: credit accounting is consistent.' : '✗ RACE STILL PRESENT: math doesn\'t add up.');

// Cleanup
await fetch(`${API}/api/settings/account`, {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ password: 'GoodPass1234' }),
});
console.log('cleanup done');
