import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';

const STEPS = [
  {
    key: 'style',
    title: 'How do you trade?',
    subtitle: 'This helps us personalize your AI analysis',
    options: [
      { value: 'day_trading', label: 'Day Trader', desc: 'Buy and sell within the same day' },
      { value: 'swing', label: 'Swing Trader', desc: 'Hold positions for days to weeks' },
      { value: 'investor', label: 'Investor', desc: 'Long-term positions, months to years' },
    ],
  },
  {
    key: 'assets',
    title: 'What do you trade?',
    subtitle: 'Select all that apply',
    options: [
      { value: 'stocks', label: 'Stocks', desc: 'Individual company shares' },
      { value: 'etfs', label: 'ETFs', desc: 'Funds and indices' },
    ],
    multi: true,
  },
  {
    key: 'risk',
    title: 'Your risk tolerance?',
    subtitle: 'We use this to calibrate AI recommendations',
    options: [
      { value: 'conservative', label: 'Conservative', desc: 'Capital preservation first' },
      { value: 'moderate', label: 'Moderate', desc: 'Balanced risk and reward' },
      { value: 'aggressive', label: 'Aggressive', desc: 'Maximum growth potential' },
    ],
  },
];

export default function OnboardingScreen() {
  const { user, updateUser } = useAuth();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ style: '', assets: [], risk: 'moderate' });
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState('questions'); // 'questions' | 'welcome'
  const [welcomeMsg, setWelcomeMsg] = useState('');
  const [welcomeVariant, setWelcomeVariant] = useState(null);
  const [welcomeLoading, setWelcomeLoading] = useState(false);
  const [welcomeRated, setWelcomeRated] = useState(false);

  const current = STEPS[step];

  function select(value) {
    if (current.multi) {
      setAnswers(a => ({
        ...a,
        [current.key]: a[current.key].includes(value)
          ? a[current.key].filter(v => v !== value)
          : [...a[current.key], value],
      }));
    } else {
      setAnswers(a => ({ ...a, [current.key]: value }));
    }
  }

  function isSelected(value) {
    if (current.multi) return answers[current.key].includes(value);
    return answers[current.key] === value;
  }

  function canProceed() {
    if (current.multi) return answers[current.key].length > 0;
    return Boolean(answers[current.key]);
  }

  const [err, setErr] = useState('');

  async function finish() {
    setSaving(true);
    setErr('');
    try {
      // Save preferences first — but DON'T flip onboarding_complete yet. We
      // want to keep the user on this screen long enough to see the AI welcome.
      // If we flipped onboarding_complete here, AppShell would unmount us before
      // the user ever sees the moment.
      await api.settings.update({
        trading_style: answers.style || 'swing',
        risk_tolerance: answers.risk || 'moderate',
        onboarding_style: answers.style,
        onboarding_assets: answers.assets.join(','),
      });
      // Move to the welcome phase and kick off the AI call. The actual
      // onboarding_complete flip happens when the user taps "Open Outpost".
      setPhase('welcome');
      setSaving(false);
      setWelcomeLoading(true);
      try {
        const res = await api.ai.welcome({
          style: answers.style || 'swing',
          risk_tolerance: answers.risk || 'moderate',
          assets: answers.assets,
        });
        setWelcomeMsg(res?.message || '');
        setWelcomeVariant(res?.variant || null);
      } catch {
        // The endpoint never throws — it falls back internally. Empty here means
        // a network failure on our side. Use a tiny inline fallback.
        setWelcomeMsg("Welcome aboard. We'll personalize as you use the app — start by adding a position you already own.");
      } finally {
        setWelcomeLoading(false);
      }
    } catch (e) {
      // Show error but let user retry — don't silently skip onboarding
      setErr('Failed to save preferences. Tap to retry, or skip below.');
      setSaving(false);
    }
  }

  async function rateWelcome(rating) {
    if (welcomeRated) return;
    setWelcomeRated(true);
    // Fire-and-forget — don't make the user wait. If it fails we silently
    // drop it; better than blocking the user on the very first interaction.
    try {
      await api.ai.feedback({
        feature: 'welcome',
        rating,
        variant: welcomeVariant,
        responsePreview: (welcomeMsg || '').slice(0, 200),
      });
    } catch {}
  }

  async function completeOnboarding() {
    setSaving(true);
    setErr('');
    try {
      await api.settings.update({ onboarding_complete: true });
      updateUser({
        onboarding_complete: true,
        trading_style: answers.style || 'swing',
        risk_tolerance: answers.risk || 'moderate',
      });
    } catch {
      setErr('Could not finish — check your connection and try again.');
      setSaving(false);
    }
  }

  if (phase === 'welcome') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '40px 24px', background: 'var(--bg)', maxWidth: 400, margin: '0 auto' }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
            {[...STEPS, { key: 'welcome' }].map((_, i) => (
              <div key={i} style={{ flex: 1, height: 2, borderRadius: 1, background: 'var(--blue)' }} />
            ))}
          </div>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 8 }}>You're set</p>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.3px' }}>A read on today, just for you</h1>
          <p style={{ fontSize: 11, color: 'var(--muted)' }}>Personalized to your style and risk preferences.</p>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 16px', minHeight: 130, display: 'flex', alignItems: welcomeLoading ? 'center' : 'flex-start', justifyContent: welcomeLoading ? 'center' : 'flex-start' }}>
            {welcomeLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, color: 'var(--faint)', fontSize: 11 }}>
                <div style={{ width: 24, height: 24, border: '2px solid var(--border)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span>Reading the market…</span>
                <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0 }}>{welcomeMsg}</p>
            )}
          </div>

          {!welcomeLoading && welcomeMsg && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 14 }}>
              {welcomeRated ? (
                <p style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.3px' }}>Thanks — that helps us tune your AI.</p>
              ) : (
                <>
                  <p style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.3px', marginRight: 4 }}>Was this useful?</p>
                  <button onClick={() => rateWelcome('up')} className="btn btn-muted" style={{ padding: '6px 12px', fontSize: 12 }} aria-label="Yes">👍</button>
                  <button onClick={() => rateWelcome('down')} className="btn btn-muted" style={{ padding: '6px 12px', fontSize: 12 }} aria-label="No">👎</button>
                </>
              )}
            </div>
          )}
        </div>

        {err && (
          <p style={{ fontSize: 11, color: 'var(--red)', textAlign: 'center', padding: '8px 0 0' }}>{err}</p>
        )}

        <div style={{ paddingTop: 24 }}>
          <button onClick={completeOnboarding} disabled={saving || welcomeLoading} className="btn btn-blue" style={{ width: '100%', padding: '12px', opacity: welcomeLoading ? 0.4 : 1 }}>
            {saving ? 'Opening...' : 'Open Outpost'}
          </button>
          <p style={{ fontSize: 9, color: 'var(--faint)', textAlign: 'center', marginTop: 14, lineHeight: 1.5, letterSpacing: '0.2px' }}>
            Educational use only. Not financial advice.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '40px 24px', background: 'var(--bg)', maxWidth: 400, margin: '0 auto' }}>
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
          {[...STEPS, { key: 'welcome' }].map((_, i) => (
            <div key={i} style={{ flex: 1, height: 2, borderRadius: 1, background: i <= step ? 'var(--blue)' : 'var(--raised)', transition: 'background 0.3s' }} />
          ))}
        </div>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 8 }}>Step {step + 1} of {STEPS.length}</p>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.3px' }}>{current.title}</h1>
        <p style={{ fontSize: 11, color: 'var(--muted)' }}>{current.subtitle}</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        {current.options.map(opt => (
          <button key={opt.value} onClick={() => select(opt.value)} style={{ padding: '14px 16px', background: isSelected(opt.value) ? 'rgba(59,130,246,0.12)' : 'var(--raised)', border: `1px solid ${isSelected(opt.value) ? 'var(--blue)' : 'var(--border)'}`, borderRadius: 8, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', fontFamily: 'inherit' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: isSelected(opt.value) ? 'var(--blue)' : 'var(--text)', marginBottom: 3 }}>{opt.label}</p>
            <p style={{ fontSize: 11, color: 'var(--muted)' }}>{opt.desc}</p>
          </button>
        ))}
      </div>

      {err && (
        <p style={{ fontSize: 11, color: 'var(--red)', textAlign: 'center', padding: '8px 0 0' }}>{err}</p>
      )}
      <div style={{ paddingTop: 24, display: 'flex', gap: 10 }}>
        {step > 0 && (
          <button onClick={() => setStep(s => s - 1)} className="btn btn-muted" style={{ flex: 1, padding: '11px' }}>Back</button>
        )}
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep(s => s + 1)} disabled={!canProceed()} className="btn btn-blue" style={{ flex: 2, padding: '11px', opacity: !canProceed() ? 0.4 : 1 }}>Continue</button>
        ) : (
          <button onClick={finish} disabled={saving || !canProceed()} className="btn btn-green" style={{ flex: 2, padding: '11px', opacity: !canProceed() ? 0.4 : 1 }}>
            {saving ? 'Setting up...' : 'Start Trading'}
          </button>
        )}
      </div>
      <button onClick={async () => {
        setSaving(true);
        setErr('');
        try {
          await api.settings.update({ onboarding_complete: true });
          updateUser({ onboarding_complete: true });
        } catch {
          // Don't update local state if server failed — user would appear onboarded
          // but the server wouldn't know, causing a loop on next login
          setErr('Could not skip — check your connection and try again.');
          setSaving(false);
        }
      }} disabled={saving} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, padding: '12px 0 0', fontFamily: 'inherit', letterSpacing: '0.3px' }}>
        {saving ? 'Skipping...' : 'Skip for now'}
      </button>
    </div>
  );
}
