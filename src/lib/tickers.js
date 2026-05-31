// Ticker detection for the frontend (journal notes today, more later).
//
// Mirrors extractTickersFromMessage in api/services/notices.js so note text
// and agent chat tokenize tickers the same way. It lives as its own frontend
// module because notices.js imports the Supabase client at the top and can't
// be pulled into the browser bundle. If you change the regex or the stopword
// list here, change it there too (and vice versa).

// Common all-caps tokens that aren't tickers. Cuts false positives in prose.
export const TICKER_STOPWORDS = new Set([
  'I', 'A', 'IT', 'IS', 'OK', 'NO', 'YES', 'IM', 'IVE', 'ITS', 'AM', 'PM',
  'CEO', 'CFO', 'IPO', 'ETF', 'NYSE', 'SEC', 'AI', 'EPS', 'PE', 'PEG',
  'ROI', 'YTD', 'YOY', 'YOLO', 'FOMO', 'BUY', 'SELL', 'HODL', 'WSB',
  'USA', 'US', 'UK', 'EU', 'TV', 'OS', 'IOS', 'API', 'URL', 'HTML',
  'CSS', 'JS', 'LOL', 'IDK', 'TBH', 'TLDR', 'IMO', 'IMHO', 'AKA',
  'ETC', 'TBD', 'FYI', 'ATH', 'ATL', 'RSI', 'MACD', 'EMA', 'SMA',
  'VWAP', 'ER', 'EX', 'OG',
]);

// Pull ticker-shaped tokens (2-5 letter ALL CAPS, minus stopwords) out of
// free text. De-duped so "NVDA NVDA NVDA" counts once. Preserves first-seen
// order so callers can render them in the order they appear.
export function extractTickers(text) {
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

// Given text and the set of tickers the user actually owns or watches, return
// only the detected tokens we can tie to that known set. Restricting to known
// tickers is what keeps precision high: prose is full of stray all-caps words
// (TODO, PLAN, CASH, NOTE) that look like tickers but aren't. We never want to
// turn one of those into a tappable "ask the agent about TODO" chip, so we only
// surface tokens that match something real in the user's book or watchlist.
export function detectKnownTickers(text, known) {
  const knownSet = known instanceof Set
    ? known
    : new Set((known || []).map(t => String(t).toUpperCase()));
  if (knownSet.size === 0) return [];
  return extractTickers(text).filter(t => knownSet.has(t));
}
