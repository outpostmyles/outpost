// The living thesis watch: the Portfolio tab's reason to come back.
//
// An investor writes down WHY they own a name (entry_thesis) and, ideally, what
// would tell them they are wrong (reversal_condition). Everywhere else those
// words just sit in a box. Here, Outpost watches that specific reason every day
// against real news, fundamentals, and price action, and says whether it is
// strengthening, intact, weakening, or breaking, tied to the investor's own
// words. That is the thing an advisor cannot do between calls and a brokerage app
// does not even attempt: it tracks your reasoning, not just your money.
//
// Conservative by design (see the prompt): it says "intact" unless there is
// concrete evidence, so it is a signal, not a drama generator.
//
// Write-through cached in ai_cache (no migration). The cache key is per user and
// ticker; the stored value carries signatures of the thesis text and the latest
// news, so a fresh Claude judgment only happens when the thesis is edited, new
// material news lands, or the read ages out. Steady state is a free cache hit,
// which is what lets the route and the nightly pre-warm both lean on it.
import { supabase } from '../db.js';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { getStockNews, getHistoricalPrice } from './agentTools.js';
import { getFinancialsResilient, getRatiosResilient } from './fundamentalsCache.js';
import { recordClaudeUsage } from './aiUsage.js';

const anthropic = new Anthropic({ apiKey: config.anthropicKey });
const MODEL = 'claude-haiku-4-5-20251001';

export const VERDICTS = ['strengthening', 'intact', 'weakening', 'broken'];
// Higher = more it wants your attention. Used to rank thesis items in the feed.
const SEVERITY = { broken: 3, weakening: 2, intact: 1, strengthening: 0 };
const MAX_AGE_MS = 4 * 24 * 60 * 60 * 1000; // re-judge at least this often, news or not
const STALE_NEWS = 6;                       // headlines fed into a judgment

// ── Pure helpers (exported for tests) ──────────────────────────────────────

/** Tiny stable string hash. Deterministic, no crypto, good enough for cache sigs. */
export function hashStr(s) {
  let h = 0;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Signature of the user's reasoning, so editing the thesis invalidates the read. */
export function thesisSignature(thesis, reversal) {
  return hashStr(norm(thesis) + '|' + norm(reversal));
}

/** Signature of the latest news, so genuinely new headlines force a re-judge but
 *  reordering or refetching the same articles does not. */
export function newsSignature(articles) {
  const titles = (Array.isArray(articles) ? articles : [])
    .map(a => norm(a?.title)).filter(Boolean).sort().slice(0, STALE_NEWS);
  return hashStr(titles.join('|'));
}

/** Has this judgment aged past the forced-refresh window? */
export function isStale(evaluatedAt, now = Date.now(), maxAgeMs = MAX_AGE_MS) {
  const t = Date.parse(evaluatedAt);
  if (!Number.isFinite(t)) return true;
  return (now - t) > maxAgeMs;
}

/** Rank for the action feed: broken first, strengthening last. */
export function verdictSeverity(verdict) {
  return SEVERITY[verdict] ?? -1;
}

/** Parse + validate Claude's JSON. Returns a clean {verdict, headline, evidence}
 *  or null (fail closed: a junk response becomes no-watch, never a fake verdict). */
export function parseVerdict(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o; try { o = JSON.parse(m[0]); } catch { return null; }
  const verdict = String(o?.verdict || '').toLowerCase().trim();
  if (!VERDICTS.includes(verdict)) return null;
  const headline = String(o?.headline || '').trim().slice(0, 160);
  if (!headline) return null;
  const evidence = String(o?.evidence || '').trim().slice(0, 240);
  return { verdict, headline, evidence };
}

/** Build the judgment prompt. Pure + deterministic so it is testable: it must
 *  carry the user's thesis and reversal condition, fold in whatever evidence we
 *  have, and stay null-safe when fundamentals or news are missing. */
export function buildThesisPrompt({ ticker, name, thesis, reversal, priceLine, fundamentals, ratios, articles }) {
  const lines = [];
  lines.push(`Stock: ${ticker}${name ? ` (${name})` : ''}`);
  lines.push(`The investor's thesis (why they own it): "${String(thesis || '').trim()}"`);
  if (reversal && String(reversal).trim()) {
    lines.push(`What they said would tell them they are wrong: "${String(reversal).trim()}"`);
  }
  if (priceLine) lines.push(`Their position: ${priceLine}`);

  const fund = [];
  if (fundamentals?.marketCap) fund.push(`mcap ${fmtCap(fundamentals.marketCap)}`);
  const pe = ratios?.peRatio ?? fundamentals?.pe;
  if (pe) fund.push(`P/E ${Number(pe).toFixed(1)}`);
  if (ratios?.grossMargin != null) fund.push(`gross margin ${ratios.grossMargin}%`);
  if (ratios?.roe != null) fund.push(`ROE ${ratios.roe}%`);
  if (ratios?.debtToEquity != null) fund.push(`debt/equity ${ratios.debtToEquity}`);
  if (fund.length) lines.push(`Fundamentals: ${fund.join(', ')}`);

  const news = (Array.isArray(articles) ? articles : []).slice(0, STALE_NEWS)
    .map(a => `- ${a.title}${a.source ? ` (${a.source})` : ''}`).filter(l => l.length > 2);
  if (news.length) lines.push(`Recent news:\n${news.join('\n')}`);
  else lines.push('Recent news: none in the last while.');

  return (
    `You are watching whether the REASON an investor owns a stock is still valid. ` +
    `Be honest and conservative: if nothing material has changed, say "intact". Only say ` +
    `"weakening" or "broken" when there is concrete evidence against their specific reason, ` +
    `and only say "strengthening" when concrete evidence supports it. Do not manufacture drama, ` +
    `and do not treat a price move alone as proof the thesis changed.\n\n` +
    lines.join('\n') +
    `\n\nJudge the thesis against this evidence and tie your reasoning to THEIR words where you can. ` +
    `Return ONLY JSON, no prose:\n` +
    `{"verdict":"strengthening|intact|weakening|broken","headline":"one short line, max ~12 words, that a busy person reads first","evidence":"one concise sentence, max ~25 words, naming the single most important fact behind the verdict"}`
  );
}

function fmtCap(n) {
  if (!n || !Number.isFinite(n)) return '';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(0)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n}`;
}

/** A short "up 12% from cost, +5% past month" line, from data we already hold. */
export function priceLine({ currentPrice, avgCost, momentum1m }) {
  const bits = [];
  if (currentPrice > 0 && avgCost > 0) {
    const pnl = ((currentPrice - avgCost) / avgCost) * 100;
    bits.push(`${pnl >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(pnl))}% from cost`);
  }
  if (momentum1m != null && Number.isFinite(momentum1m)) {
    bits.push(`${momentum1m >= 0 ? '+' : ''}${Math.round(momentum1m)}% past month`);
  }
  return bits.join(', ');
}

// ── Cache (write-through in ai_cache) ──────────────────────────────────────

const keyFor = (userId, ticker) => `thesis_watch:${userId}:${String(ticker).toUpperCase()}`;

async function cacheRead(key) {
  try {
    const { data } = await supabase.from('ai_cache').select('result, created_at').eq('cache_key', key).maybeSingle();
    if (!data?.result) return null;
    return typeof data.result === 'string' ? JSON.parse(data.result) : data.result;
  } catch { return null; }
}

async function cacheWrite(key, value) {
  try {
    const payload = { cache_key: key, result: JSON.stringify(value), created_at: new Date().toISOString() };
    const { data: existing } = await supabase.from('ai_cache').select('id').eq('cache_key', key).maybeSingle();
    if (existing) await supabase.from('ai_cache').update(payload).eq('id', existing.id);
    else await supabase.from('ai_cache').insert(payload);
  } catch { /* best effort */ }
}

// ── The judgment ───────────────────────────────────────────────────────────

/** Call Claude once for a single thesis. Returns {verdict, headline, evidence} or null. */
export async function evaluateThesis(input) {
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400, // headroom so the JSON always closes (evidence never cut mid-word)
      messages: [{ role: 'user', content: buildThesisPrompt(input) }],
    });
    recordClaudeUsage({ feature: 'thesis_watch', model: msg.model, usage: msg.usage, userId: null });
    return parseVerdict(msg.content?.[0]?.text);
  } catch (e) {
    console.error('[ThesisWatch] eval failed:', e?.message);
    return null;
  }
}

/**
 * Get the live thesis watch for one holding, using the cache when the thesis and
 * news are unchanged and the read is fresh. `position` is { ticker, entry_thesis,
 * reversal_condition, currentPrice, avg_cost }. Returns the watch object or null
 * (no thesis, or judgment unavailable).
 */
export async function getThesisWatch(position, userId, { now = Date.now() } = {}) {
  const ticker = String(position?.ticker || '').toUpperCase().trim();
  const thesis = position?.entry_thesis;
  if (!ticker || !thesis || !String(thesis).trim()) return null;
  const reversal = position?.reversal_condition || '';
  const thesisSig = thesisSignature(thesis, reversal);

  // News drives "what changed", so fetch it first; it is the main re-judge trigger.
  // Track whether the fetch actually succeeded: a transient Polygon failure returns
  // no articles, which must NOT be mistaken for "the news changed to nothing" (that
  // would flip the signature and force a needless paid re-judge on every blip).
  let articles = [], newsOk = false;
  try { const n = await getStockNews({ ticker, limit: STALE_NEWS }); articles = n?.articles || []; newsOk = !n?.error; } catch {}
  const newsSig = newsSignature(articles);

  const key = keyFor(userId, ticker);
  const cached = await cacheRead(key);
  // Serve the cache when the thesis is unchanged and the read is fresh, and either
  // the news is unchanged OR the news fetch failed (ignore the news axis on a blip).
  if (cached && cached.thesisSig === thesisSig && !isStale(cached.evaluatedAt, now) && (cached.newsSig === newsSig || !newsOk)) {
    return shape(ticker, cached);
  }

  // Cold or changed: gather the rest of the evidence and judge.
  let fundamentals = null, ratios = null, momentum1m = null;
  try { fundamentals = await getFinancialsResilient(ticker); } catch {}
  try { ratios = await getRatiosResilient(ticker); } catch {}
  try {
    const monthAgo = new Date(now - 31 * 86400000).toISOString().split('T')[0];
    const h = await getHistoricalPrice({ ticker, from_date: monthAgo });
    if (h && !h.error) momentum1m = h.change_percent;
  } catch {}

  const verdict = await evaluateThesis({
    ticker,
    name: fundamentals?.companyName || null,
    thesis, reversal,
    priceLine: priceLine({ currentPrice: position?.currentPrice, avgCost: position?.avg_cost, momentum1m }),
    fundamentals, ratios, articles,
  });
  if (!verdict) return cached ? shape(ticker, cached) : null; // keep last good read if the call failed

  const value = { ...verdict, thesisSig, newsSig, evaluatedAt: new Date(now).toISOString() };
  await cacheWrite(key, value);
  return shape(ticker, value);
}

function shape(ticker, v) {
  return { ticker, verdict: v.verdict, headline: v.headline, evidence: v.evidence || '', asOf: v.evaluatedAt };
}

async function mapLimit(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  }
  return out;
}

/**
 * Thesis watches for every holding the user has written a thesis for, as a map
 * { TICKER: {verdict, headline, evidence, asOf} }. Bounded concurrency; one bad
 * ticker never sinks the rest. Shared by the route and the nightly pre-warm.
 */
export async function getThesisWatchesForUser(userId, positions, opts = {}) {
  const withThesis = (Array.isArray(positions) ? positions : [])
    .filter(p => p?.ticker && p?.entry_thesis && String(p.entry_thesis).trim());
  const results = await mapLimit(withThesis, 3, async (p) => {
    try { return await getThesisWatch(p, userId, opts); } catch { return null; }
  });
  const map = {};
  for (const w of results) if (w) map[w.ticker] = w;
  return map;
}

/**
 * Nightly pre-warm: refresh the thesis watch for every user who has written a
 * reason for at least one holding. This is what makes the feature "always on",
 * the verdicts are ready (and feed the morning read) whether or not the user
 * opened the app. Bounded across users; one user's failure never stops the rest.
 * Cheap in steady state since getThesisWatch only calls Claude when news or the
 * thesis actually changed.
 */
export async function refreshAllThesisWatches() {
  let rows = [];
  try {
    const r = await supabase
      .from('positions')
      .select('user_id, ticker, shares, avg_cost, entry_thesis, reversal_condition')
      .not('entry_thesis', 'is', null);
    rows = r.data || [];
  } catch (e) { console.error('[ThesisWatch] nightly load failed:', e?.message); return { users: 0, evaluated: 0 }; }

  const byUser = new Map();
  for (const p of rows) {
    if (!p.entry_thesis || !String(p.entry_thesis).trim()) continue;
    if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
    byUser.get(p.user_id).push(p);
  }

  let users = 0, evaluated = 0;
  await mapLimit([...byUser.entries()], 3, async ([userId, positions]) => {
    try { const m = await getThesisWatchesForUser(userId, positions); users++; evaluated += Object.keys(m).length; }
    catch (e) { console.error('[ThesisWatch] nightly refresh failed for a user:', e?.message); }
  });
  console.log(`[ThesisWatch] nightly refresh: ${evaluated} theses across ${users} users`);
  return { users, evaluated };
}
