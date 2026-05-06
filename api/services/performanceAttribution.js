/**
 * Performance Attribution
 *
 * Goes beyond aggregate stats to answer: WHERE is the user actually making (or
 * losing) money? Surfaces patterns the user can act on.
 *
 * Three lenses:
 *   1. Style attribution — bucket closed trades by hold time (day/swing/position/long_term),
 *      compare win rate + avg P&L per bucket. Reveals "your edge is in swings, not day trades".
 *   2. Pareto / concentration — what % of total winnings came from the top N trades.
 *      Reveals whether returns are diversified or carried by 1-2 lottery hits.
 *   3. Open-position contribution — which current positions are pulling unrealized P&L
 *      up or down. "NVDA is +$X, all your other positions combined are -$Y."
 *
 * Insights surface only when sample size is meaningful (≥5 trades per bucket).
 */

import { supabase } from '../db.js';
import { getPrices } from './pricePool.js';

const MIN_TRADES_FOR_BUCKET = 3;
const MIN_TRADES_FOR_PARETO = 5;
const SIGNIFICANT_DELTA_PCT = 20; // win-rate gap that triggers a "your edge is here" insight

// Hold-day buckets. Boundaries chosen to align with trader-recognizable styles.
export const STYLE_BUCKETS = [
  { key: 'day_trade',   label: 'Day Trades',     max: 1 },
  { key: 'short_swing', label: 'Short Swings',   max: 7 },
  { key: 'swing',       label: 'Swings',         max: 30 },
  { key: 'position',    label: 'Position',       max: 180 },
  { key: 'long_term',   label: 'Long-Term',      max: Infinity },
];

/**
 * Classify a trade by its hold time. Pure function — exported for tests.
 */
export function bucketTrade(holdDays) {
  const d = Math.max(0, Number(holdDays) || 0);
  for (const b of STYLE_BUCKETS) {
    if (d <= b.max) return b.key;
  }
  return 'long_term';
}

/**
 * Compute per-style stats for closed trades.
 * Returns array of { key, label, count, winCount, lossCount, winRate, totalPnl,
 *                    avgPnlPct, avgWin, avgLoss, avgHoldDays }.
 * Only buckets with ≥1 trade are returned.
 */
export function analyzeStyles(trades) {
  const byBucket = {};
  for (const t of trades) {
    const bucket = bucketTrade(t.hold_days);
    if (!byBucket[bucket]) byBucket[bucket] = [];
    byBucket[bucket].push(t);
  }

  return STYLE_BUCKETS
    .filter(b => byBucket[b.key]?.length > 0)
    .map(b => {
      const ts = byBucket[b.key];
      const wins = ts.filter(t => (t.pnl ?? 0) > 0);
      const losses = ts.filter(t => (t.pnl ?? 0) < 0);
      const totalPnl = ts.reduce((s, t) => s + (t.pnl ?? 0), 0);
      const totalPnlPct = ts.reduce((s, t) => s + (t.pnl_percent ?? 0), 0);
      const totalHold = ts.reduce((s, t) => s + (t.hold_days ?? 0), 0);

      const avg = (arr, key) => arr.length > 0
        ? arr.reduce((s, t) => s + (t[key] ?? 0), 0) / arr.length
        : 0;

      return {
        key: b.key,
        label: b.label,
        count: ts.length,
        winCount: wins.length,
        lossCount: losses.length,
        winRate: round1((wins.length / ts.length) * 100),
        totalPnl: round2(totalPnl),
        avgPnlPct: round1(totalPnlPct / ts.length),
        avgWin: wins.length > 0 ? round1(avg(wins, 'pnl_percent')) : 0,
        avgLoss: losses.length > 0 ? round1(avg(losses, 'pnl_percent')) : 0,
        avgHoldDays: Math.round(totalHold / ts.length),
      };
    });
}

/**
 * Pareto analysis on closed trades.
 * Returns { totalWinnings, totalLosses, netPnl, top3, top3Share, top1, top1Share }.
 * Surfaces when returns are concentrated in a few big winners (carried) vs spread out.
 */
export function analyzeContribution(trades) {
  if (!trades?.length) {
    return { count: 0, totalWinnings: 0, totalLosses: 0, netPnl: 0, top3: [], top3Share: 0, top1: null, top1Share: 0 };
  }

  const wins = trades.filter(t => (t.pnl ?? 0) > 0).sort((a, b) => b.pnl - a.pnl);
  const losses = trades.filter(t => (t.pnl ?? 0) < 0).sort((a, b) => a.pnl - b.pnl);

  const totalWinnings = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLosses = losses.reduce((s, t) => s + t.pnl, 0); // negative
  const netPnl = totalWinnings + totalLosses;

  const top3 = wins.slice(0, 3).map(t => ({
    ticker: t.ticker,
    pnl: round2(t.pnl),
    pnlPercent: round1(t.pnl_percent),
    holdDays: t.hold_days ?? 0,
  }));
  const top3Total = top3.reduce((s, t) => s + t.pnl, 0);
  const top3Share = totalWinnings > 0 ? round1((top3Total / totalWinnings) * 100) : 0;

  const top1 = top3[0] || null;
  const top1Share = top1 && totalWinnings > 0 ? round1((top1.pnl / totalWinnings) * 100) : 0;

  return {
    count: trades.length,
    totalWinnings: round2(totalWinnings),
    totalLosses: round2(totalLosses),
    netPnl: round2(netPnl),
    top3,
    top3Share,
    top1,
    top1Share,
  };
}

/**
 * Open-position contribution to unrealized P&L.
 * Returns top winners + losers + share of net unrealized.
 */
export function analyzeOpenContribution(positions) {
  if (!positions?.length) {
    return { count: 0, totalUnrealized: 0, topWinners: [], topLosers: [] };
  }

  const enriched = positions
    .filter(p => p.currentPrice > 0 && p.shares > 0)
    .map(p => {
      const cost = (p.avg_cost ?? 0) * p.shares;
      const value = p.currentPrice * p.shares;
      const unrealized = value - cost;
      const unrealizedPct = cost > 0 ? (unrealized / cost) * 100 : 0;
      return {
        ticker: p.ticker,
        unrealized: round2(unrealized),
        unrealizedPct: round1(unrealizedPct),
        currentValue: round2(value),
      };
    });

  const sorted = [...enriched].sort((a, b) => b.unrealized - a.unrealized);
  const topWinners = sorted.filter(p => p.unrealized > 0).slice(0, 3);
  const topLosers = sorted.filter(p => p.unrealized < 0).slice(-3).reverse();
  const totalUnrealized = enriched.reduce((s, p) => s + p.unrealized, 0);

  return {
    count: enriched.length,
    totalUnrealized: round2(totalUnrealized),
    topWinners,
    topLosers,
  };
}

/**
 * Derive 1–4 actionable patterns from the stats.
 * Order: edge-finding insights (win-rate gap) > pareto > worst bucket > best bucket.
 */
export function derivePatterns({ styles, contribution, openContribution }) {
  const patterns = [];

  // Style edge — find buckets with significantly different win rates
  const bigBuckets = styles.filter(s => s.count >= MIN_TRADES_FOR_BUCKET);
  if (bigBuckets.length >= 2) {
    const sorted = [...bigBuckets].sort((a, b) => b.winRate - a.winRate);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    const gap = best.winRate - worst.winRate;
    if (gap >= SIGNIFICANT_DELTA_PCT) {
      patterns.push({
        key: 'style_edge',
        severity: 'positive',
        headline: `Your edge is in ${best.label.toLowerCase()}: ${best.winRate.toFixed(0)}% win rate`,
        detail: `Compared to ${worst.winRate.toFixed(0)}% on ${worst.label.toLowerCase()} (${gap.toFixed(0)}-point gap). Concentrate where you actually win.`,
      });
    }

    // Style red flag — bucket with 0 wins or net negative
    const losingBucket = bigBuckets.find(s => s.totalPnl < 0 && s.count >= 3);
    if (losingBucket && losingBucket.key !== best.key) {
      patterns.push({
        key: 'style_drag',
        severity: 'warning',
        headline: `${losingBucket.label} are dragging your portfolio`,
        detail: `${losingBucket.count} trades, ${losingBucket.winRate.toFixed(0)}% win rate, $${losingBucket.totalPnl.toFixed(0)} net P&L. Worth questioning whether to keep doing them.`,
      });
    }
  }

  // Pareto — concentrated wins
  if (contribution.count >= MIN_TRADES_FOR_PARETO && contribution.top3Share >= 70) {
    patterns.push({
      key: 'concentrated_wins',
      severity: contribution.top1Share >= 50 ? 'warning' : 'info',
      headline: `Top 3 trades drove ${contribution.top3Share.toFixed(0)}% of your winnings`,
      detail: contribution.top1Share >= 50
        ? `One trade (${contribution.top1.ticker}, +$${contribution.top1.pnl.toFixed(0)}) is ${contribution.top1Share.toFixed(0)}% of total winnings. If that was luck, your real win rate is lower than it looks.`
        : `Returns are concentrated in your few best trades. Look for what made those work and replicate the setup, not the ticker.`,
    });
  }

  // Open position concentration risk
  if (openContribution.totalUnrealized > 0 && openContribution.topWinners.length > 0) {
    const topWinner = openContribution.topWinners[0];
    const topShare = openContribution.totalUnrealized > 0
      ? (topWinner.unrealized / openContribution.totalUnrealized) * 100
      : 0;
    if (topShare >= 70) {
      patterns.push({
        key: 'open_concentration',
        severity: 'info',
        headline: `${topWinner.ticker} is ${topShare.toFixed(0)}% of your unrealized P&L`,
        detail: `Your other positions are roughly flat. If ${topWinner.ticker} reverses, your year reverses with it.`,
      });
    }
  }

  return patterns.slice(0, 4);
}

/**
 * Main entry — fetches data, runs all three analyses, derives patterns.
 */
export async function getPerformanceAttribution(userId, options = {}) {
  const limit = options.limit ?? 200;

  const [tradesRes, posRes] = await Promise.allSettled([
    supabase
      .from('closed_trades')
      .select('ticker, pnl, pnl_percent, hold_days, sell_price, avg_cost, shares, closed_at')
      .eq('user_id', userId)
      .order('closed_at', { ascending: false })
      .limit(limit),
    supabase
      .from('positions')
      .select('ticker, shares, avg_cost')
      .eq('user_id', userId),
  ]);

  const closedTrades = tradesRes.status === 'fulfilled' ? (tradesRes.value.data ?? []) : [];
  const rawPositions = posRes.status === 'fulfilled' ? (posRes.value.data ?? []) : [];

  // Enrich open positions with live prices for unrealized P&L
  const tickers = rawPositions.map(p => p.ticker);
  const priceMap = tickers.length > 0 ? getPrices(tickers) : {};
  const positions = rawPositions.map(p => ({
    ...p,
    currentPrice: priceMap[p.ticker]?.price ?? 0,
  }));

  const styles = analyzeStyles(closedTrades);
  const contribution = analyzeContribution(closedTrades);
  const openContribution = analyzeOpenContribution(positions);
  const patterns = derivePatterns({ styles, contribution, openContribution });

  const hasEnoughData = closedTrades.length >= MIN_TRADES_FOR_BUCKET;

  return {
    hasEnoughData,
    closedTradeCount: closedTrades.length,
    openPositionCount: positions.length,
    styles,
    contribution,
    openContribution,
    patterns,
    message: hasEnoughData
      ? null
      : `Need ${MIN_TRADES_FOR_BUCKET - closedTrades.length} more closed trades to start surfacing performance patterns.`,
  };
}

/**
 * Compact summary for the agent's context block.
 * One-liner — keeps token cost down. Empty when not enough data.
 */
export async function getAttributionSummaryForAgent(userId) {
  try {
    const data = await getPerformanceAttribution(userId, { limit: 50 });
    if (!data.hasEnoughData) return '';

    const parts = [];
    // Style edge
    const stylePattern = data.patterns.find(p => p.key === 'style_edge');
    if (stylePattern) parts.push(stylePattern.headline.toLowerCase());
    // Drag
    const dragPattern = data.patterns.find(p => p.key === 'style_drag');
    if (dragPattern) parts.push(dragPattern.headline.toLowerCase());
    // Concentration
    if (data.contribution.top3Share >= 70 && data.contribution.count >= MIN_TRADES_FOR_PARETO) {
      parts.push(`top 3 trades = ${data.contribution.top3Share.toFixed(0)}% of winnings`);
    }

    if (parts.length === 0) return '';
    return `PERFORMANCE PATTERNS (use to ground feedback in their actual track record): ${parts.join('; ')}.`;
  } catch {
    return '';
  }
}

// ---- helpers ----

function round1(n) { return parseFloat(Number(n).toFixed(1)); }
function round2(n) { return parseFloat(Number(n).toFixed(2)); }
