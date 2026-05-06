/**
 * Tax Insights Service
 *
 * Analyzes positions and closed trades for tax-relevant events:
 *   - Wash sale warnings (sold at a loss + rebought within 30 days)
 *   - Tax-loss harvesting opportunities (unrealized losses that could offset realized gains)
 *   - Short-term vs long-term capital gains classification
 *   - Year-end tax optimization suggestions
 *
 * This is what financial advisors charge thousands for.
 * Outpost gives it to users for $20/month.
 */

import { supabase } from '../db.js';
import { getPrices } from './pricePool.js';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const WASH_SALE_WINDOW_DAYS = 30;
const LONG_TERM_DAYS = 365;

/**
 * Get full tax insights for a user.
 * Returns wash sale risks, harvesting opportunities, gain classification, and year-end suggestions.
 */
export async function getTaxInsights(userId) {
  // Fetch positions and closed trades in parallel
  const [posResult, tradesResult] = await Promise.allSettled([
    supabase.from('positions').select('*').eq('user_id', userId),
    supabase.from('closed_trades').select('*').eq('user_id', userId).order('closed_at', { ascending: false }).limit(100),
  ]);

  const positions = posResult.status === 'fulfilled' ? (posResult.value.data ?? []) : [];
  const closedTrades = tradesResult.status === 'fulfilled' ? (tradesResult.value.data ?? []) : [];

  // Enrich positions with live prices
  const tickers = positions.map(p => p.ticker);
  const liveData = tickers.length > 0 ? getPrices(tickers) : {};

  const enrichedPositions = positions.map(p => {
    const live = liveData[p.ticker];
    const currentPrice = live?.price ?? p.current_price ?? p.avg_cost ?? 0;
    const costBasis = (p.avg_cost ?? 0) * (p.shares ?? 0);
    const currentValue = currentPrice * (p.shares ?? 0);
    const unrealizedPnl = currentValue - costBasis;
    const unrealizedPnlPercent = costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0;
    const purchaseTime = p.purchased_at || p.created_at;
    // Calendar-day diff (UTC-anchored) — tax math is sensitive to hold periods
    // (long-term threshold = 365 days). `Math.ceil` of a fractional day was
    // inflating short holds and could push positions into "1 day from long-term"
    // when they were actually 2 days away.
    let holdDays = 0;
    if (purchaseTime) {
      const startDay = Math.floor(new Date(purchaseTime).getTime() / MS_PER_DAY);
      const endDay = Math.floor(Date.now() / MS_PER_DAY);
      holdDays = Math.max(0, endDay - startDay);
    }

    return {
      ...p,
      currentPrice,
      costBasis,
      currentValue,
      unrealizedPnl,
      unrealizedPnlPercent,
      holdDays,
      isLongTerm: holdDays >= LONG_TERM_DAYS,
      daysToLongTerm: Math.max(0, LONG_TERM_DAYS - holdDays),
    };
  });

  const washSaleRisks = detectWashSales(enrichedPositions, closedTrades);
  const harvestingOpportunities = findHarvestingOpportunities(enrichedPositions, closedTrades);
  const gainClassification = classifyGains(enrichedPositions, closedTrades);
  const yearEndSuggestions = getYearEndSuggestions(enrichedPositions, closedTrades);

  return {
    washSaleRisks,
    harvestingOpportunities,
    gainClassification,
    yearEndSuggestions,
    summary: buildSummary(gainClassification, harvestingOpportunities, washSaleRisks),
  };
}

/**
 * Detect wash sale risks.
 * A wash sale occurs when you sell a security at a loss and repurchase the same
 * (or substantially identical) security within 30 days before or after the sale.
 * The IRS disallows the loss deduction.
 */
function detectWashSales(positions, closedTrades) {
  const now = Date.now();
  const risks = [];

  // Check each closed trade that was a loss
  const recentLosses = closedTrades.filter(t =>
    t.pnl < 0 && t.closed_at &&
    (now - new Date(t.closed_at).getTime()) < WASH_SALE_WINDOW_DAYS * MS_PER_DAY
  );

  for (const loss of recentLosses) {
    // Check if the same ticker is currently held (repurchased)
    const currentPosition = positions.find(p => p.ticker === loss.ticker);
    if (currentPosition) {
      const daysSinceSale = Math.ceil((now - new Date(loss.closed_at).getTime()) / MS_PER_DAY);
      const daysRemaining = Math.max(0, WASH_SALE_WINDOW_DAYS - daysSinceSale);

      risks.push({
        type: 'active_wash_sale',
        ticker: loss.ticker,
        lossAmount: Math.abs(loss.pnl),
        soldAt: loss.sell_price,
        soldDate: loss.closed_at,
        daysSinceSale,
        daysUntilClear: daysRemaining,
        message: daysRemaining > 0
          ? `Wash sale on ${loss.ticker}: you sold at a $${Math.abs(loss.pnl).toFixed(2)} loss and rebought within 30 days. This loss is NOT tax-deductible. Wait ${daysRemaining} more days before selling again to avoid extending the wash sale.`
          : `The 30-day wash sale window on ${loss.ticker} has passed — this loss is now deductible.`,
      });
    }
  }

  // Check positions that could TRIGGER a wash sale if sold at a loss now
  for (const pos of positions) {
    if (pos.unrealizedPnl >= 0) continue; // Only losses can trigger wash sales

    // Was this ticker sold at a loss in the last 30 days?
    const recentSale = closedTrades.find(t =>
      t.ticker === pos.ticker && t.pnl < 0 && t.closed_at &&
      (now - new Date(t.closed_at).getTime()) < WASH_SALE_WINDOW_DAYS * MS_PER_DAY
    );

    if (recentSale) {
      risks.push({
        type: 'potential_wash_sale',
        ticker: pos.ticker,
        unrealizedLoss: Math.abs(pos.unrealizedPnl),
        previousLoss: Math.abs(recentSale.pnl),
        message: `Selling ${pos.ticker} now would create another wash sale since you sold it at a loss ${Math.ceil((now - new Date(recentSale.closed_at).getTime()) / MS_PER_DAY)} days ago. Consider waiting until the 30-day window closes.`,
      });
    }
  }

  return risks;
}

/**
 * Find tax-loss harvesting opportunities.
 * Look for positions with unrealized losses that could offset realized gains.
 */
function findHarvestingOpportunities(positions, closedTrades) {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();

  // Calculate YTD realized gains
  const ytdTrades = closedTrades.filter(t => t.closed_at >= yearStart);
  const ytdRealizedGains = ytdTrades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const ytdRealizedLosses = ytdTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0);
  const netRealizedGain = ytdRealizedGains + ytdRealizedLosses; // losses are negative

  // Find positions with unrealized losses
  const losers = positions
    .filter(p => p.unrealizedPnl < 0)
    .sort((a, b) => a.unrealizedPnl - b.unrealizedPnl); // biggest losses first

  const opportunities = [];

  for (const pos of losers) {
    // Check if selling would trigger a wash sale
    const recentSale = closedTrades.find(t =>
      t.ticker === pos.ticker && t.closed_at &&
      (Date.now() - new Date(t.closed_at).getTime()) < WASH_SALE_WINDOW_DAYS * MS_PER_DAY
    );

    const washSaleRisk = !!recentSale;

    opportunities.push({
      ticker: pos.ticker,
      unrealizedLoss: pos.unrealizedPnl,
      unrealizedLossPercent: pos.unrealizedPnlPercent,
      currentPrice: pos.currentPrice,
      avgCost: pos.avg_cost,
      shares: pos.shares,
      holdDays: pos.holdDays,
      isLongTerm: pos.isLongTerm,
      washSaleRisk,
      potentialTaxSaving: estimateTaxSaving(pos.unrealizedPnl, pos.isLongTerm),
      message: washSaleRisk
        ? `${pos.ticker} has a $${Math.abs(pos.unrealizedPnl).toFixed(2)} unrealized loss, but selling now risks a wash sale. Consider waiting or buying a similar (not identical) stock.`
        : `${pos.ticker} has a $${Math.abs(pos.unrealizedPnl).toFixed(2)} unrealized loss. Harvesting this could save ~$${estimateTaxSaving(pos.unrealizedPnl, pos.isLongTerm).toFixed(0)} in taxes${netRealizedGain > 0 ? ` and offset your $${netRealizedGain.toFixed(2)} in realized gains this year` : ''}.`,
    });
  }

  return {
    ytdRealizedGains,
    ytdRealizedLosses,
    netRealizedGain,
    opportunities,
    totalHarvestable: losers.reduce((s, p) => s + Math.abs(p.unrealizedPnl), 0),
    annualDeductionRemaining: Math.max(0, 3000 - Math.abs(ytdRealizedLosses)), // $3K annual loss deduction limit
  };
}

/**
 * Classify all gains as short-term or long-term.
 */
function classifyGains(positions, closedTrades) {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const ytdTrades = closedTrades.filter(t => t.closed_at >= yearStart);

  // Realized gains classification (from closed trades)
  const shortTermRealized = ytdTrades
    .filter(t => (t.hold_days ?? 0) < LONG_TERM_DAYS)
    .reduce((s, t) => s + (t.pnl ?? 0), 0);

  const longTermRealized = ytdTrades
    .filter(t => (t.hold_days ?? 0) >= LONG_TERM_DAYS)
    .reduce((s, t) => s + (t.pnl ?? 0), 0);

  // Unrealized classification (from open positions)
  const shortTermUnrealized = positions
    .filter(p => !p.isLongTerm)
    .reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);

  const longTermUnrealized = positions
    .filter(p => p.isLongTerm)
    .reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);

  // Positions approaching long-term status (within 30 days)
  const approachingLongTerm = positions
    .filter(p => !p.isLongTerm && p.daysToLongTerm <= 30 && p.daysToLongTerm > 0)
    .map(p => ({
      ticker: p.ticker,
      daysToLongTerm: p.daysToLongTerm,
      unrealizedPnl: p.unrealizedPnl,
      taxRateDifference: p.unrealizedPnl > 0
        ? `Waiting ${p.daysToLongTerm} days could save ~$${estimateLongTermSaving(p.unrealizedPnl).toFixed(0)} in taxes`
        : null,
    }));

  return {
    realized: {
      shortTerm: parseFloat(shortTermRealized.toFixed(2)),
      longTerm: parseFloat(longTermRealized.toFixed(2)),
      total: parseFloat((shortTermRealized + longTermRealized).toFixed(2)),
    },
    unrealized: {
      shortTerm: parseFloat(shortTermUnrealized.toFixed(2)),
      longTerm: parseFloat(longTermUnrealized.toFixed(2)),
      total: parseFloat((shortTermUnrealized + longTermUnrealized).toFixed(2)),
    },
    approachingLongTerm,
    estimatedTaxLiability: estimateTaxLiability(shortTermRealized, longTermRealized),
  };
}

/**
 * Year-end tax optimization suggestions.
 */
function getYearEndSuggestions(positions, closedTrades) {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const ytdTrades = closedTrades.filter(t => t.closed_at >= yearStart);

  const suggestions = [];

  // Only show year-end specific tips in Q4 (Oct–Dec)
  const isQ4 = month >= 9;

  const netRealizedGain = ytdTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const unrealizedLosses = positions.filter(p => p.unrealizedPnl < 0);
  const totalUnrealizedLoss = unrealizedLosses.reduce((s, p) => s + p.unrealizedPnl, 0);

  // Suggestion: Harvest losses to offset gains
  if (netRealizedGain > 0 && unrealizedLosses.length > 0) {
    const bestHarvest = unrealizedLosses.sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)[0];
    suggestions.push({
      type: 'harvest_to_offset',
      priority: 'high',
      message: `You have $${netRealizedGain.toFixed(2)} in realized gains this year. Consider harvesting the $${Math.abs(bestHarvest.unrealizedPnl).toFixed(2)} loss on ${bestHarvest.ticker} to offset${isQ4 ? ' before year-end' : ''}.`,
      potentialSaving: estimateTaxSaving(Math.min(Math.abs(bestHarvest.unrealizedPnl), netRealizedGain), false),
    });
  }

  // Suggestion: Use the $3K annual loss deduction
  const realizedLosses = Math.abs(ytdTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  if (realizedLosses < 3000 && unrealizedLosses.length > 0 && netRealizedGain <= 0) {
    const remainingDeduction = 3000 - realizedLosses;
    suggestions.push({
      type: 'annual_deduction',
      priority: 'medium',
      message: `You've only used $${realizedLosses.toFixed(0)} of your $3,000 annual loss deduction. You could harvest up to $${remainingDeduction.toFixed(0)} more in losses to reduce your taxable income.`,
      potentialSaving: estimateTaxSaving(-remainingDeduction, false),
    });
  }

  // Suggestion: Positions close to long-term status
  const almostLongTerm = positions.filter(p =>
    !p.isLongTerm && p.daysToLongTerm <= 30 && p.unrealizedPnl > 0
  );
  for (const pos of almostLongTerm) {
    suggestions.push({
      type: 'hold_for_long_term',
      priority: 'high',
      ticker: pos.ticker,
      message: `${pos.ticker} has a $${pos.unrealizedPnl.toFixed(2)} gain and becomes long-term in ${pos.daysToLongTerm} days. Holding could save ~$${estimateLongTermSaving(pos.unrealizedPnl).toFixed(0)} in taxes (15% vs ~24% rate).`,
      potentialSaving: estimateLongTermSaving(pos.unrealizedPnl),
    });
  }

  // Suggestion: Wash sale warning for recent losses
  const recentLosses = closedTrades.filter(t =>
    t.pnl < 0 && t.closed_at &&
    (Date.now() - new Date(t.closed_at).getTime()) < WASH_SALE_WINDOW_DAYS * MS_PER_DAY
  );
  for (const loss of recentLosses) {
    const daysSince = Math.ceil((Date.now() - new Date(loss.closed_at).getTime()) / MS_PER_DAY);
    const daysLeft = WASH_SALE_WINDOW_DAYS - daysSince;
    if (daysLeft > 0) {
      suggestions.push({
        type: 'wash_sale_wait',
        priority: 'high',
        ticker: loss.ticker,
        message: `Don't rebuy ${loss.ticker} for ${daysLeft} more days — you sold it at a $${Math.abs(loss.pnl).toFixed(2)} loss on ${new Date(loss.closed_at).toLocaleDateString()}. Rebuying before then voids the tax deduction.`,
      });
    }
  }

  return suggestions.sort((a, b) => {
    const priority = { high: 0, medium: 1, low: 2 };
    return (priority[a.priority] ?? 2) - (priority[b.priority] ?? 2);
  });
}

/**
 * Build a human-readable summary for the agent to use.
 */
function buildSummary(gains, harvesting, washSales) {
  const parts = [];

  if (gains.realized.total !== 0) {
    parts.push(`YTD realized: $${gains.realized.total.toFixed(2)} (${gains.realized.shortTerm >= 0 ? '+' : ''}$${gains.realized.shortTerm.toFixed(2)} short-term, ${gains.realized.longTerm >= 0 ? '+' : ''}$${gains.realized.longTerm.toFixed(2)} long-term)`);
  }

  if (gains.estimatedTaxLiability > 0) {
    parts.push(`Estimated tax liability: ~$${gains.estimatedTaxLiability.toFixed(0)}`);
  }

  if (harvesting.opportunities.length > 0) {
    const total = harvesting.totalHarvestable;
    parts.push(`${harvesting.opportunities.length} tax-loss harvesting opportunity${harvesting.opportunities.length > 1 ? 'ies' : 'y'} ($${total.toFixed(2)} harvestable)`);
  }

  if (washSales.length > 0) {
    const active = washSales.filter(w => w.type === 'active_wash_sale');
    if (active.length > 0) {
      parts.push(`${active.length} active wash sale${active.length > 1 ? 's' : ''} — some losses not deductible`);
    }
  }

  if (gains.approachingLongTerm.length > 0) {
    parts.push(`${gains.approachingLongTerm.length} position${gains.approachingLongTerm.length > 1 ? 's' : ''} within 30 days of long-term status`);
  }

  return parts.length > 0 ? parts.join('. ') + '.' : 'No significant tax events detected.';
}

// === Tax estimation helpers ===

function estimateTaxSaving(lossAmount, isLongTerm) {
  // Approximate — short-term taxed at ~24% (median bracket), long-term at ~15%
  const rate = isLongTerm ? 0.15 : 0.24;
  return Math.abs(lossAmount) * rate;
}

function estimateLongTermSaving(gainAmount) {
  // Difference between short-term (~24%) and long-term (~15%) rate
  return Math.abs(gainAmount) * 0.09;
}

function estimateTaxLiability(shortTermGains, longTermGains) {
  const stTax = shortTermGains > 0 ? shortTermGains * 0.24 : 0;
  const ltTax = longTermGains > 0 ? longTermGains * 0.15 : 0;
  return stTax + ltTax;
}
