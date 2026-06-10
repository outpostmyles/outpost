import { mergeLots } from './bookStats.js';

/**
 * Decide the exact position values + cost for a FUNDED buy, so the atomic RPC
 * (buy_position_funded) only has to write them. This holds the two rules the buy
 * route applies, in one pure, unit-tested place so they can't silently drift:
 *
 *   - merge (adding to a held position): blend shares/avg_cost via mergeLots, and
 *     fill a plan field (thesis / target / stop) ONLY if the held position does not
 *     already have one. Never clobber an existing thesis, target, or stop.
 *   - new (no held position): set every field the user provided.
 *
 * A null plan field in the returned args means "leave whatever is there" on a merge
 * (the RPC COALESCEs it). `nowIso` is passed in rather than read from the clock so
 * this function stays pure and testable. `cost` is the ADDED lot's cost (shares paid
 * times price paid), rounded to cents, which is what gets debited from cash.
 *
 * Only called for funded buys, so avg_cost is always > 0 here.
 */
export function buildFundedBuyArgs(input) {
  const {
    held, ticker, shares, avgCost, companyName, purchaseDate, entryThesis,
    reversalCondition, priceTarget, stopLoss, tradeNotes, thesisSource, source, nowIso,
  } = input;

  const cost = Math.round(shares * avgCost * 100) / 100;

  if (held) {
    const blended = mergeLots(held.shares, held.avg_cost, shares, avgCost);
    const fillThesis = !!(entryThesis && !held.entry_thesis);
    return {
      mode: 'merge',
      positionId: held.id,
      cost,
      ticker: null, // identity is fixed on a merge; the UPDATE never touches it
      shares: blended.shares,
      avgCost: blended.avgCost,
      // insert-only fields: untouched on a merge
      companyName: null,
      purchasedAt: null,
      source: null,
      reversalCondition: null,
      tradeNotes: null,
      // plan fields: fill only when the held position lacks them
      entryThesis: fillThesis ? entryThesis : null,
      thesisWrittenAt: fillThesis ? nowIso : null,
      thesisSource: fillThesis ? thesisSource : null,
      priceTarget: (priceTarget && !held.price_target) ? priceTarget : null,
      stopLoss: (stopLoss && !held.stop_loss) ? stopLoss : null,
    };
  }

  return {
    mode: 'new',
    positionId: null,
    cost,
    ticker: ticker ?? null,
    shares,
    avgCost,
    companyName: companyName ?? null,
    purchasedAt: purchaseDate ? purchaseDate.toISOString() : null,
    source: (source && source !== 'manual') ? source : null,
    reversalCondition: reversalCondition || null,
    tradeNotes: tradeNotes || null,
    entryThesis: entryThesis || null,
    thesisWrittenAt: entryThesis ? nowIso : null,
    thesisSource: entryThesis ? thesisSource : null,
    priceTarget: priceTarget || null,
    stopLoss: stopLoss || null,
  };
}
