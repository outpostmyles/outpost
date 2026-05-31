// Proactive accountability nudge for the conversational agent.
//
// The agent already carries a standing instruction to recall a user's own words
// when they bring up a ticker. This reinforces it with a DETERMINISTIC, per-turn
// directive: when the user asks about a ticker they actually hold (or one that
// has a live price alert), we detect it in code and tell the agent, this turn,
// to pull their history and connect what is happening now to what they said they
// would do. Leaving it to the model to notice on its own is unreliable. Closing
// the loop every time is the difference between a chatbot that knows stocks and
// an advisor that remembers your promises.
//
// Pure aside from the shared ticker tokenizer, so the detection is unit-testable.

import { extractTickersFromMessage } from './notices.js';

// activeAlerts (from buildAgentContext) is a newline-joined string of lines like:
//   "NVDA is within 1.4% of its price target ($920)"
//   "AMD has BROKEN BELOW its stop loss ($145) - now at $142.30"
// Map the leading ticker on each line to that line so we can tell when the
// ticker a user is talking about is one whose level just triggered.
export function parseAlertTickers(activeAlerts) {
  const map = {};
  if (typeof activeAlerts !== 'string' || !activeAlerts) return map;
  for (const raw of activeAlerts.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/\b([A-Z]{1,5})\b/);
    if (m && !map[m[1]]) map[m[1]] = line;
  }
  return map;
}

export function buildAccountabilityNudge({ content, heldTickers = [], activeAlerts = '' } = {}) {
  const mentioned = extractTickersFromMessage(content || '');
  if (mentioned.length === 0) return '';

  const held = new Set((heldTickers || []).map(t => String(t).toUpperCase()));
  const alertMap = parseAlertTickers(activeAlerts);

  // Only nudge for tickers the user has real skin in: ones they hold, or ones
  // with a live alert. A ticker mentioned in passing does not trigger this, so
  // the agent is not nagged on every message.
  const relevant = mentioned.filter(t => held.has(t) || alertMap[t]);
  if (relevant.length === 0) return '';

  const bullets = relevant.slice(0, 3).map(t => {
    const owns = held.has(t);
    const alert = alertMap[t];
    let s = `- ${t}: ${owns ? 'a position they currently hold' : 'a ticker they have history with'}.`;
    if (alert) s += ` Live alert: ${alert}.`;
    return s;
  });

  return [
    'ACCOUNTABILITY CHECK (do this before you answer):',
    'The user is asking about tickers they have skin in:',
    ...bullets,
    'Call recall_history for each of these BEFORE responding. If they wrote a thesis, a journal note, or a past reflection, quote their own words back with a date ("Back in March you wrote: ...") and ask whether that reasoning still holds.',
    'Where a live alert is shown, connect what is happening now to the level they set and what they said they would do there. Ask the question. Do not lecture or tell them what to do.',
  ].join('\n');
}
