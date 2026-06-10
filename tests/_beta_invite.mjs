// Add an email to the private-beta allowlist so it can sign up, AND, if that email
// already has an account, upgrade it to the unlimited beta plan (new signups get
// unlimited automatically via the gate in auth.js; this also fixes anyone who
// registered as 'free' before that wiring).
// Usage: node tests/_beta_invite.mjs someone@example.com
import { supabase } from '../api/db.js';
import { PLAN_CREDITS } from '../api/constants/planCredits.js';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.log('usage: node tests/_beta_invite.mjs <email>');
  process.exit(1);
}

const { error } = await supabase
  .from('beta_allowlist')
  .upsert({ email, notes: 'founder invite' }, { onConflict: 'email' });
if (error) { console.log(`FAIL (allowlist): ${error.message}`); process.exit(1); }
console.log(`ok: ${email} can now sign up`);

// Upgrade an existing account, if there is one, to unlimited.
const { data: existing } = await supabase
  .from('user_profiles').select('id, plan').eq('email', email).maybeSingle();
if (existing) {
  if (existing.plan === 'unlimited') {
    console.log(`ok: ${email} already on unlimited`);
  } else {
    const { error: upErr } = await supabase
      .from('user_profiles')
      .update({ plan: 'unlimited', credits_remaining: PLAN_CREDITS.unlimited })
      .eq('id', existing.id);
    console.log(upErr ? `FAIL (upgrade): ${upErr.message}` : `ok: upgraded existing ${email} from ${existing.plan} to unlimited`);
    if (upErr) process.exit(1);
  }
} else {
  console.log(`(no existing account for ${email} yet; they'll get unlimited on signup)`);
}
process.exit(0);
