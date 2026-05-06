import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { clearAllCache } from '../lib/cache.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('outpost_token');
    if (!token) { setLoading(false); return; }
    api.auth.validate()
      .then(data => setUser(data.user))
      .catch((err) => {
        if (err?.status !== 401) console.warn('[Auth] Validation failed:', err?.error || err);
        localStorage.removeItem('outpost_token');
        localStorage.removeItem('outpost_user');
      })
      .finally(() => setLoading(false));

    const handleExpired = () => {
      setUser(null);
      // Clear cached data so stale views don't linger
      clearAllCache();
    };
    window.addEventListener('auth_expired', handleExpired);
    return () => window.removeEventListener('auth_expired', handleExpired);
  }, []);

  function login(token, userData) {
    // Clear any stale cached data from a previous user before switching identity
    clearAllCache();
    localStorage.setItem('outpost_token', token);
    localStorage.setItem('outpost_user', JSON.stringify(userData));
    setUser(userData);
  }

  function logout() {
    api.auth.logout().catch(() => {});
    // Wipe all cached data so the next user doesn't see the previous user's data
    clearAllCache();
    localStorage.removeItem('outpost_token');
    localStorage.removeItem('outpost_user');
    // Clear activation checklist flags to prevent cross-account leakage on shared devices
    localStorage.removeItem('outpost_checklist');
    setUser(null);
  }

  function updateUser(updates) {
    setUser(prev => ({ ...prev, ...updates }));
    const stored = localStorage.getItem('outpost_user');
    if (stored) {
      try { localStorage.setItem('outpost_user', JSON.stringify({ ...JSON.parse(stored), ...updates })); } catch {}
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
