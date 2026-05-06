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
    if (password !== confirm) { setError("Passwords don't match"); return; }
    if (password.length < 8) { setError('Password must be 8+ characters with a letter and a number'); return; }
    setLoading(true);
    try {
      await api.auth.resetPassword({ token, password });
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
      <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="28" height="28" viewBox="0 0 72 72" fill="none">
          <rect x="18" y="18" width="36" height="22" rx="2" fill="#fff"/>
          <rect x="22" y="23" width="8" height="5" rx="1" fill="#3b82f6"/>
          <rect x="42" y="23" width="8" height="5" rx="1" fill="#3b82f6"/>
          <rect x="15" y="40" width="42" height="2.5" rx="1" fill="#fff" opacity="0.6"/>
          <line x1="22" y1="42" x2="15" y2="63" stroke="#fff" strokeWidth="5" strokeLinecap="round"/>
          <line x1="30" y1="42" x2="27" y2="63" stroke="#fff" strokeWidth="5" strokeLinecap="round"/>
          <line x1="42" y1="42" x2="45" y2="63" stroke="#fff" strokeWidth="5" strokeLinecap="round"/>
          <line x1="50" y1="42" x2="57" y2="63" stroke="#fff" strokeWidth="5" strokeLinecap="round"/>
        </svg>
      </div>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: '2px', color: 'var(--text)' }}>OUTPOST</p>
        <p style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '1px' }}>TRADE LIKE YOU KNOW SOMETHING</p>
      </div>
    </div>
  );
}
