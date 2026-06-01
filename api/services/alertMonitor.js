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
import { evaluatePlanAlerts, planAlertKey } from './planAlerts.js';
import { shouldFire } from './alertRules.js';

const resend = config.resendKey ? new Resend(config.resendKey) : null;
const FROM_ADDRESS = 'Outpost <noreply@outpostapp.co>';

// shouldFire (the firing decision) moved to ./alertRules.js, imported above, so
// it can be unit-tested without the price pool, Supabase, or Resend.

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
 * Email body for a trade-plan level (the target/stop a user wrote when they set
 * up the position). Quotes their own thesis back so the reminder is grounded in
 * what they said, not a generic ping.
 */
function buildPlanAlertEmail({ displayName, hit, thesis }) {
  const price = hit.price.toFixed(2);
  const level = hit.threshold.toFixed(2);
  const isTarget = hit.kind === 'target';
  const headline = isTarget
    ? `${hit.ticker} reached your plan target of $${level}`
    : `${hit.ticker} hit your plan stop of $${level}`;
  const accent = isTarget ? '#10b981' : '#ef4444';
  const line = isTarget
    ? `It's trading at $${price}. This is the target you wrote into your plan. Your call, but you set this level for a reason.`
    : `It's trading at $${price}. This is the stop you wrote into your plan. The plan said this is where you reconsider.`;
  const thesisBlock = thesis && thesis.trim()
    ? `<p style="color:rgba(255,255,255,0.6);font-size:13px;margin-top:16px;font-style:italic">When you opened it you wrote: "${thesis.trim().replace(/</g, '&lt;')}"</p>`
    : '';

  return {
    subject: `${hit.ticker} hit your plan ${hit.kind}: $${price}`,
    html: `
      <div style="background:#08080c;color:#f1f1f3;padding:40px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',monospace;max-width:560px;margin:0 auto">
        <h1 style="color:#3b82f6;margin:0 0 24px 0;font-size:20px;letter-spacing:0.5px">OUTPOST</h1>
        <p style="margin:0 0 8px 0;color:rgba(255,255,255,0.4);font-size:11px;letter-spacing:0.5px;text-transform:uppercase">Plan Level Reached</p>
        <h2 style="margin:0 0 8px 0;font-size:22px;color:#f1f1f3">${headline}</h2>
        <p style="margin:0 0 20px 0;font-size:32px;font-weight:700;color:${accent}">$${price}</p>
        <p style="margin:0;color:rgba(255,255,255,0.7);font-size:14px;line-height:1.6">${line}</p>
        ${thesisBlock}
        <p style="margin:32px 0 0 0;color:rgba(255,255,255,0.4);font-size:11px">Hey ${displayName || 'there'}. You set this level in your trade plan in Outpost. You'll only get this once per level.</p>
        <p style="margin:16px 0 0 0;color:rgba(255,255,255,0.3);font-size:10px">Not financial advice. Verify all prices independently before trading.</p>
      </div>
    `,
  };
}

/**
 * Second monitor pass: the trade-plan levels themselves. The explicit
 * price_alerts pipeline above only covers alerts a user made by hand; this
 * honors "Outpost reminds you what you said" for the target/stop written into a
 * position. Fires once per level value (dedupe marker in ai_cache keyed by the
 * value, so editing the level re-arms it and closing the position ends it).
 * Respects the email opt-out because, unlike hand-made alerts, these are
 * auto-derived from the plan rather than explicitly requested.
 */
async function runPlanAlertMonitor() {
  const stats = { checked: 0, fired: 0, errors: 0 };
  if (!resend) return stats;
  try {
    // Beta scale: a flat scan is fine. Add a server-side filter on
    // (price_target IS NOT NULL OR stop_loss IS NOT NULL) if this ever grows.
    const { data: positions, error } = await supabase
      .from('positions')
      .select('id, user_id, ticker, price_target, stop_loss, entry_thesis')
      .limit(1000);
    if (error) throw error;

    const planned = (positions || []).filter(p =>
      (p.price_target != null && p.price_target > 0) || (p.stop_loss != null && p.stop_loss > 0)
    );
    if (!planned.length) return stats;
    stats.checked = planned.length;

    const priceMap = {};
    for (const p of planned) {
      if (!(p.ticker in priceMap)) priceMap[p.ticker] = getPrice(p.ticker) || null;
    }
    const hits = evaluatePlanAlerts(planned, priceMap);
    if (!hits.length) return stats;

    // One batched lookup: which level-keys have already fired?
    const keys = hits.map(planAlertKey);
    const { data: firedRows } = await supabase.from('ai_cache').select('cache_key').in('cache_key', keys);
    const fired = new Set((firedRows || []).map(r => r.cache_key));

    const byId = new Map(planned.map(p => [p.id, p]));
    const userIds = [...new Set(hits.map(h => byId.get(h.positionId)?.user_id).filter(Boolean))];
    const { data: users } = await supabase
      .from('user_profiles')
      .select('id, email, display_name, email_daily_digest')
      .in('id', userIds);
    const userMap = new Map((users || []).map(u => [u.id, u]));

    for (const hit of hits) {
      const key = planAlertKey(hit);
      if (fired.has(key)) continue;
      const pos = byId.get(hit.positionId);
      const user = userMap.get(pos?.user_id);
      // No email, or opted out: skip without marking, so opting back in still works.
      if (!user?.email || user.email_daily_digest === false) continue;
      try {
        const { subject, html } = buildPlanAlertEmail({ displayName: user.display_name, hit, thesis: pos?.entry_thesis });
        await resend.emails.send({ from: FROM_ADDRESS, to: user.email, subject, html });
        await supabase.from('ai_cache').insert({ cache_key: key, result: 'sent', created_at: new Date().toISOString() });
        fired.add(key);
        stats.fired++;
      } catch (e) {
        stats.errors++;
        console.error(`[PlanAlerts] send failed for position ${hit.positionId}:`, e.message);
      }
    }
  } catch (err) {
    console.error('[PlanAlerts] Run failed:', err.message);
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
  const planStats = await runPlanAlertMonitor();
  if (planStats.fired > 0 || planStats.errors > 0) {
    console.log(`[PlanAlerts] ${planStats.checked} planned, ${planStats.fired} fired, ${planStats.errors} errors`);
  }
}
