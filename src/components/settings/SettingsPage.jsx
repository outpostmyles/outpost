import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { Modal, FormField } from '../shared/UI.jsx';
import HowItWorks from './HowItWorks.jsx';
import FounderGuide from '../auth/FounderGuide.jsx';

function Row({ label, value, onClick, danger }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: onClick ? 'pointer' : 'default' }}
      onMouseEnter={e => onClick && (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ fontSize: 12, color: danger ? 'rgba(239,68,68,0.7)' : 'var(--muted)' }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--faint)' }}>{value} {onClick && '›'}</span>
    </div>
  );
}

function ToggleRow({ label, sublabel, checked, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, paddingRight: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
        {sublabel && <span style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2, lineHeight: 1.4 }}>{sublabel}</span>}
      </div>
      <button
        onClick={() => onToggle(!checked)}
        aria-pressed={checked}
        style={{
          flexShrink: 0,
          width: 36, height: 20, borderRadius: 10,
          background: checked ? 'var(--blue)' : 'rgba(255,255,255,0.12)',
          border: 'none', cursor: 'pointer', position: 'relative',
          transition: 'background 0.2s',
          padding: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
        }} />
      </button>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '1.5px', padding: '10px 16px 5px' }}>{title}</p>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, margin: '0 16px', overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );
}

function ChangePasswordModal({ onClose, showToast }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (form.next !== form.confirm) { setErr('New passwords do not match'); return; }
    if (form.next.length < 8) { setErr('Password must be at least 8 characters'); return; }
    setLoading(true); setErr('');
    try {
      await api.auth.changePassword({ currentPassword: form.current, newPassword: form.next });
      showToast('Password updated', 'success');
      onClose();
    } catch (e) { setErr(e.error || 'Failed to change password'); }
    setLoading(false);
  }

  return (
    <Modal title="Change Password" onClose={onClose}>
      <FormField label="Current Password"><input className="input" type={show ? 'text' : 'password'} value={form.current} onChange={e => setForm(f => ({ ...f, current: e.target.value }))} /></FormField>
      <FormField label="New Password"><input className="input" type={show ? 'text' : 'password'} value={form.next} onChange={e => setForm(f => ({ ...f, next: e.target.value }))} /></FormField>
      <FormField label="Confirm New Password"><input className="input" type={show ? 'text' : 'password'} value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} /></FormField>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer', fontSize: 11, color: 'var(--muted)' }}>
        <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} style={{ accentColor: 'var(--blue)' }} />
        Show passwords
      </label>
      {err && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 12 }}>{err}</p>}
      <button onClick={submit} disabled={loading} className="btn btn-blue btn-full">{loading ? 'Updating...' : 'Update Password'}</button>
    </Modal>
  );
}

function LegalModal({ type, onClose }) {
  const isTerms = type === 'terms';
  const title = isTerms ? 'Terms of Service' : 'Privacy Policy';
  return (
    <Modal title={title} onClose={onClose}>
      <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.7, maxHeight: '60vh', overflowY: 'auto', paddingRight: 4 }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px', marginBottom: 14 }}>LAST UPDATED: APRIL 2026</p>
        {isTerms ? <TermsContent /> : <PrivacyContent />}
      </div>
      <button onClick={onClose} className="btn btn-muted btn-full" style={{ marginTop: 16 }}>Close</button>
    </Modal>
  );
}

function TermsContent() {
  return (
    <>
      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8, marginTop: 4 }}>1. Not Financial Advice</h3>
      <p style={{ marginBottom: 12 }}>Outpost is an educational tool. All AI-generated analysis, briefs, summaries, signals, sector radar output, and agent responses are for informational and educational purposes only. Outpost is not a registered investment advisor, broker-dealer, or financial planner. Nothing on this platform is a recommendation to buy, sell, or hold any security. You are solely responsible for your own trading decisions.</p>

      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>2. Trading Risk</h3>
      <p style={{ marginBottom: 12 }}>Trading stocks, options, futures, and other securities involves substantial risk of loss and is not suitable for every investor. Past performance is not indicative of future results. You may lose more than you invest. Do not trade with money you cannot afford to lose.</p>

      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>3. AI Output</h3>
      <p style={{ marginBottom: 12 }}>AI-generated content may contain errors, hallucinations, outdated data, or incorrect reasoning. Market data may be delayed or inaccurate. Always verify information independently before acting on it. Outpost does not guarantee the accuracy, completeness, or timeliness of any content.</p>

      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>4. Acceptable Use</h3>
      <p style={{ marginBottom: 12 }}>You agree not to: (a) use Outpost for any unlawful purpose; (b) attempt to reverse engineer, scrape, or abuse the service; (c) submit harmful, abusive, hateful, or inappropriate content; (d) impersonate others or use misleading display names; (e) attempt to circumvent credit limits or security measures.</p>

      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>5. Account & Credits</h3>
      <p style={{ marginBottom: 12 }}>You must be 18+ to use Outpost. Credits are non-refundable and expire at the end of each billing period. Plans may be canceled at any time. We reserve the right to suspend accounts that violate these terms.</p>

      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>6. Limitation of Liability</h3>
      <p style={{ marginBottom: 12 }}>To the maximum extent permitted by law, Outpost and its operators are not liable for any trading losses, lost profits, data loss, or indirect damages arising from use of the service. The service is provided "as is" without warranty of any kind.</p>

      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>7. Changes</h3>
      <p style={{ marginBottom: 4 }}>We may update these terms from time to time. Continued use of Outpost after changes constitutes acceptance. For questions, contact us via the feedback form.</p>
    </>
  );
}

function PrivacyContent() {
  return (
    <>
      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8, marginTop: 4 }}>1. What We Collect</h3>
      <p style={{ marginBottom: 12 }}>We collect: your email, display name, hashed password, trading preferences (risk tolerance, style), portfolio data you enter (tickers, positions, targets), watchlist entries, agent chat history, and usage analytics (feature usage, credit consumption).</p>

      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>2. How We Use It</h3>
      <p style={{ marginBottom: 12 }}>Your data is used to: (a) operate the service and generate personalized AI responses; (b) enforce credit limits and prevent abuse; (c) improve the product; (d) communicate about your account. We do not sell your data.</p>

      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>3. Third-Party Services</h3>
      <p style={{ marginBottom: 12 }}>We send prompts and portfolio context to Anthropic (Claude API) to generate AI responses. We query Polygon.io and Financial Modeling Prep for market data. We use Resend for transactional email and Supabase for database hosting. These providers have their own privacy policies.</p>

      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>4. Data Retention</h3>
      <p style={{ marginBottom: 12 }}>We retain your account data until you delete your account. Deleting your account removes your profile, positions, watchlist, agent messages, and feedback. Backups may persist for up to 30 days.</p>

      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>5. Security</h3>
      <p style={{ marginBottom: 12 }}>Passwords are hashed with bcrypt. Session tokens are hashed before storage. We use HTTPS in production. No system is perfectly secure — you are responsible for keeping your password safe.</p>

      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>6. Your Rights</h3>
      <p style={{ marginBottom: 12 }}>You can view, edit, or delete your data at any time from Settings. To request a data export or ask privacy questions, contact us via the feedback form.</p>

      <h3 style={{ fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>7. Cookies & Tracking</h3>
      <p style={{ marginBottom: 4 }}>Outpost uses localStorage to keep you signed in and remember UI preferences. We do not use third-party advertising trackers.</p>
    </>
  );
}

function FeedbackModal({ onClose, showToast }) {
  const [form, setForm] = useState({ type: 'bug', description: '' });
  const [loading, setLoading] = useState(false);
  async function submit() {
    if (!form.description.trim()) return;
    setLoading(true);
    try { await api.settings.feedback(form); showToast('Feedback sent — thanks!', 'success'); onClose(); }
    catch { showToast('Failed to send feedback', 'error'); }
    setLoading(false);
  }
  return (
    <Modal title="Send Feedback" onClose={onClose}>
      <FormField label="Type">
        <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
          <option value="bug">Bug Report</option>
          <option value="feature">Feature Request</option>
          <option value="other">Other</option>
        </select>
      </FormField>
      <FormField label="Description">
        <textarea className="input" rows={5} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Tell us what you experienced or what you would like to see..." />
      </FormField>
      <button onClick={submit} disabled={loading || !form.description.trim()} className="btn btn-blue btn-full">{loading ? 'Sending...' : 'Send Feedback'}</button>
    </Modal>
  );
}

function DeleteAccountModal({ onClose, onLogout, showToast }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  async function confirm() {
    if (!password) { setErr('Password required'); return; }
    setLoading(true); setErr('');
    try { await api.settings.deleteAccount({ password }); onLogout(); }
    catch (e) { setErr(e.error || 'Failed to delete account'); setLoading(false); }
  }
  return (
    <Modal title="Delete Account" onClose={onClose}>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.6 }}>This will permanently delete your account and all data. This cannot be undone.</p>
      <FormField label="Enter your password to confirm">
        <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" />
      </FormField>
      {err && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 12 }}>{err}</p>}
      <button onClick={confirm} disabled={loading} className="btn btn-red btn-full">{loading ? 'Deleting...' : 'DELETE MY ACCOUNT'}</button>
    </Modal>
  );
}

function PreferencesModal({ user, onClose, onSave, showToast }) {
  const [form, setForm] = useState({ display_name: user?.display_name ?? '', risk_tolerance: user?.risk_tolerance ?? 'moderate', trading_style: user?.trading_style ?? 'swing' });
  const [loading, setLoading] = useState(false);
  async function save() {
    setLoading(true);
    try { await api.settings.update(form); onSave(form); showToast('Preferences saved', 'success'); onClose(); }
    catch { showToast('Failed to save', 'error'); }
    setLoading(false);
  }
  return (
    <Modal title="Edit Preferences" onClose={onClose}>
      <FormField label="Display Name"><input className="input" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} /></FormField>
      <FormField label="Risk Tolerance">
        <select className="input" value={form.risk_tolerance} onChange={e => setForm(f => ({ ...f, risk_tolerance: e.target.value }))}>
          <option value="conservative">Conservative</option>
          <option value="moderate">Moderate</option>
          <option value="aggressive">Aggressive</option>
        </select>
      </FormField>
      <FormField label="Trading Style">
        <select className="input" value={form.trading_style} onChange={e => setForm(f => ({ ...f, trading_style: e.target.value }))}>
          <option value="day_trading">Day Trader</option>
          <option value="swing">Swing Trader</option>
          <option value="investor">Investor</option>
        </select>
      </FormField>
      <button onClick={save} disabled={loading} className="btn btn-blue btn-full">{loading ? 'Saving...' : 'Save Preferences'}</button>
    </Modal>
  );
}

export default function SettingsPage({ user, onLogout, showToast, onOpenAdmin }) {
  const [modal, setModal] = useState(null);
  const [localUser, setLocalUser] = useState(user);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.admin.check()
      .then(r => { if (!cancelled) setIsAdmin(!!r?.admin); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function updateLocal(updates) {
    setLocalUser(u => ({ ...u, ...updates }));
  }

  const plan = localUser?.plan ?? 'free';
  const creditsUsed = localUser?.credits_used_this_month ?? 0;
  const creditsTotal = (localUser?.credits_remaining ?? 0) + creditsUsed;
  const usagePct = creditsTotal > 0 ? Math.min(100, Math.round((creditsUsed / creditsTotal) * 100)) : 0;
  const usageColor = usagePct < 50 ? 'var(--blue)' : usagePct < 80 ? 'var(--amber)' : 'var(--red)';
  const daysLeft = (() => {
    const today = new Date().getDate();
    const billing = localUser?.billing_date ?? 1;
    const next = billing > today ? billing - today : 30 - today + billing;
    return next;
  })();

  const PLAN_NAMES = { free: 'FREE', starter: 'STARTER', pro: 'PRO', elite: 'ELITE', unlimited: 'BETA' };
  const STYLE_LABELS = { day_trading: 'Day Trader', swing: 'Swing Trader', investor: 'Investor' };
  const RISK_LABELS = { conservative: 'Conservative', moderate: 'Moderate', aggressive: 'Aggressive' };

  return (
    <>
      <div className="scrollable" style={{ flex: 1 }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)' }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.5px', marginBottom: 2 }}>SETTINGS</p>
          <p style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.3px' }}>{localUser?.email} · {PLAN_NAMES[plan]}</p>
        </div>

        {/* Usage */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7, fontSize: 10 }}>
            <span style={{ color: 'var(--muted)', letterSpacing: '0.5px', fontWeight: 600 }}>MONTHLY USAGE</span>
            <span style={{ color: 'var(--faint)' }}>{usagePct}%</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'var(--raised)', overflow: 'hidden', marginBottom: 5 }}>
            <div style={{ height: '100%', width: `${usagePct}%`, background: usageColor, borderRadius: 2, transition: 'width 0.5s' }} />
          </div>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px' }}>RESETS IN {daysLeft} DAYS · {PLAN_NAMES[plan]} PLAN</p>
        </div>

        {/* Upgrade / Buy Credits buttons hidden until Stripe is wired (LAUNCH_PLAN Phase 0.1).
            Original gate was `plan !== 'pro'` which also incorrectly showed for elite users. */}
        {false && plan !== 'pro' && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
            <button onClick={() => showToast('Upgrade flow coming soon')} className="btn btn-blue" style={{ flex: 2, padding: 11, fontSize: 10 }}>UPGRADE PLAN</button>
            <button onClick={() => showToast('Buy credits coming soon')} className="btn btn-muted" style={{ flex: 1, padding: 11, fontSize: 10 }}>BUY CREDITS</button>
          </div>
        )}

        <div style={{ paddingTop: 8, paddingBottom: 24 }}>
          <Section title="Account">
            <Row label="Display Name" value={localUser?.display_name ?? 'Set name'} onClick={() => setModal('prefs')} />
            <Row label="Email" value={localUser?.email} />
            <Row label="Password" value="Change" onClick={() => setModal('password')} />
          </Section>

          <Section title="AI Preferences">
            <Row label="Risk Tolerance" value={RISK_LABELS[localUser?.risk_tolerance] ?? 'Moderate'} onClick={() => setModal('prefs')} />
            <Row label="Trading Style" value={STYLE_LABELS[localUser?.trading_style] ?? 'Swing'} onClick={() => setModal('prefs')} />
          </Section>

          <Section title="Notifications">
            <ToggleRow
              label="Daily digest email"
              sublabel="Pre-market AI brief sent weekday mornings"
              checked={localUser?.email_daily_digest !== false}
              onToggle={async (next) => {
                updateLocal({ email_daily_digest: next });
                try { await api.settings.update({ email_daily_digest: next }); }
                catch { updateLocal({ email_daily_digest: !next }); showToast('Failed to update', 'error'); }
              }}
            />
            <ToggleRow
              label="Weekly summary email"
              sublabel="Sunday recap of last week's trades and movers"
              checked={localUser?.email_weekly_summary !== false}
              onToggle={async (next) => {
                updateLocal({ email_weekly_summary: next });
                try { await api.settings.update({ email_weekly_summary: next }); }
                catch { updateLocal({ email_weekly_summary: !next }); showToast('Failed to update', 'error'); }
              }}
            />
          </Section>

          {isAdmin && onOpenAdmin && (
            <Section title="Founder">
              <Row label="Dashboard" value="Open" onClick={onOpenAdmin} />
            </Section>
          )}

          <Section title="Help">
            <Row label="How Outpost works" value="Read" onClick={() => setModal('howitworks')} />
            <Row label="Founder's guide" value="Read" onClick={() => setModal('founderguide')} />
          </Section>

          <Section title="Support">
            <Row label="Send Feedback" value="" onClick={() => setModal('feedback')} />
            <Row label="Report a Bug" value="" onClick={() => setModal('feedback')} />
          </Section>

          <Section title="Legal">
            <Row label="Terms of Service" value="" onClick={() => setModal('terms')} />
            <Row label="Privacy Policy" value="" onClick={() => setModal('privacy')} />
            <div onClick={() => {}} style={{ padding: '10px 16px' }}>
              <p style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.6 }}>Outpost is not a registered investment advisor. All AI-generated content is for educational purposes only and does not constitute financial advice. Trading involves substantial risk of loss.</p>
            </div>
          </Section>

          <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button onClick={onLogout} className="btn btn-muted btn-full" style={{ padding: 12, fontSize: 11 }}>LOG OUT</button>
            <button onClick={() => setModal('delete')} style={{ background: 'none', border: 'none', color: 'rgba(239,68,68,0.45)', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit', padding: '10px 0', letterSpacing: '0.5px' }}>Delete Account</button>
          </div>
        </div>
      </div>

      {modal === 'password' && <ChangePasswordModal onClose={() => setModal(null)} showToast={showToast} />}
      {modal === 'feedback' && <FeedbackModal onClose={() => setModal(null)} showToast={showToast} />}
      {modal === 'delete' && <DeleteAccountModal onClose={() => setModal(null)} onLogout={onLogout} showToast={showToast} />}
      {modal === 'prefs' && <PreferencesModal user={localUser} onClose={() => setModal(null)} onSave={updateLocal} showToast={showToast} />}
      {(modal === 'terms' || modal === 'privacy') && <LegalModal type={modal} onClose={() => setModal(null)} />}
      {modal === 'howitworks' && <HowItWorks onClose={() => setModal(null)} />}
      {modal === 'founderguide' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, overflowY: 'auto', background: '#08080c' }}>
          <FounderGuide onBack={() => setModal(null)} />
        </div>
      )}
    </>
  );
}
