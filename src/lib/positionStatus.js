// Per-position attention status + the compact dollar formatter, extracted from
// PortfolioTab so the badge thresholds and sort scoring are unit-testable.
// computePositionStatus drives both the sort order (what bubbles to the top of
// the position list) and the badge on each row, so its tiers and priority order
// are user-facing: they decide what the user's eye is pulled to.
import { pctOfBookOf } from './bookStats.js';

/**
 * Compute per-position attention status. Used to sort the position list so
 * what needs the user's attention bubbles to the top, and to render a small
 * status badge on the collapsed row.
 *
 * Returns:
 *   - status: 'below_stop' | 'near_target' | 'deep_drawdown' | 'big_mover' | 'calm'
 *   - score:  numeric, higher = more attention. Used for sort order.
 *   - badgeLabel / badgeColor: rendering hints (only for non-calm)
 *   - concentration: pct of portfolio (rendered as warning chip if > 25)
 */
export function computePositionStatus(pos, totalValue) {
  const price = pos.currentPrice ?? 0;
  const pnlPct = pos.avg_cost > 0 && price ? ((price - pos.avg_cost) / pos.avg_cost) * 100 : 0;
  const todayPct = pos.todayChangePercent ?? 0;
  // Weight in the book comes from the single source: prefer the pctOfBook the
  // server already tagged onto the position, else compute it the one shared way.
  // Coalesce to 0 so a cashless/empty book renders a number, not null.
  const concentration = pos.pctOfBook != null ? pos.pctOfBook : (pctOfBookOf(pos, totalValue) ?? 0);

  // Below stop — most urgent
  if (pos.stop_loss && price && price < pos.stop_loss) {
    return { status: 'below_stop', score: 100, badgeLabel: 'BELOW STOP', badgeColor: 'var(--red)', concentration };
  }
  // Near or hit target
  if (pos.price_target && price) {
    if (price >= pos.price_target) {
      return { status: 'target_hit', score: 95, badgeLabel: 'TARGET HIT', badgeColor: 'var(--green)', concentration };
    }
    if (price >= pos.price_target * 0.95) {
      const distPct = ((pos.price_target - price) / price) * 100;
      return { status: 'near_target', score: 90, badgeLabel: `${distPct.toFixed(1)}% TO TARGET`, badgeColor: 'var(--green)', concentration };
    }
  }
  // Deep drawdown
  if (pnlPct <= -20) {
    return { status: 'deep_drawdown', score: 85, badgeLabel: `DOWN ${Math.abs(pnlPct).toFixed(0)}%`, badgeColor: 'var(--amber)', concentration };
  }
  // Big mover today
  if (Math.abs(todayPct) >= 5) {
    return { status: 'big_mover', score: 70 + Math.min(20, Math.abs(todayPct)), badgeLabel: `${todayPct >= 0 ? '+' : ''}${todayPct.toFixed(1)}% TODAY`, badgeColor: todayPct >= 0 ? 'var(--green)' : 'var(--red)', concentration };
  }
  // Moderate drawdown
  if (pnlPct <= -15) {
    return { status: 'moderate_drawdown', score: 60, badgeLabel: `DOWN ${Math.abs(pnlPct).toFixed(0)}%`, badgeColor: 'var(--amber)', concentration };
  }
  // Calm — no badge, lowest sort priority
  return { status: 'calm', score: 0, badgeLabel: null, badgeColor: null, concentration };
}

/**
 * Compact dollar formatter: $83.4K, $1.2M, $543. Used in the 3-stat hero so the
 * VALUE column never overflows on tall numbers. Non-finite degrades to a dash.
 */
export function fmtCompact(n) {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (abs >= 10_000)    return (n / 1000).toFixed(1) + 'K';
  if (abs >= 1000)      return (n / 1000).toFixed(2) + 'K';
  return n.toFixed(0);
}
