// Deterministic enforcement of explicit numeric price limits in a screener query.
// Vague words ("cheap", "low price") are left to Claude's judgment, but an
// explicit dollar bound the user typed ("under $200", "over $50") is a hard fact
// we can check against the live price ourselves. Claude is good but not perfect
// at honoring a stated ceiling, so we enforce it in code: a screen titled
// "under $200" must never show a $269 stock. Pure and dependency-free.

const NUM = '(\\d[\\d,]*(?:\\.\\d+)?)';
const TAIL = '\\s*([a-z]+)?'; // a trailing word, so we can tell "$10 billion" (cap) from "$10" (price)
const CEIL_WORDS = 'under|below|less than|cheaper than|up to|no more than|maximum|max|<=|<';
const FLOOR_WORDS = 'over|above|more than|at least|no less than|minimum|min|>=|>';
// A dollar amount followed by one of these is a market cap, not a per-share price.
const MAGNITUDES = new Set(['k', 'm', 'b', 't', 'bn', 'mn', 'mm', 'thousand', 'million', 'billion', 'trillion']);

function boundFrom(q, words) {
  // (?<![a-z]) so a keyword only matches at a word start: "over $50" hits, but
  // "turnover $50" / "recover $50" do not falsely impose a floor. Symbol operators
  // (<, >, <=, >=) are unaffected by the letter lookbehind.
  const m = q.match(new RegExp(`(?<![a-z])(?:${words})\\s*\\$\\s*${NUM}${TAIL}`));
  if (!m) return null;
  if (MAGNITUDES.has((m[2] || '').toLowerCase())) return null; // market cap, different dimension
  const n = parseFloat(m[1].replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

/**
 * Parse an explicit dollar price bound from a query.
 * @returns {{ min: number|null, max: number|null }}
 */
export function parsePriceBound(query) {
  const q = String(query || '').toLowerCase();
  return { min: boundFrom(q, FLOOR_WORDS), max: boundFrom(q, CEIL_WORDS) };
}

/**
 * Drop results that violate an explicit dollar price bound in the query. If the
 * query has no such bound, results pass through untouched. A result with no
 * usable price is kept (we cannot verify it, so we do not silently drop it).
 */
export function applyPriceBound(query, results) {
  const { min, max } = parsePriceBound(query);
  const list = Array.isArray(results) ? results : [];
  if (min == null && max == null) return list;
  return list.filter(r => {
    const p = typeof r?.price === 'number' ? r.price : (r?.price != null ? parseFloat(r.price) : null);
    if (p == null || Number.isNaN(p)) return true; // unknown price -> cannot verify, keep
    if (max != null && p > max) return false;
    if (min != null && p < min) return false;
    return true;
  });
}
