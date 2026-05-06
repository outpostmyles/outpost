// Save-to-Journal sheet. Opens when a user taps a bookmark icon anywhere
// (agent messages, briefs, analysis cards, etc.). Lets them pick an existing
// note to append into, or create a new one on the fly.
import { useState, useEffect, useRef } from 'react';
import { api } from '../../lib/api.js';
import { Modal, Spinner } from '../shared/UI.jsx';

// Note: previously stored a "last note" hint in localStorage, but it was never
// read back, and it had a small cross-user-leak risk on shared devices since
// it wasn't cleared on logout. Removed.

export default function SaveToJournalSheet({
  open,
  onClose,
  initialContent = '',
  showToast,
  // Legacy props (ignored — kept so existing callers don't break):
  // initialTicker, source, sourceRef, preferredSectionName
}) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('pick'); // 'pick' | 'new'
  const [newTitle, setNewTitle] = useState('');

  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; }, [showToast]);

  // Load notes whenever the sheet opens
  useEffect(() => {
    if (!open) return;
    setMode('pick');
    setNewTitle('');
    setLoading(true);
    api.journal.listNotes()
      .then(({ notes }) => setNotes(notes || []))
      .catch(err => showToastRef.current?.(err.error || 'Failed to load notes', 'error'))
      .finally(() => setLoading(false));
  }, [open]);

  async function appendToNote(noteId) {
    if (!initialContent?.trim()) {
      showToastRef.current?.('Nothing to save', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.journal.appendNote(noteId, initialContent.trim());
      const title = notes.find(n => n.id === noteId)?.title || 'note';
      showToastRef.current?.(`Saved to ${title}`, 'success');
      onClose();
    } catch (err) {
      showToastRef.current?.(err.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function createAndSave() {
    const title = newTitle.trim() || 'Untitled';
    if (!initialContent?.trim()) {
      showToastRef.current?.('Nothing to save', 'error');
      return;
    }
    setSaving(true);
    try {
      // Create the note with the content baked in (no separate append needed)
      const { note } = await api.journal.createNote({
        title,
        content: initialContent.trim(),
      });
      showToastRef.current?.(`Saved to ${note.title}`, 'success');
      onClose();
    } catch (err) {
      showToastRef.current?.(err.error || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Modal title="Save to Journal" onClose={onClose}>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><Spinner /></div>
      ) : mode === 'new' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--faint)', letterSpacing: '0.8px', display: 'block', marginBottom: 6 }}>
              NEW NOTE TITLE
            </label>
            <input
              autoFocus
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createAndSave()}
              placeholder="e.g. NVDA research"
              maxLength={80}
              style={{
                width: '100%',
                background: 'var(--raised)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '10px 12px',
                color: 'var(--text)',
                fontSize: 12,
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setMode('pick')}
              disabled={saving}
              style={{
                flex: 1,
                background: 'var(--raised)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '10px',
                color: 'var(--muted)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.8px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              ← BACK
            </button>
            <button
              onClick={createAndSave}
              disabled={saving}
              style={{
                flex: 2,
                background: 'var(--blue)',
                border: 'none',
                borderRadius: 6,
                padding: '10px',
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.8px',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {saving ? <Spinner size={14} /> : null}
              {saving ? 'SAVING…' : 'CREATE & SAVE'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Preview of what's being saved */}
          {initialContent && (
            <div style={{
              background: 'var(--raised)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '9px 11px',
              maxHeight: 90,
              overflow: 'hidden',
              position: 'relative',
            }}>
              <p style={{
                fontSize: 11,
                color: 'var(--muted)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {initialContent}
              </p>
            </div>
          )}

          <div style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.8px', fontWeight: 700, marginTop: 2 }}>
            SAVE TO NOTE
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
            {/* New note button always at top */}
            <button
              onClick={() => setMode('new')}
              disabled={saving}
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                background: 'transparent',
                border: '1px dashed var(--border)',
                borderRadius: 6,
                color: 'var(--blue)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.3px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              + New note
            </button>

            {notes.length === 0 && (
              <p style={{ fontSize: 10, color: 'var(--faint)', textAlign: 'center', padding: '12px 0' }}>
                No notes yet — create your first one above.
              </p>
            )}

            {notes.map(n => (
              <button
                key={n.id}
                onClick={() => appendToNote(n.id)}
                disabled={saving}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  background: 'var(--raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--text)',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.title || 'Untitled'}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--faint)', flexShrink: 0 }}>{timeAgo(n.updated_at)}</span>
                </div>
                {n.preview && (
                  <p style={{
                    fontSize: 10,
                    color: 'var(--muted)',
                    lineHeight: 1.4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {n.preview}
                  </p>
                )}
              </button>
            ))}
          </div>

          <button
            onClick={onClose}
            disabled={saving}
            style={{
              background: 'var(--raised)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '10px',
              color: 'var(--muted)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.8px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              marginTop: 4,
            }}
          >
            CANCEL
          </button>
        </div>
      )}
    </Modal>
  );
}

// ============ HELPERS ============

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

// ============ REUSABLE BOOKMARK BUTTON ============
// Drop this anywhere next to AI content to open the save sheet.
export function BookmarkButton({ onClick, size = 14, title = 'Save to Journal' }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 4,
        color: 'var(--faint)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
        transition: 'color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.color = 'var(--blue)'; e.currentTarget.style.background = 'rgba(59,130,246,0.08)'; }}
      onMouseLeave={e => { e.currentTarget.style.color = 'var(--faint)'; e.currentTarget.style.background = 'transparent'; }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
      </svg>
    </button>
  );
}
