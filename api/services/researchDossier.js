// Research dossier: turn a single ticker into everything a retail trader needs to
// actually decide, in one place, personalized to THEIR book. The screener finds
// names; this is the room you walk into to research one. The part no generic
// screener can copy is "for your book": how this name fits YOUR sectors, YOUR
// concentration, YOUR size. That is the reason to use Outpost over Finviz.
//
// buildDossier assembles live data (best-effort, one slow source never blocks the
// rest). forYourBook is the pure, personalized read and is unit-tested on its own.
import { supabase } from '../db.js';
import { lookupStock, getStockNews, getHistoricalPrice } from './agentTools.js';
import { getAnalystRating } from './fmp.js';
import { getFinancialsResilient, getRatiosResilient } from './fundamentalsCache.js';
import { getPrices } from './pricePool.js';
import { resolveSector, staticSector } from './sectorMap.js';

/**
 * The personalized read: how this name sits against the user's actual book.
 * Pure and deterministic. holdings = [{ ticker, sector, value, beta }].
 */
export function forYourBook({ ticker, sector, beta, holdings = [] }) {
  const T = String(ticker || '').toUpperCase();
  const rows = (Array.isArray(holdings) ? holdings : []).filter(h => h && Number(h.value) > 0);
  const bookValue = rows.reduce((s, h) => s + Number(h.value), 0);
  const holdsAlready = rows.some(h => String(h.ticker).toUpperCase() === T);

  const bySector = {};
  for (const h of rows) {
    const s = h.sector || 'Unknown';
    bySector[s] = (bySector[s] || 0) + Number(h.value);
  }
  const sec = sector && sector !== 'Unknown' ? sector : null;
  const sectorPct = bookValue > 0 && sec ? Math.round(((bySector[sec] || 0) / bookValue) * 100) : 0;

  let sectorFit, fitNote;
  if (!sec) {
    sectorFit = 'unknown';
    fitNote = `We could not classify ${T}'s sector, so judge its fit on the business itself.`;
  } else if (holdsAlready) {
    sectorFit = 'owned';
    fitNote = `You already own ${T}. This would be adding to an existing position, not a new one.`;
  } else if (sectorPct === 0) {
    sectorFit = 'new';
    fitNote = `New ground for you. You hold nothing in ${sec} today, so this would diversify your book.`;
  } else if (sectorPct >= 40) {
    sectorFit = 'concentrated';
    fitNote = `Doubles down on your heaviest area. You are already ${sectorPct}% in ${sec}, so more here raises your concentration risk.`;
  } else {
    sectorFit = 'fits';
    fitNote = `Rounds out a lighter area. You are ${sectorPct}% in ${sec}, so this adds exposure without overloading it.`;
  }

  let betaNote = null;
  if (Number.isFinite(beta) && beta > 0) {
    betaNote = beta >= 1.3 ? `Beta ${beta.toFixed(2)}: swingier than the market, expect bigger moves both ways.`
      : beta <= 0.8 ? `Beta ${beta.toFixed(2)}: calmer than the market.`
      : `Beta ${beta.toFixed(2)}: moves about with the market.`;
  }

  let suggestedSize = null;
  if (bookValue > 0) {
    const starter = Math.round(bookValue * 0.05);
    suggestedSize = `A 5% starter would be about $${starter.toLocaleString()} of your $${Math.round(bookValue).toLocaleString()} book.`;
  }

  return { holdsAlready, sector: sec || 'Unknown', sectorPct, sectorFit, fitNote, betaNote, suggestedSize, bookValue };
}

/**
 * Given 2-3 dossiers, pick the one that fits the user's book best and say why.
 * Deterministic: rewards a name that diversifies (a sector you do not hold) or
 * rounds out a light area, penalizes one that doubles down on a heavy sector or
 * that you already own, with a mild nudge toward reasonable valuation. Pure.
 */
export function compareForBook(dossiers) {
  const list = (Array.isArray(dossiers) ? dossiers : []).filter(d => d && d.ticker);
  if (list.length < 2) return null;
  // "Best fit" means the best NEW addition, so only names you could add are
  // rankable. A name you already own, or one we cannot classify, is not a candidate
  // for best fit and sinks below the rest (this is also what stopped an unclassified
  // name from winning by default).
  const fitScore = { new: 2, fits: 1, concentrated: -2 };
  const ranked = list.map(d => {
    const fb = d.forYourBook || {};
    const assessable = fb.sectorFit in fitScore;
    let score = assessable ? fitScore[fb.sectorFit] : -1000;
    const pe = d.fundamentals?.pe;
    if (assessable && Number.isFinite(pe) && pe > 0 && pe < 25) score += 0.3; // value nudge breaks ties
    return { ticker: d.ticker, sector: fb.sector, sectorFit: fb.sectorFit, score };
  }).sort((a, b) => b.score - a.score);

  const best = ranked[0];
  let reason;
  // Only name a "best fit" when something here is genuinely addable. When nothing
  // is (all owned, or all unclassifiable), bestTicker is null so the UI does not
  // badge a name the reason text just said is NOT a recommendation.
  let bestTicker = best.score > -1000 ? best.ticker : null;
  if (best.score > -1000) {
    if (best.sectorFit === 'new') reason = `${best.ticker} would diversify you into ${best.sector}, a sector you do not hold yet.`;
    else if (best.sectorFit === 'fits') reason = `${best.ticker} rounds out your ${best.sector} exposure without overloading it.`;
    else reason = `None of these is a clean add for your book. ${best.ticker} is the least redundant, but they all lean into areas you already hold.`;
  } else if (ranked.every(r => r.sectorFit === 'owned')) {
    reason = `You already own all of these, so this is a check-in on names you hold, not a new pick.`;
  } else {
    reason = `We could not classify these well enough to call one the best fit. Open each to judge it on the business.`;
  }
  return { bestTicker, reason, ranked };
}

/**
 * Assemble the full dossier for a ticker, personalized to the user. Best-effort:
 * each external source is independent, so a single failure (or an FMP rate limit)
 * degrades that one field instead of breaking the whole view.
 */
export async function buildDossier(ticker, userId) {
  const T = String(ticker || '').toUpperCase().trim();
  if (!T) return null;

  const monthAgo = new Date(Date.now() - 31 * 86400000).toISOString().split('T')[0];
  const [lookupR, finR, ratiosR, analystR, newsR, posR, statusR, momoR] = await Promise.allSettled([
    lookupStock({ ticker: T }),
    getFinancialsResilient(T),
    getRatiosResilient(T),
    getAnalystRating(T),
    getStockNews({ ticker: T, limit: 3 }),
    supabase.from('positions').select('ticker, shares, avg_cost, entry_thesis, reversal_condition, price_target, stop_loss').eq('user_id', userId),
    supabase.from('research_status').select('status').eq('user_id', userId).eq('ticker', T).maybeSingle(),
    getHistoricalPrice({ ticker: T, from_date: monthAgo }), // 1-month momentum (Polygon, survives FMP)
  ]);
  const look = lookupR.status === 'fulfilled' ? lookupR.value : null;
  const fin = finR.status === 'fulfilled' ? finR.value : null;
  const ratios = ratiosR.status === 'fulfilled' ? ratiosR.value : null;
  const analyst = analystR.status === 'fulfilled' ? analystR.value : null;
  const news = newsR.status === 'fulfilled' ? newsR.value : null;
  const positions = posR.status === 'fulfilled' ? (posR.value?.data ?? []) : [];
  const status = statusR.status === 'fulfilled' ? (statusR.value?.data?.status ?? null) : null; // null pre-migration
  const momentum1m = (momoR.status === 'fulfilled' && momoR.value && !momoR.value.error) ? momoR.value.change_percent : null;

  const price = (look && !look.error && look.price != null) ? +look.price : (fin?.price ?? null);
  const sector = resolveSector(T, fin?.sector);

  // Build the book for the personalized read. Use the offline sector map (no extra
  // FMP calls per holding) so opening a dossier stays cheap and never rate-limits.
  const tickers = positions.map(p => p.ticker);
  const priceMap = tickers.length ? getPrices(tickers) : {};
  const holdings = positions.map(p => {
    const live = priceMap[p.ticker]?.price ?? p.avg_cost ?? 0;
    return { ticker: p.ticker, sector: resolveSector(p.ticker, null), value: live * (p.shares ?? 0), beta: null };
  });

  // If the user actually holds this name, attach their real position (cost, live
  // P&L, weight, the thesis + plan they wrote) so researching a holding reflects
  // YOUR position, not just "you already own it". Aggregates multiple lots.
  let holding = null;
  const heldRows = positions.filter(p => String(p.ticker).toUpperCase() === T);
  if (heldRows.length && price != null) {
    const shares = heldRows.reduce((s, p) => s + (Number(p.shares) || 0), 0);
    const costBasis = heldRows.reduce((s, p) => s + (Number(p.shares) || 0) * (Number(p.avg_cost) || 0), 0);
    const currentValue = price * shares;
    const pnl = currentValue - costBasis;
    // Weight uses ONE price source (the book's own valuation) for both this name
    // and the total, so it can never exceed 100% when the live quote and the pool
    // price disagree. P&L keeps the fresh quote since that is the accurate move.
    const bookValue = holdings.reduce((s, h) => s + h.value, 0);
    const thisInBook = holdings.filter(h => String(h.ticker).toUpperCase() === T).reduce((s, h) => s + h.value, 0);
    const withThesis = heldRows.find(p => p.entry_thesis) || heldRows[0];
    const withPlan = heldRows.find(p => p.price_target || p.stop_loss) || heldRows[0];
    holding = {
      shares,
      avgCost: shares > 0 ? +(costBasis / shares).toFixed(2) : null,
      currentValue: +currentValue.toFixed(2),
      pnl: +pnl.toFixed(2),
      pnlPct: costBasis > 0 ? +((pnl / costBasis) * 100).toFixed(1) : null,
      pctOfBook: bookValue > 0 ? Math.min(100, Math.round((thisInBook / bookValue) * 100)) : null,
      thesis: withThesis?.entry_thesis || null,
      reversalCondition: withThesis?.reversal_condition || null,
      target: withPlan?.price_target || null,
      stop: withPlan?.stop_loss || null,
    };
  }

  const yearHigh = fin?.yearHigh ?? null, yearLow = fin?.yearLow ?? null;
  const rangePosition = (price != null && yearHigh && yearLow && yearHigh > yearLow)
    ? Math.max(0, Math.min(100, Math.round(((price - yearLow) / (yearHigh - yearLow)) * 100)))
    : null;

  return {
    ticker: T,
    name: fin?.companyName || T,
    sector,
    industry: fin?.industry || null,
    status,
    holding,
    price,
    changePercent: (look && look.change_percent != null) ? look.change_percent : null,
    momentum1m,
    description: fin?.description || null,
    fundamentals: {
      marketCap: fin?.marketCap ?? null,
      pe: fin?.pe ?? null,
      eps: fin?.eps ?? null,
      beta: fin?.beta ?? null,
      netMargin: ratios?.netMargin ?? null,
      grossMargin: ratios?.grossMargin ?? null,
      roe: ratios?.roe ?? null,
      dividendYield: fin?.dividendYield ?? null,
      yearHigh,
      yearLow,
    },
    rangePosition,
    fundamentalsAsOf: fin?._asOf || null, // set when fundamentals are last-known (FMP throttled), null when live
    analyst: analyst ? {
      consensus: analyst.consensus,
      buy: analyst.buy, hold: analyst.hold, sell: analyst.sell,
      total: analyst.totalAnalysts ?? null,
      targetPrice: analyst.targetPrice ?? null,
    } : null,
    news: (news?.articles ?? []).slice(0, 2).map(a => ({ title: a.title, source: a.source, published: a.published })),
    forYourBook: forYourBook({ ticker: T, sector, beta: fin?.beta, holdings }),
  };
}
