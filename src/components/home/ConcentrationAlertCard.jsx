// Concentration Risk Alert — proactive flag when a position dominates the portfolio.
// Pure math, zero API cost: reads from the already-fetched portfolio.value() payload.
//
// Thresholds:
//   >= 25%  — ALERT (red):    "overexposed", calculate trim to get back to 18%
//   20-25%  — WARNING (amber): "getting concentrated"
//   < 20%   — hidden entirely (no nagging)
//
// Auto-hides if the portfolio has <3 positions (concentration is unavoidable with 1-2 stocks).
import { useState } from 'react';
import { fmt } from '../../utils/market.js';
import { DisclaimerBadge } from '../shared/UI.jsx';
import SaveToJournalSheet, { BookmarkButton } from '../journal/SaveToJournalSheet.jsx';

const WARN_PCT = 20;
const ALERT_PCT = 25;
const TARGET_PCT = 18; // where we suggest trimming TO (safe margin below the warn line)
const MIN_POSITIONS = 3; // below this, "concentration" is unavoidable — don't annoy

export default function ConcentrationAlertCard({ portfolio, onTabSwitch, showToast }) {
  const [journalSave, setJournalSave] = useState(null);

  if (!portfolio?.positions?.length || portfolio.totalValue <= 0) return null;
  if (portfolio.positions.length < MIN_POSITIONS) return null;

  // Compute concentration for every position, sort desc, grab the ones over threshold.
  // Also compute YESTERDAY's concentration by backing out today's % move — this lets
  // us show whether the position is creeping up or easing off even on quiet days.
  const withPct = portfolio.positions
    .map(p => {
      const todayPct = p.todayChangePercent ?? 0;
      // Back out today's move: if current is $105 and today was +5%, yesterday was $100
      const prevValue = todayPct !== 0 ? p.currentValue / (1 + todayPct / 100) : p.currentValue;
      return {
        ...p,
        concentrationPct: (p.currentValue / portfolio.totalValue) * 100,
        _prevValue: prevValue,
      };
    })
    .sort((a, b) => b.concentrationPct - a.concentrationPct);

  // Compute the portfolio total as of yesterday's close so we can compute
  // yesterday's concentration percentages for comparison
  const prevTotalValue = withPct.reduce((sum, p) => sum + p._prevValue, 0);
  const withDelta = withPct.map(p => {
    const prevConcentrationPct = prevTotalValue > 0
      ? (p._prevValue / prevTotalValue) * 100
      : p.concentrationPct;
    return {
      ...p,
      prevConcentrationPct,
      concentrationDelta: p.concentrationPct - prevConcentrationPct,
    };
  });

  const flagged = withDelta.filter(p => p.concentrationPct >= WARN_PCT);
  if (flagged.length === 0) return null;

  // Pick the worst one as the headline
  const worst = flagged[0];
  const isAlert = worst.concentrationPct >= ALERT_PCT;
  const color = isAlert ? 'var(--red)' : 'var(--amber)';
  const bgTint = isAlert ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)';
  const borderTint = isAlert ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)';
  const label = isAlert ? 'CONCENTRATION ALERT' : 'CONCENTRATION WARNING';

  // Trim math — how much to sell to bring worst position back to the target %.
  // Solves for the post-trim ratio: (currentValue - x) / (totalValue - x) = TARGET_PCT/100
  // → x = (currentValue - targetFrac * totalValue) / (1 - targetFrac)
  // The naive (currentValue - targetFrac * totalValue) is wrong because it ignores
  // that the sale also shrinks the denominator; that version overshoots the target %.
  const targetFrac = TARGET_PCT / 100;
  const trimDollars = Math.max(0, (worst.currentValue - targetFrac * portfolio.totalValue) / (1 - targetFrac));
  const trimShares = worst.currentPrice > 0 ? trimDollars / worst.currentPrice : 0;

  // Daily delta — meaningful only if it's at least 0.05% (round-to-0.1 noise floor)
  const delta = worst.concentrationDelta ?? 0;
  const hasMeaningfulDelta = Math.abs(delta) >= 0.05;
  const deltaDirection = delta > 0 ? 'up' : 'down';
  const deltaColor = delta > 0 ? (isAlert ? 'var(--red)' : 'var(--amber)') : 'var(--green)';

  // Friendly one-liner — "friend watching your back" tone, not alarm bells
  const headline = isAlert
    ? `${worst.ticker} is ${worst.concentrationPct.toFixed(1)}% of your portfolio.`
    : `${worst.ticker} is getting concentrated — ${worst.concentrationPct.toFixed(1)}% of your portfolio.`;

  const body = isAlert
    ? `A single position over 25% means one bad earnings print or headline has an outsized impact on your total returns. Diversification isn't about being cautious — it's about making sure no single mistake can blow up your year.`
    : `You're approaching the 25% single-position mark. Worth keeping an eye on — if this rallies further, it'll become the dominant factor in your returns.`;

  // Build bookmark content
  const bookmarkContent = () => {
    const lines = [
      `Concentration ${isAlert ? 'Alert' : 'Warning'}`,
      '',
      `${worst.ticker}: ${worst.concentrationPct.toFixed(1)}% of portfolio`,
      `Position value: $${fmt(worst.currentValue)} of $${fmt(portfolio.totalValue)} total`,
      `Shares: ${worst.shares} @ $${fmt(worst.currentPrice)}`,
    ];
    if (hasMeaningfulDelta) {
      const direction = delta > 0 ? 'up' : 'down';
      lines.push(`Today: ${direction} ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}% (was ${worst.prevConcentrationPct.toFixed(1)}% yesterday)`);
    }
    lines.push('');
    if (isAlert) {
      lines.push(`To bring back to ${TARGET_PCT}%:`);
      lines.push(`  Trim ~$${fmt(trimDollars)} (~${trimShares.toFixed(2)} shares)`);
      lines.push('');
    }
    if (flagged.length > 1) {
      lines.push('Other concentrated positions:');
      flagged.slice(1).forEach(p => {
        lines.push(`  ${p.ticker}: ${p.concentrationPct.toFixed(1)}% ($${fmt(p.currentValue)})`);
      });
      lines.push('');
    }
    lines.push('Note: Concentration risk is a function of position size relative to total portfolio — not a judgment on the stock itself.');
    return lines.join('\n');
  };

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <p style={{ fontSize: 9, color, letterSpacing: '1px', fontWeight: 700 }}>{label}</p>
        </div>
        <BookmarkButton onClick={() => setJournalSave({ content: bookmarkContent() })} />
      </div>

      <div style={{
        background: bgTint,
        border: `1px solid ${borderTint}`,
        borderRadius: 8,
        padding: '13px 14px',
      }}>
        {/* Headline + daily delta pill */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.1px', lineHeight: 1.4, flex: 1 }}>
            {headline}
          </p>
          {hasMeaningfulDelta && (
            <span
              title={`Yesterday's concentration: ${worst.prevConcentrationPct.toFixed(1)}%`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                background: 'var(--raised)',
                border: `1px solid ${borderTint}`,
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 9,
                fontWeight: 700,
                color: deltaColor,
                fontFamily: 'JetBrains Mono',
                letterSpacing: '0.3px',
                flexShrink: 0,
                marginTop: 2,
              }}
            >
              {deltaDirection === 'up' ? '▲' : '▼'}
              {delta >= 0 ? '+' : ''}{delta.toFixed(2)}% today
            </span>
          )}
        </div>

        {/* Concentration bar — visual representation of % */}
        <div style={{ marginBottom: 10 }}>
          <div style={{
            height: 6,
            background: 'var(--border)',
            borderRadius: 3,
            overflow: 'hidden',
            position: 'relative',
          }}>
            {/* WARN line marker at 20% */}
            <div style={{
              position: 'absolute',
              left: `${WARN_PCT}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: 'var(--faint)',
              opacity: 0.5,
              zIndex: 1,
            }} />
            {/* ALERT line marker at 25% */}
            <div style={{
              position: 'absolute',
              left: `${ALERT_PCT}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: 'var(--red)',
              opacity: 0.6,
              zIndex: 1,
            }} />
            {/* Fill */}
            <div style={{
              height: '100%',
              width: `${Math.min(worst.concentrationPct, 100)}%`,
              background: color,
              borderRadius: 3,
              transition: 'width 0.3s ease',
            }} />
            {/* Yesterday marker — small tick showing where it was at close */}
            {hasMeaningfulDelta && (
              <div
                title={`Yesterday: ${worst.prevConcentrationPct.toFixed(1)}%`}
                style={{
                  position: 'absolute',
                  left: `${Math.min(worst.prevConcentrationPct, 100)}%`,
                  top: -2,
                  bottom: -2,
                  width: 2,
                  background: 'var(--text)',
                  opacity: 0.7,
                  zIndex: 2,
                }}
              />
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 8, color: 'var(--faint)', letterSpacing: '0.3px' }}>
            <span>0%</span>
            <span style={{ color: 'var(--amber)' }}>20% warn</span>
            <span style={{ color: 'var(--red)' }}>25% alert</span>
            <span>50%</span>
          </div>
        </div>

        {/* Explanation */}
        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55, marginBottom: isAlert || flagged.length > 1 ? 10 : 0 }}>
          {body}
        </p>

        {/* Trim suggestion — only on ALERT level */}
        {isAlert && trimDollars > 0 && (
          <div style={{
            background: 'var(--raised)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '9px 11px',
            marginBottom: flagged.length > 1 ? 10 : 0,
          }}>
            <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px', fontWeight: 700, marginBottom: 4 }}>
              ONE WAY TO ADDRESS IT
            </p>
            <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
              Trimming <span style={{ color: 'var(--text)', fontWeight: 700 }}>~${fmt(trimDollars)}</span>{' '}
              (<span style={{ color: 'var(--text)', fontWeight: 700 }}>~{trimShares.toFixed(2)} shares</span>){' '}
              of {worst.ticker} would bring it back to {TARGET_PCT}% — a comfortable margin below the alert line.
            </p>
          </div>
        )}

        {/* Other concentrated positions (if multiple over threshold) */}
        {flagged.length > 1 && (
          <div style={{ marginTop: 4 }}>
            <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px', fontWeight: 700, marginBottom: 6 }}>
              ALSO CONCENTRATED
            </p>
            {flagged.slice(1, 4).map((p, i, arr) => (
              <div key={p.ticker} style={{
                display: 'flex',
                alignItems: 'center',
                padding: '5px 0',
                borderBottom: i < arr.length - 1 ? '1px dashed var(--border)' : 'none',
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.3px', minWidth: 50 }}>{p.ticker}</span>
                <span style={{ fontSize: 10, color: 'var(--faint)', marginLeft: 8 }}>${fmt(p.currentValue)}</span>
                <span style={{
                  fontSize: 10,
                  color: p.concentrationPct >= ALERT_PCT ? 'var(--red)' : 'var(--amber)',
                  fontWeight: 700,
                  marginLeft: 'auto',
                  fontFamily: 'JetBrains Mono',
                }}>
                  {p.concentrationPct.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick action — jump to Portfolio tab to review */}
      {onTabSwitch && (
        <button
          onClick={() => onTabSwitch('portfolio')}
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
          REVIEW POSITIONS →
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
