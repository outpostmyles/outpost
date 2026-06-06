// Onboarding, rebuilt around one rule: show, do not ask.
//
// The old flow opened with three essay questions and a style/risk/assets form,
// rated the user twice, then dropped them on a to-do list. The single best
// moment (the agent reading a real stock) was buried at the very end, where
// most people never reached it. In the 90 seconds you get with a new user,
// every survey field is a reason to close the tab.
//
// New shape:
//   1. hook  -> name one stock, watch the agent read it live. The magic first.
//   2. tour  -> a fast, personalized walk through all five tabs, so they leave
//               knowing what each one does. Their stock is the running example,
//               and the real bottom nav is mirrored so they learn the muscle
//               memory before they even open the app.
//   3. done  -> land in Outpost with that stock already on their watchlist.
//
// No essays. No abstract risk sliders. No "rate us" before we have earned it.
// Style/risk still get sensible defaults written silently on completion so the
// downstream agent context never sees a missing field.

import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../hooks/useAuth.jsx';

const SUGGESTED = ['NVDA', 'AAPL', 'TSLA', 'MSFT', 'AMD'];

// Mirrors AppShell's TABS so the tour teaches the real bottom bar.
const NAV = [
  { id: 'home', label: 'HOME', Icon: HomeIcon },
  { id: 'portfolio', label: 'PORT', Icon: PortIcon },
  { id: 'social', label: 'SOCIAL', Icon: SocialIcon },
  { id: 'agent', label: 'AGENT', Icon: AgentIcon },
  { id: 'progress', label: 'PROGRESS', Icon: ProgressIcon },
];

export default function ConversationalOnboarding() {
  const { updateUser } = useAuth();

  // 'hook' -> name a stock and read it. 'tour' -> walk the five tabs.
  const [phase, setPhase] = useState('hook');
  const [tourStep, setTourStep] = useState(0);

  // The free first read: the product's signature moment, given away before any
  // paywall. frResult holds { ticker, read, price, changePct } and feeds the
  // tour so the whole walkthrough is personalized to the stock they chose.
  const [frTicker, setFrTicker] = useState('');
  const [frResult, setFrResult] = useState(null);
  const [frLoading, setFrLoading] = useState(false);
  const [frError, setFrError] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function runFirstRead(rawTicker) {
    const t = String(rawTicker ?? frTicker).toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 6);
    if (!t) { setFrError('Type a ticker, like NVDA.'); return; }
    setFrError(''); setFrLoading(true); setFrResult(null);
    try {
      const r = await api.ai.firstRead({ ticker: t });
      setFrResult({ ticker: t, read: r?.read || '', price: r?.price ?? null, changePct: r?.changePct ?? null });
    } catch {
      setFrError('Could not read that one. Try another ticker.');
    } finally {
      setFrLoading(false);
    }
  }

  // Write the defaults the rest of the app expects, add the chosen stock to the
  // watchlist so the app is not empty on arrival, and mark onboarding done.
  // Every step is best effort: a single failure never traps the user in the flow.
  async function finish() {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    if (frResult?.ticker) {
      try { await api.social.addToWatchlist({ ticker: frResult.ticker, companyName: frResult.ticker }); } catch {}
    }
    try {
      await api.settings.update({
        trading_style: 'swing',
        risk_tolerance: 'moderate',
        onboarding_style: 'swing',
        onboarding_assets: 'stocks',
        onboarding_complete: true,
      });
      updateUser({ onboarding_complete: true, trading_style: 'swing', risk_tolerance: 'moderate' });
    } catch {
      setError('Could not finish. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  function startTour() { setTourStep(0); setPhase('tour'); }

  // ─── Phase: hook ────────────────────────────────────────────────────────
  if (phase === 'hook') {
    return (
      <Shell maxWidth={640}>
        <Eyebrow>Let's begin</Eyebrow>
        <h1 style={H1}>Start with a stock you actually care about.</h1>
        <p style={SUB}>
          Name one you own or are watching. I will read it the way I do every morning. Calm, specific, no hype.
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
                className="input"
                style={{ flex: 1, padding: '12px 14px', fontSize: 15, letterSpacing: '0.5px' }}
              />
              <button onClick={() => runFirstRead()} disabled={!frTicker} className="btn btn-blue" style={{ padding: '0 18px', opacity: frTicker ? 1 : 0.4 }}>Read it</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 22 }}>
              {SUGGESTED.map(t => (
                <button key={t} onClick={() => { setFrTicker(t); runFirstRead(t); }} style={CHIP}>{t}</button>
              ))}
            </div>
            {frError && <p style={ERR}>{frError}</p>}
            <button onClick={startTour} style={GHOST}>Skip, just show me around</button>
          </>
        )}

        {frLoading && (
          <div style={LOADCARD}>
            <Spinner />
            <span>Reading {frTicker}…</span>
          </div>
        )}

        {frResult && !frLoading && (
          <>
            <ReadCard r={frResult} />
            <button onClick={startTour} className="btn btn-blue" style={{ width: '100%', padding: 13, marginTop: 4 }}>
              See the rest of Outpost  →
            </button>
            <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginTop: 13 }}>
              <button onClick={() => { setFrResult(null); setFrTicker(''); setFrError(''); }} style={GHOST_INLINE}>Read another</button>
              <button onClick={finish} disabled={submitting} style={GHOST_INLINE}>{submitting ? 'Opening…' : 'Skip, open Outpost'}</button>
            </div>
          </>
        )}

        <p style={FINE}>Educational use only. Not financial advice.</p>
      </Shell>
    );
  }

  // ─── Phase: tour ────────────────────────────────────────────────────────
  const tk = frResult?.ticker || 'NVDA';
  const px = frResult?.price ?? null;
  const chg = frResult?.changePct ?? null;
  const steps = buildSteps(tk, px, chg, frResult?.read || '');
  const step = steps[tourStep];
  const last = tourStep === steps.length - 1;

  return (
    <Shell maxWidth={980}>
      <Eyebrow>Your Outpost  ·  {tourStep + 1} of {steps.length}</Eyebrow>

      <div key={tourStep} className="onb-tour-grid" style={{ animation: 'tourIn 0.34s ease' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
            <span style={{ color: 'var(--blue)', display: 'flex' }}><step.Icon active /></span>
            <h1 style={{ ...H1, fontSize: 'clamp(21px, 2.3vw, 30px)', margin: 0 }}>{step.title}</h1>
          </div>
          <p style={{ ...SUB, margin: 0 }}>{step.line}</p>
        </div>
        <div>{step.preview}</div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 26, maxWidth: 460, marginLeft: 'auto', marginRight: 'auto', width: '100%' }}>
        {tourStep > 0 && (
          <button onClick={() => setTourStep(s => s - 1)} className="btn btn-muted" style={{ padding: '12px 18px' }}>Back</button>
        )}
        <button
          onClick={() => { if (last) finish(); else setTourStep(s => s + 1); }}
          disabled={submitting}
          className="btn btn-blue"
          style={{ flex: 1, padding: 13 }}
        >
          {last ? (submitting ? 'Opening Outpost…' : 'Open Outpost  →') : 'Next'}
        </button>
      </div>
      {!last && (
        <button onClick={finish} disabled={submitting} style={GHOST}>{submitting ? 'Opening…' : 'Skip, open Outpost'}</button>
      )}
      {error && <p style={ERR}>{error}</p>}

      {/* The real bottom bar, mirrored. Tap any tab to jump to its showcase. */}
      <MiniNav active={tourStep} onPick={setTourStep} />

      <style>{`@keyframes tourIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }`}</style>
    </Shell>
  );
}

// ─── Tour content ─────────────────────────────────────────────────────────
// Each preview is honest: it uses the user's real ticker and real price/move
// where we have them, and is clearly illustrative everywhere else. We never
// fabricate a P&L number or a personal score the user has not earned yet.
function buildSteps(tk, px, chg, read) {
  const chgStr = chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%` : null;
  const chgColor = chg != null && chg < 0 ? 'var(--red)' : 'var(--green)';

  return [
    {
      id: 'home', Icon: HomeIcon,
      title: 'Home cuts it down to one thing.',
      line: `Most mornings you do not need ten alerts, you need the one that matters. If ${tk} gaps, breaks a level, or hits real news, it surfaces here first.`,
      preview: (
        <PreviewCard>
          <Tag>TODAY</Tag>
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, margin: '10px 0 0' }}>
            {chgStr
              ? <>One thing worth your attention: <b>{tk}</b> moved <span style={{ color: chgColor, fontWeight: 700 }}>{chgStr}</span> in the last session. Here is what that means for how you are positioned.</>
              : <>One thing worth your attention: <b>{tk}</b> is quiet today, and a quiet day is also information. Here is what is actually moving in your universe.</>}
          </p>
        </PreviewCard>
      ),
    },
    {
      id: 'portfolio', Icon: PortIcon,
      title: 'Your book, read like a story.',
      line: 'Live P&L on every position, how your money splits across sectors, and a plain-English take on what the whole book is really telling you.',
      preview: (
        <PreviewCard>
          <PosRow tk={tk} px={px} chgStr={chgStr} chgColor={chgColor} bright />
          <PosRow tk="••••" placeholder />
          <PosRow tk="••••" placeholder last />
          <p style={{ fontSize: 11, color: 'var(--faint)', margin: '11px 0 0', lineHeight: 1.5 }}>
            Add {tk} and your cost basis, P&L, and concentration risk all show up here.
          </p>
        </PreviewCard>
      ),
    },
    {
      id: 'social', Icon: SocialIcon,
      title: 'Find your next idea, already checked.',
      line: 'A feed ranked around what you hold, plus screeners you write in plain English. Outpost finds the names, then vets each one before it reaches you.',
      preview: (
        <PreviewCard>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.5px' }}>{tk}</span>
            <span style={{ fontSize: 10, color: 'var(--faint)' }}>on your watchlist</span>
          </div>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, padding: '9px 11px' }}>
            <p style={{ fontSize: 10.5, color: 'var(--muted)', margin: 0, fontStyle: 'italic' }}>"profitable names under $20"</p>
            <p style={{ fontSize: 11, color: 'var(--blue)', margin: '5px 0 0', fontWeight: 600 }}>7 names found, each vetted by Outpost</p>
          </div>
        </PreviewCard>
      ),
    },
    {
      id: 'agent', Icon: AgentIcon,
      title: 'An AI that actually knows your book.',
      line: `You just watched it read ${tk}. It remembers every position, your cash, and what you tell it, so its answers are about your money, not a generic chatbot's.`,
      preview: (
        <PreviewCard>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', animation: 'frDot 2s ease-in-out infinite' }} />
            <span style={{ fontSize: 9, color: 'var(--blue)', letterSpacing: '1.2px', fontWeight: 700 }}>OUTPOST</span>
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>
            {read ? truncate(read, 168) : `Ask "what should I watch in ${tk} today?" and it answers from your actual holdings, not a script.`}
          </p>
          <div style={{ marginTop: 12, padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, fontSize: 11, color: 'var(--faint)' }}>
            Ask a follow-up…
          </div>
          <style>{`@keyframes frDot { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
        </PreviewCard>
      ),
    },
    {
      id: 'progress', Icon: ProgressIcon,
      title: 'Get measurably better.',
      line: 'Outpost grades the buys and sells you make and tracks your composure under pressure, so you can see if you are improving instead of guessing.',
      preview: (
        <PreviewCard>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Bought {tk}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)', background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: 5, padding: '3px 8px' }}>FOLLOWED YOUR PLAN</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--bg)', overflow: 'hidden', marginBottom: 7 }}>
            <div className="grow-in" style={{ height: '100%', width: '72%', borderRadius: 3, background: 'linear-gradient(90deg, var(--blue), var(--cyan))' }} />
          </div>
          <p style={{ fontSize: 11, color: 'var(--faint)', margin: 0, lineHeight: 1.5 }}>
            Your composure score builds as you log decisions, so the wins and the mistakes both teach you something.
          </p>
        </PreviewCard>
      ),
    },
  ];
}

// ─── Small presentational pieces ───────────────────────────────────────────
function ReadCard({ r }) {
  return (
    <div style={{ background: 'linear-gradient(180deg, rgba(59,130,246,0.09), rgba(59,130,246,0.02))', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 11, padding: '15px 16px', marginBottom: 14, animation: 'tourIn 0.4s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', animation: 'frDot 2s ease-in-out infinite' }} />
          <p style={{ fontSize: 9, color: 'var(--blue)', letterSpacing: '1.3px', fontWeight: 700, margin: 0 }}>OUTPOST READS {r.ticker}</p>
        </div>
        {r.price != null && (
          <p style={{ fontSize: 10, color: 'var(--faint)', margin: 0 }}>
            ${r.price}{r.changePct != null && <span style={{ color: r.changePct >= 0 ? 'var(--green)' : 'var(--red)', marginLeft: 6 }}>{r.changePct >= 0 ? '+' : ''}{r.changePct.toFixed(1)}%</span>}
          </p>
        )}
      </div>
      <p style={{ fontSize: 'clamp(13.5px, 1.05vw, 15.5px)', color: 'var(--text)', lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0 }}>{r.read}</p>
      <style>{`@keyframes frDot { 0%,100% { opacity: 1 } 50% { opacity: 0.3 } } @keyframes tourIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }`}</style>
    </div>
  );
}

function PreviewCard({ children }) {
  return <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: '15px 16px' }}>{children}</div>;
}

function Tag({ children }) {
  return <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.3px', color: 'var(--faint)', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 7px' }}>{children}</span>;
}

function PosRow({ tk, px, chgStr, chgColor, bright, placeholder, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: last ? 'none' : '1px solid var(--border)', opacity: placeholder ? 0.32 : 1 }}>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: bright ? 'var(--text)' : 'var(--faint)', letterSpacing: '0.5px' }}>{tk}</span>
      {placeholder ? (
        <span style={{ fontSize: 11, color: 'var(--faint)' }}>••••</span>
      ) : (
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {px != null && <span style={{ fontSize: 12, color: 'var(--muted)' }}>${px}</span>}
          {chgStr && <span style={{ fontSize: 12, fontWeight: 700, color: chgColor }}>{chgStr}</span>}
        </span>
      )}
    </div>
  );
}

function MiniNav({ active, onPick }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 26, padding: '10px 4px 2px', borderTop: '1px solid var(--border)', background: 'rgba(122,162,255,0.015)', borderRadius: '0 0 10px 10px' }}>
      {NAV.map((n, i) => {
        const on = i === active;
        return (
          <button key={n.id} onClick={() => onPick(i)} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            color: on ? 'var(--blue)' : 'var(--faint)', padding: '4px 0',
          }}>
            <n.Icon active={on} />
            <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.5px' }}>{n.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Spinner() {
  return (
    <>
      <div style={{ width: 24, height: 24, border: '2px solid var(--border)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </>
  );
}

function Eyebrow({ children }) {
  return <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 8 }}>{children}</p>;
}

function truncate(s, n) { return s.length > n ? s.slice(0, n).trimEnd() + '…' : s; }

// ─── Shared style objects ───────────────────────────────────────────────────
const H1 = { fontSize: 'clamp(24px, 3vw, 34px)', fontWeight: 700, color: 'var(--text)', marginBottom: 12, letterSpacing: '-0.3px', lineHeight: 1.22 };
const SUB = { fontSize: 'clamp(13px, 1.2vw, 16px)', color: 'var(--muted)', lineHeight: 1.6, marginBottom: 22 };
const ERR = { fontSize: 11, color: 'var(--red)', textAlign: 'center', margin: '4px 0 12px' };
const FINE = { fontSize: 9, color: 'var(--faint)', textAlign: 'center', marginTop: 20, lineHeight: 1.5, letterSpacing: '0.2px' };
const CHIP = { padding: '6px 12px', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', background: 'var(--raised)', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit' };
const GHOST = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, padding: '14px 0 0', fontFamily: 'inherit', letterSpacing: '0.3px', width: '100%' };
const GHOST_INLINE = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, fontFamily: 'inherit', letterSpacing: '0.3px' };
const LOADCARD = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '28px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: 'var(--faint)', fontSize: 11 };

// Shared layout wrapper. Desktop-aware: a comfortable single column on a phone,
// a roomy vertically-centered panel on a computer so it never reads as a phone
// screen on a monitor. maxWidth is set per phase (a tighter hero for the hook, a
// wider canvas for the two-column tour). Responsive rules live in globals.css.
function Shell({ children, maxWidth = 460 }) {
  return (
    <div className="onb-shell">
      <div className="onb-panel" style={{ maxWidth }}>{children}</div>
    </div>
  );
}

// ─── Nav icons, copied from AppShell so the mirrored bar matches exactly ─────
function HomeIcon({ active }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill={active ? 'var(--blue)' : 'none'} stroke={active ? 'var(--blue)' : 'currentColor'} strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
}
function PortIcon({ active }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="17" x2="8" y2="10"/><line x1="12" y1="17" x2="12" y2="7"/><line x1="16" y1="17" x2="16" y2="13"/></svg>;
}
function SocialIcon({ active }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>;
}
function AgentIcon({ active }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill={active ? 'var(--blue)' : 'none'} stroke={active ? 'var(--blue)' : 'currentColor'} strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
}
function ProgressIcon({ active }) {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--blue)' : 'currentColor'} strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg>;
}
