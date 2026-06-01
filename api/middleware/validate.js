export function sanitizeTicker(ticker) {
  if (!ticker || typeof ticker !== 'string') return null;
  const clean = ticker.toUpperCase().trim().replace(/[^A-Z]/g, '');
  if (!clean || clean.length > 5) return null;
  return clean;
}

export function sanitizeNumber(val, min = null, max = null) {
  const n = parseFloat(val);
  // Reject NaN AND Infinity. parseFloat('Infinity') and any overflow (1e400)
  // yield Infinity, which is not NaN but must never reach a numeric DB column.
  if (!Number.isFinite(n)) return null;
  if (min !== null && n < min) return null;
  if (max !== null && n > max) return null;
  return n;
}

export function sanitizeString(val, maxLen = 500) {
  if (!val || typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

export function sanitizeDate(val) {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
}

export function sanitizeEnum(val, allowed) {
  if (!allowed.includes(val)) return allowed[0];
  return val;
}

// Basic profanity / slur filter for display names.
// Not comprehensive — catches obvious direct attempts. Substitute with a real
// moderation service before scaling to lots of users.
const BLOCKED_NAME_TERMS = [
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'tranny',
  'chink', 'spic', 'kike', 'gook', 'wetback', 'coon',
  'hitler', 'nazi', 'kkk',
  'rapist', 'pedophile', 'pedo',
  'fuck', 'shit', 'cunt', 'cock', 'dick', 'pussy', 'asshole', 'bitch', 'bastard', 'whore', 'slut',
  'admin', 'administrator', 'moderator', 'support', 'outpost', 'anthropic', 'claude', 'system',
];

export function isDisplayNameAllowed(name) {
  if (!name || typeof name !== 'string') return true; // falls back to email prefix elsewhere
  const lower = name.toLowerCase().replace(/[^a-z]/g, '');
  if (!lower) return true;
  for (const term of BLOCKED_NAME_TERMS) {
    if (lower.includes(term)) return false;
  }
  return true;
}

// Permissive email validation — RFC 5322 is impractical to regex; this catches
// 99% of malformed input without blocking legitimate addresses.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length > 254) return false; // RFC 5321 SMTP path limit
  return EMAIL_REGEX.test(trimmed);
}

// Minimum bar: ≥ 8 chars AND contains both a letter and a digit. Blocks
// "password", "12345678" and similar common weak patterns. The frontend
// strength meter shows users where they are; this is the floor.
//
// Maximum bar: 128 chars. bcrypt has an internal 72-byte cap (anything
// beyond is silently truncated), and accepting unbounded input lets an
// attacker waste server CPU hashing arbitrary-length strings — a cheap
// DoS vector. 128 is plenty for any real passphrase.
export function isStrongEnoughPassword(password) {
  if (!password || typeof password !== 'string') return false;
  if (password.length < 8 || password.length > 128) return false;
  return /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}
