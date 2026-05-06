/**
 * Email Notifications Service
 *
 * Two cron-driven email types:
 *   1. Daily morning digest — weekday mornings, summarizes the proactive digest
 *      (already generated at 7:00am ET) and ships it to users opted-in.
 *      Skipped on "quiet days" where the digest service had nothing to say.
 *   2. Weekly performance summary — Sunday evenings. Aggregates the week's
 *      closed-trade P&L + win rate + top mover + attribution / adherence
 *      patterns. Reuses existing services so we don't recompute.
 *
 * Both respect per-user opt-out columns (email_daily_digest / email_weekly_summary).
 * Both bound concurrent Resend sends with a small limiter to avoid hammering
 * the Resend free-tier rate limits.
 *
 * Brand: dark theme matching the in-app aesthetic. Plain-text fallback inline.
 */

import { Resend } from 'resend';
import { supabase } from '../db.js';
import { config } from '../config.js';
import { getDigestForUser } from './proactiveDigest.js';
import { getPerformanceAttribution } from './performanceAttribution.js';
import { getPlanAdherence } from './planAdherence.js';
import { todayStr } from '../utils/marketHours.js';

const resend = config.resendKey ? new Resend(config.resendKey) : null;
const FROM_ADDRESS = 'Outpost <noreply@outpostapp.co>';
const APP_URL = config.frontendUrl || 'https://outpostapp.co';

// ============ HTML BUILDERS ============

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SHELL_OPEN = `
<div style="background:#08080c;color:#f1f1f3;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',monospace;max-width:560px;margin:0 auto">
  <h1 style="color:#3b82f6;margin:0 0 24px 0;font-size:18px;letter-spacing:1px">OUTPOST</h1>
`;

const SHELL_CLOSE = `
  <p style="margin:32px 0 0 0;color:rgba(255,255,255,0.3);font-size:10px;line-height:1.6">Educational purposes only. Not financial advice. Verify all market data independently.</p>
  <p style="margin:8px 0 0 0;color:rgba(255,255,255,0.3);font-size:10px">Adjust email preferences in Outpost → Settings → Notifications.</p>
</div>
`;

/**
 * Build the daily digest email HTML.
 * Returns { subject, html, text } or null if nothing to send.
 */
export function buildDailyDigestEmail({ displayName, digest }) {
  if (!digest || !digest.available || digest.quiet || !digest.digest) return null;

  const greeting = displayName ? `Hey ${escapeHtml(displayName)},` : 'Good morning,';
  const dateStr = new Date(digest.generatedAt).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  // Up to 4 high-signal bullet rows (priority-sorted)
  const signalRows = (digest.signals || []).slice(0, 4).map(s => `
    <li style="margin-bottom:6px;color:rgba(255,255,255,0.7);font-size:13px;line-height:1.55">${escapeHtml(s.detail)}</li>
  `).join('');

  const html = `${SHELL_OPEN}
    <p style="margin:0 0 6px 0;font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:0.5px;text-transform:uppercase">${dateStr}</p>
    <h2 style="margin:0 0 16px 0;font-size:18px;color:#f1f1f3">${greeting}</h2>
    <p style="margin:0 0 20px 0;font-size:14px;line-height:1.7;color:#f1f1f3">${escapeHtml(digest.digest)}</p>
    ${signalRows ? `
    <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;margin-top:16px">
      <p style="margin:0 0 8px 0;font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:0.8px">SIGNALS</p>
      <ul style="margin:0;padding-left:18px">${signalRows}</ul>
    </div>` : ''}
    <a href="${APP_URL}" style="display:inline-block;margin-top:24px;background:#3b82f6;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:700;font-size:13px;letter-spacing:0.5px">OPEN OUTPOST</a>
  ${SHELL_CLOSE}`;

  const text = `${greeting}\n\n${digest.digest}\n\n${(digest.signals || []).slice(0, 4).map(s => `- ${s.detail}`).join('\n')}\n\nOpen Outpost: ${APP_URL}`;

  // Subject derived from the most actionable signal (high-priority first), else generic
  const lead = (digest.signals || []).find(s => s.priority === 'high');
  const subject = lead?.ticker
    ? `${lead.ticker} — ${dateStr.split(',')[0]}`
    : `Your morning read — ${dateStr.split(',')[0]}`;

  return { subject, html, text };
}

/**
 * Build the weekly summary email HTML.
 */
export function buildWeeklySummaryEmail({ displayName, weekly }) {
  if (!weekly) return null;

  const {
    weekStart, weekEnd, closedThisWeek, netPnl, winRate,
    topWinner, topLoser, attribution, adherence, openUnrealized,
  } = weekly;

  const greeting = displayName ? `Hey ${escapeHtml(displayName)},` : 'Hey,';
  const periodStr = `${new Date(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(weekEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  const pnlColor = netPnl >= 0 ? '#10b981' : '#ef4444';
  const pnlSign = netPnl >= 0 ? '+' : '-';

  // Stat row (closed trades, win rate, net P&L)
  const stats = `
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr>
        <td style="padding:12px;background:rgba(255,255,255,0.03);border-radius:6px 0 0 6px;text-align:center">
          <p style="margin:0 0 2px 0;font-size:9px;color:rgba(255,255,255,0.4);letter-spacing:0.6px">CLOSED</p>
          <p style="margin:0;font-size:20px;font-weight:700;color:#f1f1f3">${closedThisWeek}</p>
        </td>
        <td style="padding:12px;background:rgba(255,255,255,0.03);text-align:center">
          <p style="margin:0 0 2px 0;font-size:9px;color:rgba(255,255,255,0.4);letter-spacing:0.6px">WIN RATE</p>
          <p style="margin:0;font-size:20px;font-weight:700;color:${winRate >= 50 ? '#10b981' : '#ef4444'}">${winRate}%</p>
        </td>
        <td style="padding:12px;background:rgba(255,255,255,0.03);border-radius:0 6px 6px 0;text-align:center">
          <p style="margin:0 0 2px 0;font-size:9px;color:rgba(255,255,255,0.4);letter-spacing:0.6px">NET P&amp;L</p>
          <p style="margin:0;font-size:20px;font-weight:700;color:${pnlColor}">${pnlSign}$${Math.abs(netPnl).toFixed(0)}</p>
        </td>
      </tr>
    </table>
  `;

  // Top mover rows
  const moversRows = [];
  if (topWinner) {
    moversRows.push(`<p style="margin:4px 0;font-size:13px;color:#f1f1f3"><span style="color:#10b981;font-weight:700">+$${topWinner.pnl.toFixed(0)}</span> ${escapeHtml(topWinner.ticker)} <span style="color:rgba(255,255,255,0.4);font-size:11px">held ${topWinner.hold_days}d</span></p>`);
  }
  if (topLoser) {
    moversRows.push(`<p style="margin:4px 0;font-size:13px;color:#f1f1f3"><span style="color:#ef4444;font-weight:700">-$${Math.abs(topLoser.pnl).toFixed(0)}</span> ${escapeHtml(topLoser.ticker)} <span style="color:rgba(255,255,255,0.4);font-size:11px">held ${topLoser.hold_days}d</span></p>`);
  }

  // Pattern call-outs (only if we have meaningful ones)
  const patternRows = [];
  if (attribution) {
    patternRows.push(`<p style="margin:6px 0;font-size:12px;color:rgba(255,255,255,0.7);line-height:1.5">${escapeHtml(attribution)}</p>`);
  }
  if (adherence) {
    patternRows.push(`<p style="margin:6px 0;font-size:12px;color:rgba(255,255,255,0.7);line-height:1.5">${escapeHtml(adherence)}</p>`);
  }

  const html = `${SHELL_OPEN}
    <p style="margin:0 0 6px 0;font-size:11px;color:rgba(255,255,255,0.4);letter-spacing:0.5px;text-transform:uppercase">Week of ${periodStr}</p>
    <h2 style="margin:0 0 8px 0;font-size:18px;color:#f1f1f3">${greeting}</h2>
    <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.6);line-height:1.6">Here's how the week broke down across your closed trades and current positions.</p>

    ${stats}

    ${moversRows.length > 0 ? `
    <p style="margin:20px 0 6px 0;font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:0.8px">TOP MOVERS</p>
    ${moversRows.join('')}` : ''}

    ${openUnrealized != null ? `
    <p style="margin:20px 0 6px 0;font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:0.8px">OPEN POSITIONS</p>
    <p style="margin:4px 0;font-size:13px;color:#f1f1f3">Unrealized: <span style="color:${openUnrealized >= 0 ? '#10b981' : '#ef4444'};font-weight:700">${openUnrealized >= 0 ? '+' : '-'}$${Math.abs(openUnrealized).toFixed(0)}</span></p>` : ''}

    ${patternRows.length > 0 ? `
    <p style="margin:20px 0 6px 0;font-size:10px;color:rgba(255,255,255,0.4);letter-spacing:0.8px">PATTERNS</p>
    ${patternRows.join('')}` : ''}

    <a href="${APP_URL}" style="display:inline-block;margin-top:24px;background:#3b82f6;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:700;font-size:13px;letter-spacing:0.5px">OPEN OUTPOST</a>
  ${SHELL_CLOSE}`;

  const text = [
    greeting,
    `Week of ${periodStr}`,
    '',
    `Closed: ${closedThisWeek}  ·  Win rate: ${winRate}%  ·  Net P&L: ${pnlSign}$${Math.abs(netPnl).toFixed(0)}`,
    '',
    topWinner ? `Top winner: ${topWinner.ticker} +$${topWinner.pnl.toFixed(0)}` : '',
    topLoser ? `Top loser: ${topLoser.ticker} -$${Math.abs(topLoser.pnl).toFixed(0)}` : '',
    '',
    attribution || '',
    adherence || '',
    '',
    `Open Outpost: ${APP_URL}`,
  ].filter(Boolean).join('\n');

  const subject = `Outpost weekly — ${closedThisWeek} trades, ${winRate}% win, ${pnlSign}$${Math.abs(netPnl).toFixed(0)}`;

  return { subject, html, text };
}

/**
 * Compute the weekly summary stats for one user.
 * Pure-ish — uses DB but no external API calls. Exported for tests.
 */
export async function computeWeeklySummary(userId, now = new Date()) {
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

  // Closed trades in the last 7 days
  const { data: trades } = await supabase
    .from('closed_trades')
    .select('ticker, pnl, pnl_percent, hold_days, closed_at, sell_price, avg_cost, shares')
    .eq('user_id', userId)
    .gte('closed_at', sevenDaysAgo.toISOString())
    .order('closed_at', { ascending: false });

  const list = trades ?? [];
  const winners = list.filter(t => (t.pnl ?? 0) > 0);
  const losers = list.filter(t => (t.pnl ?? 0) < 0);
  const netPnl = list.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const winRate = list.length > 0
    ? Math.round((winners.length / list.length) * 100)
    : 0;

  const topWinner = winners.sort((a, b) => b.pnl - a.pnl)[0] || null;
  const topLoser = losers.sort((a, b) => a.pnl - b.pnl)[0] || null;

  // Open position unrealized — pull from existing attribution service for consistency
  let openUnrealized = null;
  let attributionLine = '';
  try {
    const attribution = await getPerformanceAttribution(userId, { limit: 100 });
    openUnrealized = attribution.openContribution?.totalUnrealized ?? null;
    const stylePattern = attribution.patterns?.find(p => p.key === 'style_edge' || p.key === 'style_drag');
    if (stylePattern) attributionLine = stylePattern.headline + '. ' + stylePattern.detail;
  } catch {}

  let adherenceLine = '';
  try {
    const adh = await getPlanAdherence(userId, 30);
    if (adh.hasEnoughData && adh.patterns?.length) {
      const top = adh.patterns[0];
      adherenceLine = `${top.headline}. ${top.detail}`;
    }
  } catch {}

  return {
    weekStart: sevenDaysAgo.toISOString(),
    weekEnd: now.toISOString(),
    closedThisWeek: list.length,
    netPnl: parseFloat(netPnl.toFixed(2)),
    winRate,
    topWinner,
    topLoser,
    openUnrealized: openUnrealized != null ? parseFloat(openUnrealized.toFixed(2)) : null,
    attribution: attributionLine || null,
    adherence: adherenceLine || null,
  };
}

// ============ SEND HELPERS ============

/**
 * Concurrency limiter — runs async fn over items with at most N in flight.
 * Resend free tier is 3/sec; we keep N=3 to stay under it.
 */
async function withLimit(items, fn, limit = 3) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const settled = await Promise.allSettled(batch.map(fn));
    results.push(...settled);
    // Brief pause between batches to spread the second-bucket load
    if (i + limit < items.length) await new Promise(r => setTimeout(r, 1100));
  }
  return results;
}

async function sendOne({ to, subject, html, text }) {
  if (!resend) return { ok: false, error: 'Resend not configured' };
  try {
    await resend.emails.send({ from: FROM_ADDRESS, to, subject, html, text });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ============ CRON ENTRY POINTS ============

/**
 * Daily digest email — invoked from runner.js at 7:45am ET on weekdays.
 * Sends to users opted-in (email_daily_digest=true) who logged in within 7 days.
 * Skips users on quiet days (no signals).
 */
export async function sendAllDailyDigestEmails() {
  if (!resend) {
    console.warn('[Notifications] Resend not configured — skipping daily digest emails');
    return;
  }
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: users } = await supabase
    .from('user_profiles')
    .select('id, email, display_name, email_daily_digest')
    .eq('email_daily_digest', true)
    .gt('last_login', sevenDaysAgo);
  if (!users?.length) {
    console.log('[Notifications] No users opted in for daily digest');
    return;
  }

  const results = await withLimit(users, async (u) => {
    try {
      const digest = await getDigestForUser(u.id, false);
      const built = buildDailyDigestEmail({ displayName: u.display_name, digest });
      if (!built) return { skipped: true, reason: 'quiet_day_or_no_data' };
      const r = await sendOne({ to: u.email, ...built });
      return r;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, 3);

  const sent = results.filter(r => r.status === 'fulfilled' && r.value?.ok).length;
  const skipped = results.filter(r => r.status === 'fulfilled' && r.value?.skipped).length;
  const failed = results.length - sent - skipped;
  console.log(`[Notifications] Daily digest emails: ${sent} sent, ${skipped} skipped (quiet), ${failed} failed (across ${users.length} opted-in)`);
}

/**
 * Weekly summary email — invoked from runner.js, daily check that fires only on Sundays.
 * Sends Sunday 6pm ET to users opted-in.
 */
export async function sendAllWeeklySummaryEmails() {
  if (!resend) {
    console.warn('[Notifications] Resend not configured — skipping weekly summaries');
    return;
  }
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: users } = await supabase
    .from('user_profiles')
    .select('id, email, display_name, email_weekly_summary')
    .eq('email_weekly_summary', true)
    .gt('last_login', sevenDaysAgo);
  if (!users?.length) {
    console.log('[Notifications] No users opted in for weekly summary');
    return;
  }

  const results = await withLimit(users, async (u) => {
    try {
      const weekly = await computeWeeklySummary(u.id);
      if (weekly.closedThisWeek === 0 && weekly.openUnrealized == null) {
        return { skipped: true, reason: 'no_activity' };
      }
      const built = buildWeeklySummaryEmail({ displayName: u.display_name, weekly });
      if (!built) return { skipped: true, reason: 'no_content' };
      const r = await sendOne({ to: u.email, ...built });
      return r;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }, 3);

  const sent = results.filter(r => r.status === 'fulfilled' && r.value?.ok).length;
  const skipped = results.filter(r => r.status === 'fulfilled' && r.value?.skipped).length;
  const failed = results.length - sent - skipped;
  console.log(`[Notifications] Weekly summary: ${sent} sent, ${skipped} skipped, ${failed} failed (across ${users.length} opted-in)`);
}
