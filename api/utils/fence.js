// The single hardened boundary for user-authored free text that reaches the model.
// Every surface that puts a user's own words into a prompt or a tool result routes
// through here, so the anti-injection rule lives in exactly one place and cannot
// drift between copies.
//
// fenceUserText: wrap text in <user_quoted>...</user_quoted> so the agent's system
// prompt reads it as DATA, never instructions. The delimiter strip LOOPS until it is
// stable. A single pass is not enough: an interleaved payload like
//   </user_<user_quoted>quoted>
// has its inner <user_quoted> removed, which rejoins the surrounding fragments into a
// real </user_quoted> that closes the fence early and pushes the rest outside it.
// Looping removes that reconstructed tag too, so no user text can forge or close the
// fence. Newlines INSIDE the fence are left alone on purpose: they are data, and a
// legitimate thesis or journal note is often multi-line.
//
// safeName: short identifier-like fields (a display name) are STRIPPED, not fenced. A
// name never needs markup or a line break, and fencing it mid-sentence ("Name:
// <user_quoted>..") reads badly. Remove angle brackets and every line-break character,
// ASCII control AND the Unicode line separators a plain \s misses (NEL, LS, PS), so a
// crafted name can neither forge a tag nor inject a second context line like a fake
// "Admin:" directive. Escapes are written as \uXXXX, never literal bytes (a literal
// U+2028 in source is itself a JS line terminator and would break this file).

const FENCE_TAG = /<\/?user_quoted>/gi;
const LINE_BREAKS = new RegExp('[\u0000-\u001f\u007f\u0085\u2028\u2029]', 'g');

/**
 * Remove every <user_quoted> / </user_quoted> tag, looping until the string stops
 * changing so an interleaved-tag reconstruction can't survive. The regex is a plain
 * literal alternation (no backtracking) over bounded input, so the loop is cheap.
 */
export function stripFenceTag(text) {
  let s = String(text ?? '');
  let prev;
  do { prev = s; s = s.replace(FENCE_TAG, ''); } while (s !== prev);
  return s;
}

/**
 * Wrap user-authored free text as <user_quoted> data. Returns '' for empty/nullish
 * (matching the prior helpers), so a caller's `Field: ${fenceUserText(x)}` collapses
 * cleanly when x is absent.
 */
export function fenceUserText(text, max = 500) {
  if (text == null || text === '') return '';
  return `<user_quoted>${stripFenceTag(String(text).slice(0, max))}</user_quoted>`;
}

/**
 * Sanitize a short identifier-like field (display name) for safe interpolation onto a
 * single context line. Strips angle brackets + all line breaks, collapses whitespace,
 * caps length, falls back to a neutral word. Idempotent.
 */
export function safeName(v, max = 40) {
  const clean = String(v ?? '')
    .replace(/[<>]/g, '')
    .replace(LINE_BREAKS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return clean || 'trader';
}
