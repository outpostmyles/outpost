/**
 * historyAggregator — Phase 3 longitudinal memory backbone.
 *
 * Pulls events from across the user's own writing/thinking history and
 * unifies them into a single chronological feed. Used by:
 *  - GET /api/journal/timeline       (the Timeline view)
 *  - GET /api/portfolio/history/:ticker (per-ticker contextual surfacing)
 *  - the recall_history agent tool   (so the agent can quote the user's
 *                                     own past writing back to them)
 *
 * Sources:
 *  - agent_messages         (substantive user messages, word count > 40)
 *  - closed_trades          (past positions with thesis + reflection + outcome)
 *  - positions              (active positions; theses surface as separate events)
 *  - journal_notes          (free-form notes, including saved bookmarks)
 *  - deploy_cash_sessions   (Phase 4 — each session is a Timeline event)
 *
 * Entry shape (uniform across sources):
 *  {
 *    id:        unique within source ("agent:<msgId>")
 *    source:    'agent' | 'position_open' | 'position_close' | 'thesis' | 'journal' | 'deploy_cash'
 *    date:      ISO timestamp (newest first when sorted)
 *    ticker:    string | null
 *    title:     short label for the entry, e.g. "Bought 5 AAPL @ $200"
 *    excerpt:   the user's own words OR a short summary (used in feed listing)
 *    quote:     the user's verbatim writing (thesis / reflection / journal / message),
 *               surfaced as a pull quote in the UI. null when no quote applies.
 *    outcome:   'win' | 'loss' | 'even' | null (only meaningful for position_close)
 *    pnl:       number | null
 *    holdDays:  number | null
 *    meta:      source-specific extras { sharesAtOpen, sellPrice, ... }
 *  }
 *
 * Filters supported in options:
 *  { ticker?, topic?, dateFrom?, dateTo?, sources?: string[], limit?: number }
 *  topic is a free-text substring match (case-insensitive) across excerpt + quote.
 *
 * Returns events sorted newest first. The caller paginates / further filters.
 */
import { supabase } from '../db.js';
import { fenceUserText } from '../utils/fence.js';

const USER_MESSAGE_WORD_FLOOR = 40; // brief: ">40 words" gates non-trivial chats
const DEFAULT_LIMIT = 30;
const HARD_CAP_PER_SOURCE = 200; // safety — don't pull a user's entire 5000-msg history

/**
 * Detect ticker mentions in free text. Looks for $TICKER and standalone
 * 1-5 letter all-caps tokens. Used when no explicit ticker is on the row
 * (e.g. agent_messages, journal_notes) so we can filter Timeline by ticker.
 */
export function detectTickers(text, knownTickers) {
  if (!text) return [];
  const found = new Set();
  // $-prefixed: $AAPL or $aapl
  const dollarMatches = text.match(/\$([A-Z]{1,5})\b/gi) ?? [];
  for (const m of dollarMatches) found.add(m.slice(1).toUpperCase());
  // Standalone 2-5 letter all-caps tokens (don't over-match; require uppercase)
  const bareMatches = text.match(/\b([A-Z]{2,5})\b/g) ?? [];
  for (const m of bareMatches) {
    // Skip common all-caps words that aren't tickers
    if (['THE', 'AND', 'BUT', 'FOR', 'NOT', 'YOU', 'YES', 'NO', 'AI', 'IT', 'IS', 'ETF', 'IRS', 'YTD', 'EPS', 'CEO', 'CFO', 'COO'].includes(m)) continue;
    // Only count if it matches a known ticker the user actually holds/held/watches
    if (knownTickers && knownTickers.has(m)) found.add(m);
  }
  return [...found];
}

/**
 * Build a small set of tickers the user has interacted with (positions +
 * closed_trades + watchlist). Used to scope ticker-detection in free text
 * so we don't flag random capital letters as tickers.
 */
async function loadKnownTickers(userId) {
  const [posRes, closedRes, watchRes] = await Promise.all([
    supabase.from('positions').select('ticker').eq('user_id', userId),
    supabase.from('closed_trades').select('ticker').eq('user_id', userId),
    supabase.from('watchlist').select('ticker').eq('user_id', userId),
  ]);
  const set = new Set();
  for (const r of posRes.data ?? []) set.add(r.ticker);
  for (const r of closedRes.data ?? []) set.add(r.ticker);
  for (const r of watchRes.data ?? []) set.add(r.ticker);
  return set;
}

export function wordCount(text) {
  if (!text || typeof text !== 'string') return 0;
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0; // whitespace-only counts as 0, not 1
}

export function truncate(text, max = 220) {
  if (!text) return '';
  const clean = String(text).trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + '…';
}

/**
 * Source: closed_trades → position_close events.
 * One entry per closed trade. The user's writing (entry_thesis, reflection)
 * is preserved as the quote; the title summarizes the trade.
 */
async function fetchClosedTrades({ userId, ticker, dateFrom, dateTo, limit }) {
  let q = supabase.from('closed_trades')
    .select('id,ticker,company_name,shares,sell_price,avg_cost,pnl,pnl_percent,entry_thesis,reflection_what_happened,reflection_lesson,exit_reflection,thesis_played_out,exit_outcome,hold_days,opened_at,closed_at')
    .eq('user_id', userId)
    .order('closed_at', { ascending: false })
    .limit(Math.min(limit ?? DEFAULT_LIMIT, HARD_CAP_PER_SOURCE));
  if (ticker) q = q.eq('ticker', ticker);
  if (dateFrom) q = q.gte('closed_at', dateFrom);
  if (dateTo) q = q.lte('closed_at', dateTo);
  const { data } = await q;
  return (data ?? []).map(t => {
    const outcome = (t.pnl ?? 0) > 0 ? 'win' : (t.pnl ?? 0) < 0 ? 'loss' : 'even';
    // Prefer the new reflection_what_happened narrative. Fall back to legacy exit_reflection.
    const what = t.reflection_what_happened || t.exit_reflection || null;
    const lesson = t.reflection_lesson || null;
    // For the quote, prefer the lesson (most distilled) → narrative → entry thesis.
    const quote = lesson || what || t.entry_thesis || null;
    const sellPrice = t.sell_price ?? 0;
    const title = `Sold ${t.shares} ${t.ticker} @ $${sellPrice.toFixed(2)} — ${outcome === 'win' ? '+' : outcome === 'loss' ? '' : '±'}$${(t.pnl ?? 0).toFixed(0)}`;
    return {
      id: `closed:${t.id}`,
      source: 'position_close',
      date: t.closed_at,
      ticker: t.ticker,
      title,
      excerpt: truncate(what || t.entry_thesis || `Closed ${t.ticker} position`, 220),
      quote: quote ? truncate(quote, 400) : null,
      outcome,
      pnl: t.pnl,
      holdDays: t.hold_days,
      meta: {
        shares: t.shares,
        sellPrice: t.sell_price,
        avgCost: t.avg_cost,
        pnlPercent: t.pnl_percent,
        thesisPlayedOut: t.thesis_played_out,
        entryThesis: t.entry_thesis || null,
        reflectionLesson: lesson,
      },
    };
  });
}

/**
 * Source: positions (active) → two event types:
 *   - position_open  (dated at purchased_at OR created_at if missing)
 *   - thesis         (dated at thesis_written_at if present)
 * When a position has no thesis, we still emit a position_open event so the
 * user sees they own it; the quote is null in that case.
 */
/**
 * Pure transformation: position row -> open-event for the history feed.
 * Returns null when the position has no usable open date.
 *
 * The trick this function exists to handle: distinguishing the user-provided
 * purchase date (`purchased_at`, when they actually bought the stock) from
 * the row-creation timestamp (`created_at`, when they added it to Outpost).
 * Before this split, the agent would say "you bought N days ago" based on
 * created_at, which is wrong for any position where the user didn't fill in
 * the optional purchase-date field.
 *
 * Output contract when purchaseDateProvided is false:
 *  - title says "Added to Outpost", NOT "Bought"
 *  - meta.purchaseDateProvided === false
 *  - recallHistory upgrades this to a top-level dateMeaning='added_to_outpost_only'
 *    flag and the recall_history tool description instructs the model to
 *    refrain from hold-duration inference.
 *
 * Exported for unit tests.
 */
export function positionToOpenEvent(p) {
  if (!p) return null;
  const purchaseDateProvided = !!p.purchased_at;
  const openDate = p.purchased_at || p.created_at;
  if (!openDate) return null;

  const quoteCandidate = p.entry_thesis || null;
  const avg = (p.avg_cost ?? 0).toFixed(2);
  const title = purchaseDateProvided
    ? `Bought ${p.shares} ${p.ticker} @ $${avg}`
    : `Added ${p.shares} ${p.ticker} @ $${avg} avg to Outpost (purchase date not specified)`;
  const excerpt = purchaseDateProvided
    ? truncate(p.entry_thesis || `Opened ${p.ticker} position`, 220)
    : truncate(p.entry_thesis || `Tracking ${p.ticker} position in Outpost. User did not specify when they actually bought it.`, 220);

  return {
    id: `open:${p.id}`,
    source: 'position_open',
    date: openDate,
    ticker: p.ticker,
    title,
    excerpt,
    quote: quoteCandidate ? truncate(quoteCandidate, 400) : null,
    outcome: null,
    pnl: null,
    holdDays: null,
    meta: {
      shares: p.shares,
      avgCost: p.avg_cost,
      companyName: p.company_name,
      reversalCondition: p.reversal_condition || null,
      stillOpen: true,
      purchaseDateProvided,
    },
  };
}

/**
 * Pure: an 'add' or 'trim' decision row -> a history event, so building up a
 * position over time (or trimming it) shows up in the user's story, not just the
 * first open. Without this, adding shares to a name you already hold left no trace
 * in the timeline. Exported for tests. Returns null on an unusable row.
 */
export function decisionToAddEvent(d) {
  if (!d || (d.type !== 'add' && d.type !== 'trim') || !d.created_at) return null;
  const sh = Number(d.shares);
  const px = Number(d.price);
  const isAdd = d.type === 'add';
  const shStr = Number.isFinite(sh) && sh > 0 ? `${sh % 1 === 0 ? sh : sh.toFixed(2)} ` : '';
  const pxStr = Number.isFinite(px) && px > 0 ? ` @ $${px.toFixed(2)}` : '';
  return {
    id: `posadd:${d.id}`,
    source: 'position_add',
    date: d.created_at,
    ticker: d.ticker,
    title: `${isAdd ? 'Added' : 'Trimmed'} ${shStr}${d.ticker}${pxStr}`,
    excerpt: isAdd ? `Added to your ${d.ticker} position.` : `Trimmed part of your ${d.ticker} position.`,
    quote: null,
    outcome: null,
    pnl: null,
    holdDays: null,
    meta: { shares: Number.isFinite(sh) ? sh : null, price: Number.isFinite(px) ? px : null, kind: d.type },
  };
}

// Source: the decision ledger, type 'add' or 'trim'. These are book changes on a
// position you already hold, which the positions-table open event cannot show.
async function fetchPositionAdds({ userId, ticker, dateFrom, dateTo, limit }) {
  let q = supabase.from('decisions')
    .select('id,type,ticker,shares,price,created_at')
    .eq('user_id', userId)
    .in('type', ['add', 'trim'])
    .order('created_at', { ascending: false })
    .limit(Math.min(limit ?? DEFAULT_LIMIT, HARD_CAP_PER_SOURCE));
  if (ticker) q = q.eq('ticker', ticker);
  if (dateFrom) q = q.gte('created_at', dateFrom);
  if (dateTo) q = q.lte('created_at', dateTo);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(decisionToAddEvent).filter(Boolean);
}

async function fetchActivePositions({ userId, ticker, dateFrom, dateTo, limit }) {
  let q = supabase.from('positions')
    .select('id,ticker,company_name,shares,avg_cost,entry_thesis,reversal_condition,thesis_written_at,purchased_at,created_at')
    .eq('user_id', userId)
    .limit(Math.min(limit ?? DEFAULT_LIMIT, HARD_CAP_PER_SOURCE));
  if (ticker) q = q.eq('ticker', ticker);
  const { data } = await q;

  const out = [];
  for (const p of data ?? []) {
    // The same open date positionToOpenEvent uses internally. Needed below for
    // the same-day thesis check; without it that line threw ReferenceError and
    // took down the whole timeline for any position that had a written thesis.
    const openDate = p.purchased_at || p.created_at;
    const openEvent = positionToOpenEvent(p);
    if (openEvent) {
      if ((!dateFrom || openEvent.date >= dateFrom) && (!dateTo || openEvent.date <= dateTo)) {
        out.push(openEvent);
      }
    }

    // Separate thesis event when thesis_written_at differs from open date
    // (e.g. user added the thesis days/weeks after buying). Skip if same day.
    if (p.thesis_written_at && p.entry_thesis) {
      const tdate = p.thesis_written_at;
      const sameDay = openDate && tdate.slice(0, 10) === openDate.slice(0, 10);
      if (!sameDay) {
        if ((!dateFrom || tdate >= dateFrom) && (!dateTo || tdate <= dateTo)) {
          out.push({
            id: `thesis:${p.id}`,
            source: 'thesis',
            date: tdate,
            ticker: p.ticker,
            title: `Wrote thesis on ${p.ticker}`,
            excerpt: truncate(p.entry_thesis, 220),
            quote: truncate(p.entry_thesis, 400),
            outcome: null,
            pnl: null,
            holdDays: null,
            meta: {
              reversalCondition: p.reversal_condition || null,
            },
          });
        }
      }
    }
  }
  return out;
}

/**
 * Source: agent_messages → user messages that are substantive (word count
 * above floor). We attach the assistant's first reply when available so the
 * Timeline can show context without forcing the UI to load a full thread.
 */
async function fetchAgentConversations({ userId, ticker, dateFrom, dateTo, limit, knownTickers }) {
  let q = supabase.from('agent_messages')
    .select('id,role,content,created_at')
    .eq('user_id', userId)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(Math.min((limit ?? DEFAULT_LIMIT) * 3, HARD_CAP_PER_SOURCE));
  if (dateFrom) q = q.gte('created_at', dateFrom);
  if (dateTo) q = q.lte('created_at', dateTo);
  const { data: userMsgs } = await q;

  // Filter to substantive messages first to keep the next query small
  const substantive = (userMsgs ?? []).filter(m => wordCount(m.content) >= USER_MESSAGE_WORD_FLOOR);

  // Fetch each user message's NEXT assistant reply (the one that immediately follows).
  // We do this with a single batched query for the timestamps just-after each user msg.
  const enriched = [];
  for (const m of substantive) {
    const detectedTickers = detectTickers(m.content, knownTickers);
    if (ticker && !detectedTickers.includes(ticker)) continue;

    // Best-effort assistant reply lookup. If it fails or is missing, we still
    // surface the user message — better than dropping the event entirely.
    let assistantReply = null;
    try {
      const { data: replies } = await supabase.from('agent_messages')
        .select('content,created_at')
        .eq('user_id', userId)
        .eq('role', 'assistant')
        .gt('created_at', m.created_at)
        .order('created_at', { ascending: true })
        .limit(1);
      if (replies?.[0]) assistantReply = replies[0].content;
    } catch {}

    enriched.push({
      id: `agent:${m.id}`,
      source: 'agent',
      date: m.created_at,
      ticker: detectedTickers[0] || null,
      title: detectedTickers.length
        ? `Talked to the agent about ${detectedTickers.join(', ')}`
        : 'Talked to the agent',
      excerpt: truncate(m.content, 220),
      quote: truncate(m.content, 400),
      outcome: null,
      pnl: null,
      holdDays: null,
      meta: {
        tickersMentioned: detectedTickers,
        assistantReplyExcerpt: assistantReply ? truncate(assistantReply, 220) : null,
      },
    });
  }
  return enriched;
}

/**
 * Source: journal_notes → every saved note, including bookmarks (which the
 * BookmarkButton UI saves as notes via POST /api/journal/notes).
 */
async function fetchJournalNotes({ userId, ticker, dateFrom, dateTo, limit, knownTickers }) {
  let q = supabase.from('journal_notes')
    .select('id,title,content,created_at,updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(Math.min(limit ?? DEFAULT_LIMIT, HARD_CAP_PER_SOURCE));
  if (dateFrom) q = q.gte('updated_at', dateFrom);
  if (dateTo) q = q.lte('updated_at', dateTo);
  const { data } = await q;

  const out = [];
  for (const n of data ?? []) {
    const detectedTickers = detectTickers(`${n.title} ${n.content}`, knownTickers);
    if (ticker && !detectedTickers.includes(ticker)) continue;
    out.push({
      id: `journal:${n.id}`,
      source: 'journal',
      date: n.updated_at,
      ticker: detectedTickers[0] || null,
      title: n.title || 'Untitled note',
      excerpt: truncate(n.content, 220),
      quote: truncate(n.content, 400),
      outcome: null,
      pnl: null,
      holdDays: null,
      meta: {
        tickersMentioned: detectedTickers,
        createdAt: n.created_at,
      },
    });
  }
  return out;
}

/**
 * Source: deploy_cash_sessions → one event per session.
 * If the user picked an option, the title reflects the choice and the chosen
 * option's reasoning becomes the quote. If they didn't pick, the title says
 * "explored deployment options" and the quote shows the first option's idea.
 */
async function fetchDeployCashSessions({ userId, ticker, dateFrom, dateTo, limit }) {
  let q = supabase.from('deploy_cash_sessions')
    .select('id,amount,time_horizon,goal,options_shown,user_choice_id,executed_position_id,market_context_note,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit ?? DEFAULT_LIMIT, HARD_CAP_PER_SOURCE));
  if (dateFrom) q = q.gte('created_at', dateFrom);
  if (dateTo) q = q.lte('created_at', dateTo);
  let data;
  try {
    ({ data } = await q);
  } catch {
    // Table may not exist yet (migration 015 not applied) — degrade silently.
    return [];
  }
  if (!data) return [];

  const out = [];
  for (const s of data) {
    const opts = Array.isArray(s.options_shown) ? s.options_shown : [];
    const chosen = s.user_choice_id ? opts.find(o => o.id === s.user_choice_id) : null;
    const featured = chosen || opts[0] || null;

    // Ticker filter — match against the chosen option's ticker or any option's ticker
    if (ticker) {
      const mentionedTickers = opts.map(o => o?.ticker).filter(Boolean);
      if (!mentionedTickers.includes(ticker)) continue;
    }

    const title = chosen
      ? `Deployed $${(s.amount ?? 0).toFixed(0)} — chose: ${chosen.title || 'unnamed option'}`
      : `Explored options for $${(s.amount ?? 0).toFixed(0)} of cash`;
    const excerpt = featured?.action_summary || featured?.title || `${opts.length} options generated`;
    const quote = featured?.reasoning || null;

    out.push({
      id: `deploy_cash:${s.id}`,
      source: 'deploy_cash',
      date: s.created_at,
      ticker: chosen?.ticker || null,
      title,
      excerpt: truncate(excerpt, 220),
      quote: quote ? truncate(quote, 400) : null,
      outcome: null,
      pnl: null,
      holdDays: null,
      meta: {
        amount: s.amount,
        timeHorizon: s.time_horizon,
        goal: s.goal,
        optionCount: opts.length,
        chosenTicker: chosen?.ticker || null,
        executedPositionId: s.executed_position_id,
        wasExecuted: !!s.executed_position_id,
      },
    });
  }
  return out;
}

/**
 * Top-level aggregator. Returns events sorted newest first.
 *
 * options: {
 *   userId:     required
 *   ticker?:    filter to a single ticker
 *   topic?:     free-text substring across title/excerpt/quote
 *   dateFrom?:  ISO
 *   dateTo?:    ISO
 *   sources?:   array of any of ['agent','position_open','position_close','thesis','journal','deploy_cash']
 *               default = all
 *   limit?:     hard cap on the returned list, default 30
 * }
 */
export async function getUserHistory(options) {
  const {
    userId, ticker, topic, dateFrom, dateTo,
    sources = ['agent', 'position_open', 'position_add', 'position_close', 'thesis', 'journal', 'deploy_cash'],
    limit = DEFAULT_LIMIT,
  } = options;
  if (!userId) throw new Error('userId required');

  const knownTickers = await loadKnownTickers(userId);

  // Per-source limit a bit higher so we have headroom after the merge sort.
  const perSourceLimit = Math.max(limit * 2, 20);

  const tasks = [];
  if (sources.includes('position_close')) tasks.push(fetchClosedTrades({ userId, ticker, dateFrom, dateTo, limit: perSourceLimit }));
  else tasks.push(Promise.resolve([]));

  if (sources.includes('position_open') || sources.includes('thesis')) {
    tasks.push(fetchActivePositions({ userId, ticker, dateFrom, dateTo, limit: perSourceLimit }));
  } else tasks.push(Promise.resolve([]));

  if (sources.includes('agent')) tasks.push(fetchAgentConversations({ userId, ticker, dateFrom, dateTo, limit: perSourceLimit, knownTickers }));
  else tasks.push(Promise.resolve([]));

  if (sources.includes('journal')) tasks.push(fetchJournalNotes({ userId, ticker, dateFrom, dateTo, limit: perSourceLimit, knownTickers }));
  else tasks.push(Promise.resolve([]));

  if (sources.includes('deploy_cash')) tasks.push(fetchDeployCashSessions({ userId, ticker, dateFrom, dateTo, limit: perSourceLimit }));
  else tasks.push(Promise.resolve([]));

  if (sources.includes('position_add')) tasks.push(fetchPositionAdds({ userId, ticker, dateFrom, dateTo, limit: perSourceLimit }));
  else tasks.push(Promise.resolve([]));

  // allSettled, not all: a single failing source (a bad row, a transient DB
  // error, a future bug in one fetcher) must degrade that one source to empty,
  // never blank the entire timeline. The timeline is the user's story; show
  // what we can.
  const settled = await Promise.allSettled(tasks);
  for (const r of settled) {
    if (r.status === 'rejected') console.error('[historyAggregator] a timeline source failed:', r.reason?.message ?? r.reason);
  }
  let merged = settled.filter(r => r.status === 'fulfilled').flatMap(r => r.value ?? []);

  // Drop event types the caller didn't ask for (active-position helper returns both opens and theses)
  merged = merged.filter(e => sources.includes(e.source));

  // Free-text topic filter — substring match across title + excerpt + quote.
  // Case-insensitive. Crude but sufficient for v1; can move to FTS later.
  if (topic && topic.trim()) {
    const needle = topic.trim().toLowerCase();
    merged = merged.filter(e => {
      const hay = `${e.title} ${e.excerpt} ${e.quote || ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }

  // Sort newest first
  merged.sort((a, b) => new Date(b.date) - new Date(a.date));

  return merged.slice(0, limit);
}

/**
 * Convenience helper for the recall_history agent tool.
 * Returns memory entries in a simpler shape optimized for prompting:
 *   { source, date, excerpt, context, ticker, outcome }
 * where `context` is the verbatim quote (so the agent can pass it through
 * to the user with attribution).
 *
 * SECURITY: `excerpt` and `context` are the user's own prior writing pulled
 * from agent_messages / journal_notes / closed_trades — i.e. arbitrary text
 * an attacker could have planted in their own data weeks ago. Wrap them in
 * <user_quoted> tags so the agent's system prompt's anti-injection clause
 * applies even when this comes back as a tool result. Strips any nested
 * </user_quoted> close-tag to keep the wrapper intact.
 */
export function wrapQuote(text, max = 400) {
  // Delegate to the one hardened fence (loop-until-stable tag strip). Preserve the
  // falsy-passthrough so a null quote stays null (the recall entry's context field).
  return text ? fenceUserText(text, max) : text;
}
export async function recallHistory(options) {
  const events = await getUserHistory(options);
  return events.map(e => {
    // For position_open events whose date is the row-creation timestamp
    // (not a user-provided purchase date), pass through an explicit signal
    // so the agent doesn't reason about hold duration from a meaningless
    // date. Other event types are unaffected: their dates are real
    // timestamps of when the user wrote/closed/chatted.
    const isUnreliableOpenDate = e.source === 'position_open' && e.meta?.purchaseDateProvided === false;
    return {
      source: e.source,
      date: e.date,
      ticker: e.ticker,
      title: e.title,
      excerpt: wrapQuote(e.excerpt, 220),
      context: wrapQuote(e.quote, 400), // user's verbatim writing, wrap before agent sees it
      outcome: e.outcome,
      pnl: e.pnl,
      holdDays: e.holdDays,
      // For position_open with no user-provided purchase date, this date is
      // when the row was added to Outpost, NOT when the user bought. Do not
      // infer hold duration from it. The user has not told us when they bought.
      dateMeaning: e.source === 'position_open'
        ? (isUnreliableOpenDate ? 'added_to_outpost_only' : 'actual_purchase_date')
        : undefined,
    };
  });
}
