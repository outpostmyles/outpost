// The Journal's front door: REFLECT prompts. A trading journal dies from two
// things, a blank page and no reason to come back. This fixes both. It surfaces
// the few moments actually worth journaling right now (a trade you closed but
// never reflected on, a thesis Outpost just flagged as breaking) and hands you a
// pre-seeded entry so you are filling in, not staring at nothing. It ties the
// Journal to the rest of the app instead of leaving it a dead scratchpad.
//
// Pure and deterministic: it takes your closed trades, your thesis verdicts, and
// the set of prompts you have already handled, and returns a short prioritized
// list. Tested in isolation.

const CLOSE_WINDOW_MS = 45 * 24 * 60 * 60 * 1000; // reflect while it is still fresh
const sign = (n) => `${n >= 0 ? '+' : '-'}$${Math.abs(Math.round(n))}`;

function closeSeed(c, pnl) {
  const held = c.hold_days ? `, held ${c.hold_days} day${c.hold_days === 1 ? '' : 's'}` : '';
  return (
    `You closed ${c.ticker} for ${pnl >= 0 ? 'a gain of' : 'a loss of'} $${Math.abs(Math.round(pnl))}${held}.\n\n` +
    `Why you bought it:\n\n` +
    `Did the thesis play out, and what actually moved the price?\n\n` +
    `What you would do the same, or differently, next time:\n`
  );
}

function thesisSeed(t, breaking) {
  return (
    `Outpost flagged your ${t.ticker} thesis as ${breaking ? 'breaking' : 'weakening'}.\n` +
    (t.headline ? `What it saw: ${t.headline}\n` : '') +
    `\nWhat you are seeing:\n\n` +
    `Does the original reason you bought it still hold?\n\n` +
    `What you will do about it (hold, trim, exit, move the stop):\n`
  );
}

/**
 * Build the prioritized reflect prompts. Inputs:
 *  - closes: closed_trades rows (ticker, pnl, hold_days, closed_at, reflection_*).
 *  - theses: thesis-watch verdict objects ({ ticker, verdict, headline }).
 *  - handled: ids of prompts the user already acted on or dismissed.
 * Returns up to 4 prompts, one per ticker, highest priority first. Each carries a
 * stable id, the chip title, and a seedTitle/seedBody to pre-fill the new note.
 */
export function buildReflectionPrompts({ closes = [], theses = [], handled = [], now = Date.now() } = {}) {
  const done = new Set(handled);
  const out = [];

  for (const c of (Array.isArray(closes) ? closes : [])) {
    if (!c?.ticker) continue;
    const reflected = !!(c.reflection_what_happened || c.reflection_lesson);
    if (reflected) continue;
    const t = Date.parse(c.closed_at);
    if (!Number.isFinite(t) || (now - t) > CLOSE_WINDOW_MS) continue; // recent only
    const id = `close:${c.id}`;
    if (done.has(id)) continue;
    const pnl = Number(c.pnl) || 0;
    out.push({
      id, severity: 90, kind: 'close', ticker: c.ticker,
      title: `Reflect on your ${c.ticker} exit (${sign(pnl)})`,
      seedTitle: `${c.ticker} post-trade`,
      seedBody: closeSeed(c, pnl),
    });
  }

  for (const th of (Array.isArray(theses) ? theses : [])) {
    if (!th?.ticker) continue;
    if (th.verdict !== 'broken' && th.verdict !== 'weakening') continue;
    const id = `thesis:${th.ticker}:${th.verdict}`;
    if (done.has(id)) continue;
    const breaking = th.verdict === 'broken';
    out.push({
      id, severity: breaking ? 85 : 70, kind: 'thesis', ticker: th.ticker,
      title: `Your ${th.ticker} thesis is ${breaking ? 'breaking' : 'weakening'}. Note what you see.`,
      seedTitle: `${th.ticker} thesis ${breaking ? 'breaking' : 'check'}`,
      seedBody: thesisSeed(th, breaking),
    });
  }

  // One prompt per ticker (the most urgent wins), highest priority first, capped.
  out.sort((a, b) => b.severity - a.severity);
  const byTicker = new Map();
  for (const p of out) if (!byTicker.has(p.ticker)) byTicker.set(p.ticker, p);
  return [...byTicker.values()].sort((a, b) => b.severity - a.severity).slice(0, 4);
}
