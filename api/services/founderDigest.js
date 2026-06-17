/**
 * Weekly Founder Digest
 *
 * Runs Monday 9am ET. Pulls the last 7 days of ai_response_log + ai_feedback,
 * computes volume + quality metrics, picks the lowest-scoring outputs as
 * "problem cases", and asks Sonnet to surface patterns + 3 specific fix
 * candidates. Output is markdown emailed to FOUNDER_EMAILS — designed to be
 * pasted directly into a Claude chat for iteration.
 *
 * The point: turn the dashboard's one-flagged-response-at-a-time grind into
 * a structural pattern view across the whole week.
 *
 * Triggered automatically by runner.js, or manually via POST /api/admin/founder-digest.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import { config } from '../config.js';
import { supabase } from '../db.js';
import { recordClaudeUsage } from './aiUsage.js';
import { detectQualityRegressions } from '../../src/lib/founderBrief.js';

const anthropic = new Anthropic({ apiKey: config.anthropicKey });
const resend = config.resendKey ? new Resend(config.resendKey) : null;
const FROM_ADDRESS = 'Outpost <noreply@outpostapp.co>';

const SYNTH_SYSTEM = `You are a senior product engineer reviewing one week of AI output data for a retail trading app called Outpost.

You'll receive: per-feature volume, quality scores, top failing rules, user thumbs up/down rates, and a sample of the lowest-scoring outputs (with input + output).

Your job — produce a markdown report with these sections (and nothing else):

## Headline
One paragraph. What's the single most important thing the founder should know about this week's AI quality? Be direct. If quality is fine, say so. If something regressed, name it.

## Patterns
Bullet list of 3-5 patterns you see across the failing outputs. Each pattern should be specific (e.g. "outputs invent prior holding periods when input mentions earnings", not "AI is sometimes wrong"). Cite which feature and which rule.

## Top 3 Fix Candidates
Numbered list. For each: (1) what to change, (2) why it'll help, (3) how to verify. Prioritize by impact-per-effort. These should be concrete prompt edits, rule additions, or new test scenarios — not vague advice.

## What's working
One short paragraph. What surfaces or rules are holding up well? The founder needs to know what NOT to touch.

Be terse. No fluff. No "I hope this helps". Write like an engineer reviewing a PR.`;

/**
 * Pull and aggregate the last 7 days of AI quality data.
 */
async function gatherWeekData() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [{ data: logs = [] }, { data: feedback = [] }] = await Promise.all([
    supabase
      .from('ai_response_log')
      .select('feature, ticker, variant, score, failures, grader_notes, input_preview, output, created_at')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(5000),
    supabase
      .from('ai_feedback')
      .select('feature, rating, variant, created_at')
      .gte('created_at', sevenDaysAgo)
      .limit(5000),
  ]);

  return { logs: logs ?? [], feedback: feedback ?? [], windowStart: sevenDaysAgo };
}

/**
 * Compute the metrics block (markdown table) and assemble the failing-output sample.
 */
function buildMetrics({ logs, feedback }) {
  // Volume + quality by feature
  const byFeature = {};
  for (const r of logs) {
    const f = r.feature || 'unknown';
    if (!byFeature[f]) byFeature[f] = { count: 0, scoreSum: 0, scoreN: 0, fails: 0, failuresByRule: {} };
    byFeature[f].count++;
    if (typeof r.score === 'number') {
      byFeature[f].scoreSum += r.score;
      byFeature[f].scoreN++;
      if (r.score < 80) byFeature[f].fails++;
    }
    if (Array.isArray(r.failures)) {
      for (const fail of r.failures) {
        const ruleMatch = String(fail).match(/^([A-Z_]+)/);
        const rule = ruleMatch ? ruleMatch[1] : 'OTHER';
        byFeature[f].failuresByRule[rule] = (byFeature[f].failuresByRule[rule] || 0) + 1;
      }
    }
  }

  // Thumbs up/down by feature
  const fbByFeature = {};
  for (const r of feedback) {
    const f = r.feature || 'unknown';
    if (!fbByFeature[f]) fbByFeature[f] = { up: 0, down: 0 };
    if (r.rating === 'up' || r.rating === 'positive') fbByFeature[f].up++;
    else if (r.rating === 'down' || r.rating === 'negative') fbByFeature[f].down++;
  }

  // Top failing rules across the whole week
  const ruleTotals = {};
  for (const f of Object.values(byFeature)) {
    for (const [rule, n] of Object.entries(f.failuresByRule)) {
      ruleTotals[rule] = (ruleTotals[rule] || 0) + n;
    }
  }
  const topRules = Object.entries(ruleTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Lowest-scoring outputs (sample for the synthesizer)
  const sample = logs
    .filter(r => typeof r.score === 'number' && r.score < 75)
    .sort((a, b) => a.score - b.score)
    .slice(0, 12)
    .map(r => ({
      feature: r.feature,
      score: r.score,
      failures: r.failures || [],
      input: (r.input_preview || '').slice(0, 400),
      output: (r.output || '').slice(0, 400),
    }));

  // Build markdown table for features
  const featureTableRows = Object.entries(byFeature)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([f, m]) => {
      const avgScore = m.scoreN ? (m.scoreSum / m.scoreN).toFixed(1) : '—';
      const failPct = m.scoreN ? ((m.fails / m.scoreN) * 100).toFixed(0) + '%' : '—';
      const fb = fbByFeature[f] || { up: 0, down: 0 };
      const fbStr = fb.up + fb.down > 0 ? `${fb.up}↑ ${fb.down}↓` : '—';
      return `| ${f} | ${m.count} | ${avgScore} | ${failPct} | ${fbStr} |`;
    });

  return {
    totalCalls: logs.length,
    avgScore: logs.length
      ? (logs.reduce((s, r) => s + (r.score || 0), 0) / logs.filter(r => typeof r.score === 'number').length).toFixed(1)
      : '—',
    featureTable: ['| feature | calls | avg score | fail rate | feedback |',
                   '| --- | --- | --- | --- | --- |',
                   ...featureTableRows].join('\n'),
    topRules,
    sample,
    fbByFeature,
  };
}

/**
 * Ask Sonnet to synthesize patterns + fix candidates from the metrics + sample.
 */
async function synthesize(metrics) {
  if (metrics.totalCalls === 0) {
    return '## Headline\n\nNo AI activity in the last 7 days. Likely the app is not yet receiving traffic, or the response logger is misconfigured.\n\n## Patterns\n- N/A (no data)\n\n## Top 3 Fix Candidates\n1. Verify ai_response_log writes are succeeding — check error logs.\n2. Confirm feature names being logged match the rubric expectations.\n3. If pre-launch, ignore until traffic begins.\n\n## What\'s working\nN/A.';
  }

  const userMsg = [
    `WEEK SUMMARY:`,
    `Total AI calls: ${metrics.totalCalls}`,
    `Overall avg score: ${metrics.avgScore}/100`,
    ``,
    `FEATURE BREAKDOWN:`,
    metrics.featureTable,
    ``,
    `TOP FAILING RULES (across all features):`,
    metrics.topRules.length ? metrics.topRules.map(([r, n]) => `- ${r}: ${n} failures`).join('\n') : '(none)',
    ``,
    `LOWEST-SCORING OUTPUTS (sample of ${metrics.sample.length}):`,
    metrics.sample.map((s, i) => [
      `--- #${i + 1} | feature=${s.feature} | score=${s.score} ---`,
      `failures: ${(s.failures || []).join('; ')}`,
      `input: ${s.input}`,
      `output: ${s.output}`,
    ].join('\n')).join('\n\n'),
    ``,
    `Produce the report now.`,
  ].join('\n');

  try {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 45000); // background job, 45s
    let msg;
    try {
      msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        system: SYNTH_SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }, { signal: ctrl.signal });
      recordClaudeUsage({ feature: 'founder_digest', model: msg.model, usage: msg.usage, userId: null });
    } finally { clearTimeout(tm); }
    return msg.content?.[0]?.text?.trim() || '(empty response)';
  } catch (err) {
    console.error('[founderDigest] synthesis failed:', err.message);
    return `## Headline\n\nFailed to synthesize this week's digest: ${err.message}\n\nRaw metrics still included below.`;
  }
}

/**
 * Build the full markdown digest.
 */
function buildDigest({ metrics, synthesis, windowStart }) {
  const start = new Date(windowStart).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);

  return [
    `# Outpost — Founder Digest`,
    `**Window:** ${start} → ${end}`,
    `**Total AI calls:** ${metrics.totalCalls.toLocaleString()}`,
    `**Avg quality score:** ${metrics.avgScore}/100`,
    ``,
    `---`,
    ``,
    synthesis,
    ``,
    `---`,
    ``,
    `## Raw metrics`,
    ``,
    metrics.featureTable,
    ``,
    metrics.topRules.length
      ? `**Top failing rules:** ${metrics.topRules.map(([r, n]) => `${r} (${n})`).join(', ')}`
      : `**Top failing rules:** none`,
    ``,
    `_Paste this entire message into a Claude chat to iterate on fixes._`,
  ].join('\n');
}

/**
 * Render markdown as basic HTML for email body. Keeps formatting readable
 * even though the founder will copy the markdown source for chat.
 */
function markdownToHtml(md) {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Basic conversion: headings, bullets, bold, code spans, paragraphs.
  let html = escaped
    .replace(/^### (.+)$/gm, '<h3 style="color:#f1f1f3;margin:24px 0 8px;font-size:14px">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="color:#3b82f6;margin:28px 0 8px;font-size:16px;letter-spacing:0.5px">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="color:#3b82f6;margin:0 0 12px;font-size:18px;letter-spacing:1px">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:#1a1a22;padding:1px 4px;border-radius:3px;font-size:12px">$1</code>')
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #2a2a32;margin:20px 0">')
    .replace(/^- (.+)$/gm, '<li style="margin:4px 0">$1</li>');
  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li[^>]*>.*?<\/li>\n?)+/gs, m => `<ul style="padding-left:20px;margin:8px 0;color:#d4d4d8">${m}</ul>`);
  // Paragraph wrap leftover lines
  html = html.split('\n\n').map(block => {
    if (/^\s*<(h[1-3]|ul|hr|table)/.test(block)) return block;
    if (!block.trim()) return '';
    return `<p style="margin:8px 0;color:#d4d4d8;line-height:1.55">${block.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
}

/**
 * Email the digest to all FOUNDER_EMAILS recipients.
 */
async function sendEmail({ markdown, subjectOverride }) {
  if (!resend) {
    console.warn('[founderDigest] Resend not configured — skipping email send');
    return { sent: 0, recipients: [] };
  }
  const recipients = (process.env.FOUNDER_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  if (!recipients.length) {
    console.warn('[founderDigest] FOUNDER_EMAILS unset — skipping email send');
    return { sent: 0, recipients: [] };
  }

  const subject = `Outpost — Founder Digest (${new Date().toISOString().slice(0, 10)})`;
  const html = `
<div style="background:#08080c;color:#f1f1f3;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',monospace;max-width:720px;margin:0 auto">
  ${markdownToHtml(markdown)}
  <p style="margin:32px 0 0 0;color:rgba(255,255,255,0.3);font-size:10px;line-height:1.6">Founder-only diagnostic email. Source markdown is also attached as plain text below for pasting into Claude.</p>
  <hr style="border:none;border-top:1px solid #2a2a32;margin:20px 0">
  <pre style="white-space:pre-wrap;color:#9ca3af;font-size:11px;line-height:1.5">${markdown.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>
</div>`;

  let sent = 0;
  for (const to of recipients) {
    try {
      await resend.emails.send({ from: FROM_ADDRESS, to, subject: subjectOverride || subject, html, text: markdown });
      sent++;
    } catch (err) {
      console.error('[founderDigest] send failed for', to, ':', err.message);
    }
  }
  return { sent, recipients };
}

/**
 * Daily QualityWatch alarm. If any AI feature's flag rate jumped versus the prior
 * window, email the founder so a prompt regression is caught the day it lands, not
 * whenever they next happen to open the dashboard. Quiet unless something actually
 * regressed (no email, no noise). The grader already scores every reply; the pure
 * per-feature detection lives in founderBrief (detectQualityRegressions).
 */
export async function runQualityWatch({ email = true, windowDays = 7, flagThreshold = 70, minRecent = 10, deltaThreshold = 15 } = {}) {
  const since = new Date(Date.now() - 2 * windowDays * 86400000).toISOString();
  const { data } = await supabase.from('ai_response_log')
    .select('feature, score, created_at')
    .gte('created_at', since)
    .not('score', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5000);
  const regressed = detectQualityRegressions(data ?? [], { now: Date.now(), windowDays, flagThreshold, minRecent, deltaThreshold });
  if (!regressed.length) return { regressed: [], email: { sent: 0, recipients: [] } };
  const md = [
    '# Outpost QualityWatch alarm',
    '',
    `${regressed.length} AI ${regressed.length === 1 ? 'feature' : 'features'} got worse in the last ${windowDays} days. Flag rate is the share of graded responses scoring under ${flagThreshold}.`,
    '',
    ...regressed.map(x => `- **${x.feature}**: flag rate ${x.priorPct}% to ${x.recentPct}% (up ${x.delta} points, ${x.recentN} recent graded). Check the prompt and the review queue.`),
  ].join('\n');
  let emailResult = { sent: 0, recipients: [] };
  if (email) emailResult = await sendEmail({ markdown: md, subjectOverride: 'Outpost QualityWatch: a feature regressed' });
  return { regressed, email: emailResult };
}

/**
 * Main entry point. Runs the whole pipeline.
 * @param {object} opts
 * @param {boolean} opts.email - whether to email (default true)
 * @returns the markdown digest + send result
 */
export async function runFounderDigest({ email = true } = {}) {
  console.log('[founderDigest] gathering week data...');
  const week = await gatherWeekData();
  const metrics = buildMetrics(week);
  console.log(`[founderDigest] ${metrics.totalCalls} calls, avg ${metrics.avgScore}, synthesizing...`);
  const synthesis = await synthesize(metrics);
  const markdown = buildDigest({ metrics, synthesis, windowStart: week.windowStart });

  let emailResult = { sent: 0, recipients: [] };
  if (email) {
    emailResult = await sendEmail({ markdown });
    console.log(`[founderDigest] sent to ${emailResult.sent}/${emailResult.recipients.length} recipients`);
  }

  return { markdown, metrics: { totalCalls: metrics.totalCalls, avgScore: metrics.avgScore }, email: emailResult };
}
