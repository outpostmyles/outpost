// Research dossier: turn a single ticker into everything a retail trader needs to
// actually decide, in one place, personalized to THEIR book. The screener finds
// names; this is the room you walk into to research one. The part no generic
// screener can copy is "for your book": how this name fits YOUR sectors, YOUR
// concentration, YOUR size. That is the reason to use Outpost over Finviz.
//
// buildDossier assembles live data (best-effort, one slow source never blocks the
// rest). forYourBook is the pure, personalized read and is unit-tested on its own.
import { supabase } from '../db.js';
import { lookupStock, getStockNews } from './agentTools.js';
import { getFinancials, getRatios, getAnalystRating } from './fmp.js';
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
 * Assemble the full dossier for a ticker, personalized to the user. Best-effort:
 * each external source is independent, so a single failure (or an FMP rate limit)
 * degrades that one field instead of breaking the whole view.
 */
export async function buildDossier(ticker, userId) {
  const T = String(ticker || '').toUpperCase().trim();
  if (!T) return null;

  const [lookupR, finR, ratiosR, analystR, newsR, posR] = await Promise.allSettled([
    lookupStock({ ticker: T }),
    getFinancials(T),
    getRatios(T),
    getAnalystRating(T),
    getStockNews({ ticker: T, limit: 3 }),
    supabase.from('positions').select('ticker, shares, avg_cost').eq('user_id', userId),
  ]);
  const look = lookupR.status === 'fulfilled' ? lookupR.value : null;
  const fin = finR.status === 'fulfilled' ? finR.value : null;
  const ratios = ratiosR.status === 'fulfilled' ? ratiosR.value : null;
  const analyst = analystR.status === 'fulfilled' ? analystR.value : null;
  const news = newsR.status === 'fulfilled' ? newsR.value : null;
  const positions = posR.status === 'fulfilled' ? (posR.value?.data ?? []) : [];

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

  const yearHigh = fin?.yearHigh ?? null, yearLow = fin?.yearLow ?? null;
  const rangePosition = (price != null && yearHigh && yearLow && yearHigh > yearLow)
    ? Math.max(0, Math.min(100, Math.round(((price - yearLow) / (yearHigh - yearLow)) * 100)))
    : null;

  return {
    ticker: T,
    name: fin?.companyName || T,
    sector,
    industry: fin?.industry || null,
    price,
    changePercent: (look && look.changePercent != null) ? look.changePercent : null,
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
