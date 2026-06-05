// Conversational onboarding — the first 90 seconds of Outpost.
//
// Replaces the old "fill out style + risk + assets" form-first flow with
// three open-ended questions that capture WHO this trader is. Answers are
// stored as agent_memory entries (memory_type='onboarding_anchor') and are
// surfaced as durable identity context in every subsequent agent turn.
//
// Flow:
//   1. Intro card — "Three questions. 90 seconds. We'll be a way better partner."
//   2-4. Three conversational questions, free-text answers, saved after each.
//   5. Optional preference set (style / risk) — collapsed by default with a
//      "set now" / "set later" toggle. Defaults: swing / moderate / stocks.
//   6. AI welcome message — quotes one of the user's own answers back to them.
//
// Old OnboardingScreen.jsx is kept on disk for reference but no longer routed.
//
// Why we still collect style/risk: they feed into agent context and several
// downstream features (deploy-cash filter defaults, position sizing prompts).
// We don't FORCE them anymore — defaults are fine, and the conversation gives
// the agent richer context than a button choice ever could.

import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';

const ASSET_OPTIONS = [
  { value: 'stocks', label: 'Stocks' },
  { value: 'etfs', label: 'ETFs' },
];
const STYLE_OPTIONS = [
  { value: 'day_trading', label: 'Day trader', desc: 'Same-day in and out' },
  { value: 'swing', label: 'Swing trader', desc: 'Days to weeks' },
  { value: 'investor', label: 'Investor', desc: 'Months to years' },
];
const RISK_OPTIONS = [
  { value: 'conservative', label: 'Conservative', desc: 'Preserve capital first' },
  { value: 'moderate', label: 'Moderate', desc: 'Balanced' },
  { value: 'aggressive', label: 'Aggressive', desc: 'Growth-first' },
];

export default function ConversationalOnboarding() {
  const { updateUser } = useAuth();

  // Phase state machine. Linear by design — no jumping back to edit answers
  // mid-flow (could be added later if users ask, but for 10-person beta we
  // ship the simplest thing that works).
  //   'intro'       → welcome card before questions
  //   'q'           → showing question[questionIdx]
  //   'preferences' → optional style/risk picker
  //   'welcome'     → AI welcome message
  const [phase, setPhase] = useState('intro');
  const [questions, setQuestions] = useState([]);
  const [questionIdx, setQuestionIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Preferences — defaults applied even if the user skips the prefs step.
  // The agent context handles missing/default values gracefully.
  const [prefs, setPrefs] = useState({ style: 'swing', risk: 'moderate', assets: ['stocks'] });

  const [welcomeMsg, setWelcomeMsg] = useState('');
  const [welcomeVariant, setWelcomeVariant] = useState(null);
  const [welcomeLoading, setWelcomeLoading] = useState(false);
  const [welcomeRated, setWelcomeRated] = useState(false);

  // The "watch it work" finale: a real, free read on a stock the user names. This
  // is the product's signature moment, the FEELING of being read accurately, given
  // away before any paywall.
  const [frTicker, setFrTicker] = useState('');
  const [frResult, setFrResult] = useState(null); // { ticker, read, price, changePct }
  const [frLoading, setFrLoading] = useState(false);
  const [frError, setFrError] = useState('');
  const [frRated, setFrRated] = useState(false);

  // Pull questions from the server on mount. Server is source of truth so we
  // can rotate copy without a frontend redeploy.
  useEffect(() => {
    let cancelled = false;
    api.onboarding.questions()
      .then(r => { if (!cancelled) setQuestions(r.questions || []); })
      .catch(() => {
        // Network blip — fall back to hardcoded copy so we never get stuck.
        if (!cancelled) {
          setQuestions([
            { idx: 0, prompt: 'What made you start investing?', placeholder: 'A story, a goal, just curiosity. Whatever\'s true.', minWords: 3 },
            { idx: 1, prompt: 'What\'s a stock you wish you\'d bought, and what stopped you?', placeholder: 'The "what stopped you" part is the useful one.', minWords: 3 },
            { idx: 2, prompt: 'What scares you most about the market right now?', placeholder: 'A specific worry beats a generic one.', minWords: 3 },
          ]);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const totalSteps = (questions.length || 3) + 2; // intro + N questions + welcome (prefs optional)
  // Progress: 0 during intro, 1..N during questions, N+1 during prefs, N+2 at welcome.
  const progressStep = phase === 'intro' ? 0
    : phase === 'q' ? questionIdx + 1
    : phase === 'preferences' ? questions.length + 1
    : totalSteps;

  function wordCount(text) {
    return (text || '').trim().split(/\s+/).filter(Boolean).length;
  }

  async function submitAnswer() {
    setError('');
    const q = questions[questionIdx];
    if (!q) return;
    const trimmed = answer.trim();
    if (wordCount(trimmed) < (q.minWords ?? 3)) {
      setError(`Give us a bit more. At least ${q.minWords ?? 3} words. The depth is the point.`);
      return;
    }
    setSubmitting(true);
    try {
      await api.onboarding.answer({ questionIdx: q.idx, answer: trimmed });
      setSubmitting(false);
      setError('');
      // Reset textarea + advance
      setAnswer('');
      if (questionIdx + 1 < questions.length) {
        setQuestionIdx(questionIdx + 1);
      } else {
        // Last question answered → go to optional preferences step
        setPhase('preferences');
      }
    } catch (err) {
      setSubmitting(false);
      setError(err?.error || 'Could not save. Try again in a moment.');
    }
  }

  async function savePrefsAndGoToWelcome() {
    setSubmitting(true);
    setError('');
    try {
      await api.settings.update({
        trading_style: prefs.style,
        risk_tolerance: prefs.risk,
        onboarding_style: prefs.style,
        onboarding_assets: prefs.assets.join(','),
      });
      setSubmitting(false);
    } catch (err) {
      // Non-fatal — defaults will be used. Don't block the welcome.
      setSubmitting(false);
      console.warn('[ConversationalOnboarding] Prefs save failed, continuing:', err);
    }
    setPhase('welcome');
    setWelcomeLoading(true);
    try {
      const res = await api.ai.welcome({
        style: prefs.style,
        risk_tolerance: prefs.risk,
        assets: prefs.assets,
      });
      setWelcomeMsg(res?.message || '');
      setWelcomeVariant(res?.variant || null);
    } catch {
      setWelcomeMsg("Welcome aboard. I'll get to know your style as we go. When you're ready, drop in a position or ask me anything about the market.");
    } finally {
      setWelcomeLoading(false);
    }
  }

  async function rateWelcome(rating) {
    if (welcomeRated) return;
    setWelcomeRated(true);
    try {
      await api.ai.feedback({
        feature: 'welcome',
        rating,
        variant: welcomeVariant,
        responsePreview: (welcomeMsg || '').slice(0, 200),
      });
    } catch {}
  }

  // Run the first read on a named ticker. The endpoint is free and always returns
  // SOMETHING (a static fallback on an AI outage), so this rarely errors.
  async function runFirstRead(rawTicker) {
    const t = String(rawTicker ?? frTicker).toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 6);
    if (!t) { setFrError('Type a ticker, like NVDA.'); return; }
    setFrError(''); setFrLoading(true); setFrResult(null); setFrRated(false);
    try {
      const r = await api.ai.firstRead({ ticker: t });
      setFrResult({ ticker: t, read: r?.read || '', price: r?.price ?? null, changePct: r?.changePct ?? null });
    } catch {
      setFrError('Could not read that one. Try another ticker.');
    } finally {
      setFrLoading(false);
    }
  }

  async function rateFirstRead(rating) {
    if (frRated) return;
    setFrRated(true);
    try {
      await api.ai.feedback({ feature: 'first_read', rating, responsePreview: (frResult?.read || '').slice(0, 200) });
    } catch {}
  }

  // Close the loop: save the stock they just had read to their watchlist, so the
  // app is not empty when they land and the thing they cared about is waiting.
  // Best-effort; a watchlist failure never blocks getting into the app.
  async function watchAndOpen() {
    if (submitting) return;
    setSubmitting(true);
    if (frResult?.ticker) {
      try { await api.social.addToWatchlist({ ticker: frResult.ticker, companyName: frResult.ticker }); } catch {}
    }
    completeOnboarding();
  }

  async function completeOnboarding() {
    setSubmitting(true);
    setError('');
    try {
      await api.settings.update({ onboarding_complete: true });
      updateUser({
        onboarding_complete: true,
        trading_style: prefs.style,
        risk_tolerance: prefs.risk,
      });
    } catch {
      setError('Could not finish. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  // Escape hatch — user can bail out of the conversation and go straight to
  // the app. We still mark onboarding_complete so they don't get re-prompted.
  // Their lack of anchors just means the agent will be less personalized
  // until they add positions / write theses.
  async function skipAll() {
    setSubmitting(true);
    setError('');
    try {
      await api.settings.update({
        trading_style: prefs.style,
        risk_tolerance: prefs.risk,
        onboarding_complete: true,
      });
      updateUser({ onboarding_complete: true, trading_style: prefs.style, risk_tolerance: prefs.risk });
    } catch {
      setError('Could not skip. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  // ─── Progress bar shared across phases ──────────────────────────────────
  function ProgressBar() {
    const filled = Math.min(progressStep, totalSteps);
    return (
      <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 2, borderRadius: 1,
            background: i < filled ? 'var(--blue)' : 'var(--raised)',
            transition: 'background 0.3s',
          }} />
        ))}
      </div>
    );
  }

  // ─── Phase: intro ───────────────────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <Shell>
        <ProgressBar />
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 8 }}>Before we start</p>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginBottom: 10, letterSpacing: '-0.3px' }}>Three questions, ninety seconds.</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 6 }}>
          Outpost works best when it knows a little about you. Not the form-fields kind of stuff. The real stuff.
        </p>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 28 }}>
          What we ask now, we'll remember forever. Quote you back to yourself in 6 months. No one else gets to do that.
        </p>
        <button onClick={() => setPhase('q')} disabled={questions.length === 0} className="btn btn-blue" style={{ width: '100%', padding: 12 }}>
          {questions.length === 0 ? 'Loading…' : 'Begin'}
        </button>
        <button onClick={skipAll} disabled={submitting} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, padding: '14px 0 0', fontFamily: 'inherit', letterSpacing: '0.3px', width: '100%' }}>
          {submitting ? 'Skipping…' : 'Skip, just take me to the app'}
        </button>
        {error && <p style={{ fontSize: 11, color: 'var(--red)', textAlign: 'center', paddingTop: 8 }}>{error}</p>}
      </Shell>
    );
  }

  // ─── Phase: question ────────────────────────────────────────────────────
  if (phase === 'q') {
    const q = questions[questionIdx];
    if (!q) return <Shell><p style={{ color: 'var(--muted)' }}>Loading…</p></Shell>;
    const wc = wordCount(answer);
    const minW = q.minWords ?? 3;
    return (
      <Shell>
        <ProgressBar />
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 8 }}>Question {questionIdx + 1} of {questions.length}</p>
        <h1 style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)', marginBottom: 14, letterSpacing: '-0.2px', lineHeight: 1.3 }}>{q.prompt}</h1>
        <textarea
          value={answer}
          onChange={e => setAnswer(e.target.value.slice(0, 800))}
          placeholder={q.placeholder || ''}
          rows={5}
          autoFocus
          style={{
            width: '100%', padding: 14, fontSize: 14, lineHeight: 1.55,
            background: 'var(--surface)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 8,
            resize: 'vertical', fontFamily: 'inherit',
            marginBottom: 8,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <p style={{ fontSize: 10, color: wc >= minW ? 'var(--muted)' : 'var(--faint)' }}>
            {wc < minW ? `At least ${minW} words` : 'Good. Take it further if you want.'}
          </p>
          <p style={{ fontSize: 10, color: 'var(--faint)' }}>{answer.length}/800</p>
        </div>
        {error && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 12, textAlign: 'center' }}>{error}</p>}
        <button
          onClick={submitAnswer}
          disabled={submitting || wc < minW}
          className="btn btn-blue"
          style={{ width: '100%', padding: 12, opacity: (submitting || wc < minW) ? 0.4 : 1 }}
        >
          {submitting ? 'Saving…' : questionIdx + 1 < questions.length ? 'Next question' : 'Continue'}
        </button>
        <button onClick={skipAll} disabled={submitting} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, padding: '14px 0 0', fontFamily: 'inherit', letterSpacing: '0.3px', width: '100%' }}>
          Skip, open the app
        </button>
      </Shell>
    );
  }

  // ─── Phase: preferences (optional) ──────────────────────────────────────
  if (phase === 'preferences') {
    function toggleAsset(v) {
      setPrefs(p => ({
        ...p,
        assets: p.assets.includes(v) ? p.assets.filter(x => x !== v) : [...p.assets, v],
      }));
    }
    return (
      <Shell>
        <ProgressBar />
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 8 }}>One more thing (optional)</p>
        <h1 style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.2px' }}>How do you usually trade?</h1>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20 }}>Helps me calibrate. You can change this anytime in Settings.</p>

        <p style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 8 }}>Style</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {STYLE_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setPrefs(p => ({ ...p, style: opt.value }))} style={{
              padding: '11px 14px', textAlign: 'left', cursor: 'pointer',
              background: prefs.style === opt.value ? 'rgba(59,130,246,0.12)' : 'var(--raised)',
              border: `1px solid ${prefs.style === opt.value ? 'var(--blue)' : 'var(--border)'}`,
              borderRadius: 7, fontFamily: 'inherit',
            }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: prefs.style === opt.value ? 'var(--blue)' : 'var(--text)' }}>{opt.label}</p>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{opt.desc}</p>
            </button>
          ))}
        </div>

        <p style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 8 }}>Risk tolerance</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {RISK_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => setPrefs(p => ({ ...p, risk: opt.value }))} style={{
              padding: '11px 14px', textAlign: 'left', cursor: 'pointer',
              background: prefs.risk === opt.value ? 'rgba(59,130,246,0.12)' : 'var(--raised)',
              border: `1px solid ${prefs.risk === opt.value ? 'var(--blue)' : 'var(--border)'}`,
              borderRadius: 7, fontFamily: 'inherit',
            }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: prefs.risk === opt.value ? 'var(--blue)' : 'var(--text)' }}>{opt.label}</p>
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{opt.desc}</p>
            </button>
          ))}
        </div>

        <p style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 8 }}>What you trade</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
          {ASSET_OPTIONS.map(opt => {
            const on = prefs.assets.includes(opt.value);
            return (
              <button key={opt.value} onClick={() => toggleAsset(opt.value)} style={{
                flex: 1, padding: '10px 14px', cursor: 'pointer',
                background: on ? 'rgba(59,130,246,0.12)' : 'var(--raised)',
                border: `1px solid ${on ? 'var(--blue)' : 'var(--border)'}`,
                borderRadius: 7, fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                color: on ? 'var(--blue)' : 'var(--text)',
              }}>{opt.label}</button>
            );
          })}
        </div>

        {error && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 12, textAlign: 'center' }}>{error}</p>}
        <button onClick={savePrefsAndGoToWelcome} disabled={submitting || prefs.assets.length === 0} className="btn btn-blue" style={{ width: '100%', padding: 12, opacity: (submitting || prefs.assets.length === 0) ? 0.4 : 1 }}>
          {submitting ? 'Saving…' : 'Continue'}
        </button>
        <button onClick={() => { setPrefs({ style: 'swing', risk: 'moderate', assets: ['stocks'] }); savePrefsAndGoToWelcome(); }} disabled={submitting} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, padding: '14px 0 0', fontFamily: 'inherit', letterSpacing: '0.3px', width: '100%' }}>
          Skip, use defaults
        </button>
      </Shell>
    );
  }

  // ─── Phase: first read (the "watch it work" finale) ─────────────────────
  if (phase === 'firstread') {
    const SUGGESTED = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMD'];
    return (
      <Shell>
        <ProgressBar />
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 8 }}>The last 20 seconds</p>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: 'var(--text)', marginBottom: 8, letterSpacing: '-0.3px' }}>Now watch it work.</h1>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 20 }}>
          Name a stock you own or are watching. I will read it the way I will every morning. Calm, specific, no hype.
        </p>

        {!frResult && !frLoading && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                value={frTicker}
                onChange={e => setFrTicker(e.target.value.toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 6))}
                onKeyDown={e => { if (e.key === 'Enter') runFirstRead(); }}
                placeholder="Ticker, e.g. NVDA"
                autoFocus
                style={{ flex: 1, padding: '12px 14px', fontSize: 15, letterSpacing: '0.5px', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'inherit' }}
              />
              <button onClick={() => runFirstRead()} disabled={!frTicker} className="btn btn-blue" style={{ padding: '0 18px', opacity: frTicker ? 1 : 0.4 }}>Read it</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 20 }}>
              {SUGGESTED.map(t => (
                <button key={t} onClick={() => { setFrTicker(t); runFirstRead(t); }} style={{
                  padding: '6px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px',
                  background: 'var(--raised)', color: 'var(--muted)', border: '1px solid var(--border)',
                  borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
                }}>{t}</button>
              ))}
            </div>
            {frError && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 12 }}>{frError}</p>}
            <button onClick={completeOnboarding} disabled={submitting} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, padding: '6px 0 0', fontFamily: 'inherit', letterSpacing: '0.3px', width: '100%' }}>
              {submitting ? 'Opening…' : 'Skip, open Outpost'}
            </button>
          </>
        )}

        {frLoading && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '28px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--faint)', fontSize: 11 }}>
            <div style={{ width: 24, height: 24, border: '2px solid var(--border)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <span>Reading {frTicker}…</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {frResult && !frLoading && (
          <>
            <div style={{ background: 'linear-gradient(180deg, rgba(59,130,246,0.08), rgba(59,130,246,0.02))', border: '1px solid rgba(59,130,246,0.18)', borderRadius: 10, padding: '15px 16px', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', animation: 'frDot 2s ease-in-out infinite' }} />
                  <p style={{ fontSize: 9, color: 'var(--blue)', letterSpacing: '1.3px', fontWeight: 700, margin: 0 }}>OUTPOST READS {frResult.ticker}</p>
                </div>
                {frResult.price != null && (
                  <p style={{ fontSize: 10, color: 'var(--faint)', margin: 0 }}>
                    ${frResult.price}{frResult.changePct != null && <span style={{ color: frResult.changePct >= 0 ? 'var(--green)' : 'var(--red)', marginLeft: 6 }}>{frResult.changePct >= 0 ? '+' : ''}{frResult.changePct.toFixed(1)}%</span>}
                  </p>
                )}
              </div>
              <p style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0 }}>{frResult.read}</p>
              <style>{`@keyframes frDot { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
            </div>

            {!frRated && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 14 }}>
                <p style={{ fontSize: 10, color: 'var(--faint)', marginRight: 4 }}>Did that land?</p>
                <button onClick={() => rateFirstRead('up')} className="btn btn-muted" style={{ padding: '6px 12px', fontSize: 12 }} aria-label="Yes">👍</button>
                <button onClick={() => rateFirstRead('down')} className="btn btn-muted" style={{ padding: '6px 12px', fontSize: 12 }} aria-label="No">👎</button>
              </div>
            )}
            {frRated && <p style={{ fontSize: 10, color: 'var(--faint)', textAlign: 'center', marginBottom: 14 }}>Noted. This is how it learns your taste.</p>}

            <button onClick={watchAndOpen} disabled={submitting} className="btn btn-blue" style={{ width: '100%', padding: 12 }}>
              {submitting ? 'Opening…' : `Track ${frResult.ticker} and open Outpost`}
            </button>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 13 }}>
              <button onClick={completeOnboarding} disabled={submitting} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, fontFamily: 'inherit', letterSpacing: '0.3px' }}>
                Just open Outpost
              </button>
              <button onClick={() => { setFrResult(null); setFrTicker(''); setFrError(''); }} disabled={submitting} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, fontFamily: 'inherit', letterSpacing: '0.3px' }}>
                Read another
              </button>
            </div>
          </>
        )}

        <p style={{ fontSize: 9, color: 'var(--faint)', textAlign: 'center', marginTop: 18, lineHeight: 1.5, letterSpacing: '0.2px' }}>
          Educational use only. Not financial advice.
        </p>
      </Shell>
    );
  }

  // ─── Phase: welcome ─────────────────────────────────────────────────────
  return (
    <Shell>
      <ProgressBar />
      <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 8 }}>You're in</p>
      <h1 style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)', marginBottom: 6, letterSpacing: '-0.2px' }}>A read on today, just for you</h1>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 20 }}>Based on what you just shared.</p>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '18px 16px', minHeight: 140, display: 'flex', alignItems: welcomeLoading ? 'center' : 'flex-start', justifyContent: welcomeLoading ? 'center' : 'flex-start', marginBottom: 16 }}>
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

      {!welcomeLoading && welcomeMsg && !welcomeRated && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 14 }}>
          <p style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.3px', marginRight: 4 }}>Useful?</p>
          <button onClick={() => rateWelcome('up')} className="btn btn-muted" style={{ padding: '6px 12px', fontSize: 12 }} aria-label="Yes">👍</button>
          <button onClick={() => rateWelcome('down')} className="btn btn-muted" style={{ padding: '6px 12px', fontSize: 12 }} aria-label="No">👎</button>
        </div>
      )}
      {welcomeRated && (
        <p style={{ fontSize: 10, color: 'var(--faint)', textAlign: 'center', marginBottom: 14 }}>Thanks. That helps us tune your AI.</p>
      )}

      {error && <p style={{ fontSize: 11, color: 'var(--red)', textAlign: 'center', paddingBottom: 8 }}>{error}</p>}
      <button onClick={() => setPhase('firstread')} disabled={welcomeLoading} className="btn btn-blue" style={{ width: '100%', padding: 12, opacity: welcomeLoading ? 0.4 : 1 }}>
        Now watch it read a real stock →
      </button>
      <button onClick={completeOnboarding} disabled={submitting || welcomeLoading} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, padding: '14px 0 0', fontFamily: 'inherit', letterSpacing: '0.3px', width: '100%' }}>
        {submitting ? 'Opening…' : 'Skip, open Outpost'}
      </button>
    </Shell>
  );
}

// Shared layout wrapper — same vibe as old OnboardingScreen so the visual
// transition from auth → onboarding doesn't jar.
function Shell({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '40px 24px', background: 'var(--bg)', maxWidth: 400, margin: '0 auto' }}>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
