// The verdict logic behind pre_trade_check, the agent's flagship safety tool:
// given the user's aggregated portfolio state and a proposed buy, decide
// ok / caution / stop and explain why (single-name concentration, sector
// stacking, dollar risk vs the user's stated tolerance). This is the
// highest-stakes reasoning in the app, so it is pure and unit-tested.
// preTradeCheck does the DB and live-price gathering, then hands the aggregates
// here.

const RISK_CAP_BY_TOLERANCE = { conservative: 1, moderate: 2, aggressive: 3.5 };

export function assessPreTradeRisk({
  ticker,
  dollars,
  tickerSector = 'Unknown',
  portfolioValue = 0,
  sectorCounts = {},
  sectorValues = {},
  existingPosition = null,
  currentPrice = null,
  stopLoss = null,
  riskTolerance = 'moderate',
}) {
  const newTotalValue = portfolioValue + dollars;
  const positionPctAfter = newTotalValue > 0 ? (dollars + (existingPosition?.currentValue ?? 0)) / newTotalValue * 100 : 100;

  const sameSectorCount = sectorCounts[tickerSector] || 0;
  const sameSectorValue = (sectorValues[tickerSector] || 0) + dollars;
  const sameSectorPctAfter = newTotalValue > 0 ? sameSectorValue / newTotalValue * 100 : 0;

  // Dollar risk if a stop loss is provided — needs the current price for the math
  let dollarRisk = null;
  let riskPctOfPortfolio = null;
  if (stopLoss && Number.isFinite(stopLoss) && currentPrice && currentPrice > stopLoss) {
    const riskPerShare = currentPrice - stopLoss;
    const shares = Math.floor(dollars / currentPrice);
    dollarRisk = +(riskPerShare * shares).toFixed(2);
    riskPctOfPortfolio = newTotalValue > 0 ? +(dollarRisk / newTotalValue * 100).toFixed(2) : null;
  }

  // Build findings
  const warnings = [];
  const notes = [];
  let verdict = 'ok';

  // Concentration check
  if (positionPctAfter >= 30) {
    warnings.push(`After this buy, ${ticker} would be ${positionPctAfter.toFixed(1)}% of your portfolio — that's a concentrated bet. One bad earnings report could wipe out weeks of gains.`);
    verdict = 'stop';
  } else if (positionPctAfter >= 20) {
    warnings.push(`After this buy, ${ticker} would be ${positionPctAfter.toFixed(1)}% of your portfolio — that's a large single position. Make sure you have high conviction.`);
    if (verdict === 'ok') verdict = 'caution';
  }

  // Sector overlap check
  if (sameSectorCount >= 4 && tickerSector !== 'Unknown') {
    warnings.push(`You already hold ${sameSectorCount} stocks in the ${tickerSector} sector (${sameSectorPctAfter.toFixed(1)}% of portfolio after this trade). Another ${tickerSector} name stacks the same macro bet.`);
    if (verdict === 'ok') verdict = 'caution';
  } else if (sameSectorCount >= 3 && sameSectorPctAfter >= 50 && tickerSector !== 'Unknown') {
    warnings.push(`This trade would push ${tickerSector} to ${sameSectorPctAfter.toFixed(1)}% of your portfolio. Consider whether you're diversified enough to weather a sector-specific drawdown.`);
    if (verdict === 'ok') verdict = 'caution';
  }

  // Risk tolerance vs dollar-at-risk
  if (riskPctOfPortfolio != null) {
    const cap = RISK_CAP_BY_TOLERANCE[riskTolerance] ?? 2;
    if (riskPctOfPortfolio > cap * 1.5) {
      warnings.push(`At your stop loss, you'd lose $${dollarRisk} (${riskPctOfPortfolio}% of portfolio). That's well above the ~${cap}% per-trade risk budget typical for a ${riskTolerance} profile. Consider a tighter stop or smaller size.`);
      verdict = 'stop';
    } else if (riskPctOfPortfolio > cap) {
      warnings.push(`Dollar risk at stop is ${riskPctOfPortfolio}% of portfolio — slightly above the ~${cap}% guideline for a ${riskTolerance} profile.`);
      if (verdict === 'ok') verdict = 'caution';
    } else {
      notes.push(`Risk at stop: $${dollarRisk} (${riskPctOfPortfolio}% of portfolio) — within a ${riskTolerance} risk budget.`);
    }
  } else if (stopLoss) {
    notes.push('Could not compute dollar risk (no live price yet for this ticker).');
  } else {
    notes.push('No stop loss provided — consider setting one before entering.');
  }

  // Existing position context
  if (existingPosition) {
    notes.push(`You already hold ${existingPosition.shares} shares of ${ticker} at $${existingPosition.avgCost?.toFixed?.(2) ?? existingPosition.avgCost}. This would be adding to it.`);
  }

  // Tiny portfolio guard
  if (portfolioValue > 0 && portfolioValue < 500) {
    notes.push(`Your tracked portfolio value is only $${portfolioValue.toFixed(0)} — make sure this reflects reality so the concentration math is meaningful.`);
  }

  if (warnings.length === 0) {
    notes.push(`${ticker} would be ${positionPctAfter.toFixed(1)}% of your portfolio after this buy — reasonable sizing.`);
  }

  return {
    ticker,
    dollars_to_invest: dollars,
    verdict, // 'ok' | 'caution' | 'stop'
    portfolio_value: +portfolioValue.toFixed(2),
    position_pct_after: +positionPctAfter.toFixed(2),
    sector: tickerSector,
    sector_positions_already: sameSectorCount,
    sector_pct_after: +sameSectorPctAfter.toFixed(2),
    risk_tolerance: riskTolerance,
    dollar_risk_at_stop: dollarRisk,
    risk_pct_of_portfolio: riskPctOfPortfolio,
    warnings,
    notes,
    guidance: verdict === 'stop'
      ? 'Stop — there\'s a meaningful problem here. Surface the warnings to the user explicitly and suggest smaller size or a different entry.'
      : verdict === 'caution'
      ? 'Caution — not a dealbreaker but the user should know the trade-off before clicking buy.'
      : 'Looks reasonable on structure. Still remind the user this is not advice and they own the decision.',
  };
}
