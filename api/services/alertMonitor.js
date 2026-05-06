/**
 * Alert Monitor — runs every 5 minutes during market hours. Reads active
 * alerts from Supabase, checks them against the live price pool, marks
 * triggered ones, and sends an email via Resend.
 *
 * Cost profile:
 *   - DB: one SELECT on active/non-triggered alerts, one UPDATE per trigger
 *   - Polygon: zero direct calls — prices come from the existing pool
 *     (pricePool.collectTickers already picks up alert tickers)
 *   - Resend: one email per trigger, free tier is 100/day / 3000/month
 *
 * To stay inside the Resend free tier, we rate-limit email sends to at
 * most one trigger per alert per 10 minutes even if the alert somehow
 * re-triggers. Once an alert fires and the email sends, it's marked
 * triggered and won't fire again until the user resets it.
 */
import { supabase } from '../db.js';
import { getPrice } from './pricePool.js';
import { isMarketHours } from '../utils/marketHours.js';
import { Resend } from 'resend';
import { config } from '../config.js';

const resend = config.resendKey ? new Resend(config.resendKey) : null;
const FROM_ADDRESS = 'Outpost <noreply@outpostapp.co>';

/**
 * Decide whether an alert should fire given a live price snapshot.
 */
function shouldFire(alert, priceData) {
  if (!priceData?.price) return false;
  const price = priceData.price;
  const changePct = priceData.changePercent;
  const threshold = parseFloat(alert.threshold);

  if (alert.direction === 'above') return price >= threshold;
  if (alert.direction === 'below') return price <= threshold;
  if (alert.direction === 'percent_change') {
    // Positive threshold (e.g. +5) fires when daily change >= threshold.
    // Negative threshold (e.g. -5) fires when daily change <= threshold.
    if (changePct == null) return false;
    if (threshold >= 0) return changePct >= threshold;
    return changePct <= threshold;
  }
  return false;
}

/**
 * Build the email body for a triggered alert.
 */
function buildAlertEmail({ displayName, alert, priceData }) {
  const ticker = alert.ticker;
  const price = priceData.price.toFixed(2);
  const change = priceData.changePercent ?? 0;
  const changeStr = change >= 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;
  const changeColor = change >= 0 ? '#10b981' : '#ef4444';

  let headline;
  if (alert.direction === 'above') {
    headline = `${ticker} crossed above $${parseFloat(alert.threshold).toFixed(2)}`;
  } else if (alert.direction === 'below') {
    headline = `${ticker} dropped below $${parseFloat(alert.threshold).toFixed(2)}`;
  } else {
    const sign = alert.threshold >= 0 ? '+' : '';
    headline = `${ticker} moved ${sign}${parseFloat(alert.threshold).toFixed(1)}% today`;
  }

  const noteBlock = alert.note
    ? `<p style="color:rgba(255,255,255,0.6);font-size:13px;margin-top:16px;font-style:italic">Your note: "${alert.note.replace(/</g, '&lt;')}"</p>`
    : '';

  return {
    subject: `${ticker} alert triggered — $${price}`,
    html: `
      <div style="background:#08080c;color:#f1f1f3;padding:40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',monospace;max-width:560px;margin:0 auto">
        <h1 style="color:#3b82f6;margin:0 0 24px 0;font-size:20px;letter-spacing:0.5px">OUTPOST</h1>
        <p style="margin:0 0 8px 0;color:rgba(255,255,255,0.4);font-size:11px;letter-spacing:0.5px;text-transform:uppercase">Price Alert</p>
        <h2 style="margin:0 0 8px 0;font-size:22px;color:#f1f1f3">${headline}</h2>
        <p style="margin:0 0 24px 0;font-size:32px;font-weight:700;color:${changeColor}">$${price} <span style="font-size:14px;font-weight:400">${changeStr}</span></p>
        ${noteBlock}
        <p style="margin:32px 0 0 0;color:rgba(255,255,255,0.4);font-size:11px">Hey ${displayName || 'there'} — this alert has now been marked triggered and won't fire again until you reset it in Outpost.</p>
        <p style="margin:16px 0 0 0;color:rgba(255,255,255,0.3);font-size:10px">Not financial advice. Verify all prices independently before trading.</p>
      </div>
    `,
  };
}

/**
 * Check all active alerts against the price pool. Returns stats for logging.
 */
export async function runAlertMonitor() {
  const stats = { checked: 0, triggered: 0, emailsSent: 0, errors: 0 };
  try {
    const { data: alerts, error } = await supabase
      .from('price_alerts')
      .select('id, user_id, ticker, direction, threshold, note')
      .eq('active', true)
      .eq('triggered', false);
    if (error) throw error;
    if (!alerts?.length) return stats;

    stats.checked = alerts.length;

    // Group by user so we can fetch display names in one query, not one per alert
    const userIds = [...new Set(alerts.map(a => a.user_id))];
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id, email, display_name')
      .in('id', userIds);
    const userMap = new Map((users ?? []).map(u => [u.id, u]));

    for (const alert of alerts) {
      try {
        const priceData = getPrice(alert.ticker);
        if (!priceData?.price) continue;
        if (!shouldFire(alert, priceData)) continue;

        // Atomic mark-as-triggered. If two monitor runs race, only one
        // succeeds at flipping triggered=false→true and sending the email.
        const { data: updated, error: updErr } = await supabase
          .from('price_alerts')
          .update({
            triggered: true,
            triggered_at: new Date().toISOString(),
            triggered_price: parseFloat(priceData.price.toFixed(4)),
          })
          .eq('id', alert.id)
          .eq('triggered', false)  // optimistic lock
          .select()
          .maybeSingle();
        if (updErr) { stats.errors++; continue; }
        if (!updated) continue;  // lost the race — another tick already handled it

        stats.triggered++;

        // Send email via Resend (non-blocking — if it fails, alert still marked
        // triggered because we don't want to spam on transient delivery issues)
        const user = userMap.get(alert.user_id);
        if (resend && user?.email) {
          try {
            const { subject, html } = buildAlertEmail({
              displayName: user.display_name,
              alert,
              priceData,
            });
            await resend.emails.send({
              from: FROM_ADDRESS,
              to: user.email,
              subject,
              html,
            });
            await supabase
              .from('price_alerts')
              .update({ notified_at: new Date().toISOString() })
              .eq('id', alert.id);
            stats.emailsSent++;
          } catch (emailErr) {
            console.error(`[AlertMonitor] Email send failed for alert ${alert.id}:`, emailErr.message);
            // No stat increment — alert is still triggered, user can see it in-app
          }
        }
      } catch (alertErr) {
        stats.errors++;
        console.error(`[AlertMonitor] Alert ${alert.id} failed:`, alertErr.message);
      }
    }
  } catch (err) {
    console.error('[AlertMonitor] Run failed:', err.message);
    stats.errors++;
  }
  return stats;
}

/**
 * Scheduled entry point — call from runner.js. Skips entirely outside market
 * hours to avoid pointless DB traffic (prices aren't moving anyway).
 */
export async function alertMonitorTick() {
  if (!isMarketHours()) return;
  const stats = await runAlertMonitor();
  if (stats.triggered > 0 || stats.errors > 0) {
    console.log(`[AlertMonitor] ${stats.checked} checked, ${stats.triggered} triggered, ${stats.emailsSent} emailed, ${stats.errors} errors`);
  }
}
