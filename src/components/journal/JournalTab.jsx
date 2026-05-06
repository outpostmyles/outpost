// Journal — a list of named notes, like chat conversations.
// - List view: browse all notes, tap one to open
// - Editor view: edit title and content inline, auto-saves on blur / debounce
// - "+ New" creates a fresh note and opens it
// - Delete from inside the editor
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { Spinner, EmptyState } from '../shared/UI.jsx';

export default function JournalTab({ showToast }) {
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

  // ========== LIST VIEW ==========
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>JOURNAL</p>
          <p style={{ fontSize: 10, color: 'var(--faint)', marginTop: 3 }}>Your saved notes and ideas</p>
        </div>
        <button
          onClick={handleNewNote}
          style={{
            background: 'var(--blue)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 14px',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.8px',
            cursor: 'pointer',
          }}
        >
          + NEW NOTE
        </button>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
            <Spinner />
          </div>
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
