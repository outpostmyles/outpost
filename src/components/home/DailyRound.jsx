import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { cachedFetch } from '../../lib/cache.js';
import { buildRound } from '../../lib/dailyRound.js';

// The Daily Round: a short, guided, completable pass that does the all-day
// watching for the user and ends on "you're covered". See docs/daily-round.md.
// This file is the Home entry card plus the full-screen step-through. The step
// content is a reframe of data the app already produces (TODAY, value, pulse,
// attribution); the decision logic lives in src/lib/dailyRound.js.

const DONE_KEY = 'outpost_round_done';
function todayStr() { return new Date().toISOString().slice(0, 10); }

function money(n) {
  if (n == null || isNaN(n)) return '$0';
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: abs >= 1000 ? 0 : 2 })}`;
}

export default function DailyRound({ onTabSwitch, showToast }) {
  const [open, setOpen] = useState(false);
  const [doneToday, setDoneToday] = useState(false);
  const [alertCount, setAlertCount] = useState(null);

  useEffect(() => {
    try { setDoneToday(localStorage.getItem(DONE_KEY) === todayStr()); } catch {}
    // Shared-cache peek at TODAY so the entry line can adapt. Same cache key as
    // TodayCard, so this adds no network call.
    cachedFetch('home_today', () => api.ai.today(), 30 * 60000)
      .then(d => setAlertCount((d?.items || []).filter(it => it.type === 'alert').length))
      .catch(() => {});
  }, []);

  function complete() {
    try { localStorage.setItem(DONE_KEY, todayStr()); } catch {}
    setDoneToday(true);
    setOpen(false);
  }

  const subline = doneToday
    ? "Done for today. You're covered."
    : alertCount > 0
      ? `${alertCount} thing${alertCount === 1 ? '' : 's'} want your eyes today.`
      : 'A quick pass on your book. Takes a minute.';

  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--text)', margin: 0 }}>YOUR DAILY ROUND</p>
          <p style={{ fontSize: 11, color: doneToday ? 'var(--green)' : 'var(--muted)', margin: '4px 0 0', lineHeight: 1.5 }}>{subline}</p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className={`btn ${doneToday ? 'btn-muted' : 'btn-blue'}`}
          style={{ fontSize: 11, padding: '8px 16px', whiteSpace: 'nowrap' }}
        >
          {doneToday ? 'Run again' : 'Start'}
        </button>
      </div>
      {open && <RoundFlow onClose={() => setOpen(false)} onComplete={complete} showToast={showToast} />}
    </div>
  );
}

function RoundFlow({ onClose, onComplete, showToast }) {
  const [loading, setLoading] = useState(true);
  const [round, setRound] = useState(null);
  const [standing, setStanding] = useState({ todayChange: 0, totalPnl: 0, pulse: '' });
  const [i, setI] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [todayR, valueR, pulseR, attrR] = await Promise.allSettled([
        api.ai.today(),
        api.portfolio.value(),
        api.portfolio.pulse(),
        api.portfolio.attribution(),
      ]);
      if (cancelled) return;
      const today = todayR.status === 'fulfilled' && todayR.value ? todayR.value : { items: [] };
      const value = valueR.status === 'fulfilled' && valueR.value ? valueR.value : { positions: [] };
      const pulse = pulseR.status === 'fulfilled' ? (pulseR.value?.pulse || '') : '';
      const attribution = attrR.status === 'fulfilled' ? attrR.value : null;
      setStanding({ todayChange: value.todayChange ?? 0, totalPnl: value.totalPnl ?? 0, pulse });
      setRound(buildRound({ todayItems: today.items || [], positions: value.positions || [], attribution }));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const steps = ['safety', 'standing', 'opportunity'];
  if (round && round.sharpen.kind !== 'none') steps.push('sharpen');
  steps.push('close');
  const current = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;

  function next() { if (last) onComplete(); else setI(i + 1); }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: '100%', maxWidth: 460, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, marginTop: 24, marginBottom: 24, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text)', margin: 0 }}>YOUR ROUND</p>
            <Dots n={steps.length} active={i} />
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--faint)', fontSize: 18, cursor: 'pointer', padding: 0, fontFamily: 'inherit', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '22px 18px', minHeight: 220 }}>
          {loading || !round ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '44px 0' }}>
              <div style={{ width: 20, height: 20, border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid var(--blue)', borderRadius: '50%', animation: 'roundspin 0.8s linear infinite' }} />
              <p style={{ fontSize: 12, color: 'var(--muted)' }}>Pulling your round together...</p>
              <style>{`@keyframes roundspin { to { transform: rotate(360deg) } }`}</style>
            </div>
          ) : (
            <>
              {current === 'safety' && <SafetyStep safety={round.safety} />}
              {current === 'standing' && <StandingStep standing={standing} />}
              {current === 'opportunity' && <OpportunityStep items={round.opportunity} />}
              {current === 'sharpen' && <SharpenStep sharpen={round.sharpen} showToast={showToast} />}
              {current === 'close' && <CloseStep round={round} />}
              <button onClick={next} className="btn btn-blue btn-full" style={{ marginTop: 22 }}>
                {last ? "Done. I'm covered." : 'Next'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Dots({ n, active }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {Array.from({ length: n }).map((_, idx) => (
        <div key={idx} style={{ width: 14, height: 3, borderRadius: 1, background: idx <= active ? 'var(--blue)' : 'var(--raised)' }} />
      ))}
    </div>
  );
}

function StepLabel({ label }) {
  return (
    <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.2px', textTransform: 'uppercase', margin: '0 0 12px' }}>{label}</p>
  );
}

function ItemRow({ it, accent }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `2px solid ${accent}`, borderRadius: 6, padding: '10px 12px' }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
        {it.ticker || ''}{it.title ? `: ${it.title}` : ''}
      </p>
      {it.detail && <p style={{ fontSize: 11, color: 'var(--muted)', margin: '3px 0 0', lineHeight: 1.5 }}>{it.detail}</p>}
    </div>
  );
}

function SafetyStep({ safety }) {
  return (
    <>
      <StepLabel label="Are you safe?" />
      {safety.allClear ? (
        <div style={{ textAlign: 'center', padding: '14px 0' }}>
          <p style={{ fontSize: 30, margin: '0 0 8px' }}>✓</p>
          <p style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, margin: '0 0 4px' }}>All clear.</p>
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            Nothing on your book needs a decision today.{safety.checked > 0 ? ` I checked all ${safety.checked}.` : ''}
          </p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
            {safety.items.length === 1 ? 'One holding' : `${safety.items.length} holdings`} need a look:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {safety.items.map((it, idx) => <ItemRow key={idx} it={it} accent="var(--amber)" />)}
          </div>
        </>
      )}
    </>
  );
}

function StandingStep({ standing }) {
  const { todayChange, totalPnl, pulse } = standing;
  const color = todayChange > 0 ? 'var(--green)' : todayChange < 0 ? 'var(--red)' : 'var(--text)';
  return (
    <>
      <StepLabel label="Where you stand" />
      <p style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1, letterSpacing: '-0.5px', margin: '0 0 4px' }}>{money(todayChange)}</p>
      <p style={{ fontSize: 10, color: 'var(--muted)', margin: '0 0 14px' }}>today, {money(totalPnl)} unrealized overall</p>
      {pulse && (
        <div style={{ borderLeft: '2px solid var(--blue)', paddingLeft: 10 }}>
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, fontStyle: 'italic', margin: 0 }}>{pulse}</p>
        </div>
      )}
    </>
  );
}

function OpportunityStep({ items }) {
  return (
    <>
      <StepLabel label="Anything you're missing?" />
      {(!items || items.length === 0) ? (
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, padding: '8px 0', margin: 0 }}>
          Nothing new worth chasing today. Not forcing a trade is a position too.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
            {items.length === 1 ? 'One idea' : `${items.length} ideas`} worth a look, no rush:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((it, idx) => <ItemRow key={idx} it={it} accent="var(--green)" />)}
          </div>
        </>
      )}
    </>
  );
}

function SharpenStep({ sharpen, showToast }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!text.trim() || !sharpen.positionId) return;
    setSaving(true);
    try {
      await api.portfolio.editPosition(sharpen.positionId, { entryThesis: text.trim() });
      setSaved(true);
      showToast?.(`Thesis saved for ${sharpen.ticker}`, 'success');
    } catch (e) {
      showToast?.(e?.error || 'Could not save just now', 'error');
    }
    setSaving(false);
  }

  return (
    <>
      <StepLabel label="Get a little sharper" />
      <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, margin: '0 0 12px' }}>{sharpen.prompt}</p>
      {sharpen.kind === 'thesis' && sharpen.positionId && !saved && (
        <>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={`Why you're holding ${sharpen.ticker}...`}
            rows={3}
            className="input"
            style={{ width: '100%', resize: 'vertical', marginBottom: 8, fontFamily: 'inherit' }}
          />
          <button onClick={save} disabled={saving || !text.trim()} className="btn btn-muted btn-full" style={{ fontSize: 11 }}>
            {saving ? 'Saving...' : 'Save it'}
          </button>
        </>
      )}
      {sharpen.kind === 'thesis' && saved && (
        <p style={{ fontSize: 12, color: 'var(--green)', lineHeight: 1.55, margin: 0 }}>
          Saved. That one line sharpens every future read on {sharpen.ticker}.
        </p>
      )}
    </>
  );
}

function CloseStep({ round }) {
  const safe = round.safety.allClear;
  const oppCount = round.opportunity.length;
  return (
    <div style={{ textAlign: 'center', padding: '10px 0' }}>
      <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.2px', textTransform: 'uppercase', margin: 0 }}>You're done</p>
      <p style={{ fontSize: 30, margin: '12px 0 0' }}>✓</p>
      <p style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600, lineHeight: 1.6, margin: '8px 0 0' }}>That's your round.</p>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, margin: '8px auto 0', maxWidth: 320 }}>
        {safe ? 'Your holdings are watched, nothing needs a decision.' : 'You looked at what needed your eyes.'}
        {oppCount > 0 ? ` ${oppCount === 1 ? 'One idea' : `${oppCount} ideas`} noted for when you want them.` : ''} You're covered. Go live your day.
      </p>
    </div>
  );
}
