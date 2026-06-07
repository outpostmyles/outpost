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
import { computeBehaviorPatterns, MIN_TRADES_FOR_ATTRIBUTION } from '../services/attributionPatterns.js';

const router = express.Router();

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
const REQUIRED_COLS = 'ticker, pnl, pnl_percent, entry_thesis, stop_loss, price_target, exit_reflection, reflection_lesson, reflection_what_happened, hold_days';
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

// Open-position thesis counts, so the client can bridge the open-vs-closed gap:
// the patterns below are from CLOSED trades, but a user who wrote theses on
// still-open positions should never be told they have none.
async function fetchOpenThesisCounts(userId) {
  try {
    const { data } = await supabase.from('positions').select('entry_thesis').eq('user_id', userId);
    const rows = data ?? [];
    const withThesis = rows.filter(p => p.entry_thesis && String(p.entry_thesis).trim().length > 0).length;
    return { total: rows.length, withThesis };
  } catch { return { total: 0, withThesis: 0 }; }
}

router.get('/', requireAuth, rateLimit(15), async (req, res) => {
  try {
    const [trades, openPositions] = await Promise.all([
      fetchClosedTradesResilient(req.user.id),
      fetchOpenThesisCounts(req.user.id),
    ]);
    // All the behavior math lives in a pure, tested module (sample-gating, the
    // per-bucket floor, the lift). The route just wires in the data.
    const result = computeBehaviorPatterns(trades);
    res.json({ ...result, openPositions });
  } catch (err) {
    console.error(`[req:${req.requestId}] [Attribution] failed:`, err.message);
    res.status(500).json({ error: 'Could not load patterns' });
  }
});

export default router;
