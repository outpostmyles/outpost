import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

/**
 * SCREENERS — the main event in Social, structured like the agent: a LIST of the
 * screeners you've built, and you tap into one to open its focused results
 * workspace (and back out). Creating one drops you straight into its space.
 * Same "I can get work done here" feel as switching between agent chats, instead
 * of one cluttered scroll. You describe what to find; Outpost pulls candidates,
 * vets them against live data (fail closed), and saves the screen to return to.
 * Every result has an ASK chip into a fresh agent conversation.
 */

const EXAMPLES = [
  'AI infrastructure stocks',
  'profitable small caps under $50',
  'beaten-down quality names near 52-week lows',
  'high-growth cybersecurity',
];

export default function ScreenersView({ showToast }) {
  const [screeners, setScreeners] = useState(null); // null = loading
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState(null);
  const [selectedId, setSelectedId] = useState(null); // null = list, id = workspace

  useEffect(() => {
    api.screeners.list().then(d => setScreeners(d.screeners ?? [])).catch(() => setScreeners([]));
  }, []);

  async function create(q = query.trim()) {
    if (!q || creating) return;
    setCreating(true);
    try {
      const d = await api.screeners.create({ query: q });
      if (d.screener) {
        setScreeners(s => [d.screener, ...(s || [])]);
        setSelectedId(d.screener.id); // drop into the new workspace
        setQuery('');
      }
    } catch (e) { showToast?.(e.error || 'Could not create screener', 'error'); }
    setCreating(false);
  }

  async function run(id) {
    setRunningId(id);
    try {
      const d = await api.screeners.run(id);
      if (d.screener) setScreeners(s => (s || []).map(x => x.id === id ? d.screener : x));
    } catch { showToast?.('Rescan failed, try again', 'error'); }
    setRunningId(null);
  }

  async function remove(id) {
    try { await api.screeners.remove(id); } catch {}
    setScreeners(s => (s || []).filter(x => x.id !== id));
    if (id === selectedId) setSelectedId(null);
  }

  function ask(ticker, q) {
    window.dispatchEvent(new CustomEvent('agent_prefill', { detail: {
      message: `${ticker} came up in my "${q}" screen. Is it worth a position given my portfolio? Walk me through it.`,
    } }));
  }

  const selected = selectedId ? (screeners || []).find(s => s.id === selectedId) : null;

  // ── Workspace (one screener) ──
  if (selected) {
    const results = Array.isArray(selected.results) ? selected.results : [];
    const running = runningId === selected.id;
    return (
      <div style={{ paddingBottom: 24 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => setSelectedId(null)}
            style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: 10, fontFamily: 'inherit', letterSpacing: '0.4px', padding: 0, marginBottom: 9 }}>
            ← Screeners
          </button>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: 0, lineHeight: 1.3 }}>{selected.name || selected.query}</p>
              <p style={{ fontSize: 9, color: 'var(--faint)', margin: '3px 0 0' }}>
                {results.length} match{results.length === 1 ? '' : 'es'}{selected.last_run_at ? ` · scanned ${timeAgo(selected.last_run_at)}` : ''}
              </p>
            </div>
            <button onClick={() => run(selected.id)} disabled={running} className="btn btn-muted" style={{ fontSize: 9, padding: '5px 10px' }}>{running ? '…' : 'RESCAN'}</button>
            <button onClick={() => remove(selected.id)} className="btn btn-muted" style={{ fontSize: 10, padding: '5px 9px' }} title="Delete screener">✕</button>
          </div>
        </div>

        {running ? (
          <p style={{ fontSize: 11, color: 'var(--faint)', fontStyle: 'italic', padding: '14px 16px' }}>Scanning and vetting…</p>
        ) : results.length === 0 ? (
          <p style={{ fontSize: 11, color: 'var(--faint)', fontStyle: 'italic', padding: '14px 16px', lineHeight: 1.5 }}>
            Nothing held up the vetting this run. Try a more specific query, or rescan later.
          </p>
        ) : (
          results.map(r => <ResultRow key={r.ticker} r={r} onAsk={() => ask(r.ticker, selected.query)} />)
        )}
      </div>
    );
  }

  // ── List of screeners ──
  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)' }}>
        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 10 }}>
          Describe what you want to find. Outpost pulls candidates, vets them against live data, and saves the screen so you can come back to it.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
            placeholder="New screen, e.g. AI infrastructure stocks" style={{ flex: 1, fontSize: 12 }} disabled={creating} />
          <button onClick={() => create()} disabled={!query.trim() || creating} className="btn btn-blue"
            style={{ fontSize: 10, padding: '8px 14px', opacity: !query.trim() || creating ? 0.5 : 1, whiteSpace: 'nowrap' }}>
            {creating ? 'SCANNING…' : 'SCAN'}
          </button>
        </div>
      </div>

      {screeners === null ? (
        <p style={{ fontSize: 11, color: 'var(--faint)', padding: '12px 16px', fontStyle: 'italic' }}>Loading your screeners…</p>
      ) : screeners.length === 0 ? (
        <div style={{ padding: '14px 16px' }}>
          <p style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.5, marginBottom: 10 }}>No screeners yet. Try one of these, or write your own above:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {EXAMPLES.map(ex => (
              <button key={ex} onClick={() => create(ex)} disabled={creating}
                style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 10px', fontSize: 10, color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--faint)', letterSpacing: '1px', padding: '10px 16px 2px' }}>YOUR SCREENERS</p>
          {screeners.map(s => {
            const top = Array.isArray(s.results) ? s.results : [];
            return (
              <div key={s.id} onClick={() => setSelectedId(s.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name || s.query}</p>
                  <p style={{ fontSize: 9, color: 'var(--faint)', margin: '2px 0 0' }}>{top.length} match{top.length === 1 ? '' : 'es'}{s.last_run_at ? ` · ${timeAgo(s.last_run_at)}` : ''}</p>
                </div>
                {top.length > 0 && (
                  <div style={{ display: 'flex', gap: 3 }}>
                    {top.slice(0, 3).map(r => (
                      <span key={r.ticker} style={{ fontSize: 8, fontWeight: 700, color: 'var(--faint)', background: 'var(--raised)', border: '0.5px solid var(--border)', borderRadius: 3, padding: '2px 5px' }}>{r.ticker}</span>
                    ))}
                  </div>
                )}
                <span style={{ color: 'var(--faint)', fontSize: 13 }}>›</span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function ResultRow({ r, onAsk }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{r.ticker}</span>
          {r.price != null && <span style={{ fontSize: 10, color: 'var(--faint)' }}>${r.price}</span>}
          {r.changePercent != null && (
            <span style={{ fontSize: 10, fontWeight: 700, color: r.changePercent >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {r.changePercent >= 0 ? '+' : ''}{Number(r.changePercent).toFixed(1)}%
            </span>
          )}
        </div>
        {r.thesis && <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45, margin: '3px 0 0' }}>{r.thesis}</p>}
      </div>
      <button onClick={onAsk}
        style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.5px', padding: '5px 9px', borderRadius: 4, cursor: 'pointer', background: 'rgba(59,130,246,0.12)', color: 'var(--blue)', border: '0.5px solid rgba(59,130,246,0.35)', whiteSpace: 'nowrap', flexShrink: 0 }}
        title="Ask Outpost about this">ASK</button>
    </div>
  );
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}
