// Portfolio Explainer — "Why did my portfolio move today?"
// Daily plain-English recap of biggest dollar-impact winners and losers
// with per-ticker "why" synthesized from recent news by Claude Haiku.
// Server generates once after close; this card just displays the cached JSON.
import { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { cachedFetch, clearCachePrefix } from '../../lib/cache.js';
import { fmt } from '../../utils/market.js';
import { DisclaimerBadge } from '../shared/UI.jsx';
import SaveToJournalSheet, { BookmarkButton } from '../journal/SaveToJournalSheet.jsx';

export default function PortfolioExplainerCard({ refreshKey, showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [journalSave, setJournalSave] = useState(null);

  const fetchData = useCallback((force = false) => {
    setLoading(true);
    if (force) clearCachePrefix('home_move_explainer');
    return cachedFetch('home_move_explainer', () => api.ai.moveExplainer(force ? { force: true } : undefined), 15 * 60000);
  }, []);

  // Cancel pattern lives in useEffect (not useCallback) so the cleanup
  // actually runs when the component unmounts or refreshKey changes.
  useEffect(() => {
    let cancelled = false;
    fetchData(false)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) { setLoading(false); setGenerating(false); } });
    return () => { cancelled = true; };
  }, [fetchData, refreshKey]);

  const generateNow = async () => {
    setGenerating(true);
    try {
      clearCachePrefix('home_move_explainer');
      const fresh = await api.ai.moveExplainer({ force: true });
      setData(fresh);
      if (fresh?.available === false && showToast) {
        showToast(fresh.reason || 'Nothing to explain yet — add positions first.', 'info');
      }
    } catch (err) {
      const msg = err?.error || err?.message || `Recap unavailable (${err?.status ?? 'network'})`;
      if (showToast) showToast(msg, 'error');
      console.error('[PortfolioExplainer] Generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  if (loading && !generating) {
    return (
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', marginBottom: 8, fontWeight: 700 }}>PORTFOLIO RECAP</p>
        <div style={{ background: 'var(--raised)', borderRadius: 8, padding: 16, textAlign: 'center' }}>
          <p style={{ fontSize: 10, color: 'var(--faint)' }}>Building today's recap...</p>
        </div>
      </div>
    );
  }

  // Empty state — show a generate button so the user can trigger it on demand
  // (normally this is auto-built at 16:45 ET by the scheduled job)
  if (!data || data.available === false) {
    return (
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>PORTFOLIO RECAP</p>
        </div>
        <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '13px 14px' }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 10 }}>
            {data?.reason || "See what moved your portfolio today — your biggest winners and losers with the news behind each move. Built automatically after close, or generate it now from live prices."}
          </p>
          <button
            onClick={generateNow}
            disabled={generating}
            style={{
              background: generating ? 'var(--raised)' : 'var(--blue)',
              color: generating ? 'var(--faint)' : 'white',
              border: 'none',
              borderRadius: 6,
              padding: '8px 14px',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.8px',
              fontFamily: 'inherit',
              cursor: generating ? 'default' : 'pointer',
            }}
          >
            {generating ? 'GENERATING…' : 'GENERATE NOW'}
          </button>
        </div>
      </div>
    );
  }

  const { portfolioSummary, benchmark, summary, winners, losers, generatedAt } = data;
  const totalChange = portfolioSummary?.totalChange ?? 0;
  const totalChangePct = portfolioSummary?.totalChangePct ?? 0;
  const up = totalChange >= 0;
  const color = up ? 'var(--green)' : 'var(--red)';

  const hasMovers = (winners?.length || 0) + (losers?.length || 0) > 0;

  // Build bookmark text for the whole recap
  const bookmarkContent = () => {
    const lines = [];
    lines.push(`Portfolio Recap — ${new Date(generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
    lines.push('');
    lines.push(`${up ? '+' : ''}$${fmt(totalChange)} (${up ? '+' : ''}${totalChangePct.toFixed(2)}%)`);
    if (benchmark) {
      const vs = benchmark.vs >= 0 ? `+${benchmark.vs.toFixed(2)}%` : `${benchmark.vs.toFixed(2)}%`;
      lines.push(`SPY ${benchmark.changePct >= 0 ? '+' : ''}${benchmark.changePct.toFixed(2)}% · ${vs} vs SPY`);
    }
    lines.push('');
    if (summary) { lines.push(summary); lines.push(''); }
    if (winners?.length) {
      lines.push('WINNERS:');
      winners.forEach(w => lines.push(`  ${w.ticker} ${w.dollarImpact >= 0 ? '+' : ''}$${fmt(w.dollarImpact)} (${w.changePct >= 0 ? '+' : ''}${w.changePct.toFixed(2)}%) — ${w.why}`));
      lines.push('');
    }
    if (losers?.length) {
      lines.push('LOSERS:');
      losers.forEach(l => lines.push(`  ${l.ticker} ${l.dollarImpact >= 0 ? '+' : ''}$${fmt(l.dollarImpact)} (${l.changePct >= 0 ? '+' : ''}${l.changePct.toFixed(2)}%) — ${l.why}`));
    }
    return lines.join('\n');
  };

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>PORTFOLIO RECAP</p>
          {generatedAt && (
            <span style={{ fontSize: 8, color: 'var(--faint)', fontWeight: 400, letterSpacing: 0 }}>
              {new Date(generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <BookmarkButton onClick={() => setJournalSave({ content: bookmarkContent() })} />
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, fontFamily: 'inherit' }}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
        {/* Headline number */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color, letterSpacing: '-0.3px', fontFamily: 'JetBrains Mono' }}>
            {up ? '+' : ''}${fmt(totalChange)}
          </span>
          <span style={{ fontSize: 12, color, fontWeight: 700 }}>
            {up ? '+' : ''}{totalChangePct.toFixed(2)}%
          </span>
          {benchmark && (
            <span style={{ fontSize: 10, color: 'var(--faint)', marginLeft: 'auto' }}>
              SPY {benchmark.changePct >= 0 ? '+' : ''}{benchmark.changePct.toFixed(2)}%
              <span style={{ color: benchmark.vs >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700, marginLeft: 4 }}>
                ({benchmark.vs >= 0 ? '+' : ''}{benchmark.vs.toFixed(2)})
              </span>
            </span>
          )}
        </div>

        {/* One-line summary */}
        {summary && (
          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55, marginBottom: expanded && hasMovers ? 12 : 0 }}>
            {summary}
          </p>
        )}

        {/* Winners / Losers lists */}
        {expanded && hasMovers && (
          <>
            {winners?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 8, color: 'var(--green)', letterSpacing: '0.8px', fontWeight: 700, marginBottom: 6 }}>WINNERS</p>
                {winners.map((w, i) => (
                  <MoverRow key={w.ticker} mover={w} color="var(--green)" last={i === winners.length - 1} />
                ))}
              </div>
            )}

            {losers?.length > 0 && (
              <div style={{ marginTop: winners?.length > 0 ? 12 : 10 }}>
                <p style={{ fontSize: 8, color: 'var(--red)', letterSpacing: '0.8px', fontWeight: 700, marginBottom: 6 }}>LOSERS</p>
                {losers.map((l, i) => (
                  <MoverRow key={l.ticker} mover={l} color="var(--red)" last={i === losers.length - 1} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

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

function MoverRow({ mover, color, last }) {
  const up = mover.dollarImpact >= 0;
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
      paddingBottom: last ? 0 : 8,
      marginBottom: last ? 0 : 8,
      borderBottom: last ? 'none' : '1px dashed var(--border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.3px' }}>{mover.ticker}</span>
        <span style={{ fontSize: 9, color: 'var(--faint)' }}>${fmt(mover.currentPrice)}</span>
        <span style={{ fontSize: 9, color, fontWeight: 700, marginLeft: 'auto', fontFamily: 'JetBrains Mono' }}>
          {up ? '+' : ''}${fmt(mover.dollarImpact)}
        </span>
        <span style={{ fontSize: 9, color, fontWeight: 700, fontFamily: 'JetBrains Mono' }}>
          {mover.changePct >= 0 ? '+' : ''}{mover.changePct.toFixed(2)}%
        </span>
      </div>
      <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>{mover.why}</p>
    </div>
  );
}
