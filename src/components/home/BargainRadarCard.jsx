// Bargain Radar — daily oversold dip scanner for quality large-caps.
// Runs server-side once a day; this card just displays the cached result.
// Each pick shows: ticker, price, % off 52w high, RSI, analyst score, upside to target,
// and a one-sentence Claude "buyable dip" thesis. Bookmark icon saves a pick to journal.
import { useState, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { cachedFetch } from '../../lib/cache.js';
import { fmt } from '../../utils/market.js';
import { DisclaimerBadge } from '../shared/UI.jsx';
import SaveToJournalSheet, { BookmarkButton } from '../journal/SaveToJournalSheet.jsx';

export default function BargainRadarCard({ refreshKey, showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [journalSave, setJournalSave] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    cachedFetch('home_bargain', () => api.ai.bargainRadar(), 30 * 60000)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (loading) {
    return (
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', marginBottom: 8, fontWeight: 700 }}>BARGAIN RADAR</p>
        <div style={{ background: 'var(--raised)', borderRadius: 8, padding: 16, textAlign: 'center' }}>
          <p style={{ fontSize: 10, color: 'var(--faint)' }}>Scanning for oversold quality...</p>
        </div>
      </div>
    );
  }

  if (!data || !data.picks?.length) {
    return (
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>BARGAIN RADAR</p>
        </div>
        <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '13px 14px' }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
            No quality names are deeply oversold right now. The radar only surfaces large-caps that are down 15%+ from their 52-week high, analyst-rated buy or better, and passed Claude's "real problem vs buyable dip" check. Clean slate means the market isn't offering obvious discounts.
          </p>
        </div>
      </div>
    );
  }

  const picks = data.picks;
  const visible = expanded ? picks : picks.slice(0, 3);

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>BARGAIN RADAR</p>
          {data.generatedAt && (
            <span style={{ fontSize: 8, color: 'var(--faint)', fontWeight: 400, letterSpacing: 0 }}>
              {new Date(data.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        <span style={{ fontSize: 8, color: 'var(--faint)', letterSpacing: '0.5px', fontWeight: 600 }}>
          {picks.length} PICKS
        </span>
      </div>

      {/* Research-required note — these are starting points, not buy recommendations */}
      <div style={{
        background: 'rgba(245,158,11,0.06)',
        border: '1px solid rgba(245,158,11,0.25)',
        borderRadius: 6,
        padding: '8px 10px',
        marginBottom: 10,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 1 }}>
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
          <span style={{ color: 'var(--amber)', fontWeight: 700, letterSpacing: '0.3px' }}>RESEARCH REQUIRED.</span>{' '}
          These are screener results — large-caps that passed technical (RSI&lt;40, 15%+ off 52w high), analyst, and qualitative filters. They are <b>starting points for your own due diligence</b>, not buy recommendations. Always verify fundamentals, recent earnings, sector trends, and your own thesis before taking a position.
        </p>
      </div>

      <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {visible.map((pick, i) => (
          <div
            key={pick.ticker}
            style={{
              padding: '11px 13px',
              borderBottom: i < visible.length - 1 ? '1px solid var(--border)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.3px' }}>{pick.ticker}</span>
              <span style={{ fontSize: 10, color: 'var(--faint)' }}>${fmt(pick.price)}</span>
              <span style={{ fontSize: 9, color: 'var(--red)', fontWeight: 700, marginLeft: 'auto' }}>
                {pick.pctOffHigh.toFixed(1)}% off high
              </span>
              <BookmarkButton
                onClick={() => {
                  const analystLine = pick.analystScore != null
                    ? `Analyst score: ${pick.analystScore}/5 (${pick.analystCount} analysts)\n`
                    : '';
                  const ptLine = pick.targetMean != null
                    ? `Price target: $${fmt(pick.targetMean)} (+${pick.upside}% upside)`
                    : `Upside to 52w high: +${pick.upside}%`;
                  setJournalSave({
                    content: `${pick.ticker} — Bargain Radar\n\n${pick.thesis}\n\nPrice: $${fmt(pick.price)}\n${pick.pctOffHigh.toFixed(1)}% off 52w high ($${fmt(pick.fiftyTwoWeekHigh)})\nRSI: ${pick.rsi.toFixed(1)}\n${analystLine}${ptLine}`,
                  });
                }}
              />
            </div>

            <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>{pick.thesis}</p>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
              <MetricPill label="RSI" value={pick.rsi.toFixed(0)} color="var(--amber)" />
              {pick.analystScore != null && (
                <MetricPill label="ANALYST" value={`${pick.analystScore}/5`} color="var(--blue)" />
              )}
              <MetricPill
                label={pick.upsideSource === 'drawdown' ? 'TO HIGH' : 'UPSIDE'}
                value={`+${pick.upside}%`}
                color="var(--green)"
              />
              {pick.marketCapB != null && (
                <MetricPill label="MKT CAP" value={`$${pick.marketCapB}B`} color="var(--faint)" />
              )}
            </div>
          </div>
        ))}
      </div>

      {picks.length > 3 && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            marginTop: 8,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--blue)',
            fontSize: 9,
            fontFamily: 'inherit',
            letterSpacing: '0.8px',
            fontWeight: 700,
            padding: 0,
          }}
        >
          {expanded ? `▲ SHOW LESS` : `▼ SHOW ALL ${picks.length}`}
        </button>
      )}

      <DisclaimerBadge />

      <SaveToJournalSheet
        open={journalSave !== null}
        onClose={() => setJournalSave(null)}
        initialContent={journalSave?.content || ''}
        showToast={showToast}
      />
    </div>
  );
}

function MetricPill({ label, value, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 7, color: 'var(--faint)', letterSpacing: '0.6px', fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 10, color, fontWeight: 700 }}>{value}</span>
    </div>
  );
}
