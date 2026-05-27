// Verifies the daily email pipeline end-to-end by building the digest for a
// specific user and either previewing it (default) or sending it for real
// (pass --send).
//
// Usage:
//   node tests/_verify_daily_email.mjs <email>           # preview only
//   node tests/_verify_daily_email.mjs <email> --send    # actually send
//
// This is a verification utility, not part of the test suite.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { buildDailyDigestEmail } from '../api/services/notifications.js';
import { getDigestForUser } from '../api/services/proactiveDigest.js';
import { initPricePool } from '../api/services/pricePool.js';
import { initMarketDataService } from '../api/services/marketData.js';
import { Resend } from 'resend';
import { config } from '../api/config.js';

const targetEmail = process.argv[2];
const reallySend = process.argv.includes('--send');
if (!targetEmail) {
  console.error('Usage: node tests/_verify_daily_email.mjs <email> [--send]');
  process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = config.resendKey ? new Resend(config.resendKey) : null;

async function main() {
  console.log('Booting market data + price pool...');
  await initMarketDataService();
  await initPricePool();

  const { data: user } = await sb.from('user_profiles')
    .select('id, email, display_name, email_daily_digest, plan')
    .eq('email', targetEmail.toLowerCase().trim())
    .maybeSingle();

  if (!user) {
    console.error(`No user found with email: ${targetEmail}`);
    process.exit(1);
  }

  console.log(`\nUser: ${user.email} (${user.display_name || 'no name'})`);
  console.log(`Plan: ${user.plan}`);
  console.log(`Email opted in: ${user.email_daily_digest}\n`);

  console.log('Building digest...');
  const digest = await getDigestForUser(user.id, false);
  console.log(`\nDigest available: ${digest?.available}`);
  console.log(`Digest quiet: ${digest?.quiet}`);
  console.log(`Signals count: ${(digest?.signals || []).length}`);
  if (digest?.digest) {
    console.log(`\nDigest text:\n${'─'.repeat(60)}\n${digest.digest}\n${'─'.repeat(60)}`);
  }

  console.log('\nBuilding email...');
  const built = buildDailyDigestEmail({ displayName: user.display_name, digest });
  if (!built) {
    console.log('\nbuildDailyDigestEmail returned null — the digest was either');
    console.log('unavailable, quiet, or empty. No email would be sent today.');
    console.log('(This is the expected behavior on a quiet day with no signals.)');
    process.exit(0);
  }

  console.log(`\nSubject: ${built.subject}`);
  console.log(`HTML length: ${built.html.length} chars`);
  console.log(`\nText version:\n${'─'.repeat(60)}\n${built.text}\n${'─'.repeat(60)}`);

  if (!reallySend) {
    console.log('\n[PREVIEW ONLY] Pass --send to actually deliver this email.');
    process.exit(0);
  }

  if (!resend) {
    console.error('\nResend not configured — cannot send.');
    process.exit(1);
  }

  console.log(`\nSending to ${user.email} via Resend...`);
  const result = await resend.emails.send({
    from: 'Outpost <noreply@outpostapp.co>',
    to: user.email,
    subject: built.subject,
    html: built.html,
    text: built.text,
  });
  console.log('\nResend response:', JSON.stringify(result, null, 2));
  if (result.error) {
    console.error('\nSend failed. Common causes: domain not verified, sender not allowed, recipient blocked.');
    process.exit(1);
  }
  console.log(`\n✓ Email sent. Check ${user.email} inbox.`);
}

main().catch(err => { console.error(err); process.exit(1); });
