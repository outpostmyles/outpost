// Journal — a list of named notes, like chat conversations.
// - List view: browse all notes, tap one to open
// - Editor view: edit title and content inline, auto-saves on blur / debounce
// - "+ New" creates a fresh note and opens it
// - Delete from inside the editor
//
// Phase 3: a Timeline sub-tab shows the user's investing story across all
// surfaces (positions, closed trades, agent chats, notes). Sub-tab state
// lives at the top of this component so opening a note from Timeline
// returns to Timeline, not Notes.
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../../lib/api.js';
import { cachedFetch } from '../../lib/cache.js';
import { buildCoaching } from '../../lib/coaching.js';
import { buildGrowthArc } from '../../lib/growthArc.js';
import { buildReflectionPrompts } from '../../lib/journalPrompts.js';
import ProcessScorecard from './ProcessScorecard.jsx';
import { computeComposure } from '../../lib/composure.js';
import NorthStarCard from '../home/NorthStarCard.jsx';
import { Spinner, EmptyState } from '../shared/UI.jsx';
import { detectKnownTickers } from '../../lib/tickers.js';
import { filterNotes } from '../../lib/journalSearch.js';

export default function JournalTab({ showToast, onTabSwitch }) {
  const [subTab, setSubTab] = useState('overview'); // 'overview' | 'story' | 'saved'
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openNote, setOpenNote] = useState(null); // full note object when editing
  const [query, setQuery] = useState(''); // notes search box
  // Tickers the user owns (positions) and watches (watchlist). Used to turn
  // ALL-CAPS mentions in a note into tappable chips that jump to the agent.
  // We only linkify KNOWN tickers so stray all-caps prose (TODO, CASH) never
  // becomes a chip. Owned drives a "you hold this" marker + a tailored prompt.
  const [ownedTickers, setOwnedTickers] = useState(() => new Set());
  const [watchTickers, setWatchTickers] = useState(() => new Set());

  // Stabilize showToast across renders so effects don't re-fire on parent updates.
  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);

  const loadNotes = useCallback(async () => {
    try {
      const { notes } = await api.journal.listNotes();
      setNotes(notes || []);
    } catch (err) {
      showToastRef.current?.(err.error || 'Failed to load notes', 'error');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadNotes().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadNotes]);

  // Load the user's known tickers once. Best-effort: if either call fails the
  // note still works, it just won't show chips for that source.
  useEffect(() => {
    let cancelled = false;
    api.portfolio.value()
      .then(d => {
        if (cancelled) return;
        const owned = new Set((d?.positions ?? []).map(p => String(p.ticker || '').toUpperCase()).filter(Boolean));
        setOwnedTickers(owned);
      })
      .catch(() => {});
    api.social.watchlist()
      .then(d => {
        if (cancelled) return;
        const watched = new Set((d?.items ?? []).map(w => String(w.ticker || '').toUpperCase()).filter(Boolean));
        setWatchTickers(watched);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Tap a detected ticker chip inside a note. Both owned and not-owned route to
  // the agent (it already has full portfolio context), just with a prompt that
  // fits the situation. Reuses the same agent_prefill + tab-switch bridge the
  // Deploy Cash flow uses, so there's one consistent way into the agent.
  function handleTickerTap(ticker, owned) {
    const message = owned
      ? `Give me a quick read on my ${ticker} position. What should I be watching right now?`
      : `What's the current setup on ${ticker}? I came across it in my notes and want a quick take.`;
    window.dispatchEvent(new CustomEvent('agent_prefill', { detail: { message } }));
    onTabSwitch?.('agent');
  }

  async function handleNewNote() {
    try {
      const { note } = await api.journal.createNote({ title: 'Untitled', content: '' });
      setOpenNote(note);
      // Prepend to list optimistically
      setNotes(prev => [{ ...note, preview: '' }, ...prev]);
    } catch (err) {
      showToast?.(err.error || 'Failed to create note', 'error');
    }
  }

  async function handleOpenNote(id) {
    try {
      const { note } = await api.journal.getNote(id);
      setOpenNote(note);
    } catch (err) {
      showToast?.(err.error || 'Failed to open note', 'error');
    }
  }

  function handleCloseEditor() {
    setOpenNote(null);
    loadNotes(); // refresh list to reflect any edits
  }

  // A REFLECT prompt was tapped: start a pre-seeded entry (no blank page), mark the
  // prompt handled so it stops nagging, and drop straight into the editor.
  async function handleReflect(prompt) {
    try {
      const { note } = await api.journal.createNote({ title: prompt.seedTitle, content: prompt.seedBody });
      api.journal.markReflected(prompt.id).catch(() => {});
      setNotes(prev => [{ ...note, preview: prompt.seedBody.slice(0, 100) }, ...prev]);
      setOpenNote(note);
    } catch (err) {
      showToast?.(err.error || 'Could not start that entry', 'error');
    }
  }

  async function handleDeleteNote(id) {
    if (!confirm('Delete this note? This cannot be undone.')) return;
    try {
      await api.journal.deleteNote(id);
      setNotes(prev => prev.filter(n => n.id !== id));
      setOpenNote(null);
      showToast?.('Note deleted', 'success');
    } catch (err) {
      showToast?.(err.error || 'Failed to delete', 'error');
    }
  }

  // Notes filtered by the search box. Empty query returns all (instant).
  const filteredNotes = filterNotes(notes, query);

  // ========== EDITOR VIEW ==========
  if (openNote) {
    return (
      <NoteEditor
        note={openNote}
        onClose={handleCloseEditor}
        onDelete={() => handleDeleteNote(openNote.id)}
        showToast={showToast}
        ownedTickers={ownedTickers}
        watchTickers={watchTickers}
        onTickerTap={handleTickerTap}
      />
    );
  }

  // ========== LIST VIEW (Notes sub-tab) or TIMELINE VIEW ==========
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Sub-tab navigation */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        {[
          { id: 'overview', label: 'PROGRESS' },
          { id: 'story', label: 'STORY' },
          { id: 'saved', label: 'SAVED' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${subTab === t.id ? 'var(--blue)' : 'transparent'}`,
              padding: '11px 0',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '1px',
              color: subTab === t.id ? 'var(--blue)' : 'var(--faint)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'color 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'overview' ? (
        <ProgressOverview onSeeStory={() => setSubTab('story')} onReflect={handleReflect} />
      ) : subTab === 'story' ? (
        <TimelineView showToast={showToast} />
      ) : (
        <>
          {/* SAVED: bookmarks and notes. Demoted to a shelf, since saving now
              happens everywhere in the app, not just here. */}
          <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>SAVED</p>
              <p style={{ fontSize: 10, color: 'var(--faint)', marginTop: 3 }}>Bookmarks and notes from around the app</p>
            </div>
            <button
              onClick={handleNewNote}
              style={{
                background: 'var(--blue)', color: '#fff', border: 'none',
                borderRadius: 6, padding: '8px 14px', fontSize: 10,
                fontWeight: 700, letterSpacing: '0.8px', cursor: 'pointer',
              }}
            >
              + NEW NOTE
            </button>
          </div>

          {/* Search — pure client-side filter over title + preview. Only shown
              once there are notes to search. Instant, no network per keystroke. */}
          {!loading && notes.length > 0 && (
            <div style={{ padding: '10px 16px 0', flexShrink: 0 }}>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search notes…"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: 'var(--raised)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '8px 30px 8px 11px',
                    color: 'var(--text)', fontSize: 11, fontFamily: 'inherit', outline: 'none',
                  }}
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    style={{
                      position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', color: 'var(--faint)',
                      cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 2, fontFamily: 'inherit',
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}><Spinner /></div>
            ) : notes.length === 0 ? (
              <EmptyState
                title="Your scratchpad"
                subtitle="A private space for ideas, AI reads worth saving, and your own notes. The agent doesn't read these — they're for you, not for the AI."
                tips={[
                  { title: 'Bookmark anything', body: 'Tap the bookmark icon on any AI response or news headline to save it here. Re-read later, organize how you want.' },
                  { title: 'Catch ideas fast', body: 'See a ticker on Social you want to look into? + NEW NOTE and jot it down. No structure required.' },
                  { title: 'Private by design', body: 'Trade plans you set on positions (thesis, target, stop) DO inform the agent. Free-form journal notes never do.' },
                ]}
              />
            ) : filteredNotes.length === 0 ? (
              <p style={{ fontSize: 11, color: 'var(--faint)', textAlign: 'center', padding: '24px 16px', lineHeight: 1.5 }}>
                No notes match "{query}". Search looks at titles and the start of each note.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredNotes.map(note => (
                  <NoteListItem key={note.id} note={note} onOpen={() => handleOpenNote(note.id)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ============ THE MINDSET COACH ============
// The front door of Progress and the heart of it: a grounded "talk it through"
// companion for the emotional side of investing. Warm, knows your situation,
// not therapy and not advice. The card invites; the overlay holds the conversation.

const COACH_STARTERS = [
  "I'm down and it's stressing me out",
  "I feel like panic selling",
  "I'm scared to buy anything",
  "Did I mess up?",
];
const coachBubbleStyle = { maxWidth: '85%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '10px 10px 10px 2px', padding: '10px 12px', fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5, marginBottom: 10, whiteSpace: 'pre-wrap' };
const userBubbleStyle = { maxWidth: '85%', marginLeft: 'auto', background: 'rgba(59,130,246,0.14)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '10px 10px 2px 10px', padding: '10px 12px', fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5, marginBottom: 10, whiteSpace: 'pre-wrap' };

function MindsetCard({ onOpen }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--text)', margin: '0 0 6px' }}>YOUR CORNER</p>
      <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 10px' }}>
        The hard part of investing is the part nobody talks about: down days, fear, the urge to bail. Talk it through with a coach who knows your situation.
      </p>
      <button onClick={onOpen} className="btn btn-blue" style={{ fontSize: 11, padding: '8px 16px' }}>TALK IT THROUGH</button>
    </div>
  );
}

function CoachChat({ onClose }) {
  const [view, setView] = useState('chat'); // 'chat' | 'history'
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]); // {role:'user'|'assistant', content}
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [convos, setConvos] = useState(null); // null = loading
  const [opening, setOpening] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, sending]);

  async function send(text) {
    const content = (text ?? input).trim();
    if (!content || sending) return;
    setMessages(m => [...m, { role: 'user', content }]);
    setInput('');
    setSending(true);
    try {
      const d = await api.ai.coachChat(content, conversationId);
      if (d?.conversationId) setConversationId(d.conversationId);
      setMessages(m => [...m, { role: 'assistant', content: d?.reply || "I'm here. Tell me a bit more?" }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'I could not reach you just now. Try again in a moment, I am still here.' }]);
    }
    setSending(false);
  }

  async function openHistory() {
    setView('history'); setConvos(null);
    try { const d = await api.ai.coachConversations(); setConvos(d?.conversations || []); }
    catch { setConvos([]); }
  }
  async function openConv(id) {
    setOpening(true); setView('chat');
    try { const d = await api.ai.coachConversation(id); setMessages(d?.messages || []); setConversationId(id); }
    catch {}
    setOpening(false);
  }
  function newConv() { setMessages([]); setConversationId(null); setView('chat'); }
  async function delConv(id, e) {
    e.stopPropagation();
    setConvos(cs => (cs || []).filter(c => c.id !== id));
    if (id === conversationId) newConv();
    try { await api.ai.deleteCoachConversation(id); } catch {}
  }

  const smallBtn = { background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 9px', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column', zIndex: 1000 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <button onClick={view === 'history' ? () => setView('chat') : onClose} style={{ background: 'none', border: 'none', color: 'var(--faint)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>‹ Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.5px', margin: 0 }}>YOUR COACH</p>
          <p style={{ fontSize: 9, color: 'var(--faint)', margin: '2px 0 0' }}>the mental side, just between us</p>
        </div>
        {view === 'chat' && (
          <>
            <button onClick={openHistory} style={smallBtn}>PAST</button>
            <button onClick={newConv} style={smallBtn}>+ NEW</button>
          </>
        )}
      </div>

      {view === 'history' ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          <button onClick={newConv} style={{ width: '100%', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: 7, padding: '10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.5px', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 12 }}>+ Start a new conversation</button>
          {convos === null ? (
            <p style={{ fontSize: 11, color: 'var(--faint)', textAlign: 'center', padding: 20 }}>Loading…</p>
          ) : convos.length === 0 ? (
            <p style={{ fontSize: 11, color: 'var(--faint)', textAlign: 'center', padding: 20, lineHeight: 1.5 }}>No past conversations yet. Everything you talk through is saved here for you.</p>
          ) : convos.map(c => (
            <div key={c.id} onClick={() => openConv(c.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 12px', marginBottom: 8, cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</p>
                {c.last && <p style={{ fontSize: 10, color: 'var(--faint)', margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.last}</p>}
              </div>
              <span style={{ fontSize: 9, color: 'var(--faint)', flexShrink: 0 }}>{timeAgo(c.updatedAt)}</span>
              <button onClick={(e) => delConv(c.id, e)} aria-label="Delete" style={{ background: 'none', border: 'none', color: 'var(--faint)', fontSize: 12, cursor: 'pointer', flexShrink: 0, padding: '2px 4px', fontFamily: 'inherit' }}>✕</button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            <div style={coachBubbleStyle}>
              I'm here. The hard part of investing, the fear, being down, not knowing what to do, is real, and you do not have to sit with it alone. What is on your mind?
            </div>
            {messages.map((m, i) => (
              <div key={i} style={m.role === 'user' ? userBubbleStyle : coachBubbleStyle}>{m.content}</div>
            ))}
            {(sending || opening) && <div style={{ ...coachBubbleStyle, color: 'var(--faint)', fontStyle: 'italic' }}>{opening ? 'opening…' : 'thinking…'}</div>}
            {messages.length === 0 && !sending && !opening && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 6 }}>
                {COACH_STARTERS.map(s => (
                  <button key={s} onClick={() => send(s)}
                    style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 14, padding: '7px 12px', fontSize: 11, color: 'var(--muted)', cursor: 'pointer', fontFamily: 'inherit' }}>{s}</button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, padding: '10px 16px 4px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
            <input className="input" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
              placeholder="Tell me what's weighing on you…" style={{ flex: 1, fontSize: 12 }} disabled={sending} />
            <button onClick={() => send()} disabled={!input.trim() || sending} className="btn btn-blue" style={{ fontSize: 11, padding: '8px 14px', opacity: (!input.trim() || sending) ? 0.5 : 1 }}>Send</button>
          </div>
          <p style={{ fontSize: 8.5, color: 'var(--faint)', textAlign: 'center', padding: '4px 16px 8px', margin: 0, lineHeight: 1.4, flexShrink: 0 }}>
            A trading mindset coach, not therapy or financial advice. If you are in crisis, call or text 988.
          </p>
        </>
      )}
    </div>
  );
}

// WHO YOU'RE BECOMING: the coach's honest growth read, the lead of Progress and the
// thing no tracker does. It interprets your behavior into a story, instead of
// handing you a chart to decode yourself.
function WhoYoureBecomingCard() {
  const [narrative, setNarrative] = useState(null); // null = loading, '' = none
  useEffect(() => {
    let alive = true;
    cachedFetch('progress_becoming', () => api.ai.becoming(), 30 * 60000)
      .then(d => { if (alive) setNarrative(d?.narrative || ''); })
      .catch(() => { if (alive) setNarrative(''); });
    return () => { alive = false; };
  }, []);
  if (narrative === null) return <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}><p style={{ fontSize: 11, color: 'var(--faint)', fontStyle: 'italic', margin: 0 }}>Reading your growth…</p></div>;
  if (!narrative) return null;
  return (
    <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--text)', margin: '0 0 8px' }}>WHO YOU'RE BECOMING</p>
      <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>{narrative}</p>
    </div>
  );
}

// COMPOSURE: a score for what you control, not what the market did. Climbs as you
// build the habits, so it can rise in a red market. Hides until there is real data.
const subColor = (v) => v >= 65 ? 'var(--green)' : v >= 40 ? 'var(--blue)' : 'var(--amber)';
function ComposureCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      cachedFetch('portfolio_attribution', () => api.portfolio.attribution(), 10 * 60000).catch(() => null),
      cachedFetch('portfolio_value', () => api.portfolio.value(), 60000).catch(() => ({ positions: [] })),
    ]).then(([attribution, val]) => { if (alive) setData({ attribution, positions: val?.positions || [] }); });
    return () => { alive = false; };
  }, []);
  if (!data) return null;
  const c = computeComposure(data);
  if (!c.hasEnough) return null;
  return (
    <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--text)', margin: 0 }}>COMPOSURE</p>
        <span style={{ fontSize: 11, color: subColor(c.score), fontWeight: 700 }}>{c.band}</span>
      </div>
      <p style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.5, margin: '0 0 12px' }}>
        What you control, not what the market did. This climbs as you build the habits, even in a red market.
      </p>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 32, fontWeight: 800, color: subColor(c.score), letterSpacing: '-1px', lineHeight: 1 }}>{c.score}</span>
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>/ 100</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {c.subs.map(s => (
          <div key={s.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: 'var(--text)', fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontSize: 10, color: 'var(--faint)' }}>{s.value}</span>
            </div>
            <div style={{ height: 5, background: 'var(--raised)', borderRadius: 3, overflow: 'hidden' }}>
              <div className="grow-in" style={{ width: `${s.value}%`, height: '100%', background: subColor(s.value), borderRadius: 3 }} />
            </div>
            <p style={{ fontSize: 9, color: 'var(--faint)', margin: '3px 0 0' }}>{s.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ PROGRESS OVERVIEW ============
// The cold-start-proof front page. Leads with where you are headed (the North Star
// trajectory, meaningful from your first dollar), then the mirror that fills in as
// you trade: your record, your edge, how you have grown, what to work on. Reflect
// sits up top so the next entry is one tap. Never an empty page: a brand new user
// still sees their goal and an honest "this fills in as you trade" below it.
function ProgressOverview({ onSeeStory, onReflect }) {
  // Account value (holdings + cash), not holdings only: the North Star measures
  // progress against everything they have, so sitting in cash still counts.
  const [accountValue, setAccountValue] = useState(0);
  const [coachOpen, setCoachOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    cachedFetch('portfolio_value', () => api.portfolio.value(), 60000)
      .then(d => { if (alive) setAccountValue(d?.accountValue ?? d?.totalValue ?? 0); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  // Home can send the user straight into the coach on a hard day (dispatched after
  // the tab switch, so this listener is mounted and ready to catch it).
  useEffect(() => {
    const open = () => setCoachOpen(true);
    window.addEventListener('coach_open', open);
    return () => window.removeEventListener('coach_open', open);
  }, []);
  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {/* The process grade leads: HOW you traded, derived from your decisions, no
          form to fill. This is what a pro tracks; we just compute it for them. */}
      <ProcessScorecard />
      {/* Who you are becoming: the story, not the numbers. */}
      <WhoYoureBecomingCard />
      {/* The human front door: talk the hard part through. */}
      <MindsetCard onOpen={() => setCoachOpen(true)} />
      {coachOpen && <CoachChat onClose={() => setCoachOpen(false)} />}
      {/* What you control, getting better even when the market is not. */}
      <ComposureCard />
      <NorthStarCard currentValue={accountValue} />
      <ReflectFeed onReflect={onReflect} />
      <PatternsView />
      <div style={{ padding: '0 16px 22px' }}>
        <button onClick={onSeeStory}
          style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 13px', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.5px' }}>SEE YOUR FULL STORY</span>
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>›</span>
        </button>
      </div>
    </div>
  );
}

// ============ REFLECT FEED ============
// The Journal's proactive front door. Pulls the few moments worth journaling right
// now from the rest of the app, a trade you closed but never reflected on, a thesis
// Outpost flagged as breaking, and offers each as one tap into a pre-seeded entry.
// Quiet (renders nothing) when there is nothing to reflect on.
function ReflectFeed({ onReflect }) {
  const [prompts, setPrompts] = useState([]);
  useEffect(() => {
    let alive = true;
    Promise.all([
      cachedFetch('portfolio_closed_trades', () => api.portfolio.closedTrades(), 5 * 60000).catch(() => ({ trades: [] })),
      cachedFetch('portfolio_thesis_watch', () => api.portfolio.thesisWatch(), 30 * 60000).catch(() => ({ watches: {} })),
      api.journal.reflectedIds().catch(() => ({ ids: [] })),
    ]).then(([ct, tw, rf]) => {
      if (!alive) return;
      setPrompts(buildReflectionPrompts({
        closes: ct?.trades || [],
        theses: Object.values(tw?.watches || {}),
        handled: rf?.ids || [],
      }));
    });
    return () => { alive = false; };
  }, []);

  if (!prompts.length) return null;
  const act = (p) => { onReflect(p); setPrompts(ps => ps.filter(x => x.id !== p.id)); };
  return (
    <div style={{ margin: '12px 16px 0', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.18)', borderRadius: 8, overflow: 'hidden' }}>
      <p style={{ fontSize: 9, fontWeight: 800, color: 'var(--blue)', letterSpacing: '1px', padding: '10px 12px 2px', margin: 0 }}>REFLECT</p>
      {prompts.map((p, i) => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
          <p style={{ flex: 1, fontSize: 11.5, color: 'var(--text)', lineHeight: 1.4, margin: 0 }}>{p.title}</p>
          <button onClick={() => act(p)}
            style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', padding: '6px 11px', borderRadius: 5, cursor: 'pointer', background: 'var(--blue)', color: '#fff', border: 'none', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            WRITE
          </button>
        </div>
      ))}
    </div>
  );
}

// ============ PATTERNS VIEW ============
// Behavior-outcome attribution. Shows the user's win rate cut by behavior:
// did you write a thesis, did you set a stop, did you log a reflection on
// close. The whole point is to make the framework MEASURABLE — the user can
// see "my win rate is X% with a thesis vs Y% without" and decide for themselves
// whether the discipline is paying off. Sub-5-trades shows an empty state
// telling them to come back when they have more data.
function PatternsView() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [adherence, setAdherence] = useState(null);
  const [closed, setClosed] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // Attribution drives the scorecard + behavior cuts; plan adherence adds the
    // honored/broke-stop and early-exit signals. Both feed the coach. Adherence
    // is best-effort: if it fails, the coach just leans on attribution.
    Promise.allSettled([api.portfolio.attribution(), api.portfolio.planAdherence(), api.portfolio.closedTrades()])
      .then(([attrR, adhR, closedR]) => {
        if (cancelled) return;
        if (attrR.status === 'fulfilled') { setData(attrR.value); setError(''); }
        else setError(attrR.reason?.error || 'Could not load patterns');
        setAdherence(adhR.status === 'fulfilled' ? adhR.value : null);
        setClosed(closedR.status === 'fulfilled' ? (closedR.value?.trades || []) : []);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>;
  }
  if (error) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <p style={{ fontSize: 12, color: 'var(--red)' }}>{error}</p>
      </div>
    );
  }
  if (!data?.ready) {
    const need = (data?.minRequired ?? 5) - (data?.totalTrades ?? 0);
    return (
      <div style={{ padding: '32px 20px', textAlign: 'center', flex: 1 }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 10 }}>Patterns</p>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 12 }}>Not enough data yet</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 320, margin: '0 auto 16px' }}>
          We need at least {data?.minRequired ?? 5} closed trades before we can show real patterns.
          {data?.totalTrades > 0 ? ` You're at ${data.totalTrades}. ${need} more to go.` : ' Add a position, write a thesis, and we\'ll start the count when you close it.'}
        </p>
        <p style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.55, maxWidth: 320, margin: '0 auto' }}>
          Once you have the data, this view will show your win rate cut by behavior. Thesis vs no thesis, stop set vs not, reflection logged vs not. So you can see what's actually working.
        </p>
      </div>
    );
  }

  const { patterns, totalTrades, execution, scorecard } = data;
  const coaching = buildCoaching({ attribution: data, adherence });
  const growth = buildGrowthArc(closed);
  const rows = [
    { key: 'thesis', label: 'Wrote a thesis', short: 'a thesis', explainer: 'You typed a "why I\'m buying" when you opened the position.' },
    { key: 'stopLoss', label: 'Set a stop loss', short: 'a stop', explainer: 'You committed to a price where you\'d exit.' },
    { key: 'priceTarget', label: 'Set a price target', short: 'a target', explainer: 'You knew where you\'d take profits before you bought.' },
    { key: 'reflection', label: 'Logged a reflection on close', short: 'a reflection', explainer: 'You wrote what played out or what you learned.' },
  ];
  // A behavior is only worth a full WITH-vs-WITHOUT row when there is an actual
  // split to compare. If you did it on every closed trade or none, both rows would
  // just restate your overall rate, four identical boxes that say nothing. Those
  // collapse into a single honest line instead.
  const hasSplit = (k) => (patterns[k]?.with?.count > 0) && (patterns[k]?.without?.count > 0);
  const comparableRows = rows.filter(r => hasSplit(r.key));
  const flatRows = rows.filter(r => !hasSplit(r.key));

  return (
    <div style={{ padding: '18px 16px' }}>
      {coaching.hasEnough && (coaching.fix || coaching.strength) && <CoachCard coaching={coaching} />}
      {scorecard && <ScorecardSummary s={scorecard} />}
      {growth.hasEnough && growth.lines.length > 0 && <GrowthArcCard lines={growth.lines} />}

      <div style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 4 }}>Your patterns</p>
        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55 }}>
          {comparableRows.length > 0
            ? `Across your ${totalTrades} closed trades. The number on the right is your win rate WITH each behavior vs WITHOUT it.`
            : `Across your ${totalTrades} closed trades.`}
        </p>
      </div>

      {comparableRows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {comparableRows.map(r => (
            <PatternRow key={r.key} row={r} pattern={patterns[r.key]} />
          ))}
        </div>
      )}

      {flatRows.length > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px', marginTop: comparableRows.length ? 10 : 0 }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55, margin: 0 }}>
            Nothing to compare yet on {flatRows.map(r => r.short).join(', ')}. You did each on all of your closed trades or none, so there is no split to measure. Mix it up and this will show whether it lifts your win rate.
          </p>
        </div>
      )}

      {/* Execution rating block. Different shape than the binary patterns
          above, so it gets its own row component. Only renders if the user
          has rated at least 3 closed trades. Tracks the CONTROLLABLE half
          of trading: did you follow your own plan, regardless of outcome. */}
      {execution && (
        <div style={{ marginTop: 14 }}>
          <ExecutionRatingBlock execution={execution} />
        </div>
      )}

      <p style={{ fontSize: 9, color: 'var(--faint)', textAlign: 'center', marginTop: 22, lineHeight: 1.55, letterSpacing: '0.3px' }}>
        Small samples are noisy. Patterns matter most after 20+ closed trades.
      </p>
    </div>
  );
}

// Top-line track record. Sits above the behavior cuts and answers the first
// question any trader asks: am I actually making money, and do I win more than
// I lose. The hold-time line is the behavioral tell most traders never see.
// Your growth arc: an honest then-vs-now read on how you've grown, so progress
// is visible. Only shows when there's something real to say.
function GrowthArcCard({ lines }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
      <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 10px' }}>How you've grown</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {lines.map(l => (
          <div key={l.metric} style={{ borderLeft: `2px solid ${l.improved ? 'var(--green)' : 'var(--amber)'}`, paddingLeft: 10 }}>
            <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.55, margin: 0 }}>{l.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// The coach's read: the one thing to work on, the one thing to keep doing.
// Synthesized from the same closed-trade data the cards below break down.
function CoachCard({ coaching }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
      <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 10px' }}>Your coach</p>
      {coaching.fix && (
        <div style={{ borderLeft: '2px solid var(--amber)', paddingLeft: 10, marginBottom: coaching.strength ? 12 : 0 }}>
          <p style={{ fontSize: 9, color: 'var(--amber)', fontWeight: 700, letterSpacing: '0.5px', margin: '0 0 3px' }}>WORK ON THIS</p>
          <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>{coaching.fix}</p>
        </div>
      )}
      {coaching.strength && (
        <div style={{ borderLeft: '2px solid var(--green)', paddingLeft: 10 }}>
          <p style={{ fontSize: 9, color: 'var(--green)', fontWeight: 700, letterSpacing: '0.5px', margin: '0 0 3px' }}>KEEP DOING</p>
          <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>{coaching.strength}</p>
        </div>
      )}
    </div>
  );
}

function ScorecardSummary({ s }) {
  if (!s) return null;

  const money = (n) => {
    if (n == null) return '—';
    const sign = n > 0 ? '+' : n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: abs >= 1000 ? 0 : 2 })}`;
  };
  const pnlColor = s.totalPnl > 0 ? 'var(--green)' : s.totalPnl < 0 ? 'var(--red)' : 'var(--text)';

  // Flag the classic mistake: riding losers longer than winners. Only call it
  // out with enough trades on both sides to mean something.
  const ridesLosersLonger = s.avgHoldWinners != null && s.avgHoldLosers != null
    && s.wins >= 2 && s.losses >= 2 && s.avgHoldLosers > s.avgHoldWinners * 1.3;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 14px 14px', marginBottom: 18 }}>
      <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 8 }}>Your track record</p>

      {/* Realized P&L hero */}
      <p style={{ fontSize: 28, fontWeight: 800, color: pnlColor, lineHeight: 1, letterSpacing: '-0.5px', margin: 0 }}>{money(s.totalPnl)}</p>
      <p style={{ fontSize: 10, color: 'var(--muted)', margin: '4px 0 14px' }}>
        realized across {s.totalTrades} closed trade{s.totalTrades === 1 ? '' : 's'}
      </p>

      {/* Headline stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        <ScoreStat label="Win rate" value={`${s.winRate.toFixed(0)}%`} sub={`${s.wins}W / ${s.losses}L`} />
        <ScoreStat
          label="Profit factor"
          value={s.profitFactor != null ? s.profitFactor.toFixed(2) : '—'}
          sub={s.profitFactor != null ? '$ won per $1 lost' : 'no losses yet'}
        />
        <ScoreStat label="Avg / trade" value={money(s.expectancy)} sub="realized" />
      </div>

      {/* Average winner vs loser, in plain words */}
      {(s.avgWin != null || s.avgLoss != null) && (
        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 8px' }}>
          Your average winner is {money(s.avgWin)}. Your average loser is {money(s.avgLoss)}.
        </p>
      )}

      {/* Hold-time behavioral tell */}
      {(s.avgHoldWinners != null || s.avgHoldLosers != null) && (
        <p style={{ fontSize: 11, color: ridesLosersLonger ? 'var(--amber)' : 'var(--muted)', lineHeight: 1.5, margin: 0 }}>
          You hold winners {s.avgHoldWinners ?? '—'} day{s.avgHoldWinners === 1 ? '' : 's'} on average, losers {s.avgHoldLosers ?? '—'} day{s.avgHoldLosers === 1 ? '' : 's'}.
          {ridesLosersLonger ? ' You ride losers longer than winners, the opposite of what most plans intend.' : ''}
        </p>
      )}

      {/* Best / worst */}
      {(s.best || s.worst) && (
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          {s.best && <ScoreBestWorst label="Best trade" t={s.best} />}
          {s.worst && <ScoreBestWorst label="Worst trade" t={s.worst} />}
        </div>
      )}
    </div>
  );
}

function ScoreStat({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 9px' }}>
      <p style={{ fontSize: 8.5, color: 'var(--faint)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 3 }}>{label}</p>
      <p style={{ fontSize: 14, color: 'var(--text)', fontWeight: 700, lineHeight: 1, margin: 0 }}>{value}</p>
      {sub && <p style={{ fontSize: 8.5, color: 'var(--muted)', margin: '3px 0 0' }}>{sub}</p>}
    </div>
  );
}

function ScoreBestWorst({ label, t }) {
  // Color by the actual return, not the best/worst label. If every trade is a
  // winner, the "worst" trade is still green, because it still made money.
  const pct = t.pnlPercent;
  const color = pct == null ? 'var(--faint)' : pct >= 0 ? 'var(--green)' : 'var(--red)';
  return (
    <div style={{ flex: 1, background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px' }}>
      <p style={{ fontSize: 8.5, color: 'var(--faint)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 3 }}>{label}</p>
      <p style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700, margin: 0 }}>{t.ticker || '—'}</p>
      <p style={{ fontSize: 10, color, fontWeight: 600, margin: '1px 0 0' }}>
        {pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : '—'}
      </p>
    </div>
  );
}

function ExecutionRatingBlock({ execution }) {
  const { rated, unrated, avgRating, distribution, whenHigh, whenLow, lift } = execution;
  const total = rated + unrated;
  const liftColor = lift == null ? 'var(--faint)'
    : lift > 0 ? 'var(--green)'
    : lift < 0 ? 'var(--red)'
    : 'var(--muted)';
  const liftText = lift == null
    ? 'Need more rated trades'
    : lift > 0 ? `+${lift.toFixed(1)}pp when execution was 4-5 vs 1-2`
    : lift < 0 ? `${lift.toFixed(1)}pp when execution was 4-5 vs 1-2`
    : 'No measurable lift';

  // Find the max bar value so distribution heights are relative.
  const maxBar = Math.max(1, ...distribution.map(d => d.count));

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 14px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 4 }}>
        <p style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>Execution rating</p>
        <p style={{ fontSize: 11, color: liftColor, fontWeight: 700, whiteSpace: 'nowrap' }}>{liftText}</p>
      </div>
      <p style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 10, lineHeight: 1.55 }}>
        The skill metric. How well you followed your own plan, regardless of the outcome. You've rated {rated} of {total} closes.
      </p>

      {/* Distribution bars. Five columns, height scales with frequency. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 4, alignItems: 'end', height: 50 }}>
        {distribution.map(d => (
          <div key={d.score} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
            <div style={{
              width: '100%',
              height: `${Math.max(4, (d.count / maxBar) * 100)}%`,
              background: d.score >= 4 ? 'rgba(34,197,94,0.55)'
                : d.score <= 2 ? 'rgba(239,68,68,0.45)'
                : 'rgba(59,130,246,0.45)',
              borderRadius: 3,
              transition: 'height 0.2s',
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4, marginBottom: 12 }}>
        {distribution.map(d => (
          <div key={d.score} style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 9, color: 'var(--faint)' }}>{d.score}</p>
            <p style={{ fontSize: 9, color: 'var(--muted)' }}>{d.count}</p>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <SplitBox label="Avg" agg={{ count: rated, winRate: null, avgPnlPercent: null }} accent customValue={avgRating.toFixed(1)} customUnit="/ 5" />
        <SplitBox label="When 4-5" agg={whenHigh} />
        <SplitBox label="When 1-2" agg={whenLow} />
      </div>
    </div>
  );
}

function PatternRow({ row, pattern }) {
  const w = pattern?.with;
  const wo = pattern?.without;
  const lift = pattern?.lift;

  // Color the lift: green = doing this helps you, red = doing this hurts,
  // neutral = no signal yet. Lift null when one side has <3 trades.
  const liftColor = lift == null ? 'var(--faint)'
    : lift > 0 ? 'var(--green)'
    : lift < 0 ? 'var(--red)'
    : 'var(--muted)';
  const liftText = lift == null
    ? 'Need more data'
    : lift > 0 ? `+${lift.toFixed(1)}pp win rate`
    : lift < 0 ? `${lift.toFixed(1)}pp win rate`
    : 'No measurable lift';

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 14px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
        <p style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{row.label}</p>
        <p style={{ fontSize: 11, color: liftColor, fontWeight: 700, whiteSpace: 'nowrap' }}>{liftText}</p>
      </div>
      <p style={{ fontSize: 10, color: 'var(--faint)', marginBottom: 10, lineHeight: 1.55 }}>{row.explainer}</p>
      <div style={{ display: 'flex', gap: 10 }}>
        <SplitBox label="With" agg={w} accent />
        <SplitBox label="Without" agg={wo} />
      </div>
    </div>
  );
}

function SplitBox({ label, agg, accent, customValue, customUnit }) {
  const count = agg?.count ?? 0;
  const wr = agg?.winRate;
  const pnl = agg?.avgPnlPercent;
  return (
    <div style={{
      flex: 1,
      background: accent ? 'rgba(59,130,246,0.08)' : 'var(--raised)',
      border: `1px solid ${accent ? 'rgba(59,130,246,0.3)' : 'var(--border)'}`,
      borderRadius: 6, padding: '8px 10px',
    }}>
      <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 14, color: 'var(--text)', fontWeight: 700, marginBottom: 2 }}>
        {customValue != null ? customValue : (wr != null ? `${wr.toFixed(0)}%` : '—')}
        {customUnit ? <span style={{ fontSize: 10, color: 'var(--faint)', fontWeight: 400, marginLeft: 2 }}>{customUnit}</span> : null}
      </p>
      <p style={{ fontSize: 9, color: 'var(--muted)' }}>
        {count} trade{count === 1 ? '' : 's'}
        {customValue == null && pnl != null && count > 0 ? ` · avg ${pnl > 0 ? '+' : ''}${pnl.toFixed(1)}%` : ''}
      </p>
    </div>
  );
}

// ============ LIST ITEM ============

function NoteListItem({ note, onOpen }) {
  const when = timeAgo(note.updated_at);
  const preview = note.preview?.trim() || 'Empty note';

  return (
    <button
      onClick={onOpen}
      style={{
        textAlign: 'left',
        background: 'var(--raised)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '11px 13px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {note.title || 'Untitled'}
        </span>
        <span style={{ fontSize: 9, color: 'var(--faint)', flexShrink: 0 }}>{when}</span>
      </div>
      <p style={{
        fontSize: 10,
        color: 'var(--muted)',
        lineHeight: 1.5,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        whiteSpace: 'pre-wrap',
      }}>
        {preview}
      </p>
    </button>
  );
}

// ============ EDITOR ============

function NoteEditor({ note, onClose, onDelete, showToast, ownedTickers, watchTickers, onTickerTap }) {
  const [title, setTitle] = useState(note.title || '');
  const [content, setContent] = useState(note.content || '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef(null);

  // Union of owned + watched tickers is what we'll linkify. Owned ones get a
  // marker so the user can tell "I hold this" from "I'm watching this" at a
  // glance. Recomputed only when the source sets change.
  const knownSet = useMemo(() => {
    const s = new Set(ownedTickers || []);
    for (const t of (watchTickers || [])) s.add(t);
    return s;
  }, [ownedTickers, watchTickers]);

  // Detect known tickers mentioned in the body. Live as the user types, but
  // cheap: a single regex pass plus a set lookup, memoized on content.
  const mentioned = useMemo(
    () => detectKnownTickers(content, knownSet),
    [content, knownSet]
  );

  // Stabilize showToast
  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);

  // Latest-value refs so the unmount handler doesn't fire-and-forget stale data.
  // Without these, a user typing right up to unmount would lose their last edits
  // (the cleanup closure captured the props/state at mount time only).
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  useEffect(() => { titleRef.current = title; contentRef.current = content; });

  // Mark dirty whenever the user edits
  useEffect(() => {
    dirtyRef.current = true;
  }, [title, content]);

  // Debounced autosave — 800ms after last keystroke
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (dirtyRef.current) persist();
    }, 800);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content]);

  // Save one more time on unmount if dirty — uses refs to capture latest values.
  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        // Fire-and-forget final save
        api.journal.updateNote(note.id, { title: titleRef.current || 'Untitled', content: contentRef.current }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persist() {
    setSaving(true);
    try {
      await api.journal.updateNote(note.id, {
        title: title.trim() || 'Untitled',
        content,
      });
      dirtyRef.current = false;
      setSavedAt(Date.now());
    } catch (err) {
      showToastRef.current?.(err.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Editor header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={onClose}
          style={{
            background: 'var(--raised)',
            border: '1px solid var(--border)',
            borderRadius: 5,
            padding: '6px 10px',
            color: 'var(--muted)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: 'inherit',
          }}
        >
          ← BACK
        </button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 9, color: 'var(--faint)', letterSpacing: '0.8px', fontWeight: 600 }}>
          {saving ? 'SAVING…' : savedAt ? 'SAVED' : ''}
        </div>
        <button
          onClick={onDelete}
          style={{
            background: 'transparent',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 5,
            padding: '6px 10px',
            color: '#fca5a5',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.8px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          DELETE
        </button>
      </div>

      {/* Title input */}
      <div style={{ padding: '14px 16px 6px', flexShrink: 0 }}>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (dirtyRef.current) persist(); }}
          placeholder="Untitled"
          maxLength={80}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text)',
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: '0.3px',
            fontFamily: 'inherit',
            padding: 0,
          }}
        />
      </div>

      {/* Mentioned tickers — auto-detected from the body, tap to ask the agent.
          Owned names get a filled dot, watched names a hollow one. Hidden when
          the note mentions nothing the user actually owns or watches. */}
      {mentioned.length > 0 && (
        <div style={{ padding: '2px 16px 8px', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--faint)', letterSpacing: '1px', marginRight: 2 }}>MENTIONED</span>
          {mentioned.map(t => {
            const owned = (ownedTickers || new Set()).has(t);
            return (
              <button
                key={t}
                onClick={() => onTickerTap?.(t, owned)}
                title={owned ? `You hold ${t} — ask the agent about your position` : `Ask the agent about ${t}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '3px 9px', borderRadius: 999,
                  background: 'var(--blue-dim)', border: '0.5px solid rgba(59,130,246,0.3)',
                  color: 'var(--blue)', fontSize: 10, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.3px',
                }}
              >
                <span style={{
                  width: 5, height: 5, borderRadius: '50%',
                  background: owned ? 'var(--green)' : 'transparent',
                  border: owned ? 'none' : '1px solid var(--faint)',
                  flexShrink: 0,
                }} />
                {t}
              </button>
            );
          })}
        </div>
      )}

      {/* Content textarea — fills remaining space */}
      <div style={{ flex: 1, padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          onBlur={() => { if (dirtyRef.current) persist(); }}
          placeholder="Start writing..."
          maxLength={50000}
          style={{
            flex: 1,
            width: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            resize: 'none',
            color: 'var(--text)',
            fontSize: 12,
            lineHeight: 1.6,
            fontFamily: 'inherit',
            padding: 0,
          }}
        />
      </div>
    </div>
  );
}

// ============ HELPERS ============

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ============ TIMELINE VIEW (Phase 3) ============
//
// The user's investing story — every meaningful event in one chronological
// feed, with their own writing surfaced as pull quotes. Treat the user's
// words like the texture of the page, not flattened database rows.

const SOURCE_LABEL = {
  agent: 'AGENT CHAT',
  position_open: 'POSITION OPENED',
  position_add: 'ADDED TO POSITION',
  position_close: 'POSITION CLOSED',
  thesis: 'THESIS WRITTEN',
  journal: 'JOURNAL NOTE',
  deploy_cash: 'DEPLOYED CASH',
};
const SOURCE_COLOR = {
  agent: '#a78bfa',          // soft violet — conversations
  position_open: 'var(--green)',
  position_add: '#34d399',   // teal-green for building or trimming a position
  position_close: 'var(--amber)',
  thesis: 'var(--blue)',
  journal: 'var(--muted)',
  deploy_cash: '#38bdf8',    // soft cyan — deploy moments
};

const SOURCE_FILTER_OPTIONS = [
  { id: 'all', label: 'ALL', sources: ['agent', 'position_open', 'position_add', 'position_close', 'thesis', 'journal', 'deploy_cash'] },
  { id: 'positions', label: 'POSITIONS', sources: ['position_open', 'position_add', 'position_close', 'thesis'] },
  { id: 'chats', label: 'CHATS', sources: ['agent'] },
  { id: 'notes', label: 'NOTES', sources: ['journal'] },
  { id: 'deploys', label: 'DEPLOYS', sources: ['deploy_cash'] },
];

function TimelineView({ showToast }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [ticker, setTicker] = useState('');
  const [topic, setTopic] = useState('');
  const [debouncedTopic, setDebouncedTopic] = useState('');
  const [knownTickers, setKnownTickers] = useState([]);

  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);

  // Debounce free-text topic search — don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTopic(topic.trim()), 350);
    return () => clearTimeout(t);
  }, [topic]);

  // Load timeline whenever filters change. Re-derives known tickers from
  // current events so the ticker dropdown reflects what the user actually has.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const sources = SOURCE_FILTER_OPTIONS.find(o => o.id === filter)?.sources;
    api.journal.timeline({
      ticker: ticker || undefined,
      topic: debouncedTopic || undefined,
      sources,
      limit: 80,
    })
      .then(d => {
        if (cancelled) return;
        const ev = d.events || [];
        setEvents(ev);
        // Update known tickers set ONLY when we're showing all events with no
        // ticker filter, so the dropdown doesn't shrink after filtering.
        if (!ticker && filter === 'all' && !debouncedTopic) {
          const set = new Set();
          ev.forEach(e => e.ticker && set.add(e.ticker));
          setKnownTickers([...set].sort());
        }
      })
      .catch(err => showToastRef.current?.(err.error || 'Timeline unavailable', 'error'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, debouncedTopic, filter]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header — short intro */}
      <div style={{ padding: '14px 16px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>YOUR STORY</p>
        <p style={{ fontSize: 10, color: 'var(--faint)', marginTop: 3, lineHeight: 1.5 }}>
          Every position, conversation, and note — in one chronological feed. The longer you use Outpost, the richer this gets.
        </p>
      </div>

      {/* Filter bar */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Search input */}
        <input
          className="input"
          placeholder="Search your own writing…"
          value={topic}
          onChange={e => setTopic(e.target.value)}
          style={{ fontSize: 11, padding: '7px 10px' }}
        />
        {/* Source pills + ticker dropdown */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {SOURCE_FILTER_OPTIONS.map(o => (
            <button
              key={o.id}
              onClick={() => setFilter(o.id)}
              style={{
                fontSize: 9, padding: '4px 9px', borderRadius: 3,
                background: filter === o.id ? 'var(--blue)' : 'transparent',
                color: filter === o.id ? '#fff' : 'var(--faint)',
                border: `1px solid ${filter === o.id ? 'var(--blue)' : 'var(--border)'}`,
                cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '0.6px',
                fontWeight: 700,
              }}
            >{o.label}</button>
          ))}
          {knownTickers.length > 0 && (
            <select
              value={ticker}
              onChange={e => setTicker(e.target.value)}
              style={{
                fontSize: 10, padding: '4px 8px', borderRadius: 3,
                background: ticker ? 'var(--blue)' : 'transparent',
                color: ticker ? '#fff' : 'var(--faint)',
                border: `1px solid ${ticker ? 'var(--blue)' : 'var(--border)'}`,
                fontFamily: 'inherit', cursor: 'pointer', letterSpacing: '0.6px',
                fontWeight: 700, appearance: 'none', paddingRight: 16,
              }}
            >
              <option value="">ALL TICKERS</option>
              {knownTickers.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {(ticker || debouncedTopic || filter !== 'all') && (
            <button
              onClick={() => { setTicker(''); setTopic(''); setFilter('all'); }}
              style={{
                fontSize: 9, padding: '4px 9px', borderRadius: 3,
                background: 'transparent', color: 'var(--faint)',
                border: '1px solid var(--border)', cursor: 'pointer',
                fontFamily: 'inherit', letterSpacing: '0.6px', marginLeft: 'auto',
              }}
            >CLEAR ALL</button>
          )}
        </div>
      </div>

      {/* Feed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 24px' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
            <Spinner />
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            title={ticker || debouncedTopic || filter !== 'all' ? 'Nothing matches that filter' : 'Your timeline is empty'}
            subtitle={
              ticker || debouncedTopic || filter !== 'all'
                ? 'Try clearing the filters above, or pick a different ticker.'
                : 'Open a position with a thesis, talk to the agent about a stock, or save a journal note. Everything you write will end up here.'
            }
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {events.map(ev => <TimelineEntry key={ev.id} ev={ev} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One row in the Timeline feed.
 * Layout: [date column on the left | content column on the right]
 * Pull quotes (the user's own writing) are styled distinctly — italic +
 * left border in the source color — so the user's voice feels like the
 * texture of the page.
 */
function TimelineEntry({ ev }) {
  const d = new Date(ev.date);
  const dateLine = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const yearLine = d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() : '';
  const sourceColor = SOURCE_COLOR[ev.source] || 'var(--faint)';
  const sourceLabel = (ev.source === 'position_add' && ev.meta?.kind === 'trim')
    ? 'TRIMMED POSITION'
    : (SOURCE_LABEL[ev.source] || ev.source.toUpperCase());

  // Outcome chip on closed positions
  let outcomeChip = null;
  if (ev.source === 'position_close' && ev.outcome) {
    const c = ev.outcome === 'win' ? 'var(--green)' : ev.outcome === 'loss' ? 'var(--red)' : 'var(--faint)';
    const lbl = ev.outcome === 'win' ? 'W' : ev.outcome === 'loss' ? 'L' : '—';
    outcomeChip = { color: c, label: lbl };
  }

  return (
    <div style={{ display: 'flex', gap: 12, paddingTop: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
      {/* Date column */}
      <div style={{ flexShrink: 0, width: 56, textAlign: 'right', paddingTop: 2 }}>
        <p style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, letterSpacing: '0.3px' }}>{dateLine}</p>
        {yearLine && <p style={{ fontSize: 9, color: 'var(--faint)', marginTop: 1 }}>{yearLine}</p>}
      </div>

      {/* Content column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Source label + ticker + outcome chip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, color: sourceColor,
            letterSpacing: '0.6px', padding: '1px 5px', borderRadius: 3,
            background: `${sourceColor}14`, border: `1px solid ${sourceColor}33`,
          }}>{sourceLabel}</span>
          {ev.ticker && (
            <span style={{ fontSize: 10, color: 'var(--text)', fontWeight: 700, letterSpacing: '0.3px' }}>
              {ev.ticker}
            </span>
          )}
          {outcomeChip && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: outcomeChip.color,
              padding: '1px 4px', borderRadius: 3, letterSpacing: '0.4px',
              background: outcomeChip.color === 'var(--green)' ? 'rgba(34,197,94,0.12)' : outcomeChip.color === 'var(--red)' ? 'rgba(239,68,68,0.12)' : 'transparent',
              border: `1px solid ${outcomeChip.color === 'var(--green)' ? 'rgba(34,197,94,0.3)' : outcomeChip.color === 'var(--red)' ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
            }}>{outcomeChip.label}</span>
          )}
          {ev.source === 'position_close' && ev.pnl != null && (
            <span style={{ fontSize: 10, color: ev.pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700, marginLeft: 'auto' }}>
              {ev.pnl >= 0 ? '+' : ''}${Math.abs(ev.pnl).toFixed(0)}
              {ev.holdDays != null && <span style={{ color: 'var(--faint)', fontWeight: 400, marginLeft: 4, fontSize: 9 }}>· {ev.holdDays}d</span>}
            </span>
          )}
        </div>

        {/* Title */}
        <p style={{ fontSize: 12, color: 'var(--text)', fontWeight: 500, lineHeight: 1.4, marginBottom: ev.quote ? 6 : 0 }}>
          {ev.title}
        </p>

        {/* Pull quote — the user's own words, treated distinctly. */}
        {ev.quote && (
          <div style={{
            borderLeft: `2px solid ${sourceColor}66`,
            paddingLeft: 10, marginTop: 4, marginBottom: 2,
          }}>
            <p style={{
              fontSize: 11, color: 'var(--muted)', lineHeight: 1.55,
              fontStyle: 'italic', whiteSpace: 'pre-wrap',
            }}>{ev.quote}</p>
          </div>
        )}

        {/* Agent excerpt of the assistant's reply (when present, gives context to the chat) */}
        {ev.source === 'agent' && ev.context && ev.context !== ev.quote && (
          <p style={{ fontSize: 10, color: 'var(--faint)', marginTop: 4, lineHeight: 1.5 }}>
            {ev.context}
          </p>
        )}
      </div>
    </div>
  );
}
