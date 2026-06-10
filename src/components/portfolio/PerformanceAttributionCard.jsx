// Performance Attribution — pattern-recognition layer over closed_trades + open positions.
// Shows the user WHERE their edge actually is (or isn't): style breakdown, pareto on
// winning trades, open-position concentration. Hides cleanly until enough data.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { fmt, colorFor } from '../../utils/market.js';
import { TickerIcon, Spinner, DisclaimerBadge } from '../shared/UI.jsx';
import SaveToJournalSheet, { BookmarkButton } from '../journal/SaveToJournalSheet.jsx';

const SEVERITY_COLOR = {
  warning: 'var(--red)',
  info: 'var(--amber)',
  positive: 'var(--green)',
};

const SEVERITY_BG = {
  warning: 'rgba(239,68,68,0.06)',
  info: 'rgba(245,158,11,0.06)',
  positive: 'rgba(34,197,94,0.06)',
};

const SEVERITY_BORDER = {
  warning: 'rgba(239,68,68,0.2)',
  info: 'rgba(245,158,11,0.2)',
  positive: 'rgba(34,197,94,0.2)',
};

export default function PerformanceAttributionCard({ showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [journalSave, setJournalSave] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.portfolio.performanceAttribution()
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700, marginBottom: 8 }}>WHERE YOUR EDGE LIVES</p>
        <div style={{ background: 'var(--raised)', borderRadius: 8, padding: 14, textAlign: 'center' }}>
          <Spinner size={14} />
        </div>
      </div>
    );
  }

  if (!data || (data.closedTradeCount === 0 && data.openPositionCount === 0)) return null;

  const { hasEnoughData, message, styles, contribution, openContribution, patterns, closedTradeCount } = data;

  const bookmarkContent = () => {
    const lines = [`Performance Attribution — ${closedTradeCount} closed trades`];
    lines.push('');
    if (patterns?.length) {
      for (const p of patterns) {
        lines.push(`- ${p.headline}`);
        lines.push(`  ${p.detail}`);
      }
      lines.push('');
    }
    if (styles?.length) {
      lines.push('By style:');
      for (const s of styles) {
        // Same rule as the on-screen table: no win-rate claim off fewer than 3 trades.
        const rate = s.count >= 3 ? `${s.winRate}% win` : `${s.winCount}W / ${s.lossCount}L`;
        lines.push(`  ${s.label}: ${s.count} trades, ${rate}, ${s.totalPnl >= 0 ? '+' : ''}$${fmt(s.totalPnl)} net`);
      }
      lines.push('');
    }
    if (contribution.top3?.length) {
      lines.push('Top winning trades:');
      for (const t of contribution.top3) {
        lines.push(`  ${t.ticker}: +$${fmt(t.pnl)} (${t.pnlPercent}%, held ${t.holdDays}d)`);
      }
    }
    return lines.join('\n');
  };

  // Not-enough-data state — gentle nudge
  if (!hasEnoughData) {
    return (
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.5">
            <path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/>
          </svg>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>WHERE YOUR EDGE LIVES</p>
        </div>
        <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 13px' }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55 }}>
            {message || 'Need a few more closed trades before patterns emerge.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.5">
            <path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/>
          </svg>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>WHERE YOUR EDGE LIVES</p>
          <span style={{ fontSize: 8, color: 'var(--faint)' }}>{closedTradeCount} closed trades</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <BookmarkButton onClick={() => setJournalSave({ content: bookmarkContent() })} />
          <button onClick={() => setExpanded(e => !e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, fontFamily: 'inherit' }}>
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Pattern cards (always visible) */}
      {patterns.length === 0 && (
        <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 13px' }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55 }}>
            No strong patterns yet — your trades look reasonably diversified across styles and outcomes.
          </p>
        </div>
      )}

      {patterns.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {patterns.map(p => (
            <div key={p.key} style={{
              background: SEVERITY_BG[p.severity] || 'var(--raised)',
              border: `1px solid ${SEVERITY_BORDER[p.severity] || 'var(--border)'}`,
              borderRadius: 8,
              padding: '10px 13px',
            }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: SEVERITY_COLOR[p.severity] || 'var(--text)', letterSpacing: '0.2px', marginBottom: 4, lineHeight: 1.4 }}>
                {p.headline}
              </p>
              <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55 }}>
                {p.detail}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Expanded detail: styles table + top trades + open contribution */}
      {expanded && (
        <>
          {/* Style breakdown */}
          {styles.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.8px', fontWeight: 700, marginBottom: 6 }}>BY STYLE</p>
              <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {styles.map((s, i) => (
                  <div key={s.key} style={{
                    display: 'flex', alignItems: 'center', padding: '8px 13px', gap: 10,
                    borderBottom: i < styles.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{s.label}</p>
                      <p style={{ fontSize: 9, color: 'var(--faint)' }}>
                        {s.count} {s.count === 1 ? 'trade' : 'trades'} · avg {s.avgHoldDays}d hold
                      </p>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 60 }}>
                      {/* A win rate off one or two trades is not an edge. Under a header
                          that says "where your edge lives," only show the rate once the
                          bucket has 3+ trades (same bar the insights use). Below that,
                          show the honest raw W/L count, no colored "100% win" claim. */}
                      {s.count >= 3 ? (
                        <>
                          <p style={{ fontSize: 11, fontWeight: 700, color: s.winRate >= 50 ? 'var(--green)' : 'var(--red)' }}>
                            {s.winRate.toFixed(0)}% win
                          </p>
                          <p style={{ fontSize: 9, color: 'var(--faint)' }}>{s.winCount}W / {s.lossCount}L</p>
                        </>
                      ) : (
                        <>
                          <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--faint)' }}>{s.winCount}W / {s.lossCount}L</p>
                          <p style={{ fontSize: 9, color: 'var(--faint)' }}>too few to rate</p>
                        </>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 65 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: colorFor(s.totalPnl) }}>
                        {s.totalPnl >= 0 ? '+' : ''}${fmt(s.totalPnl)}
                      </p>
                      <p style={{ fontSize: 9, color: colorFor(s.avgPnlPct) }}>
                        {s.avgPnlPct >= 0 ? '+' : ''}{s.avgPnlPct.toFixed(1)}% avg
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top winning trades */}
          {contribution.top3.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.8px', fontWeight: 700, marginBottom: 6 }}>
                TOP TRADES — {contribution.top3Share.toFixed(0)}% of total winnings
              </p>
              <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {contribution.top3.map((t, i) => (
                  <div key={t.ticker} style={{
                    display: 'flex', alignItems: 'center', padding: '8px 13px', gap: 10,
                    borderBottom: i < contribution.top3.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <TickerIcon ticker={t.ticker} size={24} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{t.ticker}</p>
                      <p style={{ fontSize: 9, color: 'var(--faint)' }}>held {t.holdDays}d</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>+${fmt(t.pnl)}</p>
                      <p style={{ fontSize: 9, color: 'var(--green)' }}>+{t.pnlPercent.toFixed(1)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Open-position contribution — who's pulling the unrealized P&L */}
          {openContribution.count > 0 && (openContribution.topWinners.length > 0 || openContribution.topLosers.length > 0) && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.8px', fontWeight: 700, marginBottom: 6 }}>
                OPEN POSITIONS — UNREALIZED ${fmt(openContribution.totalUnrealized)}
              </p>
              <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {[...openContribution.topWinners, ...openContribution.topLosers].map((p, i, arr) => (
                  <div key={p.ticker} style={{
                    display: 'flex', alignItems: 'center', padding: '8px 13px', gap: 10,
                    borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <TickerIcon ticker={p.ticker} size={24} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{p.ticker}</p>
                      <p style={{ fontSize: 9, color: 'var(--faint)' }}>${fmt(p.currentValue)} value</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: colorFor(p.unrealized) }}>
                        {p.unrealized >= 0 ? '+' : ''}${fmt(p.unrealized)}
                      </p>
                      <p style={{ fontSize: 9, color: colorFor(p.unrealizedPct) }}>
                        {p.unrealizedPct >= 0 ? '+' : ''}{p.unrealizedPct.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
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
