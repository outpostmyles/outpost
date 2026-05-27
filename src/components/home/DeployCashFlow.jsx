// DeployCashFlow — Phase 4 "I have $X to deploy" guided workflow.
//
// Three steps:
//   1. amount (chips + custom)
//   2. context (time horizon + goal — optional, skippable)
//   3. recommendations (2-3 option cards with primary/secondary/text actions)
//
// Opens full-screen on mobile, modal on desktop. Tapping "I'll do this"
// pre-fills the Add Position flow with the recommendation's ticker, shares,
// cost, and reasoning (the bridge to Phase 2 thesis capture).
import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';

const AMOUNT_CHIPS = [50, 100, 500, 1000, 5000];

const HORIZON_OPTIONS = [
  { id: 'never', label: 'Never (long-term)' },
  { id: '5plus', label: '5+ years' },
  { id: '1to5', label: '1–5 years' },
  { id: 'this_year', label: 'This year' },
  { id: 'unsure', label: 'Not sure' },
];

const GOAL_OPTIONS = [
  { id: 'grow_aggressively', label: 'Grow it aggressively' },
  { id: 'build_steadily', label: 'Build steadily' },
  { id: 'preserve', label: 'Just preserve it' },
  { id: 'open', label: 'Open to ideas' },
];

export default function DeployCashFlow({ onClose, onPickRecommendation, onOpenAgent, showToast }) {
  const [step, setStep] = useState('amount'); // 'amount' | 'context' | 'loading' | 'results'
  const [amount, setAmount] = useState(null);
  const [customAmount, setCustomAmount] = useState('');
  const [horizon, setHorizon] = useState(null);
  const [goal, setGoal] = useState(null);
  const [recs, setRecs] = useState(null); // full response from /deploy-cash
  const [err, setErr] = useState('');

  function pickChip(v) { setAmount(v); setCustomAmount(''); }
  function applyCustom() {
    const v = parseFloat(customAmount);
    if (!isFinite(v) || v <= 0) { setErr('Enter a positive number'); return; }
    setAmount(v); setErr('');
  }

  async function fetchRecs({ seekVariety = false, previousTitles = [] } = {}) {
    setStep('loading'); setErr('');
    try {
      const d = await api.ai.deployCash({
        amount,
        time_horizon: horizon || undefined,
        goal: goal || undefined,
        seek_variety: seekVariety,
        previous_titles: previousTitles,
      });
      setRecs(d);
      setStep('results');
    } catch (e) {
      setErr(e.error || 'Could not generate recommendations');
      setStep('amount');
      showToast?.(e.error || 'Could not generate recommendations', 'error');
    }
  }

  function gotoContext() {
    if (amount == null) return;
    setStep('context');
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '24px 16px', overflowY: 'auto',
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: '100%', maxWidth: 540,
        background: 'var(--bg)', border: '1px solid var(--border)',
        borderRadius: 12, padding: 0, marginTop: 24, marginBottom: 24,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text)' }}>DEPLOY CASH</p>
            <ProgressDots step={step} />
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--faint)', fontSize: 18, cursor: 'pointer', padding: 0, fontFamily: 'inherit', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '20px 18px' }}>
          {/* STEP 1 — AMOUNT */}
          {step === 'amount' && (
            <>
              <p style={{ fontSize: 15, color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>
                How much are you looking to put to work?
              </p>
              <p style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 18, lineHeight: 1.5 }}>
                Outpost will look at your portfolio and your past thinking to give you 2–3 specific options.
              </p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                {AMOUNT_CHIPS.map(v => (
                  <button
                    key={v}
                    onClick={() => pickChip(v)}
                    style={chipStyle(amount === v && !customAmount)}
                  >${v.toLocaleString()}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--faint)' }}>Custom $</span>
                <input
                  className="input"
                  type="number"
                  placeholder="e.g. 250"
                  value={customAmount}
                  onChange={e => setCustomAmount(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && applyCustom()}
                  style={{ flex: 1, fontSize: 12 }}
                />
                <button onClick={applyCustom} className="btn btn-muted" style={{ fontSize: 10, padding: '8px 14px' }}>SET</button>
              </div>
              {err && <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 12 }}>{err}</p>}
              <button
                onClick={gotoContext}
                disabled={amount == null}
                className="btn btn-blue btn-full"
                style={{ marginTop: 20, padding: '11px 0', opacity: amount == null ? 0.4 : 1 }}
              >
                Continue → {amount != null && `$${amount.toLocaleString()}`}
              </button>
            </>
          )}

          {/* STEP 2 — CONTEXT */}
          {step === 'context' && (
            <>
              <p style={{ fontSize: 15, color: 'var(--text)', fontWeight: 600, marginBottom: 4 }}>
                Want to give Outpost a bit of context?
              </p>
              <p style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 18, lineHeight: 1.5 }}>
                Optional — sharpens the recommendations. You can skip.
              </p>

              <p style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 700, letterSpacing: '0.6px', marginBottom: 6 }}>WHEN DO YOU NEED THIS MONEY BACK?</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                {HORIZON_OPTIONS.map(o => (
                  <button key={o.id} onClick={() => setHorizon(h => h === o.id ? null : o.id)} style={chipStyle(horizon === o.id)}>
                    {o.label}
                  </button>
                ))}
              </div>

              <p style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 700, letterSpacing: '0.6px', marginBottom: 6 }}>WHAT ARE YOU TRYING TO DO?</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
                {GOAL_OPTIONS.map(o => (
                  <button key={o.id} onClick={() => setGoal(g => g === o.id ? null : o.id)} style={chipStyle(goal === o.id)}>
                    {o.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => fetchRecs()} className="btn btn-muted" style={{ flex: 1 }}>
                  Skip & get recommendations
                </button>
                <button onClick={() => fetchRecs()} className="btn btn-blue" style={{ flex: 1 }}>
                  Get recommendations →
                </button>
              </div>
            </>
          )}

          {/* STEP 3 — LOADING */}
          {step === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 0' }}>
              <div style={{ width: 22, height: 22, border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid var(--blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 18, textAlign: 'center', lineHeight: 1.5, maxWidth: 320 }}>
                Looking at your portfolio, your past thinking, and what's happening in the market right now…
              </p>
            </div>
          )}

          {/* STEP 3 — RESULTS */}
          {step === 'results' && recs && (
            <RecommendationsView
              recs={recs}
              amount={amount}
              onPick={onPickRecommendation}
              onShowAlternatives={() => fetchRecs({ seekVariety: true, previousTitles: (recs.options || []).map(o => o.title) })}
              onOpenAgent={() => onOpenAgent?.(amount, recs.options)}
              showToast={showToast}
            />
          )}

          {err && step !== 'amount' && (
            <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 14, textAlign: 'center' }}>{err}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressDots({ step }) {
  const order = ['amount', 'context', 'loading', 'results'];
  const idx = order.indexOf(step);
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[0, 1, 2].map(i => {
        const reached = idx >= i || (i === 2 && step === 'results');
        return <div key={i} style={{ width: 16, height: 3, borderRadius: 1, background: reached ? 'var(--blue)' : 'var(--raised)' }} />;
      })}
    </div>
  );
}

function chipStyle(active) {
  return {
    fontSize: 11, padding: '7px 12px', borderRadius: 5,
    background: active ? 'var(--blue)' : 'transparent',
    color: active ? '#fff' : 'var(--muted)',
    border: `1px solid ${active ? 'var(--blue)' : 'var(--border)'}`,
    cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
    letterSpacing: '0.3px', transition: 'all 0.15s',
  };
}

function RecommendationsView({ recs, amount, onPick, onShowAlternatives, onOpenAgent, showToast }) {
  return (
    <>
      {recs.market_context_note && (
        <div style={{ background: 'var(--raised)', borderLeft: '2px solid var(--blue)', borderRadius: 4, padding: '8px 11px', marginBottom: 14 }}>
          <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '0.6px', marginBottom: 3 }}>TODAY'S MARKET READ</p>
          <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.5 }}>{recs.market_context_note}</p>
        </div>
      )}

      {recs.tiny_amount && (
        <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 5, padding: '8px 11px', marginBottom: 14 }}>
          <p style={{ fontSize: 11, color: 'var(--amber)', lineHeight: 1.5 }}>
            Heads up — small amounts get eaten by spread. The options below lean toward accumulating or DCA so the money actually does work.
          </p>
        </div>
      )}

      <p style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 700, letterSpacing: '0.6px', marginBottom: 8 }}>
        YOUR OPTIONS · ${amount?.toLocaleString()}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        {(recs.options || []).map(opt => (
          <OptionCard
            key={opt.id}
            opt={opt}
            sessionId={recs.session_id}
            onPick={() => onPick?.(opt, recs.session_id)}
            showToast={showToast}
          />
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={onShowAlternatives} className="btn btn-muted btn-full" style={{ fontSize: 10, padding: '9px 0' }}>
          ✦ SHOW ME DIFFERENT ANGLES
        </button>
        <button
          onClick={onOpenAgent}
          style={{
            background: 'none', border: 'none', color: 'var(--faint)',
            fontSize: 10, cursor: 'pointer', padding: '6px 0', letterSpacing: '0.3px',
            textAlign: 'center', fontFamily: 'inherit',
          }}
        >
          None of these feel right? → Talk it out with the agent
        </button>
      </div>

      {/* Disclaimer — required on every AI-generated recommendation surface.
          Always visible, never collapsed, matches the disclaimer on Today/Brief. */}
      <p style={{
        fontSize: 9, color: 'var(--faint)', textAlign: 'center',
        marginTop: 14, lineHeight: 1.5, fontStyle: 'italic',
      }}>
        Not financial advice. For educational purposes only. Trading involves substantial risk of loss.
      </p>
    </>
  );
}

function OptionCard({ opt, sessionId, onPick, showToast }) {
  const [counter, setCounter] = useState(null);
  const [counterLoading, setCounterLoading] = useState(false);

  async function fetchCounter() {
    if (!sessionId) {
      showToast?.('Counter-arguments need the session log — apply migration 015 in Supabase first.', 'error');
      return;
    }
    setCounterLoading(true);
    try {
      const d = await api.ai.deployCashCounter({ session_id: sessionId, option_id: opt.id });
      setCounter(d.counter);
    } catch (e) {
      showToast?.(e.error || 'Counter unavailable', 'error');
    }
    setCounterLoading(false);
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{opt.title}</p>
      {opt.action_summary && (
        <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8, fontWeight: 600 }}>{opt.action_summary}</p>
      )}
      {opt.reasoning && (
        <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.55, marginBottom: 8 }}>{opt.reasoning}</p>
      )}
      {opt.fit_note && (
        <div style={{ borderLeft: '2px solid var(--blue)', paddingLeft: 8, marginBottom: 8 }}>
          <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 2 }}>WHY THIS FITS YOU</p>
          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>{opt.fit_note}</p>
        </div>
      )}
      {opt.risk_note && (
        <p style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.5, marginBottom: 10 }}>
          <span style={{ color: 'var(--amber)', fontWeight: 700, letterSpacing: '0.3px' }}>RISK · </span>
          {opt.risk_note}
        </p>
      )}

      {counter && (
        <div style={{ background: 'var(--raised)', borderLeft: '2px solid var(--amber)', borderRadius: 4, padding: '8px 10px', marginBottom: 10 }}>
          <p style={{ fontSize: 9, color: 'var(--amber)', fontWeight: 700, letterSpacing: '0.5px', marginBottom: 3 }}>HONEST PUSHBACK</p>
          <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.55, fontStyle: 'italic' }}>{counter}</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onPick} className="btn btn-blue" style={{ flex: 1, fontSize: 11, padding: '8px 0' }}>
          I'll do this →
        </button>
        <button
          onClick={fetchCounter}
          disabled={counterLoading}
          className="btn btn-muted"
          style={{ fontSize: 10, padding: '8px 12px' }}
        >
          {counterLoading ? '…' : counter ? 'HIDE' : 'WHY NOT?'}
        </button>
      </div>
    </div>
  );
}
