import { validateToken } from '../db.js';
import { memGet, memSet, memDel, memStats } from '../services/memoryCache.js';

const AUTH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function cachedValidateToken(token) {
  const cacheKey = `auth_${token}`;
  const cached = memGet(cacheKey);
  if (cached) return cached;

  const user = await validateToken(token);
  if (user) {
    memSet(cacheKey, user, AUTH_CACHE_TTL);
  }
  return user;
}

export async function requireAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const user = await cachedValidateToken(token);
    if (!user) return res.status(401).json({ error: 'Session expired — please sign in again' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

export async function optionalAuth(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const user = await cachedValidateToken(token);
      req.user = user;
    }
    next();
  } catch {
    next();
  }
}

/**
 * Invalidate cached auth for a specific token.
 * Call this on logout, password change, etc.
 */
export function invalidateAuth(tokenOrUserId) {
  if (!tokenOrUserId) return;
  // If it looks like a token (long hex string), delete directly
  if (typeof tokenOrUserId === 'string' && tokenOrUserId.length > 40) {
    memDel(`auth_${tokenOrUserId}`);
    return;
  }
  // Otherwise it's a user ID — scan and clear all matching entries
  const { keys } = memStats();
  for (const key of keys) {
    if (!key.startsWith('auth_')) continue;
    const cached = memGet(key);
    if (cached && cached.id === tokenOrUserId) {
      memDel(key);
    }
  }
}
