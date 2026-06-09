import { supabase } from '../db.js';
import { getMarketData, getMoversData } from '../services/marketData.js';
import { getPrices } from '../services/pricePool.js';
import { getCashBalance } from '../services/cashBalance.js';
import { getUserPatternBlock } from '../services/decisionLedger.js';
import { staticSector } from '../services/sectorMap.js';
import { buildConcentrationRead, formatConcentrationRead } from '../../src/lib/concentrationRead.js';
import { computePortfolioValue } from '../../src/lib/portfolioValue.js';
import { getNews, getSnapshot, getMarketTrend, getMarketNews } from '../utils/polygon.js';
import { getBreakingNews, isFinnhubAvailable } from '../utils/finnhub.js';

// Wraps user-authored free-text (entry_thesis, reversal_condition, trade_notes)
// in <user_quoted> tags before interpolating into a system prompt. The
// AGENT_SYSTEM / brief / analysis system prompts all instruct the model to
// treat content inside these tags as DATA, not instructions — which defangs
// "ignore previous instructions" style injections planted in a position note.
// Strips any nested </user_quoted> close-tag a clever attacker tries to use
// to break out of the wrapper.
function safeUserText(text, max = 500) {
  if (!text) return '';
  return `<user_quoted>${String(text).slice(0, max).replace(/<\/?user_quoted>/gi, '')}</user_quoted>`;
}

/**
 * Get sector radar summary from cache for enriching other contexts.
 * Returns a short string summarizing sector rotation.
 */
async function getRadarSummary() {
  try {
    const { data: cached } = await supabase.from('ai_cache').select('result,created_at').eq('cache_key', 'sector_radar').maybeSingle();
    if (!cached?.result) return '';
    // Only use if less than 2 hours old
    if (Date.now() - new Date(cached.created_at).getTime() > 2 * 60 * 60 * 1000) return '';
    const radar = JSON.parse(cached.result);
    const parts = [];
    if (radar.heating?.length) {
      parts.push('Money flowing INTO: ' + radar.heating.map(s => `${s.name} (${s.signal} — ${s.thesis})`).join(', '));
    }
    if (radar.cooling?.length) {
      parts.push('Money flowing OUT OF: ' + radar.cooling.map(s => `${s.name} (${s.signal} — ${s.thesis})`).join(', '));
    }
    if (radar.themeWatch) {
      parts.push(`Emerging theme: ${radar.themeWatch.name} — ${radar.themeWatch.thesis}`);
    }
    return parts.length > 0 ? parts.join('. ') : '';
  } catch {
    return '';
  }
}

export async function buildUserContext(userId, user) {
  try {
    // Market data comes from memory — zero Polygon calls
    const market = getMarketData();

    const [positions, watchlist, cashResult] = await Promise.allSettled([
      // Phase 2 added reversal_condition + thesis_written_at — the agent
      // needs both visible in its base context, otherwise it has to call
      // recall_history for data that's already on the row. Also pulling
      // source (Phase 4) so the agent can mention "you opened this via
      // Deploy Cash" when relevant.
      supabase.from('positions').select('ticker,shares,avg_cost,company_name,entry_thesis,reversal_condition,thesis_written_at,price_target,stop_loss,trade_notes,purchased_at,created_at,source').eq('user_id', userId),
      supabase.from('watchlist').select('ticker').eq('user_id', userId).limit(10),
      // Cash is the user's real buying power. Without it the agent guesses how
      // much dry powder they have, which is exactly the kind of "you got their
      // book wrong" mistake that breaks trust.
      getCashBalance(userId),
    ]);

    const pos = positions.status === 'fulfilled' ? (positions.value.data ?? []) : [];
    const watch = watchlist.status === 'fulfilled' ? (watchlist.value.data ?? []).map(w => w.ticker) : [];
    const cash = cashResult.status === 'fulfilled' ? (Number(cashResult.value) || 0) : 0;

    // Get live prices from pool for accurate P&L
    const priceMap = pos.length > 0 ? getPrices(pos.map(p => p.ticker)) : {};

    // The SAME hardened money math the home screen uses (src/lib/portfolioValue.js),
    // so the agent's portfolio numbers are byte-for-byte identical to the cards and
    // can never go NaN. A malformed row used to leak through `price ?? avg_cost`
    // (?? misses NaN) and bake a literal "$NaN" into the agent's context, which it
    // would then read back to the user as their account value.
    const { positions: enrichedPos, totals } = computePortfolioValue(pos, priceMap, { marketOpen: market.marketOpen });
    const totalUnrealizedPnl = totals.totalPnl;
    const gainers = enrichedPos.filter(p => p.pnl > 0).length;
    const losers = enrichedPos.filter(p => p.pnl < 0).length;

    const positionsStr = enrichedPos.length > 0
      ? enrichedPos.map(p => {
          const hasLive = !p.priceStale;
          const livePrice = hasLive ? p.currentPrice : null;
          const cost = p.avg_cost ?? 0;
          const pnlPct = hasLive ? p.pnlPercent.toFixed(1) : '0.0';
          // CRITICAL: only use the user-provided purchased_at. Do NOT fall back
          // to created_at (when the position row was added to OUR database) —
          // that's not when the user actually bought the stock. A user adding
          // a 3-year hold yesterday would otherwise look like a "1d" hold and
          // the AI would invent short-term/tax-status reasoning that's wrong.
          // When the date is unknown, say so explicitly so the AI knows not to
          // invent a holding period.
          const purchaseTime = p.purchased_at;
          let holdSegment = 'hold duration unknown';
          // Guard an unparseable date: new Date('garbage').getTime() is NaN, which
          // would print "held NaNd" into the agent's context. Finite or nothing.
          const startMs = purchaseTime ? new Date(purchaseTime).getTime() : NaN;
          if (Number.isFinite(startMs)) {
            const startDay = Math.floor(startMs / 86400000);
            const endDay = Math.floor(Date.now() / 86400000);
            const holdDays = Math.max(0, endDay - startDay);
            const holdStr = holdDays >= 365 ? `${Math.floor(holdDays / 365)}y${holdDays % 365 > 30 ? ` ${Math.floor((holdDays % 365) / 30)}m` : ''}` : `${holdDays}d`;
            const taxStatus = holdDays >= 365 ? 'long-term' : 'short-term';
            holdSegment = `held ${holdStr} [${taxStatus}]`;
          }
          // With no live quote we do not print a fabricated "0.0% P&L" (which
          // would read as "flat"); we say the P&L is unknown so the model does
          // not reason off a number we do not actually have.
          const pnlSegment = livePrice ? `${pnlPct > 0 ? '+' : ''}${pnlPct}% P&L` : 'P&L unknown (no live price)';
          return `${p.ticker} (${p.shares} shares @ $${cost} avg, ${livePrice ? `now $${livePrice.toFixed(2)}, ` : ''}${pnlSegment}, ${holdSegment})`;
        }).join(', ')
      : 'No positions yet';

    // Fetch multi-day trend data, Polygon news, and Finnhub breaking news in parallel
    const fetchJobs = [getMarketTrend(), getMarketNews(5)];
    if (isFinnhubAvailable()) fetchJobs.push(getBreakingNews(5));

    const [trendResult, marketNewsResult, breakingResult] = await Promise.allSettled(fetchJobs);
    const trend = trendResult.status === 'fulfilled' ? trendResult.value : { narrative: 'Trend data unavailable', momentum: 'unknown' };
    const marketHeadlines = marketNewsResult.status === 'fulfilled' ? marketNewsResult.value : [];
    const breakingNews = breakingResult?.status === 'fulfilled' ? (breakingResult.value ?? []) : [];

    // Combine Polygon + Finnhub headlines, dedupe by title similarity
    const allHeadlines = [...breakingNews, ...marketHeadlines];
    const seen = new Set();
    const dedupedHeadlines = allHeadlines.filter(a => {
      const key = a.title?.toLowerCase().slice(0, 50);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);

    const headlinesStr = dedupedHeadlines.length > 0
      ? dedupedHeadlines.map(a => `${a.source}: ${a.title}`).join('\n')
      : 'No recent headlines';

    // Frontier #6: the hidden bet, a portfolio-level read that catches when several
    // names are secretly one sector bet, so the agent can plain it out for them.
    const hiddenBet = formatConcentrationRead(buildConcentrationRead(
      enrichedPos.map(p => ({ ticker: p.ticker, value: p.currentValue })),
      { sectorOf: staticSector },
    ));

    return {
      name: user.display_name || 'Trader',
      plan: user.plan || 'free',
      riskTolerance: user.risk_tolerance || 'moderate',
      tradingStyle: user.trading_style || 'swing',
      positions: positionsStr,
      positionCount: pos.length,
      positionTickers: pos.map(p => p.ticker),
      _rawPositions: pos,
      hiddenBet,
      watchlist: watch.length > 0 ? watch.join(', ') : 'Empty',
      cash: `$${cash.toFixed(2)}`,
      cashRaw: cash,
      holdingsValue: `$${totals.totalValue.toFixed(0)}`,
      accountValue: `$${(totals.totalValue + cash).toFixed(0)}`,
      totalUnrealizedPnl: totalUnrealizedPnl !== 0 ? `${totalUnrealizedPnl > 0 ? '+' : ''}$${totalUnrealizedPnl.toFixed(0)}` : '$0',
      gainers,
      losers,
      vix: market.vix?.value ?? 'N/A',
      vixLabel: market.vix?.label ?? 'Unknown',
      fearGreed: market.fearGreed?.value ?? 'N/A',
      fearGreedLabel: market.fearGreed?.label ?? 'Unknown',
      spyRsi: market.spyRsi?.value ?? 'N/A',
      spyRsiLabel: market.spyRsi?.label ?? 'Unknown',
      qqqRsi: market.qqqRsi?.value ?? 'N/A',
      regime: market.regime,
      marketOpen: market.marketOpen,
      marketTrend: trend.narrative,
      marketMomentum: trend.momentum,
      marketHeadlines: headlinesStr,
    };
  } catch {
    return {
      name: user.display_name || 'Trader',
      plan: user.plan || 'free',
      riskTolerance: user.risk_tolerance || 'moderate',
      tradingStyle: user.trading_style || 'swing',
      positions: 'Unavailable',
      positionCount: 0,
      positionTickers: [],
      _rawPositions: [],
      watchlist: 'Unavailable',
      cash: 'Unknown', cashRaw: 0, holdingsValue: 'Unknown', accountValue: 'Unknown',
      totalUnrealizedPnl: '$0',
      gainers: 0,
      losers: 0,
      vix: 'N/A', vixLabel: 'Unknown',
      fearGreed: 'N/A', fearGreedLabel: 'Unknown',
      spyRsi: 'N/A', spyRsiLabel: 'Unknown',
      qqqRsi: 'N/A', regime: 'Neutral', marketOpen: false,
    };
  }
}

/**
 * Build rich context for the agent — includes real news, movers, and price moves.
 * This prevents Claude from hallucinating market events.
 */
export async function buildAgentContext(userId, user) {
  const base = await buildUserContext(userId, user);

  // Get today's date in ET for temporal grounding
  const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dateStr = etNow.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = etNow.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  // Get movers from memory (zero API calls)
  const movers = getMoversData();

  // Get recent news for user's position tickers + broad market
  const newsTickers = [...new Set([...base.positionTickers.slice(0, 3), 'SPY'])];
  let recentNews = [];
  try {
    const newsResults = await Promise.allSettled(newsTickers.map(t => getNews(t, 5)));
    for (const result of newsResults) {
      if (result.status === 'fulfilled' && result.value?.length) {
        recentNews.push(...result.value);
      }
    }
    // Dedupe by title and sort by date, take most recent
    const seen = new Set();
    recentNews = recentNews
      .filter(a => { const key = a.title; if (seen.has(key)) return false; seen.add(key); return true; })
      .sort((a, b) => new Date(b.publishedUtc) - new Date(a.publishedUtc))
      .slice(0, 8);
  } catch { recentNews = []; }

  // Get SPY/QQQ price changes (key indices)
  let indexMoves = '';
  try {
    const indices = getPrices(['SPY', 'QQQ', 'DIA', 'IWM']);
    const parts = [];
    for (const [ticker, data] of Object.entries(indices)) {
      if (data?.price && data?.changePercent != null) {
        parts.push(`${ticker}: $${data.price.toFixed(2)} (${data.changePercent >= 0 ? '+' : ''}${data.changePercent.toFixed(2)}%)`);
      }
    }
    indexMoves = parts.length > 0 ? parts.join(', ') : 'No index data available';
  } catch { indexMoves = 'No index data available'; }

  // Format movers
  const topGainers = (movers.gainers ?? []).slice(0, 3).map(m =>
    `${m.ticker} +${m.changePercent?.toFixed(1)}% ($${m.price?.toFixed(2)})`
  ).join(', ') || 'None available';

  const topLosers = (movers.losers ?? []).slice(0, 3).map(m =>
    `${m.ticker} ${m.changePercent?.toFixed(1)}% ($${m.price?.toFixed(2)})`
  ).join(', ') || 'None available';

  // Format news
  const newsStr = recentNews.length > 0
    ? recentNews.map(a => {
        const ago = timeSince(new Date(a.publishedUtc));
        return `[${ago}] ${a.source}: ${a.title}`;
      }).join('\n')
    : 'No recent news available from data feeds.';

  // Position price changes for "what happened" context
  let positionMoves = '';
  if (base.positionTickers.length > 0) {
    const posMap = getPrices(base.positionTickers);
    const parts = [];
    for (const ticker of base.positionTickers) {
      const d = posMap[ticker];
      if (d?.price && d?.changePercent != null) {
        parts.push(`${ticker}: $${d.price.toFixed(2)} (${d.changePercent >= 0 ? '+' : ''}${d.changePercent.toFixed(2)}%)`);
      }
    }
    positionMoves = parts.length > 0 ? parts.join(', ') : 'No live price data for positions';
  }

  // Get sector radar summary for rotation context
  let sectorRadarStr = '';
  try {
    sectorRadarStr = await getRadarSummary();
  } catch {}

  // Plan adherence summary — patterns from comparing stated trade plans vs actual exits.
  // Lets the agent ground feedback in the trader's actual behavior rather than generic advice.
  let planAdherenceStr = '';
  try {
    const { getAdherenceSummaryForAgent } = await import('../services/planAdherence.js');
    planAdherenceStr = await getAdherenceSummaryForAgent(userId);
  } catch {}

  // Performance attribution summary — where the user's edge actually lives (style, concentration).
  let attributionStr = '';
  try {
    const { getAttributionSummaryForAgent } = await import('../services/performanceAttribution.js');
    attributionStr = await getAttributionSummaryForAgent(userId);
  } catch {}

  // Build trade plans context — check if positions have plan data.
  // Phase 2: reversal_condition is the user's "what would change my mind"
  // captured at position open. Phase 4: source tells us if they got here
  // via Deploy Cash, which is worth referencing naturally.
  const rawPos = base._rawPositions ?? [];
  const tradePlans = rawPos.filter(p => p.entry_thesis || p.reversal_condition || p.price_target || p.stop_loss);
  let tradePlansStr = '';
  const activeAlerts = []; // positions near stop or target
  if (tradePlans.length > 0) {
    const priceMap = getPrices(tradePlans.map(p => p.ticker));
    tradePlansStr = '\nTRADE PLANS (the trader set these — reference them when relevant, quote their wording where possible):\n' +
      tradePlans.map(p => {
        const live = priceMap[p.ticker]?.price;
        const parts = [`${p.ticker}:`];
        if (p.entry_thesis) parts.push(`Thesis: ${safeUserText(p.entry_thesis)}`);
        if (p.reversal_condition) parts.push(`Will change mind if: ${safeUserText(p.reversal_condition)}`);
        if (p.price_target) {
          const targetDist = live ? ((p.price_target - live) / live * 100) : null;
          const targetStr = targetDist != null ? ` (${targetDist.toFixed(1)}% from current)` : '';
          parts.push(`Target: $${p.price_target}${targetStr}`);
          if (targetDist != null && targetDist >= 0 && targetDist <= 10) {
            activeAlerts.push(`${p.ticker} is within ${targetDist.toFixed(1)}% of its price target ($${p.price_target})`);
          }
          if (targetDist != null && targetDist < 0) {
            activeAlerts.push(`${p.ticker} has PASSED its price target ($${p.price_target}) — now trading at $${live.toFixed(2)}`);
          }
        }
        if (p.stop_loss) {
          const stopDist = live ? ((p.stop_loss - live) / live * 100) : null;
          const stopStr = stopDist != null ? ` (${stopDist.toFixed(1)}% from current)` : '';
          parts.push(`Stop: $${p.stop_loss}${stopStr}`);
          if (stopDist != null && stopDist >= -10 && stopDist <= 0) {
            activeAlerts.push(`${p.ticker} is within ${Math.abs(stopDist).toFixed(1)}% of its stop loss ($${p.stop_loss})`);
          }
          if (stopDist != null && stopDist > 0) {
            activeAlerts.push(`${p.ticker} has BROKEN BELOW its stop loss ($${p.stop_loss}) — now at $${live.toFixed(2)}`);
          }
        }
        if (p.trade_notes) parts.push(`Notes: ${safeUserText(p.trade_notes, 1000)}`);
        return parts.join(' | ');
      }).join('\n');
  }

  // If any positions are near their targets/stops, add an urgent alert section
  let alertsStr = '';
  if (activeAlerts.length > 0) {
    alertsStr = '\n\nACTIVE ALERTS (bring these up proactively — the trader needs to know):\n' + activeAlerts.join('\n');
  }

  // North Star — the trader's freedom number, so the agent can frame guidance
  // around protecting and advancing it, not just the trade in front of them.
  let northStar = '';
  try {
    const { data: goalRow } = await supabase.from('agent_memory')
      .select('content').eq('user_id', userId).eq('memory_type', 'goal')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (goalRow?.content) {
      const g = JSON.parse(goalRow.content);
      const target = Number(g?.amount);
      if (target > 0) {
        const pm = getPrices(rawPos.map(p => p.ticker));
        const holdingsValue = rawPos.reduce((s, p) => s + (pm[p.ticker]?.price ?? p.avg_cost ?? 0) * (p.shares ?? 0), 0);
        // Account value, not holdings only: the freedom number is measured against
        // everything they have, so cash counts and closing a position into cash
        // does not make the goal look further away.
        const accountValue = holdingsValue + await getCashBalance(userId);
        const pct = Math.max(0, Math.min(100, Math.round((accountValue / target) * 100)));
        northStar = `\n\nNORTH STAR (the trader's stated freedom goal): $${target.toLocaleString()}${g.label ? ` ("${safeUserText(g.label, 80)}")` : ''}. They are about ${pct}% of the way there. When a decision is material, frame it in terms of protecting and advancing this goal. Never reframe or invent a different goal for them.`;
      }
    }
  } catch {}

  // The trader's real, recorded patterns (decision quality + self-sabotage), so
  // the agent coaches from their actual history in every conversation. Empty
  // until there is graded history; fail-safe.
  let decisionPatterns = '';
  try { decisionPatterns = await getUserPatternBlock(userId); } catch {}

  return {
    ...base,
    currentDate: dateStr,
    currentTime: timeStr,
    indexMoves,
    topGainers,
    topLosers,
    recentNews: newsStr,
    positionMoves,
    tradePlans,
    tradePlansStr,
    activeAlerts: alertsStr,
    sectorRadar: sectorRadarStr,
    planAdherence: planAdherenceStr,
    performanceAttribution: attributionStr,
    northStar,
    decisionPatterns,
  };
}

/**
 * Lightweight context for the daily pre-market brief.
 * Wraps buildUserContext and adds:
 *   - trade plan rows with target/stop distance
 *   - active alerts for positions near or past their target/stop
 *   - ticker-specific headlines for any position that's a big premarket mover
 *
 * Designed to stay cheap at scale — runs at 7:30am ET across all paid users
 * via the cron, so we keep extra fetches bounded (max 3 ticker-news calls).
 */
export async function buildBriefContext(userId, user) {
  const base = await buildUserContext(userId, user);

  const rawPos = base._rawPositions ?? [];
  if (rawPos.length === 0) return base;

  const tickers = rawPos.map(p => p.ticker);
  const priceMap = getPrices(tickers);

  // ── Trade plans + alerts (lifted from buildAgentContext, kept inline so this
  //    helper stays self-contained) ────────────────────────────────────────────
  const planLines = [];
  const activeAlerts = [];
  for (const p of rawPos) {
    if (!p.entry_thesis && !p.price_target && !p.stop_loss) continue;
    const live = priceMap[p.ticker]?.price;
    const parts = [`${p.ticker}:`];
    if (p.entry_thesis) parts.push(`thesis ${safeUserText(p.entry_thesis)}`);
    if (p.price_target) {
      const dist = live ? ((p.price_target - live) / live * 100) : null;
      parts.push(`target $${p.price_target}${dist != null ? ` (${dist.toFixed(1)}% away)` : ''}`);
      if (dist != null && dist >= 0 && dist <= 10) {
        activeAlerts.push(`${p.ticker} is within ${dist.toFixed(1)}% of its target ($${p.price_target}).`);
      } else if (dist != null && dist < 0) {
        activeAlerts.push(`${p.ticker} has PASSED its target ($${p.price_target}) — now $${live.toFixed(2)}.`);
      }
    }
    if (p.stop_loss) {
      const dist = live ? ((p.stop_loss - live) / live * 100) : null;
      parts.push(`stop $${p.stop_loss}${dist != null ? ` (${dist.toFixed(1)}% away)` : ''}`);
      if (dist != null && dist >= -10 && dist <= 0) {
        activeAlerts.push(`${p.ticker} is within ${Math.abs(dist).toFixed(1)}% of its stop ($${p.stop_loss}).`);
      } else if (dist != null && dist > 0) {
        activeAlerts.push(`${p.ticker} has BROKEN BELOW its stop ($${p.stop_loss}) — now $${live.toFixed(2)}.`);
      }
    }
    planLines.push(parts.join(' | '));
  }
  const tradePlansStr = planLines.length > 0
    ? '\nTRADE PLANS (the trader set these — reference them when relevant):\n' + planLines.join('\n')
    : '';
  const activeAlertsStr = activeAlerts.length > 0
    ? '\n\nACTIVE ALERTS (lead with these — the trader needs to know):\n- ' + activeAlerts.join('\n- ')
    : '';

  // ── Ticker-specific news for big movers ──────────────────────────────────
  // Premarket moves often have catalysts (earnings, analyst, FDA, contract).
  // We pull headlines for up to 3 tickers with the largest absolute move so
  // the brief can lead with WHY rather than just the percentage.
  const moversByMove = rawPos
    .map(p => ({
      ticker: p.ticker,
      changePct: priceMap[p.ticker]?.changePercent ?? 0,
    }))
    .filter(m => Math.abs(m.changePct) >= 3)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 3);

  const tickerNewsLines = [];
  if (moversByMove.length > 0) {
    const newsResults = await Promise.allSettled(
      moversByMove.map(m => getNews(m.ticker, 2))
    );
    for (let i = 0; i < moversByMove.length; i++) {
      const m = moversByMove[i];
      const r = newsResults[i];
      const articles = r.status === 'fulfilled' ? (r.value ?? []) : [];
      if (articles.length === 0) continue;
      tickerNewsLines.push(
        `${m.ticker} (${m.changePct >= 0 ? '+' : ''}${m.changePct.toFixed(1)}%): ` +
        articles.slice(0, 2).map(a => a.title).join(' | ')
      );
    }
  }
  const tickerNewsStr = tickerNewsLines.length > 0
    ? '\nTICKER-SPECIFIC NEWS for big movers in your portfolio:\n' + tickerNewsLines.join('\n')
    : '';

  return {
    ...base,
    tradePlansStr,
    activeAlertsStr,
    tickerNewsStr,
  };
}

function timeSince(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
