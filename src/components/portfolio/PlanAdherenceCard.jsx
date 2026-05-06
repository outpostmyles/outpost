// Plan Adherence Card — shows how the user's actual exits compare to their stated plans.
// Surfaces 1-3 actionable patterns (took profits early, broke stops, held winners) plus
// a per-trade breakdown on tap. Auto-hides when there's no plan data yet.
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

const CATEGORY_LABEL = {
  early_exit: { text: 'EARLY EXIT', color: 'var(--amber)' },
  held_past_target: { text: 'PAST TARGET', color: 'var(--green)' },
  broke_stop: { text: 'BROKE STOP', color: 'var(--red)' },
  honored_stop: { text: 'STOP HONORED', color: 'var(--muted)' },
  loss_no_stop: { text: 'NO STOP', color: 'var(--faint)' },
  profit_no_target: { text: 'NO TARGET', color: 'var(--faint)' },
  no_plan: { text: 'NO PLAN', color: 'var(--faint)' },
};

export default function PlanAdherenceCard({ showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [journalSave, setJournalSave] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.portfolio.planAdherence()
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700, marginBottom: 8 }}>PLAN ADHERENCE</p>
        <div style={{ background: 'var(--raised)', borderRadius: 8, padding: 14, textAlign: 'center' }}>
          <Spinner size={14} />
        </div>
      </div>
    );
  }

  // Hide entirely if no closed trades at all — nothing useful to show
  if (!data || data.summary?.totalTrades === 0) return null;

  const { summary, byTrade, patterns, hasEnoughData, message } = data;
  const planTrades = byTrade.filter(t => t.hadPlan);

  // Build bookmark content
  const bookmarkContent = () => {
    const lines = [`Plan Adherence — ${summary.tradesWithPlan} of ${summary.totalTrades} trades had a stated plan`];
    lines.push('');
    if (patterns.length > 0) {
      for (const p of patterns) {
        lines.push(`- ${p.headline}`);
        lines.push(`  ${p.detail}`);
      }
    }
    if (planTrades.length > 0) {
      lines.push('');
      lines.push('Per-trade:');
      for (const t of planTrades.slice(0, 10)) {
        lines.push(`  ${t.ticker}: ${t.detail || t.category} (${t.pnl >= 0 ? '+' : ''}$${fmt(t.pnl)})`);
      }
    }
    return lines.join('\n');
  };

  // No-plan-data state — show a gentle nudge but don't be loud
  if (!hasEnoughData) {
    return (
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.5">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>PLAN ADHERENCE</p>
        </div>
        <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 13px' }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55 }}>
            {message || `Need ${3 - summary.tradesWithPlan} more trade${3 - summary.tradesWithPlan === 1 ? '' : 's'} with a stated plan to start surfacing patterns.`}
          </p>
          <p style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.5, marginTop: 6 }}>
            Tip: when you add a position, set a price target and stop loss. The more trades you close with stated plans, the sharper this card gets.
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
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>PLAN ADHERENCE</p>
          <span style={{ fontSize: 8, color: 'var(--faint)', fontWeight: 400 }}>
            {summary.tradesWithPlan} of {summary.totalTrades} trades
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <BookmarkButton onClick={() => setJournalSave({ content: bookmarkContent() })} />
          <button onClick={() => setExpanded(e => !e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, fontFamily: 'inherit' }}>
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Patterns — always visible */}
      {patterns.length === 0 && (
        <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 13px' }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55 }}>
            No strong patterns yet — your exits look reasonably aligned with your stated plans across {summary.tradesWithPlan} trades.
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

      {/* Win-rate split (if both populated) */}
      {summary.honoredWinRate != null && summary.violatedWinRate != null && (
        <div style={{ marginTop: 10, padding: '8px 11px', background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 6, display: 'flex', justifyContent: 'space-around', gap: 8 }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 8, color: 'var(--faint)', letterSpacing: '0.6px', fontWeight: 700 }}>HONORED PLAN</p>
            <p style={{ fontSize: 14, fontWeight: 700, color: summary.honoredWinRate >= 50 ? 'var(--green)' : 'var(--muted)' }}>
              {summary.honoredWinRate.toFixed(0)}% win
            </p>
          </div>
          <div style={{ width: 1, background: 'var(--border)' }} />
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 8, color: 'var(--faint)', letterSpacing: '0.6px', fontWeight: 700 }}>VIOLATED PLAN</p>
            <p style={{ fontSize: 14, fontWeight: 700, color: summary.violatedWinRate >= 50 ? 'var(--green)' : 'var(--red)' }}>
              {summary.violatedWinRate.toFixed(0)}% win
            </p>
          </div>
        </div>
      )}

      {/* Per-trade detail — only when expanded */}
      {expanded && planTrades.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.8px', fontWeight: 700, marginBottom: 6 }}>BY TRADE</p>
          <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {planTrades.slice(0, 12).map((t, i) => {
              const lbl = CATEGORY_LABEL[t.category] || CATEGORY_LABEL.no_plan;
              return (
                <div key={t.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 13px',
                  borderBottom: i < planTrades.slice(0, 12).length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <TickerIcon ticker={t.ticker} size={24} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{t.ticker}</span>
                      <span style={{ fontSize: 8, fontWeight: 700, color: lbl.color, background: 'var(--surface)', padding: '1px 5px', borderRadius: 3, letterSpacing: '0.3px' }}>
                        {lbl.text}
                      </span>
                    </div>
                    <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.detail}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: colorFor(t.pnl) }}>
                      {t.pnl >= 0 ? '+' : ''}${fmt(t.pnl)}
                    </p>
                    <p style={{ fontSize: 9, color: colorFor(t.pnlPercent) }}>
                      {t.pnlPercent >= 0 ? '+' : ''}{fmt(t.pnlPercent)}%
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          {planTrades.length > 12 && (
            <p style={{ fontSize: 9, color: 'var(--faint)', textAlign: 'center', marginTop: 6 }}>
              Showing 12 most recent — full history below in the trade list
            </p>
          )}
        </div>
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
