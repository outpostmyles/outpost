import { useState } from 'react';
import { api } from '../../lib/api.js';

export default function ResetPasswordScreen({ token, onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    // Trim before any check — autofill leaves trailing spaces and the next
    // login would fail silently against a hash that doesn't include them.
    const pwd = (password || '').trim();
    const conf = (confirm || '').trim();
    if (pwd !== conf) { setError("Passwords don't match"); return; }
    // Mirror backend isStrongEnoughPassword: 8+ chars, at least one letter
    // and one digit. The old client-side check was length-only, which caused
    // the displayed message to lie when backend rejected a length-OK but
    // weak password (e.g. "aaaaaaaa").
    if (pwd.length < 8 || !/[a-zA-Z]/.test(pwd) || !/[0-9]/.test(pwd)) {
      setError('Password must be 8+ characters with a letter and a number');
      return;
    }
    setLoading(true);
    try {
      await api.auth.resetPassword({ token, password: pwd });
      setDone(true);
    } catch (err) {
      setError(err.error || 'Reset link is invalid or has expired');
    }
    setLoading(false);
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <Logo />
        {done ? (
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <p style={{ fontSize: 12, color: 'var(--green)', marginBottom: 8 }}>Password updated</p>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 20 }}>Sign in with your new password.</p>
            <button onClick={onDone} className="btn btn-blue btn-full">Continue to sign in</button>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 20, marginTop: 24, textAlign: 'center' }}>Choose a new password for your Outpost account.</p>
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 10, position: 'relative' }}>
                <input type={showPw ? 'text' : 'password'} placeholder="New password" value={password} onChange={e => setPassword(e.target.value)} required className="input" style={{ paddingRight: 40 }} />
                <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, fontFamily: 'inherit' }}>
                  {showPw ? 'HIDE' : 'SHOW'}
                </button>
              </div>
              <div style={{ marginBottom: 12 }}>
                <input type={showPw ? 'text' : 'password'} placeholder="Confirm password" value={confirm} onChange={e => setConfirm(e.target.value)} required className="input" />
              </div>
              {error && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 12, textAlign: 'center' }}>{error}</p>}
              <button type="submit" disabled={loading} className="btn btn-blue btn-full" style={{ marginBottom: 10 }}>
                {loading ? 'Updating...' : 'Update Password'}
              </button>
              <button type="button" onClick={onDone} className="btn btn-muted btn-full">Back to sign in</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function Logo() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 48, height: 48, borderRadius: 12, background: '#0d1117', border: '1px solid rgba(122,162,255,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="30" height="30" viewBox="0 0 72 72" fill="none">
          <g transform="translate(5.8,5.8) scale(0.84)" fill="none" stroke="#e8edf2" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M36 13 V8 M32 8 H40"/>
            <path d="M11 24 L24 15 H48 L61 24 Z" fill="#e8edf2"/>
            <rect x="18" y="24" width="36" height="13"/>
            <rect x="21" y="26.5" width="30" height="8" fill="#3b82f6" stroke="none"/>
            <path d="M28.5 26.5 V34.5 M36 26.5 V34.5 M43.5 26.5 V34.5" strokeWidth="1.6"/>
            <path d="M13 37 H59"/>
            <path d="M13 41 H59"/>
            <path d="M15 37 V41 M25 37 V41 M36 37 V41 M47 37 V41 M57 37 V41"/>
            <path d="M19 41 L11 63 M53 41 L61 63"/>
            <path d="M19 41 L57 52 M53 41 L15 52 M15 52 H57 M15 52 L61 63 M57 52 L11 63"/>
            <path d="M11 63 l-2 4 M61 63 l2 4"/>
          </g>
        </svg>
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: '2px', color: 'var(--text)' }}>OUTPOST</p>
        <p style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '1px' }}>TRADE LIKE YOU KNOW SOMETHING</p>
      </div>
    </div>
  );
}
