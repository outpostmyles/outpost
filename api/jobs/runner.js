import '../config.js';
import { backgroundScan } from '../functions/social.js';
import { runBargainScan } from '../functions/bargainRadar.js';
import { runDailyScreeners } from '../functions/screeners.js';
import { refreshAllThesisWatches } from '../services/thesisWatch.js';
import { generateAllExplainers } from '../functions/portfolioExplainer.js';
import { generateAllDigests } from '../services/proactiveDigest.js';
import { sendAllDailyDigestEmails, sendAllWeeklySummaryEmails } from '../services/notifications.js';
import { supabase } from '../db.js';
import { getETTime, todayStr, isWeekday } from '../utils/marketHours.js';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { buildBriefContext } from '../utils/promptEngine.js';
import { getPrices, initPricePool } from '../services/pricePool.js';
import { resetDailyCounters } from '../services/analytics.js';
import { alertMonitorTick } from '../services/alertMonitor.js';
import { runFounderDigest } from '../services/founderDigest.js';
import { PLAN_CREDITS } from '../constants/planCredits.js';
import { PLAIN_TEXT_RULE, NO_DASH_RULE, trimToLastSentence } from '../utils/aiStyle.js';

const anthropic = new Anthropic({ apiKey: config.anthropicKey });

// Run social scan every 30 min
const CATEGORIES = ['all', 'stocks', 'pennystocks', 'etfs', 'crypto'];
CATEGORIES.forEach((cat, i) => {
  setTimeout(() => {
    backgroundScan(cat);
    setInterval(() => backgroundScan(cat), 30 * 60 * 1000);
  }, i * 12000);
});

/**
 * Concurrency limiter — runs async functions with max N concurrent.
 * Prevents Claude API burst at 7:30am with 500+ users.
 */
async function withConcurrency(items, fn, maxConcurrent = 5) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const p = fn(item).then(r => {
      executing.delete(p);
      return r;
    });
    executing.add(p);
    results.push(p);

    if (executing.size >= maxConcurrent) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

async function generateBriefForUser(user) {
  const today = todayStr();
  const cacheKey = `brief_${user.id}_${today}`;
  const { data: existing } = await supabase.from('ai_cache').select('id').eq('cache_key', cacheKey).maybeSingle();
  if (existing) return false;

  const ctx = await buildBriefContext(user.id, user);
  if (ctx.positionCount === 0) return false;

  // Brief structure (drilled into the prompt):
  //   Sentence 1: today's market read in plain English, framed for the trader's STYLE.
  //   Sentence 2: one specific observation about THEIR positions — uses trade-plan
  //               distance / active alerts / premarket movers when present.
  //   Sentence 3: ONE concrete thing to do or watch today (never "be careful").
  // Switching from Sonnet→Haiku saves ~94% per call; the tighter spec more than
  // compensates for the model swap. Trade plan + ticker news inputs come from
  // buildBriefContext so the brief is no longer blind to the user's stated intent.
  const system = `You are Outpost, the friend in someone's phone who actually knows finance. You're writing the morning brief for ONE specific person before the market opens. Read it like you're texting them, not delivering a corporate update.

OUTPUT (3 short sentences, in this exact order, no headers, no labels, no numbering):
1) ONE sentence on today's market in plain English, from THIS person's angle (swing trader, long-term investor, etc.). Name what's happening AND what it means for them. "Stocks are calm and tech is leading, a quiet and friendly day for your kind of trading" beats "Regime: risk-on, VIX at 16".
2) ONE sentence about THEIR portfolio. If there's an ACTIVE ALERT (near target/stop), lead with that company and the level. If a position is a big premarket mover, lead with the company and the news. Otherwise call out one position that matters today.
3) ONE concrete thing to do or watch today. Never "be careful" alone, say WHAT to watch and what it would mean. "Watch SPY around 585, a break below means the rally's losing steam" beats "exercise caution".

ABSOLUTE RULES:
- Use full company names ("Apple", "Meta", "Nvidia"), not just tickers, when the count is small.
- Cite specific prices and percentages from the input, never "your positions" or "some tickers". Never invent prices not in the input.
- Never restate the trader's P&L. They can see it.
- Don't open with "Good morning", the UI provides framing.
- Do not invent news. If headlines aren't in the input, don't speculate on catalysts.
- If a position shows "hold duration unknown", do NOT reference how long it's been held, do NOT use phrases like "long-term holder" or "recent buy", and do NOT infer tax status.
- VOICE: smart friend texting, not a Bloomberg analyst. Sentences under 22 words. Break clauses with periods, not em-dashes or commas-into-run-ons. Plain English by default. Honest about risk, never doom, never condescending.
- HARD WORD BANS, these are forbidden, no exceptions:
  - "tape" or "broad tape" → say "the market" or "stocks overall"
  - "capex" → say "spending" or "investment in [thing]"
  - "drawdown" → say "loss from where you bought it" or "down from your entry"
  - "thesis" → say "the reason you bought it" or "your original take"
  - "roll over" → say "lose steam" or "reverse"
  - "value trap" → say "a stock that looks cheap but the business is actually broken"
  - "regime" → say "the market is calm/jittery/etc."
- Never invent specific price levels not in the input. If you cite a level for an alert or watch, it must be a price that appeared in the inputs.
${PLAIN_TEXT_RULE}`;

  const userMsg = [
    `Trader: ${ctx.name} | Style: ${ctx.tradingStyle} | Risk: ${ctx.riskTolerance}`,
    `Market: regime ${ctx.regime}, VIX ${ctx.vix} (${ctx.vixLabel}), F&G ${ctx.fearGreed} (${ctx.fearGreedLabel}), SPY RSI ${ctx.spyRsi}`,
    `Positions: ${ctx.positions}`,
    ctx.tradePlansStr || '',
    ctx.activeAlertsStr || '',
    ctx.tickerNewsStr || '',
    '',
    'Write the brief now.',
  ].filter(Boolean).join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 320, // was 220, which cut briefs off mid-sentence
      system,
      messages: [{ role: 'user', content: userMsg }],
    }, { signal: controller.signal });

    // Trim to the last complete sentence so a token-cap cutoff never ships a
    // dangling fragment to the user's morning brief.
    const brief = trimToLastSentence(msg.content[0].text);
    const now = new Date().toISOString();
    await supabase.from('ai_cache').insert({ cache_key: cacheKey, result: brief, created_at: now });

    // Credits: 8 (down from 15) — Haiku is much cheaper, but the brief is still
    // a daily premium feature, so keep it priced as a real touchpoint, not free.
    await supabase.from('user_profiles').update({
      credits_remaining: Math.max(0, user.credits_remaining - 8),
      credits_used_this_month: (user.credits_used_this_month ?? 0) + 8,
    }).eq('id', user.id);

    return true;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateBriefs() {
  if (!isWeekday()) return;
  console.log('[Jobs] Generating pre-market briefs...');
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: users } = await supabase.from('user_profiles').select('*').neq('plan', 'free').gt('last_login', sevenDaysAgo);
  if (!users?.length) return;

  const results = await withConcurrency(users, async (user) => {
    try {
      return await generateBriefForUser(user);
    } catch (err) {
      console.error(`[Jobs] Brief failed for ${user.id}:`, err.message);
      return false;
    }
  }, 5);

  const count = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
  console.log(`[Jobs] Generated ${count} briefs for ${users.length} eligible users`);
}

async function takeSnapshots() {
  if (!isWeekday()) return;
  console.log('[Jobs] Taking portfolio snapshots...');
  const today = todayStr();
  const { data: users } = await supabase.from('user_profiles').select('id').limit(1000);
  let count = 0;
  for (const user of users ?? []) {
    try {
      const { data: existing } = await supabase.from('portfolio_snapshots').select('id').eq('user_id', user.id).eq('date', today).maybeSingle();
      if (existing) continue;

      // Fetch positions with shares and avg_cost — compute value from LIVE prices
      const { data: positions } = await supabase.from('positions').select('ticker,shares,avg_cost').eq('user_id', user.id);
      if (!positions?.length) continue;

      const tickers = positions.map(p => p.ticker);
      const priceMap = getPrices(tickers);

      let totalValue = 0;
      let totalCost = 0;
      for (const p of positions) {
        const livePrice = priceMap[p.ticker]?.price ?? p.avg_cost ?? 0;
        totalValue += livePrice * (p.shares ?? 0);
        totalCost += (p.avg_cost ?? 0) * (p.shares ?? 0);
      }
      const totalPnl = totalValue - totalCost;

      // Only snapshot if we got meaningful data (at least one live price)
      if (totalValue <= 0) continue;

      await supabase.from('portfolio_snapshots').insert({ user_id: user.id, total_value: parseFloat(totalValue.toFixed(2)), total_pnl: parseFloat(totalPnl.toFixed(2)), date: today });
      count++;
    } catch (err) { console.error('[Jobs] Snapshot failed for user', user.id, ':', err.message); }
  }
  console.log(`[Jobs] Snapshotted ${count} portfolios`);
}

async function resetCredits() {
  const today = new Date().getDate();
  const { data: users } = await supabase.from('user_profiles').select('id,plan,billing_date').eq('billing_date', today);
  for (const user of users ?? []) {
    await supabase.from('user_profiles').update({ credits_remaining: PLAN_CREDITS[user.plan] ?? 50, credits_used_this_month: 0 }).eq('id', user.id);
  }
  if (users?.length) console.log(`[Jobs] Reset credits for ${users.length} users`);
}

function scheduleAt(hour, min, fn, label) {
  const now = getETTime();
  const target = new Date(now);
  target.setHours(hour, min, 0, 0);
  let delay = target.getTime() - now.getTime();
  if (delay < 0) delay += 24 * 60 * 60 * 1000;
  setTimeout(() => {
    fn();
    setInterval(fn, 24 * 60 * 60 * 1000);
  }, delay);
  console.log(`[Jobs] Scheduled ${label} in ${Math.round(delay / 60000)}m`);
}

scheduleAt(7, 0, async () => {
  if (!isWeekday()) return;
  try { await generateAllDigests(); } catch (err) { console.error('[Jobs] Proactive digest failed:', err.message); }
}, 'Proactive digests');
// Wrapped in try/catch so a Supabase blip BEFORE the inner try doesn't
// take down the jobs runner. Same defensive pattern as the other scheduled
// jobs in this file.
scheduleAt(7, 30, async () => {
  try { await generateBriefs(); } catch (err) { console.error('[Jobs] Pre-market briefs failed:', err.message); }
}, 'Pre-market briefs');
// Email the digest 15 min after generation completes (gives the cron room to finish even at scale)
scheduleAt(7, 45, async () => {
  if (!isWeekday()) return;
  try { await sendAllDailyDigestEmails(); } catch (err) { console.error('[Jobs] Daily digest email failed:', err.message); }
}, 'Daily digest emails');
// Weekly summary fires daily at 6pm but skips non-Sundays (cleaner than a custom weekly scheduler)
scheduleAt(18, 0, async () => {
  if (getETTime().getDay() !== 0) return;
  try { await sendAllWeeklySummaryEmails(); } catch (err) { console.error('[Jobs] Weekly summary failed:', err.message); }
}, 'Weekly summary emails');
// Founder digest fires daily at 9am but skips non-Mondays — gives Myles a Monday-morning read
scheduleAt(9, 0, async () => {
  if (getETTime().getDay() !== 1) return;
  try { await runFounderDigest(); } catch (err) { console.error('[Jobs] Founder digest failed:', err.message); }
}, 'Founder digest');
scheduleAt(16, 30, async () => {
  try { await takeSnapshots(); } catch (err) { console.error('[Jobs] Portfolio snapshots failed:', err.message); }
}, 'Portfolio snapshots');
scheduleAt(16, 45, async () => {
  if (!isWeekday()) return;
  try { await generateAllExplainers(); } catch (err) { console.error('[Jobs] Portfolio explainers failed:', err.message); }
}, 'Portfolio explainers');
scheduleAt(17, 0, async () => {
  if (!isWeekday()) return;
  try { await runBargainScan(); } catch (err) { console.error('[Jobs] Bargain scan failed:', err.message); }
}, 'Bargain Radar scan');
// Living thesis watch: re-judge whether the reason behind each held thesis still
// holds, against the day's news and fundamentals. Weekday only, after the close,
// so the verdicts are fresh on the cards and ready for the morning read.
scheduleAt(18, 0, async () => {
  if (!isWeekday()) return;
  try { await refreshAllThesisWatches(); } catch (err) { console.error('[Jobs] Thesis watch refresh failed:', err.message); }
}, 'Thesis watch refresh');
// Living screens: re-run each saved screener after the close so it surfaces what
// is new since the user last looked. Weekday only, for fresh end-of-day prices.
scheduleAt(18, 30, async () => {
  if (!isWeekday()) return;
  try { await runDailyScreeners(); } catch (err) { console.error('[Jobs] Screener refresh failed:', err.message); }
}, 'Screener refresh');
scheduleAt(0, 1, resetCredits, 'Credit resets');
scheduleAt(0, 0, resetDailyCounters, 'Analytics daily reset');
resetCredits();

// ─── Price alert monitor ────────────────────────────────────────────────
// Runs every 5 minutes. The alertMonitorTick() function internally skips
// outside market hours so we don't hit the DB for nothing overnight. The
// price pool must already be initialized so the monitor has fresh prices
// to compare against — start it here since the jobs process runs
// independently of the web server.
(async () => {
  try {
    await initPricePool();
    console.log('[Jobs] Price pool initialized for alert monitor');
    setInterval(async () => {
      try { await alertMonitorTick(); } catch (err) { console.error('[Jobs] Alert monitor tick failed:', err.message); }
    }, 5 * 60 * 1000);
    // Also run once ~30s after boot so alerts that should already be triggered don't wait 5 full minutes
    setTimeout(() => alertMonitorTick().catch(() => {}), 30 * 1000);
    console.log('[Jobs] Scheduled alert monitor every 5 minutes (market hours only)');
  } catch (err) {
    console.error('[Jobs] Alert monitor init failed:', err.message);
  }
})();

console.log('[Jobs] Background jobs running');
