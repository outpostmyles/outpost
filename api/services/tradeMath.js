// Pure trade-advice math the agent hands a user directly: how many shares to
// buy for a given risk, and the risk/reward of a setup. The inputs arrive from
// Claude tool calls, so they are validated hard. A non-finite or out-of-range
// value must produce a clear error, never nonsense advice (an Infinity or
// negative share count, an "Infinity:1" ratio). Pure and dependency-free so the
// math is unit-testable.

// ============ POSITION SIZING ============

export function calculatePositionSize({ account_size, risk_pct = 2, entry_price, stop_loss, target_price }) {
  // Numeric validation up front. !value would let Infinity through (it is not
  // falsy), so use Number.isFinite, matching calculateRiskReward below.
  if (!Number.isFinite(account_size) || account_size <= 0) return { error: 'Account size must be a positive number' };
  if (!Number.isFinite(entry_price) || entry_price <= 0) return { error: 'Entry price must be a positive number' };
  if (!Number.isFinite(stop_loss) || stop_loss <= 0) return { error: 'Stop loss price must be a positive number' };
  // Unvalidated risk_pct was the sharp edge: a negative value produced a
  // negative share count, Infinity produced Infinity shares.
  if (!Number.isFinite(risk_pct) || risk_pct <= 0 || risk_pct > 100) return { error: 'Risk percent must be between 0 and 100' };
  if (stop_loss >= entry_price) return { error: 'Stop loss must be below entry price for a long position' };

  const riskPerShare = entry_price - stop_loss;
  const riskDollars = account_size * (risk_pct / 100);
  const riskBasedShares = Math.floor(riskDollars / riskPerShare);
  // AFFORDABILITY CAP: never recommend more shares than the account can pay for. A
  // tight stop makes the risk-based count balloon past the whole account (a $1,000
  // account told to buy $5,000 of stock), which is the single worst thing to hand a
  // beginner. The recommended size is the smaller of "risk-based" and "affordable".
  const affordableShares = Math.max(0, Math.floor(account_size / entry_price));
  const shares = Math.min(riskBasedShares, affordableShares);
  const cappedByAffordability = riskBasedShares > affordableShares;
  const totalCost = shares * entry_price;
  const portfolioPct = account_size > 0 ? (totalCost / account_size * 100) : 0;

  const result = {
    account_size,
    risk_pct,
    entry_price: +entry_price.toFixed(2),
    stop_loss: +stop_loss.toFixed(2),
    risk_per_share: +riskPerShare.toFixed(2),
    max_risk_dollars: +(shares * riskPerShare).toFixed(2),
    shares_to_buy: shares,
    total_cost: +totalCost.toFixed(2),
    portfolio_allocation_pct: +portfolioPct.toFixed(1),
  };

  if (target_price && Number.isFinite(target_price) && target_price > entry_price) {
    const rewardPerShare = target_price - entry_price;
    const riskRewardRatio = rewardPerShare / riskPerShare;
    const potentialProfit = shares * rewardPerShare;
    result.target_price = +target_price.toFixed(2);
    result.risk_reward_ratio = `${riskRewardRatio.toFixed(1)}:1`;
    result.potential_profit = +potentialProfit.toFixed(2);
    result.potential_loss = +(-shares * riskPerShare).toFixed(2);
    result.trade_quality = riskRewardRatio >= 3 ? 'Excellent (3:1+)'
      : riskRewardRatio >= 2 ? 'Good (2:1+)'
      : riskRewardRatio >= 1.5 ? 'Acceptable (1.5:1+)'
      : 'Poor, risk outweighs reward';
  }

  // Warnings
  const warnings = [];
  if (cappedByAffordability) warnings.push(`Capped to ${shares} share${shares === 1 ? '' : 's'}, the most a $${account_size} account can buy. Your stop is tight enough that a full ${risk_pct}% risk would cost more than your entire account, so this is the real ceiling. A true ${risk_pct}% risk would need a wider stop or more capital.`);
  if (portfolioPct > 25) warnings.push('Position is >25% of account, consider reducing size');
  if (portfolioPct > 50) warnings.push('DANGER: Position is >50% of account, way too concentrated');
  if (risk_pct > 5) warnings.push('Risking >5% per trade is aggressive, most pros risk 1-2%');
  if (shares === 0) warnings.push('Account too small or stop too tight for even 1 share at this risk level');
  if (warnings.length > 0) result.warnings = warnings;

  return result;
}

// ============ RISK / REWARD CALCULATOR ============

export function calculateRiskReward({ entry_price, stop_loss, targets }) {
  // Defensive numeric validation. Claude could supply NaN, Infinity, or
  // tiny/negative prices and the resulting math produces nonsense (Infinity
  // ratios, NaN percentages) that confuses the response and the user.
  if (!Number.isFinite(entry_price) || entry_price <= 0) return { error: 'Entry price must be a positive number' };
  if (!Number.isFinite(stop_loss) || stop_loss <= 0) return { error: 'Stop loss must be a positive number' };
  if (entry_price === stop_loss) return { error: 'Entry price and stop loss cannot be equal' };
  // Outpost is long-only. A stop at or above entry is either a typo or a short
  // setup, and grading it would silently hand the user short-side math the rest of
  // the app can never act on. Reject it, exactly as calculatePositionSize does.
  if (stop_loss > entry_price) return { error: 'Stop loss must sit below entry. Outpost is long-only, so a stop above entry is not a valid setup.' };
  if (!Array.isArray(targets) || targets.length === 0) return { error: 'Need at least one target' };
  // For a long, a real profit target sits above entry. Drop anything that does not
  // (non-finite, non-positive, or at/below entry) so the reward math stays positive
  // and the grade stays meaningful.
  const cleanTargets = targets.filter(t => Number.isFinite(t) && t > entry_price);
  if (cleanTargets.length === 0) return { error: 'For a long, at least one target must be above entry' };
  targets = cleanTargets;

  const riskPerShare = entry_price - stop_loss;

  const targetAnalysis = targets.map((target, i) => {
    const rewardPerShare = target - entry_price;
    const ratio = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;
    const movePct = ((target - entry_price) / entry_price * 100);
    return {
      target_num: i + 1,
      price: +target.toFixed(2),
      reward_per_share: +rewardPerShare.toFixed(2),
      risk_reward_ratio: `${ratio.toFixed(1)}:1`,
      move_required_pct: +movePct.toFixed(1),
      quality: ratio >= 3 ? 'Excellent' : ratio >= 2 ? 'Good' : ratio >= 1.5 ? 'Acceptable' : 'Poor',
    };
  });

  const stopMovePct = ((stop_loss - entry_price) / entry_price * 100);
  const bestRR = Math.max(...targetAnalysis.map(t => parseFloat(t.risk_reward_ratio)));

  return {
    direction: 'LONG',
    entry_price: +entry_price.toFixed(2),
    stop_loss: +stop_loss.toFixed(2),
    risk_per_share: +riskPerShare.toFixed(2),
    stop_distance_pct: +stopMovePct.toFixed(1),
    targets: targetAnalysis,
    best_risk_reward: `${bestRR.toFixed(1)}:1`,
    overall_grade: bestRR >= 3 ? 'A: Excellent setup'
      : bestRR >= 2 ? 'B: Good setup'
      : bestRR >= 1.5 ? 'C: Acceptable but tight'
      : 'D: Risk outweighs reward, consider passing',
  };
}
