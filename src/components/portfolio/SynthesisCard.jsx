// Synthesis Card — the "advisor opening" at the top of the Port tab.
// 2-3 sentence steady-friend read on the whole book, generated server-side
// from an aggregated structured summary (so it scales 1 → 100+ positions).
// Cached 4h on the backend; the ↻ button forces a regenerate.
import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { Spinner, DisclaimerBadge, FeedbackButtons } from '../shared/UI.jsx';
import SaveToJournalSheet, { BookmarkButton } from '../journal/SaveToJournalSheet.jsx';

export default function SynthesisCard({ refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [journalSave, setJournalSave] = useState(null);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true); else setLoading(true);
    try {
      const d = await api.portfolio.synthesis(force);
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial fetch + reload when parent signals a refresh (e.g. after add/edit)
  useEffect(() => { load(false); }, [load, refreshKey]);

  // Hide entirely when there are no positions — empty state belongs to the parent
  if (data?.empty) return null;

  if (loading) {
    return (
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1.2px', margin: 0 }}>OUTPOST READ</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Spinner size={12} />
          <p style={{ fontSize: 11, color: 'var(--faint)', margin: 0 }}>Synthesizing your book…</p>
        </div>
      </div>
    );
  }

  // Failure or no text — fail closed, don't show a broken card
  if (!data?.text) return null;

  const generatedAt = data.generatedAt ? new Date(data.generatedAt) : null;
  const timeStr = generatedAt
    ? generatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <>
      <div style={{
        padding: '14px 16px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'linear-gradient(180deg, rgba(59,130,246,0.04) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--blue)',
              animation: 'synthPulse 2s ease-in-out infinite',
            }} />
            <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1.2px', margin: 0 }}>OUTPOST READ</p>
            {data.fromCache && timeStr && (
              <span style={{ fontSize: 9, color: 'var(--faint)', marginLeft: 4 }}>· {timeStr}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <BookmarkButton
              onClick={() => setJournalSave({ content: `Outpost read — ${timeStr || ''}\n\n${data.text}` })}
              title="Save to journal"
            />
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              aria-label="Regenerate synthesis"
              style={{
                background: 'none', border: 'none',
                cursor: refreshing ? 'default' : 'pointer',
                color: 'var(--faint)', fontSize: 13, padding: '0 4px',
                fontFamily: 'inherit',
                opacity: refreshing ? 0.5 : 1,
              }}
            >
              ↻
            </button>
          </div>
        </div>
        <p style={{
          fontSize: 13, lineHeight: 1.55,
          color: 'var(--text)',
          margin: '4px 0 8px',
          whiteSpace: 'pre-wrap',
        }}>
          {data.text}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <DisclaimerBadge />
          <FeedbackButtons feature="portfolio_synthesis" response={data.text} />
        </div>
        <style>{`@keyframes synthPulse { 0%,100%{opacity:1} 50%{opacity:0.45} }`}</style>
      </div>
      <SaveToJournalSheet
        open={journalSave !== null}
        onClose={() => setJournalSave(null)}
        initialContent={journalSave?.content || ''}
      />
    </>
  );
}
