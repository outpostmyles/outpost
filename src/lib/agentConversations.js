// Group a flat list of agent messages into conversation summaries for the chat
// switcher. Pure and order-independent, so the route can load rows newest-first
// (to keep recent conversations from being truncated out under a row cap) without
// the grouping depending on that order.
//
// For each conversation: lastActivity is the NEWEST message (drives the
// most-recent-first sort), title is the EARLIEST non-empty message (the opener),
// and count is the number of messages seen. Messages with no conversation_id
// collapse into one '__legacy__' bucket (history from before conversations
// existed). Defensive against null rows and non-string content.
//
// The earlier inline version walked the rows in ascending order and overwrote
// lastActivity on every row; flipping the query to descending (the truncation
// fix) would have silently inverted the sort. Computing min/max here makes the
// result correct for any input order and pins that invariant under test.

const TITLE_MAX = 60;

export function groupConversations(rows, { legacyKey = '__legacy__' } = {}) {
  const byConv = new Map();
  for (const m of Array.isArray(rows) ? rows : []) {
    if (!m) continue;
    const key = m.conversation_id || legacyKey;
    const created = m.created_at || null;
    let c = byConv.get(key);
    if (!c) { c = { id: key, title: '', _titleAt: null, lastActivity: created, count: 0 }; byConv.set(key, c); }
    c.count++;
    if (created && (!c.lastActivity || created > c.lastActivity)) c.lastActivity = created; // newest wins
    const content = typeof m.content === 'string' ? m.content.trim() : '';
    if (content) {
      const at = created ?? ''; // ISO strings sort chronologically; null sorts first
      if (c._titleAt === null || at < c._titleAt) {
        c.title = content.slice(0, TITLE_MAX); // earliest non-empty message becomes the title
        c._titleAt = at;
      }
    }
  }
  return [...byConv.values()]
    .map(({ _titleAt, ...c }) => ({
      ...c,
      title: c.title || (c.id === legacyKey ? 'Earlier conversation' : 'New conversation'),
    }))
    .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
}
