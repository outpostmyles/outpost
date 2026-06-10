// Reset onboarding for an account so the intro flow shows again on next load.
// Usage: node tests/_reset_onboarding.mjs someone@example.com
import { supabase } from '../api/db.js';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.log('usage: node tests/_reset_onboarding.mjs <email>');
  process.exit(1);
}
const { error, data } = await supabase
  .from('user_profiles')
  .update({ onboarding_complete: false })
  .eq('email', email)
  .select('email');
if (error) { console.log(`FAIL: ${error.message}`); process.exit(1); }
console.log(data?.length ? `ok: ${email} will see onboarding again on reload` : `no account found for ${email}`);
process.exit(0);
