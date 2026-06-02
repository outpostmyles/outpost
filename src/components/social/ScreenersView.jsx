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

// Where you are on a name in your own research. Stays with the ticker everywhere.
const STATUS_META = {
  researching: { label: 'Researching', color: 'var(--blue)', bg: 'rgba(59,130,246,0.14)', border: 'rgba(59,130,246,0.4)' },
  watching: { label: 'Watching', color: '#f59e0b', bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.4)' },
  passed: { label: 'Passed', color: 'var(--faint)', bg: 'var(--raised)', border: 'var(--border)' },
  bought: { label: 'Bought', color: 'var(--green)', bg: 'rgba(34,197,94,0.14)', border: 'rgba(34,197,94,0.4)' },
};
const STATUS_ORDER = ['researching', 'watching', 'passed', 'bought'];

export default function ScreenersView({ showToast }) {
  const [screeners, setScreeners] = useState(null); // null = loading
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState(null);
  const [selectedId, setSelectedId] = useState(null); // null = list, id = workspace
  const [refineText, setRefineText] = useState('');
  const [refining, setRefining] = useState(false);
  const [dossierTicker, setDossierTicker] = useState(null);
  const [dossier, setDossier] = useState(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierError, setDossierError] = useState(null);
  const [statuses, setStatuses] = useState({}); // ticker -> research status

  useEffect(() => {
    api.screeners.list().then(d => setScreeners(d.screeners ?? [])).catch(() => setScreeners([]));
    api.research.statuses().then(d => setStatuses(d.statuses || {})).catch(() => {});
  }, []);

  // Opening a screen that has new names clears the NEW flags (server + local), so
  // the "while you were away" markers only show until you have actually looked.
  useEffect(() => {
    if (!selectedId) return;
    const s = (screeners || []).find(x => x.id === selectedId);
    if (!s || !(Array.isArray(s.results) ? s.results : []).some(r => r.isNew)) return;
    api.screeners.seen(selectedId).catch(() => {});
    setScreeners(list => (list || []).map(x => x.id === selectedId
      ? { ...x, results: (x.results || []).map(r => ({ ...r, isNew: false })) } : x));
  }, [selectedId, screeners]);

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

  async function watch(ticker) {
    try {
      await api.social.addToWatchlist({ ticker, companyName: ticker });
      showToast?.(`${ticker} added to watchlist`, 'success');
    } catch (e) {
      showToast?.(e.error || 'Could not add to watchlist', 'error');
    }
  }

  async function refine(id) {
    const r = refineText.trim();
    if (!r || refining) return;
    setRefining(true);
    try {
      const d = await api.screeners.refine(id, { refinement: r });
      if (d.screener) {
        setScreeners(s => (s || []).map(x => x.id === id ? d.screener : x));
        setRefineText('');
        showToast?.('Screen refined', 'success');
      }
    } catch (e) { showToast?.(e.error || 'Could not refine', 'error'); }
    setRefining(false);
  }

  async function openDossier(ticker) {
    setDossierTicker(ticker); setDossier(null); setDossierError(null); setDossierLoading(true);
    try {
      const d = await api.research.dossier(ticker);
      setDossier(d.dossier || null);
    } catch (e) {
      setDossierError(e.error || 'Could not load research right now');
    }
    setDossierLoading(false);
  }
  function closeDossier() { setDossierTicker(null); setDossier(null); setDossierError(null); }
  async function setStatus(ticker, status) {
    const next = statuses[ticker] === status ? null : status; // tapping the active one clears it
    try {
      await api.research.setStatus(ticker, next);
      setStatuses(m => { const n = { ...m }; if (next) n[ticker] = next; else delete n[ticker]; return n; });
      setDossier(d => (d && d.ticker === ticker) ? { ...d, status: next } : d);
    } catch (e) { showToast?.(e.error || 'Could not save your call', 'error'); }
  }
  function deepDive(d) {
    const t = d?.ticker || dossierTicker;
    const name = d?.name && d.name !== t ? ` (${d.name})` : '';
    window.dispatchEvent(new CustomEvent('agent_prefill', { detail: { message:
      `Give me a full research read on ${t}${name}. What does the company actually do, the bull case, the bear case, how the valuation looks, and most importantly whether it fits my portfolio and goals given what you know about me. Be honest about the risks.` } }));
  }

  // ── Research dossier (one stock), overlays list or workspace ──
  if (dossierTicker) {
    return <DossierView ticker={dossierTicker} dossier={dossier} loading={dossierLoading} error={dossierError}
      status={dossier?.status ?? statuses[dossierTicker] ?? null} onStatus={(s) => setStatus(dossierTicker, s)}
      onBack={closeDossier} onWatch={() => watch(dossierTicker)} onAsk={() => deepDive(dossier)} />;
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

        {(running || refining) ? (
          <p style={{ fontSize: 11, color: 'var(--faint)', fontStyle: 'italic', padding: '14px 16px' }}>Scanning and vetting…</p>
        ) : results.length === 0 ? (
          <p style={{ fontSize: 11, color: 'var(--faint)', fontStyle: 'italic', padding: '14px 16px', lineHeight: 1.5 }}>
            Nothing held up the vetting this run. Try a more specific query, refine it below, or rescan later.
          </p>
        ) : (
          results.map(r => <ResultRow key={r.ticker} r={r} status={statuses[r.ticker]} onAsk={() => ask(r.ticker, selected.query)} onWatch={() => watch(r.ticker)} onOpen={() => openDossier(r.ticker)} />)
        )}

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', marginTop: 4 }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--faint)', letterSpacing: '1px', marginBottom: 6 }}>SHAPE IT</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" value={refineText} onChange={e => setRefineText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); refine(selected.id); } }}
              placeholder="Refine in plain English, e.g. only profitable, under $100" style={{ flex: 1, fontSize: 12 }} disabled={refining} />
            <button onClick={() => refine(selected.id)} disabled={!refineText.trim() || refining} className="btn btn-muted"
              style={{ fontSize: 10, padding: '8px 12px', whiteSpace: 'nowrap', opacity: !refineText.trim() || refining ? 0.5 : 1 }}>
              {refining ? '…' : 'REFINE'}
            </button>
          </div>
        </div>
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
            const newCount = top.filter(r => r.isNew).length;
            return (
              <div key={s.id} onClick={() => setSelectedId(s.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderTop: '1px solid var(--border)', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name || s.query}</p>
                  <p style={{ fontSize: 9, color: 'var(--faint)', margin: '2px 0 0' }}>{top.length} match{top.length === 1 ? '' : 'es'}{s.last_run_at ? ` · ${timeAgo(s.last_run_at)}` : ''}</p>
                </div>
                {newCount > 0 && (
                  <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--green)', background: 'rgba(34,197,94,0.14)', border: '0.5px solid rgba(34,197,94,0.4)', borderRadius: 3, padding: '2px 5px', whiteSpace: 'nowrap' }}>{newCount} NEW</span>
                )}
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

function ResultRow({ r, status, onAsk, onWatch, onOpen }) {
  const sm = status ? STATUS_META[status] : null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--border)', opacity: status === 'passed' ? 0.55 : 1 }}>
      <div onClick={onOpen} title="Open research" style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {r.isNew && <span style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '0.5px', color: 'var(--green)', background: 'rgba(34,197,94,0.14)', border: '0.5px solid rgba(34,197,94,0.4)', borderRadius: 3, padding: '1px 4px' }}>NEW</span>}
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{r.ticker}</span>
          {sm && <span style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: '0.5px', color: sm.color, background: sm.bg, border: `0.5px solid ${sm.border}`, borderRadius: 3, padding: '1px 4px', textTransform: 'uppercase' }}>{sm.label}</span>}
          {r.price != null && <span style={{ fontSize: 10, color: 'var(--faint)' }}>${r.price}</span>}
          {r.changePercent != null && (
            <span style={{ fontSize: 10, fontWeight: 700, color: r.changePercent >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {r.changePercent >= 0 ? '+' : ''}{Number(r.changePercent).toFixed(1)}%
            </span>
          )}
          <span style={{ fontSize: 9, color: 'var(--blue)', marginLeft: 'auto' }}>RESEARCH ›</span>
        </div>
        {r.thesis && <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45, margin: '3px 0 0' }}>{r.thesis}</p>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
        <button onClick={onAsk}
          style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.5px', padding: '5px 9px', borderRadius: 4, cursor: 'pointer', background: 'rgba(59,130,246,0.12)', color: 'var(--blue)', border: '0.5px solid rgba(59,130,246,0.35)', whiteSpace: 'nowrap' }}
          title="Ask Outpost about this">ASK</button>
        <button onClick={onWatch}
          style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.5px', padding: '5px 9px', borderRadius: 4, cursor: 'pointer', background: 'var(--raised)', color: 'var(--muted)', border: '1px solid var(--border)', whiteSpace: 'nowrap' }}
          title="Add to watchlist">+ WATCH</button>
      </div>
    </div>
  );
}

// The research dossier: one stock, everything to decide, personalized to your
// book. The screener finds names; this is the room you research one in.
const dsNote = { fontSize: 11, color: 'var(--faint)', lineHeight: 1.45, margin: '6px 0 0' };

function DossierView({ ticker, dossier, loading, error, status, onStatus, onBack, onWatch, onAsk }) {
  const d = dossier;
  const f = d?.fundamentals || {};
  const hasFund = f && Object.values(f).some(v => v != null);
  return (
    <div style={{ paddingBottom: 44 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: 10, fontFamily: 'inherit', letterSpacing: '0.4px', padding: 0, marginBottom: 9 }}>← Back</button>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>{(d?.ticker) || ticker}</span>
          {d?.price != null && <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>${d.price}</span>}
          {d?.changePercent != null && <span style={{ fontSize: 12, fontWeight: 700, color: d.changePercent >= 0 ? 'var(--green)' : 'var(--red)' }}>{d.changePercent >= 0 ? '+' : ''}{Number(d.changePercent).toFixed(2)}%</span>}
        </div>
        {d && <p style={{ fontSize: 10.5, color: 'var(--muted)', margin: '3px 0 0' }}>{[d.name !== d.ticker ? d.name : null, d.sector, d.industry].filter(Boolean).join(' · ')}</p>}
      </div>

      {loading ? (
        <p style={{ fontSize: 11, color: 'var(--faint)', fontStyle: 'italic', padding: '16px' }}>Pulling research…</p>
      ) : error ? (
        <p style={{ fontSize: 11, color: 'var(--faint)', padding: '16px', lineHeight: 1.5 }}>{error}</p>
      ) : d ? (
        <>
          <DSection title="FOR YOUR BOOK" accent>
            <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, margin: 0 }}>{d.forYourBook.fitNote}</p>
            {d.forYourBook.sector && d.forYourBook.sector !== 'Unknown' && d.forYourBook.bookValue > 0 && (
              <SectorBar pct={d.forYourBook.sectorPct} sector={d.forYourBook.sector} />
            )}
            {d.forYourBook.betaNote && <p style={dsNote}>{d.forYourBook.betaNote}</p>}
            {d.forYourBook.suggestedSize && <p style={dsNote}>{d.forYourBook.suggestedSize}</p>}
          </DSection>

          {d.description && (
            <DSection title="WHAT THEY DO">
              <p style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55, margin: 0 }}>{d.description}</p>
            </DSection>
          )}

          <DSection title="FUNDAMENTALS">
            {hasFund ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
                  <Metric label="Market cap" value={fmtCap(f.marketCap)} />
                  <Metric label="P/E" value={f.pe != null ? Number(f.pe).toFixed(1) : null} />
                  <Metric label="EPS" value={f.eps != null ? `$${Number(f.eps).toFixed(2)}` : null} />
                  <Metric label="Net margin" value={f.netMargin != null ? `${f.netMargin}%` : null} />
                  <Metric label="Gross margin" value={f.grossMargin != null ? `${f.grossMargin}%` : null} />
                  <Metric label="ROE" value={f.roe != null ? `${f.roe}%` : null} />
                  <Metric label="Dividend" value={f.dividendYield ? `${f.dividendYield}%` : null} />
                  <Metric label="Beta" value={f.beta != null ? Number(f.beta).toFixed(2) : null} />
                </div>
                {d.rangePosition != null && <RangeBar pos={d.rangePosition} low={f.yearLow} high={f.yearHigh} />}
              </>
            ) : (
              <p style={{ fontSize: 11, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>Live fundamentals are catching up. Reload in a moment.</p>
            )}
          </DSection>

          {d.analyst && (d.analyst.total > 0 || d.analyst.targetPrice) && (
            <DSection title="THE STREET">
              <p style={{ fontSize: 12, color: 'var(--text)', margin: 0 }}>
                Consensus: <strong>{d.analyst.consensus}</strong>
                {d.analyst.total > 0 && <span style={{ color: 'var(--faint)', fontSize: 10.5 }}>  ({d.analyst.buy} buy · {d.analyst.hold} hold · {d.analyst.sell} sell)</span>}
              </p>
              {d.analyst.targetPrice && <p style={dsNote}>Avg price target ${Number(d.analyst.targetPrice).toFixed(2)}{d.price ? ` (${d.analyst.targetPrice >= d.price ? '+' : ''}${Math.round((d.analyst.targetPrice / d.price - 1) * 100)}% from here)` : ''}</p>}
            </DSection>
          )}

          {d.news?.length > 0 && (
            <DSection title="LATEST">
              {d.news.map((n, i) => (
                <p key={i} style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.45, margin: i === 0 ? '0' : '7px 0 0' }}>
                  {n.title} <span style={{ color: 'var(--faint)' }}>— {n.source}</span>
                </p>
              ))}
            </DSection>
          )}

          <DSection title="YOUR CALL">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {STATUS_ORDER.map(s => {
                const m = STATUS_META[s];
                const active = status === s;
                return (
                  <button key={s} onClick={() => onStatus(s)}
                    style={{ fontSize: 10, fontWeight: 700, padding: '6px 11px', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit',
                      color: active ? m.color : 'var(--muted)', background: active ? m.bg : 'var(--raised)',
                      border: `1px solid ${active ? m.border : 'var(--border)'}` }}>
                    {m.label}
                  </button>
                );
              })}
            </div>
            <p style={dsNote}>Your call sticks to {(dossier?.ticker) || ticker} everywhere in Outpost. Tap the active one to clear it.</p>
          </DSection>

          <div style={{ display: 'flex', gap: 8, padding: '14px 16px' }}>
            <button onClick={onAsk} className="btn btn-blue" style={{ flex: 1, fontSize: 11, padding: '10px' }}>DEEP DIVE WITH OUTPOST</button>
            <button onClick={onWatch} className="btn btn-muted" style={{ fontSize: 11, padding: '10px 14px' }}>+ WATCH</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function DSection({ title, accent, children }) {
  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: accent ? 'rgba(59,130,246,0.05)' : 'transparent' }}>
      <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '1px', color: accent ? 'var(--blue)' : 'var(--faint)', margin: '0 0 7px' }}>{title}</p>
      {children}
    </div>
  );
}

function Metric({ label, value }) {
  if (value == null) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

function SectorBar({ pct, sector }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--faint)', marginBottom: 3 }}>
        <span>{sector}</span><span>{pct}% of your book</span>
      </div>
      <div style={{ height: 5, background: 'var(--raised)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: pct >= 40 ? 'var(--red)' : 'var(--blue)' }} />
      </div>
    </div>
  );
}

function RangeBar({ pos, low, high }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--faint)', marginBottom: 3 }}>
        <span>52-wk range</span>
        <span>{low != null ? `$${low}` : ''}{low != null && high != null ? ' to ' : ''}{high != null ? `$${high}` : ''}</span>
      </div>
      <div style={{ position: 'relative', height: 5, background: 'var(--raised)', borderRadius: 3 }}>
        <div style={{ position: 'absolute', left: `${pos}%`, top: -2, transform: 'translateX(-50%)', width: 3, height: 9, background: 'var(--text)', borderRadius: 2 }} />
      </div>
      <p style={{ fontSize: 9.5, color: 'var(--faint)', margin: '3px 0 0' }}>{pos}% of the way up its 52-week range</p>
    </div>
  );
}

function fmtCap(n) {
  if (n == null) return null;
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(0)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n}`;
}

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}
