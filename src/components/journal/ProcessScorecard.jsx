// The Progress lead: one honest grade on HOW you traded, derived from the decision
// ledger, never a form to fill. A strength to keep and one thing to work on. New
// users get an encouraging "coming soon" instead of a scary zero.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { buildProcessScorecard } from '../../lib/processScorecard.js';

const gradeColor = (letter) => (letter === 'A' || letter === 'B') ? 'var(--green)' : letter === 'C' ? 'var(--amber)' : 'var(--red)';
const trendBits = (t) => t === 'improving' ? { text: 'improving', color: 'var(--green)', arrow: '↑' }
  : t === 'slipping' ? { text: 'slipping', color: 'var(--red)', arrow: '↓' }
  : { text: 'steady', color: 'var(--faint)', arrow: '·' };

export default function ProcessScorecard() {
  const [card, setCard] = useState(null);

  useEffect(() => {
    let alive = true;
    api.decisions.mine()
      .then(r => { if (alive) setCard(buildProcessScorecard(r)); })
      .catch(() => { if (alive) setCard(null); });
    return () => { alive = false; };
  }, []);

  if (!card) return null;

  const wrap = { padding: '16px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(180deg, rgba(59,130,246,0.05) 0%, transparent 100%)' };
  const kicker = { fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1.2px', margin: 0 };

  if (!card.hasData) {
    return (
      <div style={wrap}>
        <p style={kicker}>PROCESS SCORE</p>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '8px 0 4px' }}>{card.title}</p>
        <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>{card.body}</p>
      </div>
    );
  }

  const tb = trendBits(card.trend);

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <p style={kicker}>PROCESS SCORE</p>
        <span style={{ fontSize: 10, fontWeight: 700, color: tb.color, letterSpacing: '0.3px' }}>{tb.arrow} {tb.text}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1, color: gradeColor(card.letter) }}>{card.letter}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{card.score}<span style={{ fontSize: 11, color: 'var(--faint)' }}>/100</span></span>
        {card.winRate != null && (
          <span style={{ fontSize: 10, color: 'var(--faint)', marginLeft: 'auto' }}>{card.winRate}% win rate · {card.sample} decisions</span>
        )}
      </div>
      <p style={{ fontSize: 10.5, color: 'var(--faint)', margin: '0 0 12px' }}>How you traded, not how it paid. The part you control.</p>

      <div style={{ marginBottom: 10 }}>
        <p style={{ fontSize: 9, color: 'var(--green)', fontWeight: 700, letterSpacing: '0.6px', margin: '0 0 3px' }}>WHAT YOU'RE NAILING</p>
        <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55, margin: 0 }}>{card.strength}</p>
      </div>

      <div>
        <p style={{ fontSize: 9, color: 'var(--amber)', fontWeight: 700, letterSpacing: '0.6px', margin: '0 0 3px' }}>WORK ON</p>
        <p style={{ fontSize: 11.5, color: 'var(--text)', fontWeight: 600, lineHeight: 1.5, margin: 0 }}>{card.focus.label}</p>
        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55, margin: '2px 0 0' }}>{card.focus.stat}. {card.focus.detail}</p>
      </div>
    </div>
  );
}
