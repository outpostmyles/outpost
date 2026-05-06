/**
 * Financial Modeling Prep (FMP) Service
 * Provides fundamental data, earnings dates, and analyst ratings.
 * All data is cached per-ticker (shared across users) to stay well within free tier limits.
 *
 * Free tier: 250 calls/day — with 24hr ticker caching we'd need 250+ unique tickers
 * queried in one day to hit the limit. Very safe.
 */

import { config } from '../config.js';
import { memCachedFetch } from './memoryCache.js';

const BASE = 'https://financialmodelingprep.com/stable';
const KEY = config.fmpKey;

async function fmpFetch(path) {
  if (!KEY) return null;
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}apikey=${KEY}`;
  // 15s timeout — defense-in-depth against hung third-party API
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`[FMP] ${res.status} for ${path}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[FMP] fetch failed: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Get key fundamental metrics for a ticker.
 * Cached 24 hours (fundamentals don't change intraday).
 */
export async function getFinancials(ticker) {
  ticker = ticker.toUpperCase().trim();
  return memCachedFetch(`fmp_profile_${ticker}`, async () => {
    const data = await fmpFetch(`/profile?symbol=${ticker}`);
    if (!data?.[0]) return null;
    const p = data[0];
    return {
      ticker: p.symbol,
      companyName: p.companyName,
      sector: p.sector,
      industry: p.industry,
      marketCap: p.mktCap,
      price: p.price,
      pe: p.pe,                        // P/E ratio (trailing)
      eps: p.eps,                      // Earnings per share
      beta: p.beta,                    // Volatility vs market
      dividendYield: p.lastDiv > 0 ? +(p.lastDiv / p.price * 100).toFixed(2) : 0,
      yearHigh: p.range ? parseFloat(p.range.split('-')[1]) : null,
      yearLow: p.range ? parseFloat(p.range.split('-')[0]) : null,
      avgVolume: p.volAvg,
      description: p.description?.slice(0, 300) || '',
    };
  }, 24 * 60 * 60 * 1000); // 24 hour cache
}

/**
 * Get key financial ratios (profitability, growth, etc).
 * Cached 24 hours.
 */
export async function getRatios(ticker) {
  ticker = ticker.toUpperCase().trim();
  return memCachedFetch(`fmp_ratios_${ticker}`, async () => {
    const data = await fmpFetch(`/ratios-ttm?symbol=${ticker}`);
    if (!data?.[0]) return null;
    const r = data[0];
    return {
      ticker,
      grossMargin: r.grossProfitMarginTTM ? +(r.grossProfitMarginTTM * 100).toFixed(1) : null,
      operatingMargin: r.operatingProfitMarginTTM ? +(r.operatingProfitMarginTTM * 100).toFixed(1) : null,
      netMargin: r.netProfitMarginTTM ? +(r.netProfitMarginTTM * 100).toFixed(1) : null,
      roe: r.returnOnEquityTTM ? +(r.returnOnEquityTTM * 100).toFixed(1) : null,
      roa: r.returnOnAssetsTTM ? +(r.returnOnAssetsTTM * 100).toFixed(1) : null,
      debtToEquity: r.debtEquityRatioTTM ? +r.debtEquityRatioTTM.toFixed(2) : null,
      currentRatio: r.currentRatioTTM ? +r.currentRatioTTM.toFixed(2) : null,
      peRatio: r.peRatioTTM ? +r.peRatioTTM.toFixed(2) : null,
      pegRatio: r.pegRatioTTM ? +r.pegRatioTTM.toFixed(2) : null,
      priceToBook: r.priceToBookRatioTTM ? +r.priceToBookRatioTTM.toFixed(2) : null,
      priceToSales: r.priceToSalesRatioTTM ? +r.priceToSalesRatioTTM.toFixed(2) : null,
      dividendYield: r.dividendYieldTTM ? +(r.dividendYieldTTM * 100).toFixed(2) : null,
    };
  }, 24 * 60 * 60 * 1000);
}

// NOTE: FMP earnings functions (getEarningsDate, getBatchEarnings) were removed
// 2026-04-15. FMP Starter tier's /earnings-calendar?symbol= endpoint was
// returning unfiltered global calendar data, causing every position in a
// portfolio to display the same "ER TOMORROW" badge. Earnings data is now
// sourced exclusively from Finnhub's /calendar/earnings endpoint via
// getEarningsForTickers in api/utils/finnhub.js — one cached call serves all
// users, and the data is correctly per-ticker. Do not re-add FMP earnings
// without first verifying the symbol filter actually works on our tier.

/**
 * Get analyst consensus for a ticker.
 * Cached 12 hours.
 */
export async function getAnalystRating(ticker) {
  ticker = ticker.toUpperCase().trim();
  return memCachedFetch(`fmp_analyst_${ticker}`, async () => {
    const data = await fmpFetch(`/grades?symbol=${ticker}&limit=20`);
    if (!data?.length) return null;

    // Count recent grades (last 90 days)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const recent = data.filter(g => g.date >= cutoffStr);

    const grades = { buy: 0, hold: 0, sell: 0 };
    for (const g of recent) {
      const action = (g.newGrade || '').toLowerCase();
      if (action.includes('buy') || action.includes('outperform') || action.includes('overweight')) grades.buy++;
      else if (action.includes('hold') || action.includes('neutral') || action.includes('equal') || action.includes('peer')) grades.hold++;
      else if (action.includes('sell') || action.includes('underperform') || action.includes('underweight')) grades.sell++;
    }

    const total = grades.buy + grades.hold + grades.sell;
    const consensus = grades.buy > grades.hold + grades.sell ? 'Buy'
      : grades.sell > grades.buy + grades.hold ? 'Sell'
      : 'Hold';

    // Get price target
    const ptData = await fmpFetch(`/financial-estimates?symbol=${ticker}&limit=1`);
    const avgTarget = ptData?.[0]?.estimatedEpsAvg ? null : null; // estimates endpoint may not have target

    // Try consensus endpoint for price target
    const consData = await fmpFetch(`/price-target-consensus?symbol=${ticker}`);
    const targetPrice = consData?.[0]?.targetConsensus || null;
    const targetHigh = consData?.[0]?.targetHigh || null;
    const targetLow = consData?.[0]?.targetLow || null;

    return {
      ticker,
      consensus,
      buy: grades.buy,
      hold: grades.hold,
      sell: grades.sell,
      totalAnalysts: total,
      targetPrice: targetPrice ? +targetPrice.toFixed(2) : null,
      targetHigh: targetHigh ? +targetHigh.toFixed(2) : null,
      targetLow: targetLow ? +targetLow.toFixed(2) : null,
      recentGrades: recent.slice(0, 5).map(g => ({
        date: g.date,
        firm: g.gradingCompany,
        action: g.newGrade,
        previous: g.previousGrade,
      })),
    };
  }, 12 * 60 * 60 * 1000); // 12 hour cache
}

// getBatchEarnings removed — see note above getEarningsDate's removal.
