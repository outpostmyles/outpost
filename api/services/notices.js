// "Outpost noticed" — passive observations that surface on Home.
//
// The point: the app sometimes notices things the user is too close to see.
// A position they added 9 days ago that still has no thesis. A close they
// logged 3 days ago without a reflection. A ticker they've chatted about
// four times this week but haven't bought. None of these are alerts and
// none should be loud. They're soft "hey, by the way" nudges that turn the
// passive surface of the app into active discipline.
//
// Architecture:
//   * generateNotices(input)  — PURE function. Deterministic. Unit-tested.
//   * getNoticesForUser(uid)  — DB wrapper. Calls Supabase, builds the
//                                input shape, hands off to generateNotices.
// Splitting the two keeps the logic testable without mocking the DB.
//
// Returns at most MAX_NOTICES items, ranked by priority. The client decides
// which to render (dismissals tracked client-side in localStorage for now).
//
// Each notice has:
//   id        — stable string identifier for client-side dismiss tracking.
//   severity  — 'high' | 'medium' | 'low' for visual weight.
//   text      — full sentence, friend-voice.
//   cta       — { label, action, ...payload } where action is one of:
//                'open_close_reflection'  { ticker, closedTradeId }
//                'add_thesis'             { positionId, ticker }
//                'look_at_ticker'         { ticker }
import { supabase } from '../db.js';

const MAX_NOTICES = 3;
const TICKER_CHAT_THRESHOLD = 3;   // mention N+ times in 7 days to surface
const NO_THESIS_AGE_DAYS = 7;      // surface when a thesis-less position is older than this
const NO_REFLECTION_AGE_DAYS = 2;  // surface a missing reflection this many days after close

// Common all-caps tokens that aren't tickers. Used by the chat-mention
// detector to cut false positives.
export const TICKER_STOPWORDS = new Set([
  'I', 'A', 'IT', 'IS', 'OK', 'NO', 'YES', 'IM', 'IVE', 'ITS', 'AM', 'PM',
  'CEO', 'CFO', 'IPO', 'ETF', 'NYSE', 'SEC', 'AI', 'EPS', 'PE', 'PEG',
  'ROI', 'YTD', 'YOY', 'YOLO', 'FOMO', 'BUY', 'SELL', 'HODL', 'WSB',
  'USA', 'US', 'UK', 'EU', 'TV', 'OS', 'IOS', 'API', 'URL', 'HTML',
  'CSS', 'JS', 'LOL', 'IDK', 'TBH', 'TLDR', 'IMO', 'IMHO', 'AKA',
  'ETC', 'TBD', 'FYI', 'ATH', 'ATL', 'RSI', 'MACD', 'EMA', 'SMA',
  'VWAP', 'ER', 'EX', 'OG',
]);

// Extracts ticker-shaped tokens from a chat message. 1-5 letter ALL CAPS
// tokens, excluding the stopword list. De-duped within a single message
// so "NVDA NVDA NVDA" in one rant still counts once.
export function extractTickersFromMessage(text) {
  if (!text || typeof text !== 'string') return [];
  const TICKER_REGEX = /\b([A-Z]{1,5})\b/g;
  const seen = new Set();
  let match;
  while ((match = TICKER_REGEX.exec(text)) !== null) {
    const tok = match[1];
    if (tok.length < 2 || TICKER_STOPWORDS.has(tok)) continue;
    seen.add(tok);
  }
  return Array.from(seen);
}

/**
 * PURE function. Generates notices from already-fetched data.
 * Takes a `now` parameter so age calculations are deterministic in tests.
 *
 * Input shape:
 *   {
 *     closedTrades: [{ id, ticker, pnl, closed_at, thesis_played_out,
 *                       reflection_what_happened, reflection_lesson,
 *                       exit_reflection }, ...]
 *     positions:    [{ id, ticker, entry_thesis, created_at, purchased_at }, ...]
 *     messages:     [{ content }, ...]   user-role agent messages, last 7 days
 *     watchlist:    [{ ticker }, ...]
 *     now:          Date  (defaults to new Date(), override in tests)
 *   }
 *
 * Output: top MAX_NOTICES candidates sorted by priority descending.
 */
export function generateNotices({ closedTrades = [], positions = [], messages = [], watchlist = [], now = new Date() } = {}) {
  const candidates = [];
  const ownedOrRecentlyClosedTickers = new Set();
  const watchedSet = new Set((watchlist || []).map(w => (w.ticker || '').toUpperCase()).filter(Boolean));
  const nowMs = now.getTime();

  // ─── Closes without a reflection ─────────────────────────────────────────
  for (const t of (closedTrades || [])) {
    if (!t?.ticker) continue;
    ownedOrRecentlyClosedTickers.add(t.ticker);
    const hasReflection = (t.reflection_what_happened?.trim() || t.reflection_lesson?.trim() || t.exit_reflection?.trim());
    const hasOutcome = !!t.thesis_played_out;
    if (hasReflection || hasOutcome) continue;
    const ageDays = Math.floor((nowMs - new Date(t.closed_at).getTime()) / 86400000);
    if (ageDays < NO_REFLECTION_AGE_DAYS) continue;
    const pnlText = t.pnl != null
      ? (t.pnl > 0 ? `+$${Math.round(t.pnl)}` : `-$${Math.round(Math.abs(t.pnl))}`)
      : '';
    candidates.push({
      id: `close_no_reflection_${t.id}`,
      severity: 'high',
      text: `You closed ${t.ticker}${pnlText ? ` (${pnlText})` : ''} ${ageDays} day${ageDays === 1 ? '' : 's'} ago without writing what happened. The lesson is the asset, not the trade.`,
      cta: { label: 'Log it', action: 'open_close_reflection', closedTradeId: t.id, ticker: t.ticker },
      _priority: 100 + ageDays,
    });
  }

  // ─── Active positions with no thesis ─────────────────────────────────────
  for (const p of (positions || [])) {
    if (!p?.ticker) continue;
    ownedOrRecentlyClosedTickers.add(p.ticker);
    if (p.entry_thesis && p.entry_thesis.trim().length > 0) continue;
    const refDate = p.purchased_at || p.created_at;
    if (!refDate) continue;
    const ageDays = Math.floor((nowMs - new Date(refDate).getTime()) / 86400000);
    if (ageDays < NO_THESIS_AGE_DAYS) continue;
    candidates.push({
      id: `no_thesis_${p.id}`,
      severity: 'medium',
      text: `${p.ticker} has been in your book for ${ageDays} day${ageDays === 1 ? '' : 's'} without a thesis. Takes 30 seconds. Future you will be glad you wrote it.`,
      cta: { label: 'Write it', action: 'add_thesis', positionId: p.id, ticker: p.ticker },
      _priority: 50 + Math.min(ageDays, 30),
    });
  }

  // ─── Tickers mentioned in chat but not owned and not watched ─────────────
  const counts = new Map();
  for (const m of (messages || [])) {
    const tickers = extractTickersFromMessage(m.content);
    for (const t of tickers) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  for (const [ticker, count] of counts.entries()) {
    if (count < TICKER_CHAT_THRESHOLD) continue;
    if (ownedOrRecentlyClosedTickers.has(ticker)) continue;
    if (watchedSet.has(ticker)) continue;
    candidates.push({
      id: `chat_mention_${ticker}`,
      severity: 'low',
      text: `You've talked about ${ticker} ${count} times this week but you don't own it. Worth a closer look?`,
      cta: { label: 'Look closer', action: 'look_at_ticker', ticker },
      _priority: 10 + count,
    });
  }

  candidates.sort((a, b) => b._priority - a._priority);
  return candidates.slice(0, MAX_NOTICES).map(c => {
    const { _priority, ...rest } = c;
    return rest;
  });
}

// DB-backed wrapper. Pulls everything generateNotices needs, then hands off.
export async function getNoticesForUser(userId) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  const [closedRes, positionsRes, messagesRes, watchlistRes] = await Promise.allSettled([
    supabase.from('closed_trades')
      .select('id, ticker, pnl, closed_at, thesis_played_out, reflection_what_happened, reflection_lesson, exit_reflection')
      .eq('user_id', userId)
      .gte('closed_at', thirtyDaysAgo)
      .order('closed_at', { ascending: false })
      .limit(20),
    supabase.from('positions')
      .select('id, ticker, entry_thesis, created_at, purchased_at')
      .eq('user_id', userId)
      .limit(50),
    supabase.from('agent_messages')
      .select('content')
      .eq('user_id', userId)
      .eq('role', 'user')
      .gte('created_at', sevenDaysAgo)
      .limit(60),
    supabase.from('watchlist')
      .select('ticker')
      .eq('user_id', userId),
  ]);

  return generateNotices({
    closedTrades: closedRes.status === 'fulfilled' ? (closedRes.value.data ?? []) : [],
    positions: positionsRes.status === 'fulfilled' ? (positionsRes.value.data ?? []) : [],
    messages: messagesRes.status === 'fulfilled' ? (messagesRes.value.data ?? []) : [],
    watchlist: watchlistRes.status === 'fulfilled' ? (watchlistRes.value.data ?? []) : [],
  });
}
