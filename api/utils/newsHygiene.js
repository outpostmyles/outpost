// News hygiene: keep a ticker's news actually about that ticker.
//
// Polygon's per-ticker news feed includes "stocks to watch" listicles that tag a
// big basket of unrelated tickers. Ask for POET and you get an article that is
// really about IMMP and just happens to tag POET (and a dozen others) too. Shown
// as POET's news, it reads as spam and makes the per-stock read look broken.
//
// The operative signal is the size of the article's ticker basket: a focused
// article tags a few names, a listicle tags many. We drop big baskets unless the
// ticker is named in the headline (which is a strong "this is about it" signal,
// common for the small caps that get listicle-spammed). Pure so it is testable.

// More tagged tickers than this, with the ticker absent from the title, reads as
// a basket/listicle rather than an article about the company.
const MAX_BASKET = 6;

function titleNamesTicker(title, ticker) {
  if (!title || !ticker) return false;
  // Word-boundary match so "F" does not hit "FOR" and "AI" does not hit "SAID".
  const re = new RegExp(`(^|[^A-Z0-9])${ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9]|$)`);
  return re.test(title.toUpperCase());
}

/**
 * Is this article plausibly ABOUT the target ticker, versus a basket listicle
 * that merely co-tags it? article: { title, tickers? }. ticker: symbol string.
 */
export function isRelevantNews(article, ticker) {
  if (!article || !ticker) return false;
  const t = String(ticker).toUpperCase().trim();
  if (!t) return false;
  const tickers = Array.isArray(article.tickers) ? article.tickers.map(x => String(x).toUpperCase()) : [];
  // If the feed tagged tickers and ours is not among them, it is not our news.
  if (tickers.length > 0 && !tickers.includes(t)) return false;
  // Named in the headline: keep it regardless of basket size.
  if (titleNamesTicker(article.title, t)) return true;
  // Untagged article we cannot judge by basket: keep (rare, and at least it came
  // back from a query for this ticker).
  if (tickers.length === 0) return true;
  // Otherwise keep only focused articles; a large multi-ticker basket that does
  // not name the ticker in its headline is listicle spam.
  return tickers.length <= MAX_BASKET;
}

/**
 * Filter a ticker's raw articles down to the relevant ones, preserving order,
 * capped at `max`. Safe on junk input (returns []).
 */
export function filterTickerNews(articles, ticker, { max = 10 } = {}) {
  const list = Array.isArray(articles) ? articles : [];
  const kept = list.filter(a => isRelevantNews(a, ticker));
  return max > 0 ? kept.slice(0, max) : kept;
}
