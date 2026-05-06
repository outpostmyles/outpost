// Proactive Digest — "what your agent noticed overnight" card.
// Auto-generated daily at 7am ET; on-demand fetch otherwise.
// Auto-hides for users with no positions.
import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { cachedFetch, clearCachePrefix } from '../../lib/cache.js';
import { renderPlainText } from '../../utils/renderText.js';
import { DisclaimerBadge, FeedbackButtons } from '../shared/UI.jsx';
import SaveToJournalSheet, { BookmarkButton } from '../journal/SaveToJournalSheet.jsx';

const PRIORITY_COLOR = {
  high: 'var(--red)',
  medium: 'var(--amber)',
  low: 'var(--faint)',
};

export default function ProactiveDigestCard({ refreshKey, showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [showSignals, setShowSignals] = useState(false);
  const [journalSave, setJournalSave] = useState(null);

  const fetchData = useCallback((force = false) => {
    setLoading(true);
    if (force) clearCachePrefix('home_proactive_digest');
    return cachedFetch(
      'home_proactive_digest',
      () => api.ai.proactiveDigest(force ? { force: true } : undefined),
      30 * 60000  // 30 min in-browser cache; server already does daily caching
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchData(false)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fetchData, refreshKey]);

  const generateNow = async () => {
    setGenerating(true);
    try {
      clearCachePrefix('home_proactive_digest');
      const fresh = await api.ai.proactiveDigest({ force: true });
      setData(fresh);
      if (fresh?.available === false) {
        showToast?.(fresh.reason || 'Nothing to digest yet — add a position first.', 'info');
      }
    } catch (err) {
      const msg = err?.error || err?.message || `Digest unavailable (${err?.status ?? 'network'})`;
      showToast?.(msg, 'error');
      console.error('[ProactiveDigest] Generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  if (loading && !generating) {
    return (
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', marginBottom: 8, fontWeight: 700 }}>AGENT NOTICED</p>
        <div style={{ background: 'var(--raised)', borderRadius: 8, padding: 14, textAlign: 'center' }}>
          <p style={{ fontSize: 10, color: 'var(--faint)' }}>Reading the tape...</p>
        </div>
      </div>
    );
  }

  // Hide entirely for new users without positions — don't clutter the home tab
  if (!data || data.available === false) return null;

  const { digest, signals = [], quiet, generatedAt, cached } = data;

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--blue)">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>AGENT NOTICED</p>
          {generatedAt && (
            <span style={{ fontSize: 8, color: 'var(--faint)', fontWeight: 400 }}>
              {new Date(generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
          {cached && <span style={{ fontSize: 8, color: 'var(--faint)' }}>CACHED</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {digest && (
            <BookmarkButton
              onClick={() => setJournalSave({ content: `Morning Digest — ${new Date(generatedAt).toLocaleDateString()}\n\n${digest}` })}
            />
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, fontFamily: 'inherit' }}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      <div style={{
        background: 'var(--raised)',
        borderLeft: `2px solid ${quiet ? 'var(--faint)' : 'var(--blue)'}`,
        borderRadius: '0 8px 8px 0',
        padding: '11px 13px',
      }}>
        {expanded && (
          <>
            <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
              {renderPlainText(digest)}
            </p>

            {/* Signal chips — collapsed by default for non-quiet days */}
            {!quiet && signals.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={() => setShowSignals(s => !s)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--blue)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px',
                    fontFamily: 'inherit', padding: 0,
                  }}
                >
                  {showSignals ? '▲ HIDE SIGNALS' : `▼ ${signals.length} SIGNAL${signals.length === 1 ? '' : 'S'}`}
                </button>
                {showSignals && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {signals.map((s, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                        <div style={{
                          width: 5, height: 5, borderRadius: '50%',
                          background: PRIORITY_COLOR[s.priority] || 'var(--faint)',
                          flexShrink: 0, marginTop: 6,
                        }} />
                        <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
                          {s.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Manual regenerate — useful when the cron hasn't run yet or user wants a refresh */}
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={generateNow}
                disabled={generating}
                style={{
                  background: 'none', border: 'none', cursor: generating ? 'default' : 'pointer',
                  color: generating ? 'var(--faint)' : 'var(--blue)', fontSize: 9, fontWeight: 700,
                  letterSpacing: '0.5px', fontFamily: 'inherit', padding: 0,
                }}
              >
                {generating ? 'REFRESHING…' : 'REFRESH'}
              </button>
              {!quiet && <FeedbackButtons feature="proactive_digest" response={digest} />}
            </div>
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
