// One shared style rule for every AI surface that produces user-facing prose.
//
// Outpost's voice is a real person texting a friend, and em-dashes / en-dashes
// read as "written by an AI". Before this, the no-dash instruction lived on only
// two prompts (the mindset coach and the "who you're becoming" read), so every
// other surface (the portfolio synthesis, the chat agent, deploy cash, the daily
// brief, per-stock analysis, the welcome) could and did emit them. This is the
// single rule, appended to the plain-text rules and the prose system prompts, so
// the wording cannot drift between surfaces and a new prompt inherits it by using
// the shared plain-text rule.
//
// We name the characters rather than print them so this file itself stays clean.
export const NO_DASH_RULE = 'Never use em-dashes or en-dashes (the long dash or the short dash) anywhere in your writing. Use commas, periods, colons, or shorter sentences instead. Ordinary hyphens inside words like long-term or risk-on are fine.';

// The plain-text rule, now carrying the no-dash rule, shared so the three copies
// that had drifted apart cannot diverge again.
export const PLAIN_TEXT_RULE = `CRITICAL: Respond in plain text only. No markdown, no asterisks, no bold, no italic, no headers, no bullet dashes. Use numbered lists (1. 2. 3.) only when necessary. Never use * or ** or # for formatting. ${NO_DASH_RULE}`;

/**
 * Trim AI output back to its last complete sentence. A short max_tokens cap can
 * cut a generated brief mid-sentence ("...watch SPY around 585 and cons"), which
 * reads as broken. If the text already ends on terminal punctuation we keep it;
 * otherwise we cut back to the last sentence that ended cleanly. A decimal point
 * inside a number is not a sentence end (it is not followed by whitespace), so
 * "$585.20" is never mistaken for a boundary. If there is no clean boundary at
 * all we return the text unchanged rather than emptying it.
 */
export function trimToLastSentence(text) {
  if (typeof text !== 'string') return text;
  const s = text.trim();
  if (!s) return s;
  if (/[.!?][)"'’”]?$/.test(s)) return s; // already ends cleanly
  let lastEnd = -1;
  const re = /[.!?][)"'’”]?(?=\s)/g;
  let m;
  while ((m = re.exec(s)) !== null) lastEnd = m.index + m[0].length;
  return lastEnd === -1 ? s : s.slice(0, lastEnd).trim();
}
