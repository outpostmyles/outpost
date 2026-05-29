// Behavior-outcome attribution.
//
// Aggregates the user's closed trades by behavior (wrote a thesis vs didn't,
// set a stop-loss vs didn't, set a price target vs didn't) and computes win
// rate + avg pnl % for each cut. Renders as a "Your Patterns" card on the
// Journal tab so the user can SEE that their disciplined trades outperform
// their undisciplined ones — the framework becomes measurable to them, not
// just preached at them.
//
// Pure SQL aggregation, no AI call, fast and cheap. Returns "not enough
// data" when the user has fewer than 5 closed trades — below that the
// numbers are too noisy to be meaningful and would feed false certainty.
import express from 'express';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = express.Router();

const MIN_TRADES_FOR_ATTRIBUTION = 5;

// Helper: compute win rate + avg pnl% for a subset of trades.
function aggregate(trades) {
  if (!trades?.length) return { count: 0, winRate: null, avgPnlPercent: null, avgHoldDays: null };
  const wins = trades.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate = parseFloat(((wins / trades.length) * 100).toFixed(1));
  const totalPnl = trades.reduce((s, t) => s + (t.pnl_percent ?? 0), 0);
  const avgPnlPercent = parseFloat((totalPnl / trades.length).toFixed(1));
  const totalHold = trades.reduce((s, t) => s + (t.hold_days ?? 0), 0);
  const tradesWithHold = trades.filter(t => t.hold_days != null);
  const avgHoldDays = tradesWithHold.length > 0
    ? Math.round(totalHold / tradesWithHold.length)
    : null;
  return { count: trades.length, winRate, avgPnlPercent, avgHoldDays };
}

// GET /api/portfolio/attribution
//
// Returns:
//   {
//     ready: true | false,
//     totalTrades: number,
//     minRequired: number,
//     patterns?: {
//       thesis: { with: agg, without: agg, lift: number | null },
//       stopLoss: { with: agg, without: agg, lift: number | null },
//       priceTarget: { with: agg, without: agg, lift: number | null },
//       reflection: { with: agg, without: agg, lift: number | null }
//     }
//   }
//
// When ready=false, frontend shows the "not enough data — write theses on
// your active positions to start tracking" empty state.
// Columns the endpoint selects. execution_rating is in its own list because
// it was added in migration 017 and may not exist in older DBs. If the
// primary query fails with a "column does not exist" error we retry without
// the optional columns so users on stale schemas still see Patterns. The
// execution-rating block in the response just won't appear for them, which
// is correct behavior since they couldn't have rated any closes anyway.
const REQUIRED_COLS = 'pnl, pnl_percent, entry_thesis, stop_loss, price_target, exit_reflection, reflection_lesson, reflection_what_happened, hold_days';
const OPTIONAL_COLS = ['execution_rating'];

async function fetchClosedTradesResilient(userId) {
  const fullSelect = [REQUIRED_COLS, ...OPTIONAL_COLS].join(', ');
  const { data, error } = await supabase
    .from('closed_trades')
    .select(fullSelect)
    .eq('user_id', userId)
    .order('closed_at', { ascending: false })
    .limit(500);
  if (!error) return data ?? [];

  // Retry without optional columns if the error looks schema-related. Supabase
  // returns code '42703' (undefined_column) or a message containing 'column'
  // and 'does not exist'. Be lenient on detection because exact error shape
  // varies across PostgREST versions.
  const msg = (error.message || '').toLowerCase();
  const looksLikeMissingColumn = error.code === '42703'
    || (msg.includes('column') && msg.includes('does not exist'))
    || msg.includes('execution_rating');
  if (!looksLikeMissingColumn) throw error;

  console.warn(`[Attribution] Falling back to schema-safe query (missing optional column). Error was: ${error.message}`);
  const { data: fallbackData, error: fallbackErr } = await supabase
    .from('closed_trades')
    .select(REQUIRED_COLS)
    .eq('user_id', userId)
    .order('closed_at', { ascending: false })
    .limit(500);
  if (fallbackErr) throw fallbackErr;
  return fallbackData ?? [];
}

router.get('/', requireAuth, rateLimit(15), async (req, res) => {
  try {
    const trades = await fetchClosedTradesResilient(req.user.id);

    const all = trades ?? [];
    if (all.length < MIN_TRADES_FOR_ATTRIBUTION) {
      return res.json({
        ready: false,
        totalTrades: all.length,
        minRequired: MIN_TRADES_FOR_ATTRIBUTION,
      });
    }

    // Cut 1: had thesis vs didn't
    const withThesis = all.filter(t => t.entry_thesis && t.entry_thesis.trim().length > 0);
    const withoutThesis = all.filter(t => !t.entry_thesis || t.entry_thesis.trim().length === 0);

    // Cut 2: had stop-loss vs didn't
    const withStop = all.filter(t => t.stop_loss != null && t.stop_loss > 0);
    const withoutStop = all.filter(t => t.stop_loss == null || t.stop_loss <= 0);

    // Cut 3: had price target vs didn't
    const withTarget = all.filter(t => t.price_target != null && t.price_target > 0);
    const withoutTarget = all.filter(t => t.price_target == null || t.price_target <= 0);

    // Cut 4: logged a reflection on close vs didn't.
    // Any of the three reflection fields counts as "reflected."
    const hasReflection = t =>
      (t.exit_reflection && t.exit_reflection.trim()) ||
      (t.reflection_lesson && t.reflection_lesson.trim()) ||
      (t.reflection_what_happened && t.reflection_what_happened.trim());
    const withReflection = all.filter(hasReflection);
    const withoutReflection = all.filter(t => !hasReflection(t));

    // "Lift" is the absolute percentage-point delta in win rate. We only
    // surface it when BOTH groups have at least 3 trades — below that the
    // comparison is meaningless. Null lift means "not enough data to compare."
    function lift(aWith, aWithout) {
      if (aWith.winRate == null || aWithout.winRate == null) return null;
      if (aWith.count < 3 || aWithout.count < 3) return null;
      return parseFloat((aWith.winRate - aWithout.winRate).toFixed(1));
    }

    const thesisAgg = { with: aggregate(withThesis), without: aggregate(withoutThesis) };
    const stopAgg = { with: aggregate(withStop), without: aggregate(withoutStop) };
    const targetAgg = { with: aggregate(withTarget), without: aggregate(withoutTarget) };
    const reflectionAgg = { with: aggregate(withReflection), without: aggregate(withoutReflection) };

    // Execution rating summary. Separate from the with/without pattern shape
    // because it's a 1-5 score, not a binary cut. Show distribution + avg +
    // win-rate-when-high-execution (4-5) vs win-rate-when-low (1-2). This is
    // the killer retrospective metric: execution is the controllable thing,
    // so seeing the win-rate delta when you executed well is the real edge.
    const rated = all.filter(t => t.execution_rating != null);
    let executionSummary = null;
    if (rated.length >= 3) {
      const avg = rated.reduce((s, t) => s + t.execution_rating, 0) / rated.length;
      const dist = [1, 2, 3, 4, 5].map(score => ({
        score,
        count: rated.filter(t => t.execution_rating === score).length,
      }));
      const highExec = rated.filter(t => t.execution_rating >= 4);
      const lowExec = rated.filter(t => t.execution_rating <= 2);
      const highAgg = aggregate(highExec);
      const lowAgg = aggregate(lowExec);
      executionSummary = {
        rated: rated.length,
        unrated: all.length - rated.length,
        avgRating: parseFloat(avg.toFixed(2)),
        distribution: dist,
        whenHigh: highAgg,
        whenLow: lowAgg,
        lift: (highAgg.winRate != null && lowAgg.winRate != null && highAgg.count >= 2 && lowAgg.count >= 2)
          ? parseFloat((highAgg.winRate - lowAgg.winRate).toFixed(1))
          : null,
      };
    }

    res.json({
      ready: true,
      totalTrades: all.length,
      minRequired: MIN_TRADES_FOR_ATTRIBUTION,
      patterns: {
        thesis: { ...thesisAgg, lift: lift(thesisAgg.with, thesisAgg.without) },
        stopLoss: { ...stopAgg, lift: lift(stopAgg.with, stopAgg.without) },
        priceTarget: { ...targetAgg, lift: lift(targetAgg.with, targetAgg.without) },
        reflection: { ...reflectionAgg, lift: lift(reflectionAgg.with, reflectionAgg.without) },
      },
      execution: executionSummary,  // null if fewer than 3 rated trades
    });
  } catch (err) {
    console.error(`[req:${req.requestId}] [Attribution] failed:`, err.message);
    res.status(500).json({ error: 'Could not load patterns' });
  }
});

export default router;
