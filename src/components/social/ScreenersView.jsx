import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

/**
 * SCREENERS — the main event in Social. You describe what you want to find in
 * plain English; Outpost pulls candidates, checks them against live data, and
 * keeps only the ones that hold up (fail closed). Every result has an ASK chip
 * straight into the agent. This is the interactive "build your own scanner"
 * surface, the counterpart to DISCOVER's broadcast feed.
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

  useEffect(() => {
    api.screeners.list().then(d => setScreeners(d.screeners ?? [])).catch(() => setScreeners([]));
  }, []);

  async function create(q = query.trim()) {
    if (!q || creating) return;
    setCreating(true);
    try {
      const d = await api.screeners.create({ query: q });
      if (d.screener) setScreeners(s => [d.screener, ...(s || [])]);
      setQuery('');
    } catch (e) {
      showToast?.(e.error || 'Could not create screener', 'error');
    }
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
  }

  function ask(ticker, q) {
    window.dispatchEvent(new CustomEvent('agent_prefill', { detail: {
      message: `${ticker} came up in my "${q}" screen. Is it worth a position given my portfolio? Walk me through it.`,
    } }));
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: '14px 16px 10px' }}>
        <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--faint)', letterSpacing: '1.2px', marginBottom: 6 }}>YOUR SCREENERS</p>
        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 10 }}>
          Describe what you want to find. Outpost pulls candidates, checks them against live data, and keeps only the ones that hold up.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
            placeholder="e.g. AI infrastructure stocks"
            style={{ flex: 1, fontSize: 12 }}
            disabled={creating}
          />
          <button onClick={() => create()} disabled={!query.trim() || creating} className="btn btn-blue"
            style={{ fontSize: 10, padding: '8px 14px', opacity: !query.trim() || creating ? 0.5 : 1, whiteSpace: 'nowrap' }}>
            {creating ? 'SCANNING…' : 'SCAN'}
          </button>
        </div>
      </div>

      {screeners === null ? (
        <p style={{ fontSize: 11, color: 'var(--faint)', padding: '8px 16px', fontStyle: 'italic' }}>Loading your screeners…</p>
      ) : screeners.length === 0 ? (
        <div style={{ padding: '4px 16px 16px' }}>
          <p style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.5, marginBottom: 10 }}>
            No screeners yet. Try one of these, or write your own above:
          </p>
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
        screeners.map(s => (
          <ScreenerCard key={s.id} s={s} onRun={() => run(s.id)} onRemove={() => remove(s.id)} running={runningId === s.id} onAsk={ask} />
        ))
      )}
    </div>
  );
}

function ScreenerCard({ s, onRun, onRemove, running, onAsk }) {
  const results = Array.isArray(s.results) ? s.results : [];
  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name || s.query}</p>
          <p style={{ fontSize: 9, color: 'var(--faint)', margin: '1px 0 0' }}>
            {results.length} match{results.length === 1 ? '' : 'es'}{s.last_run_at ? ` · ${timeAgo(s.last_run_at)}` : ''}
          </p>
        </div>
        <button onClick={onRun} disabled={running} className="btn btn-muted" style={{ fontSize: 9, padding: '4px 9px' }}>{running ? '…' : 'RESCAN'}</button>
        <button onClick={onRemove} className="btn btn-muted" style={{ fontSize: 10, padding: '4px 8px' }} title="Delete screener">✕</button>
      </div>

      {running ? (
        <p style={{ fontSize: 10, color: 'var(--faint)', fontStyle: 'italic' }}>Scanning and vetting…</p>
      ) : results.length === 0 ? (
        <p style={{ fontSize: 10, color: 'var(--faint)', fontStyle: 'italic' }}>Nothing held up the vetting this run. Try refining the query, or rescan later.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {results.map(r => (
            <div key={r.ticker} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{r.ticker}</span>
                  {r.price != null && <span style={{ fontSize: 10, color: 'var(--faint)' }}>${r.price}</span>}
                  {r.changePercent != null && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: r.changePercent >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {r.changePercent >= 0 ? '+' : ''}{Number(r.changePercent).toFixed(1)}%
                    </span>
                  )}
                </div>
                {r.thesis && <p style={{ fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.4, margin: '2px 0 0' }}>{r.thesis}</p>}
              </div>
              <button onClick={() => onAsk(r.ticker, s.query)}
                style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.5px', padding: '5px 9px', borderRadius: 4, cursor: 'pointer', background: 'rgba(59,130,246,0.12)', color: 'var(--blue)', border: '0.5px solid rgba(59,130,246,0.35)', whiteSpace: 'nowrap', flexShrink: 0 }}
                title="Ask Outpost about this">ASK</button>
            </div>
          ))}
        </div>
      )}
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
