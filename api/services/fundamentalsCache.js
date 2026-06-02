// Resilience layer over FMP fundamentals. FMP's free tier is rate-limited, and
// when it is throttled getFinancials/getRatios return null, which leaves the
// dossier, the screener, and the agent's research answer with blanks ("Valuation
// Unknown"). That is the single biggest gap between "great" and "always has the
// answer".
//
// This is a write-through cache: every time FMP answers, we save the numbers; when
// it does not, we serve the most recent saved copy (stamped with when we got it)
// instead of a blank. Price stays live (that comes from Polygon, not here), so we
// are only ever serving slightly-stale slow-moving fundamentals, never a stale
// quote. Stored in the existing ai_cache table, so no migration is needed.
import { supabase } from '../db.js';
import { getFinancials, getRatios } from './fmp.js';

async function cacheRead(key) {
  try {
    const { data } = await supabase.from('ai_cache').select('result, created_at').eq('cache_key', key).maybeSingle();
    if (!data?.result) return null;
    const parsed = typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...parsed, _asOf: data.created_at }; // _asOf marks this as last-known, not live
  } catch { return null; }
}

async function cacheWrite(key, value) {
  try {
    const payload = { cache_key: key, result: JSON.stringify(value), created_at: new Date().toISOString() };
    const { data: existing } = await supabase.from('ai_cache').select('id').eq('cache_key', key).maybeSingle();
    if (existing) await supabase.from('ai_cache').update(payload).eq('id', existing.id);
    else await supabase.from('ai_cache').insert(payload);
  } catch { /* best effort: never let a cache write block or break the request */ }
}

async function resilient(prefix, ticker, fetchFn) {
  const T = String(ticker || '').toUpperCase().trim();
  if (!T) return null;
  const live = await fetchFn(T);              // FMP first (in-memory cached, never caches null)
  if (live) { cacheWrite(`${prefix}_${T}`, live); return live; } // refresh the saved copy, fire-and-forget
  return cacheRead(`${prefix}_${T}`);         // throttled or missing -> last-known copy, or null
}

/** getFinancials that survives an FMP outage by serving the last-known copy. */
export const getFinancialsResilient = (ticker) => resilient('fund', ticker, getFinancials);
/** getRatios that survives an FMP outage by serving the last-known copy. */
export const getRatiosResilient = (ticker) => resilient('ratios', ticker, getRatios);
