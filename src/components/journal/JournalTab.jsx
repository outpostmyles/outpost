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
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { Spinner, EmptyState } from '../shared/UI.jsx';

export default function JournalTab({ showToast }) {
  const [subTab, setSubTab] = useState('notes'); // 'notes' | 'timeline'
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openNote, setOpenNote] = useState(null); // full note object when editing

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

  // ========== EDITOR VIEW ==========
  if (openNote) {
    return (
      <NoteEditor
        note={openNote}
        onClose={handleCloseEditor}
        onDelete={() => handleDeleteNote(openNote.id)}
        showToast={showToast}
      />
    );
  }

  // ========== LIST VIEW (Notes sub-tab) or TIMELINE VIEW ==========
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Sub-tab navigation */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--surface)' }}>
        {[
          { id: 'notes', label: 'NOTES' },
          { id: 'timeline', label: 'TIMELINE' },
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

      {subTab === 'notes' ? (
        <>
          {/* Notes header */}
          <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>JOURNAL</p>
              <p style={{ fontSize: 10, color: 'var(--faint)', marginTop: 3 }}>Your saved notes and ideas</p>
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
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {notes.map(note => (
                  <NoteListItem key={note.id} note={note} onOpen={() => handleOpenNote(note.id)} />
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <TimelineView showToast={showToast} />
      )}
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

function NoteEditor({ note, onClose, onDelete, showToast }) {
  const [title, setTitle] = useState(note.title || '');
  const [content, setContent] = useState(note.content || '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef(null);

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
  position_close: 'POSITION CLOSED',
  thesis: 'THESIS WRITTEN',
  journal: 'JOURNAL NOTE',
  deploy_cash: 'DEPLOYED CASH',
};
const SOURCE_COLOR = {
  agent: '#a78bfa',          // soft violet — conversations
  position_open: 'var(--green)',
  position_close: 'var(--amber)',
  thesis: 'var(--blue)',
  journal: 'var(--muted)',
  deploy_cash: '#38bdf8',    // soft cyan — deploy moments
};

const SOURCE_FILTER_OPTIONS = [
  { id: 'all', label: 'ALL', sources: ['agent', 'position_open', 'position_close', 'thesis', 'journal', 'deploy_cash'] },
  { id: 'positions', label: 'POSITIONS', sources: ['position_open', 'position_close', 'thesis'] },
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
  const sourceLabel = SOURCE_LABEL[ev.source] || ev.source.toUpperCase();

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
