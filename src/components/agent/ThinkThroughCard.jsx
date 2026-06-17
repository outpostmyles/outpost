// Think It Through: the disciplined trade-plan scaffold, the process turned into
// a front door. The user names a buy they are weighing and fills the six
// disciplines; the card grades it live (the pure assessTradePlan on the server)
// and is honest about whether they have a plan or a gut buy, naming the
// invalidation, the step almost everyone skips. Nothing is bought until they
// choose to set it up, and the thesis they write is tagged as THEIRS.
import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { FeedbackButtons } from '../shared/UI.jsx';

const VERDICT = {
  thought_through: { color: 'var(--green)', label: 'Thought through' },
  has_gaps: { color: 'var(--amber)', label: 'Has gaps' },
  gut_buy: { color: 'var(--red)', label: 'Gut buy' },
};

// Red-team feature flag. Live now; set to false to hide the button instantly
// (the backend endpoint is additive and harmless on its own).
const RED_TEAM_ENABLED = true;

// Referee verdict tone: which side the stress-test came down on.
const RT_TONE = {
  bull: { color: 'var(--green)', label: 'Bull case is stronger' },
  bear: { color: 'var(--red)', label: 'Bear case is stronger' },
  even: { color: 'var(--amber)', label: 'Too close to call' },
};

export default function ThinkThroughCard({ onClose, showToast }) {
  const [ticker, setTicker] = useState('');
  const [thesis, setThesis] = useState('');
  const [invalidation, setInvalidation] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [riskPct, setRiskPct] = useState('2');
  const [reviewDays, setReviewDays] = useState('30');
  const [accountSize, setAccountSize] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [grading, setGrading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [redTeam, setRedTeam] = useState(null);
  const [rtLoading, setRtLoading] = useState(false);
  const [rtError, setRtError] = useState('');

  // Ground: the user's account value defaults the sizing, so they do not type it.
  useEffect(() => {
    let cancelled = false;
    api.portfolio.value().then(v => { if (!cancelled) setAccountSize(v?.accountValue ?? v?.totalValue ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // A red-team result is tied to the ticker it ran on; if the user changes the
  // ticker, drop the stale result so they re-run on the new one.
  useEffect(() => { setRedTeam(null); setRtError(''); }, [ticker]);

  // Live grading, debounced. Pure and cheap on the server, so it feels instant.
  useEffect(() => {
    if (!ticker.trim()) { setAssessment(null); return; }
    setGrading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.portfolio.assessPlan({
          ticker: ticker.trim(),
          stop_loss: stop ? Number(stop) : undefined,
          target_price: target ? Number(target) : undefined,
          account_size: accountSize ?? undefined,
          risk_pct: riskPct ? Number(riskPct) : undefined,
          thesis, invalidation,
          review_in_days: reviewDays ? Number(reviewDays) : undefined,
        });
        setAssessment(r);
      } catch { setAssessment(null); }
      finally { setGrading(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [ticker, thesis, invalidation, stop, target, riskPct, reviewDays, accountSize]);

  const entry = assessment?.entryPrice ?? null;
  const sized = assessment?.sizing?.shares_to_buy > 0;
  const canSetUp = !!(ticker.trim() && entry && sized && thesis.trim());
  const tone = assessment ? (VERDICT[assessment.verdict] || VERDICT.has_gaps) : null;

  async function setUp() {
    if (!canSetUp || applying) return;
    setApplying(true);
    try {
      await api.portfolio.addPosition({
        ticker: ticker.trim(),
        shares: assessment.sizing.shares_to_buy,
        avgCost: entry,
        entryThesis: thesis.trim(),
        thesisSource: 'user',
        reversalCondition: invalidation.trim() || undefined,
        stopLoss: stop ? Number(stop) : undefined,
        priceTarget: target ? Number(target) : undefined,
        source: 'manual',
      });
      showToast?.(`Set up ${ticker.trim()} with your plan`, 'success');
      onClose?.();
    } catch (e) {
      showToast?.(e?.error || 'Could not set it up just now', 'error');
      setApplying(false);
    }
  }

  async function runRedTeam() {
    if (rtLoading || !ticker.trim()) return;
    setRtLoading(true); setRtError('');
    try {
      const r = await api.ai.redTeam({ ticker: ticker.trim(), thesis: thesis.trim(), invalidation: invalidation.trim() });
      setRedTeam(r);
    } catch (e) {
      setRtError(e?.error || 'Could not run the red-team just now.');
    } finally {
      setRtLoading(false);
    }
  }

  const labelStyle = { fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--faint)', textTransform: 'uppercase', display: 'block', marginBottom: 4 };
  const fieldStyle = { width: '100%', padding: '8px 10px', fontSize: 13, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 7, fontFamily: 'inherit', boxSizing: 'border-box' };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 460, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, margin: '24px 0', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)' }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text)', margin: 0 }}>THINK IT THROUGH</p>
            <p style={{ fontSize: 9.5, color: 'var(--faint)', margin: '2px 0 0' }}>A plan beats a gut buy. Fill in what you can.</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--faint)', fontSize: 18, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Ticker</label>
              <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 6))} placeholder="e.g. NVDA" autoFocus style={{ ...fieldStyle, letterSpacing: '0.5px', fontWeight: 700 }} />
            </div>
            {entry != null && <span style={{ fontSize: 12, color: 'var(--muted)', paddingBottom: 9 }}>${entry}</span>}
          </div>

          <div>
            <label style={labelStyle}>Thesis, why you own it</label>
            <textarea value={thesis} onChange={e => setThesis(e.target.value.slice(0, 400))} rows={2} placeholder="One line, in your own words." style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>
          <div>
            <label style={{ ...labelStyle, color: 'var(--blue)' }}>Invalidation, what would prove you wrong</label>
            <textarea value={invalidation} onChange={e => setInvalidation(e.target.value.slice(0, 400))} rows={2} placeholder="The step most people skip. What would make you sell?" style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.5, borderColor: invalidation.trim() ? 'var(--border)' : 'rgba(59,130,246,0.4)' }} />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><label style={labelStyle}>Stop</label><input value={stop} onChange={e => setStop(e.target.value)} inputMode="decimal" placeholder="exit if wrong" style={fieldStyle} /></div>
            <div style={{ flex: 1 }}><label style={labelStyle}>Target</label><input value={target} onChange={e => setTarget(e.target.value)} inputMode="decimal" placeholder="take profit" style={fieldStyle} /></div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}><label style={labelStyle}>Risk per trade %</label><input value={riskPct} onChange={e => setRiskPct(e.target.value)} inputMode="decimal" style={fieldStyle} /></div>
            <div style={{ flex: 1 }}><label style={labelStyle}>Review in (days)</label><input value={reviewDays} onChange={e => setReviewDays(e.target.value)} inputMode="numeric" style={fieldStyle} /></div>
          </div>
          {accountSize != null && <p style={{ fontSize: 10, color: 'var(--faint)', margin: 0 }}>Sizing against your account of about ${Math.round(accountSize).toLocaleString()}.</p>}

          {ticker.trim() && tone && (
            <div style={{ background: 'var(--surface)', border: `1px solid ${tone.color}`, borderRadius: 9, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone.color }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.5px', color: tone.color }}>{tone.label.toUpperCase()}</span>
                {grading && <span style={{ fontSize: 9, color: 'var(--faint)', marginLeft: 'auto' }}>checking…</span>}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.55, margin: '0 0 10px' }}>{assessment.headline}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px' }}>
                {assessment.steps.map(s => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: s.present ? 'var(--text)' : 'var(--faint)' }}>
                    <span style={{ color: s.present ? 'var(--green)' : 'var(--faint)' }}>{s.present ? '✓' : '○'}</span>
                    {s.label.replace(/ \(.*\)/, '')}
                  </div>
                ))}
              </div>
              {assessment.sizing && (
                <p style={{ fontSize: 11, color: 'var(--muted)', margin: '10px 0 0', lineHeight: 1.5 }}>
                  Size: {assessment.sizing.shares_to_buy} shares, about ${Math.round(assessment.sizing.total_cost).toLocaleString()} ({assessment.sizing.portfolio_allocation_pct}% of your account){assessment.riskReward ? `. Risk to reward ${assessment.riskReward.best_risk_reward}.` : '.'}
                </p>
              )}
              {assessment.warnings?.length > 0 && (
                <p style={{ fontSize: 10.5, color: 'var(--red)', margin: '6px 0 0', lineHeight: 1.5 }}>{assessment.warnings.join('. ')}</p>
              )}
            </div>
          )}

          {RED_TEAM_ENABLED && ticker.trim() && !redTeam && (
            <button onClick={runRedTeam} disabled={rtLoading} className="btn btn-muted" style={{ width: '100%', padding: 11, fontSize: 12, letterSpacing: '0.5px', opacity: rtLoading ? 0.5 : 1 }}>
              {rtLoading ? 'Weighing both sides...' : 'RED-TEAM THIS TRADE'}
            </button>
          )}
          {rtError && <p style={{ fontSize: 10.5, color: 'var(--red)', textAlign: 'center', margin: 0 }}>{rtError}</p>}
          {redTeam && (() => {
            const t = RT_TONE[redTeam.lean] || RT_TONE.even;
            return (
              <div style={{ background: 'var(--surface)', border: `1px solid ${t.color}`, borderRadius: 9, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.color }} />
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.5px', color: t.color }}>{t.label.toUpperCase()}</span>
                  <span style={{ fontSize: 9, color: 'var(--faint)', marginLeft: 'auto', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{redTeam.confidence} confidence</span>
                </div>
                {redTeam.verdict && <p style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55, margin: 0 }}>{redTeam.verdict}</p>}
                {redTeam.crux && <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.5, margin: 0 }}><span style={{ color: 'var(--text)', fontWeight: 700 }}>The crux: </span>{redTeam.crux}</p>}
                {redTeam.whatWouldFlip && <p style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.5, margin: 0 }}><span style={{ fontWeight: 700 }}>What would flip it: </span>{redTeam.whatWouldFlip}</p>}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 9 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--green)' }}>THE BULL</span>
                  <p style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.55, margin: '3px 0 0', whiteSpace: 'pre-wrap' }}>{redTeam.bull}</p>
                </div>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 9 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--red)' }}>THE BEAR</span>
                  <p style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.55, margin: '3px 0 0', whiteSpace: 'pre-wrap' }}>{redTeam.bear}</p>
                </div>
                <FeedbackButtons feature="red_team" response={redTeam.verdict} />
              </div>
            );
          })()}

          <button onClick={setUp} disabled={!canSetUp || applying} className="btn btn-blue" style={{ width: '100%', padding: 12, opacity: (!canSetUp || applying) ? 0.4 : 1 }}>
            {applying ? 'Setting up…' : 'Set up this buy with my plan'}
          </button>
          {ticker.trim() && !sized && (
            <p style={{ fontSize: 10, color: 'var(--faint)', textAlign: 'center', margin: 0 }}>Set a stop so it can size the buy to your risk.</p>
          )}
          <p style={{ fontSize: 9, color: 'var(--faint)', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>Nothing is bought until you tap set up. Educational use only, not financial advice.</p>
        </div>
      </div>
    </div>
  );
}
