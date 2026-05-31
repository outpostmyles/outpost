// Match journal notes to a ticker for the "YOUR NOTES" section on a position
// card. Pure + testable: hand it note rows and a ticker, get back the notes
// that actually mention it.
//
// We reuse extractTickersFromMessage (the same tokenizer the journal chips and
// chat-mention detector use) so matching is consistent everywhere and precise:
//   * "AAPL" in the body matches AAPL
//   * lowercase "apple" never matches AAPL (tickers are ALL CAPS)
//   * "education" never matches CAT (whole-token, not substring)
// Title and content are both scanned, since a user often puts the ticker only
// in the title ("AAPL thoughts") or only in the body.
import { extractTickersFromMessage } from './notices.js';

export function filterNotesByTicker(notes, ticker) {
  const want = String(ticker || '').toUpperCase();
  if (!want) return [];
  return (notes || []).filter(n => {
    const text = `${n?.title || ''}\n${n?.content || ''}`;
    return extractTickersFromMessage(text).includes(want);
  });
}
