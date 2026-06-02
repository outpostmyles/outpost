/**
 * Custom screeners — the user describes what they want to find in plain English
 * ("AI infrastructure stocks"), and Outpost finds + vets matches on a schedule.
 *
 * The pipeline is the same fail-closed shape as Bargain Radar:
 *   1. Claude proposes candidate tickers that genuinely fit the query.
 *   2. Enrich each with LIVE price + fundamentals (drops hallucinated/delisted
 *      tickers that have no real quote, so results are grounded in today).
 *   3. Claude vets each candidate against the live data + the query, dropping
 *      what doesn't hold up and writing one line on why each survivor fits.
 *   4. applyScreenerVerdicts keeps only confirmed fits. Better five real than
 *      fifteen loose.
 *
 * This replaces the user's manual "prompt Claude, then hand-vet the list" loop.
 */
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { config } from '../config.js';
import { sanitizeString } from '../middleware/validate.js';
import { lookupStock } from '../services/agentTools.js';
import { getFinancials } from '../services/fmp.js';
import { applyScreenerVerdicts } from '../services/screenerVerdicts.js';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: config.anthropicKey });
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_SCREENERS = 8;
const MAX_CANDIDATES = 12;

// Small bounded-concurrency map so we don't fire a dozen Polygon/FMP calls at once.
async function mapLimit(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...await Promise.all(items.slice(i, i + limit).map(fn)));
  }
  return out;
}

function parseJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function fmtCap(n) {
  if (!n) return '';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(0)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n}`;
}

/**
 * Run one screener query end to end. Returns { results, reason? } where results
 * is a vetted, ranked list of { ticker, price, changePercent, marketCap, pe, thesis }.
 */
export async function runScreenerQuery(query) {
  // 1. Claude proposes candidates that fit the theme/query.
  let candTickers = [];
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content:
        `A user wants to screen the US stock market for: "${query}".\n` +
        `List up to ${MAX_CANDIDATES} real, currently US-listed common stocks that genuinely match. ` +
        `Prefer liquid, well-known names unless the query explicitly asks for small or micro caps. ` +
        `Return ONLY JSON, no prose: {"tickers":["NVDA","AVGO"]}` }],
    });
    const parsed = parseJson(msg.content?.[0]?.text);
    candTickers = Array.isArray(parsed?.tickers)
      ? parsed.tickers.map(t => String(t).toUpperCase().replace(/[^A-Z]/g, '')).filter(Boolean).slice(0, MAX_CANDIDATES)
      : [];
  } catch (e) {
    console.error('[Screener] candidate generation failed:', e.message);
  }
  if (candTickers.length === 0) return { results: [], reason: 'no_candidates' };

  // 2. Enrich with live price + fundamentals; drop anything without a real quote.
  const uniq = [...new Set(candTickers)];
  const enriched = (await mapLimit(uniq, 4, async (ticker) => {
    try {
      const look = await lookupStock({ ticker });
      if (!look || look.error || !look.price) return null;
      let fin = null;
      try { fin = await getFinancials(ticker); } catch {}
      return {
        ticker,
        price: +look.price,
        changePercent: look.changePercent ?? null,
        marketCap: fin?.marketCap ?? null,
        pe: fin?.pe ?? null,
      };
    } catch { return null; }
  })).filter(Boolean);
  if (enriched.length === 0) return { results: [], reason: 'no_valid_tickers' };

  // 3. Claude vets each candidate against live data + the query.
  const lines = enriched.map(c => {
    const bits = [`$${c.price}`];
    if (c.changePercent != null) bits.push(`${c.changePercent >= 0 ? '+' : ''}${Number(c.changePercent).toFixed(1)}% today`);
    if (c.marketCap) bits.push(`mcap ${fmtCap(c.marketCap)}`);
    if (c.pe) bits.push(`P/E ${c.pe}`);
    return `${c.ticker}: ${bits.join(', ')}`;
  }).join('\n');

  let parsed = null;
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content:
        `A user is screening for: "${query}".\n\nCandidates with live data:\n${lines}\n\n` +
        `For EACH, decide if it genuinely fits the query given the live data. Be selective: drop anything that does not clearly fit. ` +
        `For those that fit, write ONE tight sentence on why it fits the query right now. ` +
        `Order best-fit first. Return ONLY JSON, no prose: {"results":[{"ticker":"NVDA","fits":true,"thesis":"..."}]}` }],
    });
    parsed = parseJson(msg.content?.[0]?.text);
  } catch (e) {
    console.error('[Screener] vetting failed:', e.message);
  }

  // 4. Fail closed: keep only Claude-confirmed fits, in Claude's order.
  const byTicker = Object.fromEntries(enriched.map(c => [c.ticker, c]));
  const ordered = [];
  if (parsed && Array.isArray(parsed.results)) {
    for (const v of parsed.results) {
      const c = byTicker[String(v?.ticker || '').toUpperCase()];
      if (c) ordered.push(c);
    }
  }
  for (const c of enriched) if (!ordered.includes(c)) ordered.push(c);
  return { results: applyScreenerVerdicts(ordered, parsed) };
}

// ---- routes ----

// GET / — the user's screeners (with their last results)
router.get('/', requireAuth, rateLimit(30), async (req, res) => {
  try {
    const { data } = await supabase.from('screeners').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    res.json({ screeners: data ?? [] });
  } catch {
    res.json({ screeners: [] });
  }
});

// POST / — create a screener and run it once so the user sees results immediately
router.post('/', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const query = sanitizeString(req.body.query, 300);
    if (!query) return res.status(400).json({ error: 'Tell the screener what to look for' });
    const name = sanitizeString(req.body.name, 80) || query.slice(0, 60);

    const { count } = await supabase.from('screeners').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id);
    if ((count ?? 0) >= MAX_SCREENERS) {
      return res.status(403).json({ error: `You can have up to ${MAX_SCREENERS} screeners. Delete one to add another.` });
    }

    const { data: created, error } = await supabase.from('screeners').insert({ user_id: req.user.id, name, query }).select().single();
    if (error) return res.status(500).json({ error: 'Failed to create screener' });

    const { results } = await runScreenerQuery(query);
    const last_run_at = new Date().toISOString();
    await supabase.from('screeners').update({ results, last_run_at }).eq('id', created.id).eq('user_id', req.user.id);
    res.json({ screener: { ...created, results, last_run_at } });
  } catch (e) {
    console.error('[Screener] create failed:', e.message);
    res.status(500).json({ error: 'Failed to create screener' });
  }
});

// POST /:id/run — re-run a screener on demand
router.post('/:id/run', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const { data: s } = await supabase.from('screeners').select('*').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
    if (!s) return res.status(404).json({ error: 'Screener not found' });
    const { results } = await runScreenerQuery(s.query);
    const last_run_at = new Date().toISOString();
    await supabase.from('screeners').update({ results, last_run_at }).eq('id', s.id).eq('user_id', req.user.id);
    res.json({ screener: { ...s, results, last_run_at } });
  } catch (e) {
    console.error('[Screener] run failed:', e.message);
    res.status(500).json({ error: 'Screener run failed' });
  }
});

// DELETE /:id
router.delete('/:id', requireAuth, rateLimit(10), async (req, res) => {
  try {
    await supabase.from('screeners').delete().eq('id', req.params.id).eq('user_id', req.user.id);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to delete screener' });
  }
});

export default router;
