import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';

function PasswordStrength({ password }) {
  if (!password) return null;
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const color = score <= 1 ? 'var(--red)' : score <= 2 ? 'var(--amber)' : 'var(--green)';
  const label = score <= 1 ? 'WEAK' : score <= 2 ? 'FAIR' : 'STRONG';
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ height: 2, borderRadius: 1, background: 'var(--raised)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(score / 4) * 100}%`, background: color, transition: 'all 0.3s' }} />
      </div>
      <p style={{ fontSize: 9, color, marginTop: 3, letterSpacing: '0.8px' }}>{label}</p>
    </div>
  );
}

export default function AuthScreen() {
  const { login } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [ageConfirm, setAgeConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [legalModal, setLegalModal] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (mode === 'signup' && password !== confirmPassword) { setError("Passwords don't match"); return; }
    if (mode === 'signup' && !ageConfirm) { setError('You must confirm you are 18 or older'); return; }
    setLoading(true);
    try {
      // Trim password — autofill / paste often introduces a trailing space
      // that locks the user out on next login because the server-side hash
      // was computed against the trimmed value (or vice versa, depending on
      // which side trims first). Pin it down here.
      const pwd = (password || '').trim();
      const fn = mode === 'signin' ? api.auth.login : api.auth.signup;
      const body = mode === 'signup'
        ? { email: (email || '').trim(), password: pwd, displayName: (displayName || '').trim() }
        : { email: (email || '').trim(), password: pwd };
      const data = await fn(body);
      if (data.token && data.user) login(data.token, data.user);
      else setError('Something went wrong — please try again');
    } catch (err) { setError(err.error || 'Something went wrong'); }
    setLoading(false);
  }

  async function handleForgot(e) {
    e.preventDefault();
    if (!email) { setError('Enter your email address'); return; }
    setLoading(true);
    try { await api.auth.forgotPassword({ email }); setForgotSent(true); } catch { setError('Failed to send reset email'); }
    setLoading(false);
  }

  if (forgotMode) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg)' }}>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <Logo />
          {forgotSent ? (
            <div style={{ textAlign: 'center', marginTop: 32 }}>
              <p style={{ fontSize: 12, color: 'var(--green)', marginBottom: 8 }}>Reset link sent</p>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 20 }}>Check your email for a link to reset your password.</p>
              <button onClick={() => { setForgotMode(false); setForgotSent(false); setError(''); }} className="btn btn-muted btn-full">Back to sign in</button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 20, marginTop: 24 }}>Enter your email and we will send you a reset link.</p>
              <form onSubmit={handleForgot}>
                <div style={{ marginBottom: 12 }}>
                  <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} required className="input" />
                </div>
                {error && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 10 }}>{error}</p>}
                <button type="submit" disabled={loading} className="btn btn-blue btn-full" style={{ marginBottom: 10 }}>
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
                <button type="button" onClick={() => { setForgotMode(false); setError(''); }} className="btn btn-muted btn-full">Back</button>
              </form>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <Logo />
        <div style={{ display: 'flex', background: 'var(--raised)', borderRadius: 6, padding: 3, marginBottom: 20, marginTop: 28 }}>
          {['signin','signup'].map(m => (
            <button key={m} onClick={() => { setMode(m); setError(''); }} style={{ flex: 1, padding: '8px', borderRadius: 4, border: 'none', background: mode === m ? 'var(--blue)' : 'transparent', color: mode === m ? '#fff' : 'var(--muted)', fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.8px', textTransform: 'uppercase', transition: 'all 0.15s' }}>
              {m === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>
        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <div style={{ marginBottom: 10 }}>
              <input type="text" placeholder="Display name" value={displayName} onChange={e => setDisplayName(e.target.value)} className="input" />
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} required className="input" />
          </div>
          <div style={{ marginBottom: mode === 'signup' ? 6 : 16, position: 'relative' }}>
            <input type={showPw ? 'text' : 'password'} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required className="input" style={{ paddingRight: 40 }} />
            <button type="button" onClick={() => setShowPw(!showPw)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, fontFamily: 'inherit' }}>
              {showPw ? 'HIDE' : 'SHOW'}
            </button>
          </div>
          {mode === 'signup' && <PasswordStrength password={password} />}
          {mode === 'signup' && (
            <div style={{ marginTop: 10, marginBottom: 6, position: 'relative' }}>
              <input type={showPw ? 'text' : 'password'} placeholder="Confirm password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required className="input" />
            </div>
          )}
          {mode === 'signup' && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', margin: '14px 0' }}>
              <input type="checkbox" checked={ageConfirm} onChange={e => setAgeConfirm(e.target.checked)} style={{ marginTop: 2, accentColor: 'var(--blue)' }} />
              <span style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>I confirm I am 18+ and agree to the <button type="button" onClick={(e) => { e.preventDefault(); setLegalModal('terms'); }} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--blue)', cursor: 'pointer', fontSize: 10, fontFamily: 'inherit', textDecoration: 'underline' }}>Terms of Service</button> and <button type="button" onClick={(e) => { e.preventDefault(); setLegalModal('privacy'); }} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--blue)', cursor: 'pointer', fontSize: 10, fontFamily: 'inherit', textDecoration: 'underline' }}>Privacy Policy</button></span>
            </label>
          )}
          {mode === 'signin' && (
            <div style={{ textAlign: 'right', marginBottom: 16, marginTop: -8 }}>
              <button type="button" onClick={() => { setForgotMode(true); setError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 10, fontFamily: 'inherit', letterSpacing: '0.3px' }}>Forgot password?</button>
            </div>
          )}
          {error && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 12, textAlign: 'center' }}>{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-blue btn-full">
            {loading ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
      {legalModal && <AuthLegalModal type={legalModal} onClose={() => setLegalModal(null)} />}
    </div>
  );
}

function AuthLegalModal({ type, onClose }) {
  const isTerms = type === 'terms';
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, maxWidth: 480, width: '100%', maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.5px' }}>{isTerms ? 'Terms of Service' : 'Privacy Policy'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 16, fontFamily: 'inherit' }}>×</button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto', fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px', marginBottom: 14 }}>LAST UPDATED: APRIL 2026</p>
          {isTerms ? <AuthTermsContent /> : <AuthPrivacyContent />}
        </div>
      </div>
    </div>
  );
}

function AuthTermsContent() {
  return (
    <>
      <p style={{ marginBottom: 12, color: 'var(--text)', fontWeight: 600 }}>Outpost is an educational tool — not financial advice.</p>
      <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text)' }}>Not a financial advisor.</strong> All AI-generated analysis, briefs, signals, and agent responses are for informational and educational purposes only. Outpost is not a registered investment advisor or broker-dealer. Nothing here is a recommendation to buy, sell, or hold any security. You are solely responsible for your own trading decisions.</p>
      <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text)' }}>Trading risk.</strong> Trading involves substantial risk of loss and is not suitable for every investor. Past performance does not predict future results. You may lose more than you invest. Do not trade with money you cannot afford to lose.</p>
      <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text)' }}>AI output.</strong> AI-generated content may contain errors, hallucinations, outdated data, or incorrect reasoning. Market data may be delayed or inaccurate. Always verify information independently before acting on it.</p>
      <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text)' }}>Acceptable use.</strong> You agree not to use Outpost for unlawful purposes, submit harmful or abusive content, impersonate others, or attempt to circumvent credit limits.</p>
      <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text)' }}>Account.</strong> You must be 18+. Credits are non-refundable. We reserve the right to suspend accounts that violate these terms.</p>
      <p style={{ marginBottom: 4 }}><strong style={{ color: 'var(--text)' }}>Liability.</strong> To the maximum extent permitted by law, Outpost is not liable for any trading losses or indirect damages arising from use of the service. Provided "as is" without warranty.</p>
    </>
  );
}

function AuthPrivacyContent() {
  return (
    <>
      <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text)' }}>What we collect.</strong> Email, display name, hashed password, trading preferences, portfolio data you enter, watchlist, agent chat history, and usage analytics.</p>
      <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text)' }}>How we use it.</strong> To operate the service, generate personalized AI responses, enforce credit limits, and improve the product. We do not sell your data.</p>
      <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text)' }}>Third parties.</strong> We send prompts to Anthropic (Claude), pull market data from Polygon.io and Financial Modeling Prep, use Resend for email, and host data on Supabase. These providers have their own privacy policies.</p>
      <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text)' }}>Retention.</strong> We retain your data until you delete your account. Deleting removes your profile, positions, watchlist, agent messages, and feedback.</p>
      <p style={{ marginBottom: 12 }}><strong style={{ color: 'var(--text)' }}>Security.</strong> Passwords are hashed with bcrypt. Session tokens are hashed before storage. No system is perfectly secure — protect your password.</p>
      <p style={{ marginBottom: 4 }}><strong style={{ color: 'var(--text)' }}>Your rights.</strong> You can view, edit, or delete your data from Settings at any time.</p>
    </>
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
