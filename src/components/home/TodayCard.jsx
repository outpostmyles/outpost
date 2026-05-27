import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { cachedFetch, clearCachePrefix } from '../../lib/cache.js';
import { DisclaimerBadge } from '../shared/UI.jsx';

/**
 * TODAY — Outpost's top 5 ranked picks. Sits at the top of Home tab and
 * answers "what should I look at right now?" in 30 seconds.
 *
 * Pulls from the /api/ai/today endpoint which aggregates cached signals
 * across the user's portfolio + watchlist + market data. Zero Claude calls
 * on the server side — pure ranking + template strings.
 *
 * Each row deep-links to its origin via onTabSwitch when tapped.
 */

const STYLE_BY_TYPE = {
  alert:    { label: 'ALERT',    color: 'var(--amber)', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)' },
  watch:    { label: 'WATCH',    color: '#a78bfa',       bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.3)' },
  mover:    { label: 'MOVER',    color: '#60a5fa',       bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.3)' },
  heat:     { label: 'HEAT',     color: 'var(--amber)', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)' },
  bargain:  { label: 'BARGAIN',  color: 'var(--green)', bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.3)' },
  catalyst: { label: 'CATALYST', color: '#f97316',      bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.3)' },
  quiet:    { label: 'QUIET',    color: 'var(--faint)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)' },
};

const ACCENT_BY_TYPE = {
  alert:    'var(--amber)',
  watch:    '#8b5cf6',
  mover:    'var(--blue)',
  heat:     'var(--amber)',
  bargain:  'var(--green)',
  catalyst: '#f97316',
  quiet:    'rgba(255,255,255,0.15)',
};

export default function TodayCard({ onTabSwitch, onItemTap }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (force = false) => {
    if (force) clearCachePrefix('home_today');
    try {
      const d = await cachedFetch('home_today', () => api.ai.today(), 30 * 60000);
      setData(d);
    } catch {}
  }, []);

  useEffect(() => {
    fetchData(false).finally(() => setLoading(false));
  }, [fetchData]);

  async function refresh() {
    setRefreshing(true);
    await fetchData(true);
    setRefreshing(false);
  }

  // Loading skeleton — keep it minimal so the card doesn't fight the rest of Home
  if (loading) {
    return (
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '1.2px', marginBottom: 4 }}>TODAY</p>
        <p style={{ fontSize: 10, color: 'var(--faint)' }}>Loading picks...</p>
      </div>
    );
  }

  const items = data?.items ?? [];

  // No picks today — graceful empty state. Could happen if user has zero
  // positions/watchlist AND there are no big movers in the market. Rare.
  if (items.length === 0) {
    return (
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '1.2px', marginBottom: 4 }}>TODAY</p>
        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          Quiet across your portfolio and watchlist. Nothing urgent — your positions are calm.
        </p>
      </div>
    );
  }

  const generatedAt = data?.generatedAt ? new Date(data.generatedAt) : null;
  const timeStr = generatedAt
    ? generatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)', animation: 'todayPulse 2s ease-in-out infinite' }} />
            <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '1.2px', margin: 0 }}>TODAY</p>
          </div>
          <p style={{ fontSize: 9, color: 'var(--faint)', margin: 0 }}>{timeStr}</p>
        </div>
        <p style={{ fontSize: 10, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
          {items.length === 1 ? 'One thing' : `${items.length} things`} worth your attention.
        </p>
        <style>{`@keyframes todayPulse { 0%,100%{opacity:1} 50%{opacity:0.45} }`}</style>
      </div>

      {/* Rows */}
      {items.map((item, i) => {
        const style = STYLE_BY_TYPE[item.type] || STYLE_BY_TYPE.mover;
        const accent = ACCENT_BY_TYPE[item.type] || 'var(--blue)';
        const isQuiet = item.type === 'quiet';
        return (
          <div
            key={`${item.type}-${item.ticker || 'noticker'}-${i}`}
            onClick={() => !isQuiet && onItemTap?.(item)}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: '11px 16px',
              borderTop: '1px solid var(--border)',
              gap: 10,
              cursor: isQuiet ? 'default' : 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!isQuiet) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
            onMouseLeave={e => { if (!isQuiet) e.currentTarget.style.background = 'transparent'; }}
          >
            <div style={{ flexShrink: 0, width: 3, alignSelf: 'stretch', borderRadius: 2, background: accent }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                  background: style.bg, color: style.color,
                  border: `0.5px solid ${style.border}`, letterSpacing: '0.5px',
                }}>
                  {style.label}
                </span>
                {item.ticker && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.3px' }}>{item.ticker}</span>}
                {item.title && <span style={{ fontSize: 10, color: 'var(--faint)' }}>{item.ticker ? '— ' : ''}{item.title}</span>}
              </div>
              <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45, margin: 0 }}>{item.detail}</p>
            </div>
            {!isQuiet && <span style={{ color: 'var(--faint)', fontSize: 14, paddingTop: 1 }}>›</span>}
          </div>
        );
      })}

      {/* Disclaimer — required on every AI-recommendation surface */}
      <DisclaimerBadge />

      {/* Footer */}
      <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', margin: 0, letterSpacing: '0.4px' }}>Ranked by Outpost · refreshes hourly</p>
        <button
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh today's picks"
          style={{
            background: 'none', border: 'none', cursor: refreshing ? 'default' : 'pointer',
            color: 'var(--faint)', fontSize: 11, padding: '2px 6px', fontFamily: 'inherit',
            opacity: refreshing ? 0.5 : 1,
          }}
        >
          ↻
        </button>
      </div>
    </div>
  );
}
