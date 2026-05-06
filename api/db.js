import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { config } from './config.js';

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);

/**
 * Validate a session token. The client sends the raw token;
 * we hash it with SHA-256 before looking it up in the DB.
 * This way the DB never stores usable tokens.
 */
export async function validateToken(token) {
  if (!token) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('session_token', tokenHash)
    .gt('session_expires', new Date().toISOString())
    .maybeSingle();
  return data;
}
