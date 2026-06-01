// Client-side search over the journal notes list.
//
// The notes list payload carries each note's title and a preview (the first
// chunk of its body), so search runs instantly in the browser with no network
// round-trip per keystroke. We match against title + preview, case-insensitive.
//
// Multi-term queries use AND semantics: "aapl earnings" returns notes that
// contain BOTH "aapl" and "earnings" somewhere in their title or preview. That
// matches how people expect to narrow a search by adding words.

export function filterNotes(notes, query) {
  const list = Array.isArray(notes) ? notes : [];
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return list;
  const terms = q.split(/\s+/).filter(Boolean);
  return list.filter(n => {
    const hay = `${n?.title || ''} ${n?.preview || ''}`.toLowerCase();
    return terms.every(t => hay.includes(t));
  });
}
