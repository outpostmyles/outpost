// Reset a password for an account you own.
//
// You run this; the password you pick is hashed (bcrypt, exactly as the app
// does) and written straight to user_profiles. Nobody else ever sees it. Use it
// when you have forgotten the password to your own account.
//
//   node scripts/reset-password.mjs <email> '<newPassword>'
//
// Example:
//   node scripts/reset-password.mjs mylesschen@gmail.com 'MyNewPass123'
//
// To just see which accounts exist (read-only), pass --list:
//   node scripts/reset-password.mjs --list
import bcrypt from 'bcryptjs';
import { supabase } from '../api/db.js';

const args = process.argv.slice(2);

if (args[0] === '--list') {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('email, plan, created_at')
    .order('created_at', { ascending: true });
  if (error) { console.error('Failed:', error.message); process.exit(1); }
  console.log(`Accounts (${data?.length ?? 0}):`);
  for (const u of data ?? []) console.log(`  ${u.email}   plan=${u.plan ?? 'free'}`);
  process.exit(0);
}

const [emailArg, password] = args;
if (!emailArg || !password) {
  console.error("Usage: node scripts/reset-password.mjs <email> '<newPassword>'");
  console.error("   or: node scripts/reset-password.mjs --list");
  process.exit(1);
}
if (password.length < 8) {
  console.error('Pick a password of at least 8 characters.');
  process.exit(1);
}

const email = emailArg.toLowerCase().trim();
const hash = await bcrypt.hash(password, 12); // matches the app's BCRYPT_ROUNDS

const { data, error } = await supabase
  .from('user_profiles')
  .update({ password_hash: hash, password_salt: 'bcrypt' })
  .eq('email', email)
  .select('id, email');

if (error) { console.error('Failed:', error.message); process.exit(1); }
if (!data || data.length === 0) {
  console.error(`No account found for ${email}. Run with --list to see the emails that exist.`);
  process.exit(1);
}
console.log(`Password reset for ${email}. You can log in with the new password now.`);
process.exit(0);
