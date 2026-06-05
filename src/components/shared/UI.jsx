import { useState, useEffect, useRef } from 'react';
import { getTickerColor, getInitials } from '../../utils/market.js';

/**
 * CountUp: animate a number from its last value to the new one, easing out, so
 * hero figures tick up like a terminal readout instead of snapping. First mount
 * counts from zero (the "data loading in" moment); later updates animate from the
 * previous value. `format(n)` renders each frame, so callers keep their own $ and
 * percent formatting. Cheap: one rAF loop that stops when it lands.
 */
export function CountUp({ value, format, duration = 650, style, className }) {
  const target = Number(value) || 0;
  const [n, setN] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef();
  useEffect(() => {
    const from = fromRef.current;
    if (from === target) { setN(target); return; }
    let start = null;
    const step = (ts) => {
      if (start == null) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      setN(from + (target - from) * e);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else { fromRef.current = target; setN(target); }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return <span style={style} className={className}>{format ? format(n) : Math.round(n)}</span>;
}

export function Spinner({ size = 20 }) {
  return <div className="spinner" style={{ width: size, height: size }} />;
}

export function TickerIcon({ ticker, size = 36 }) {
  const [bg, color] = getTickerColor(ticker);
  const initials = getInitials(ticker);
  return (
    <div className="ticker-icon" style={{ width: size, height: size, background: bg, color, fontSize: size < 30 ? 8 : 9 }}>
      {initials}
    </div>
  );
}

export function Badge({ type = 'gray', children }) {
  return <span className={`badge badge-${type}`}>{children}</span>;
}

export function EmptyState({ title, subtitle, action, tips }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 20px', gap: 10, textAlign: 'center' }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '1.2px' }}>{title}</p>
      {subtitle && <p style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 260, lineHeight: 1.6 }}>{subtitle}</p>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
      {tips && (
        <div style={{ width: '100%', marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tips.map((tip, i) => (
            <div key={i} style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 13px', textAlign: 'left' }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.8px' }}>{tip.title}</p>
              <p style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.6 }}>{tip.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Modal({ children, onClose, title }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FormField({ label, children }) {
  return (
    <div className="form-field">
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}

export function Toast({ message, type = 'info', show }) {
  if (!show) return null;
  return <div className={`toast show ${type}`}>{message}</div>;
}

export function DisclaimerBadge() {
  return (
    <p style={{ fontSize: 10, color: 'var(--faint)', paddingTop: 8, lineHeight: 1.5 }}>
      Not financial advice. Educational purposes only. Trading involves risk of loss.
    </p>
  );
}

export function SectionLabel({ children }) {
  return <p className="sec-lbl">{children}</p>;
}

export function FeedbackButtons({ feature, response }) {
  const [rated, setRated] = useState(null);
  async function rate(rating) {
    if (rated) return;
    setRated(rating);
    try {
      const { api } = await import('../../lib/api.js');
      await api.ai.feedback({ feature, rating, responsePreview: response?.slice(0, 200) });
    } catch {
      setRated(null); // Reset on failure so user can retry
    }
  }
  return (
    <div style={{ display: 'flex', gap: 8, paddingTop: 6 }}>
      <button onClick={() => rate('up')} disabled={!!rated} style={{ background: 'none', border: 'none', cursor: rated ? 'default' : 'pointer', fontSize: 12, color: rated === 'up' ? 'var(--green)' : 'var(--faint)', padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit', transition: 'color 0.15s', opacity: rated && rated !== 'up' ? 0.3 : 1 }}>
        {rated === 'up' ? '▲ Thanks!' : '▲ Helpful'}
      </button>
      <button onClick={() => rate('down')} disabled={!!rated} style={{ background: 'none', border: 'none', cursor: rated ? 'default' : 'pointer', fontSize: 12, color: rated === 'down' ? 'var(--red)' : 'var(--faint)', padding: '2px 6px', borderRadius: 4, fontFamily: 'inherit', transition: 'color 0.15s', opacity: rated && rated !== 'down' ? 0.3 : 1 }}>
        {rated === 'down' ? '▼ Noted' : '▼ Not helpful'}
      </button>
    </div>
  );
}

export function SkeletonLine({ width = '100%', height = 12 }) {
  return <div className="skeleton" style={{ width, height, marginBottom: 6 }} />;
}

export function SkeletonCard() {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 6, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <SkeletonLine width="40%" height={13} />
          <SkeletonLine width="60%" height={10} />
        </div>
      </div>
      <SkeletonLine width="90%" />
      <SkeletonLine width="70%" />
    </div>
  );
}
