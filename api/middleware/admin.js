/**
 * Founder/admin gate.
 *
 * The frontend never calls this directly — it calls /api/admin/* endpoints
 * with the normal Bearer token, and this middleware decides whether the
 * authenticated user is allowed in.
 *
 * Allow list comes from the FOUNDER_EMAILS env var (comma-separated).
 * If the env var is missing, NO ONE is admin (fail closed).
 *
 * Use AFTER requireAuth so req.user is populated.
 */

/**
 * Pure helper: parse a comma-separated allow list into a clean array.
 * Lower-cased, trimmed, empties dropped, deduped.
 */
export function parseAllowList(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return [...new Set(
    raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  )];
}

/**
 * Pure helper: given an allow list and the caller's email, return whether
 * they're an admin. Empty allow list → false (fail closed).
 */
export function isAdminEmail(allowList, email) {
  if (!Array.isArray(allowList) || allowList.length === 0) return false;
  if (!email || typeof email !== 'string') return false;
  return allowList.includes(email.trim().toLowerCase());
}

export function requireAdmin(req, res, next) {
  const allow = parseAllowList(process.env.FOUNDER_EMAILS || '');
  if (allow.length === 0) {
    return res.status(403).json({ error: 'Admin access not configured' });
  }
  if (!isAdminEmail(allow, req.user?.email)) {
    // Generic 404 — don't leak that an admin endpoint exists to non-admins.
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

/**
 * Reads the same env var so the frontend can decide whether to render
 * the Founder link. Exported as an array (lowercased, deduped).
 */
export function getFounderEmails() {
  return parseAllowList(process.env.FOUNDER_EMAILS || '');
}
