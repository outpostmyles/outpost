// Pins the news relevance filter that keeps a ticker's news ABOUT that ticker.
// The bug it fixes: asking for POET's news returned a "penny stocks to watch"
// listicle that was really about IMMP and just co-tagged POET. The filter drops
// big multi-ticker baskets unless the ticker is named in the headline.
import assert from 'node:assert/strict';
import { isRelevantNews, filterTickerNews } from '../api/utils/newsHygiene.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('keeps a focused article that tags the ticker', () => {
  assert.equal(isRelevantNews({ title: 'POET Technologies reports Q3', tickers: ['POET'] }, 'POET'), true);
  assert.equal(isRelevantNews({ title: 'Apple and Microsoft both rally', tickers: ['AAPL', 'MSFT'] }, 'AAPL'), true);
});

test('drops a big multi-ticker listicle that does not name the ticker in the title', () => {
  // The actual spam: a basket about IMMP that co-tags POET and many others.
  const listicle = { title: '7 Penny Stocks To Watch This Week', tickers: ['IMMP', 'POET', 'XYZ', 'ABC', 'DEF', 'GHI', 'JKL'] };
  assert.equal(isRelevantNews(listicle, 'POET'), false);
});

test('keeps a big basket when the ticker IS named in the headline', () => {
  const named = { title: 'POET Technologies Leads This Week\'s Penny Stock Movers', tickers: ['POET', 'A', 'B', 'C', 'D', 'E', 'F', 'G'] };
  assert.equal(isRelevantNews(named, 'POET'), true);
});

test('drops an article that does not tag the ticker at all', () => {
  assert.equal(isRelevantNews({ title: 'IMMP surges on data', tickers: ['IMMP'] }, 'POET'), false);
});

test('keeps an untagged article (cannot judge by basket)', () => {
  assert.equal(isRelevantNews({ title: 'Markets mixed today', tickers: [] }, 'POET'), true);
  assert.equal(isRelevantNews({ title: 'Markets mixed today' }, 'POET'), true);
});

test('title match is word-boundary, not substring', () => {
  // Ticker "F" must not be considered "named" inside the word FORD.
  assert.equal(isRelevantNews({ title: 'FORD AND GM SLIDE', tickers: ['F', 'GM', 'A', 'B', 'C', 'D', 'E', 'H'] }, 'F'), false);
  // But "F " as its own token in a headline counts.
  assert.equal(isRelevantNews({ title: 'Why F is the value play', tickers: ['F', 'A', 'B', 'C', 'D', 'E', 'G', 'H'] }, 'F'), true);
  // "AI" must not match inside SAID.
  assert.equal(isRelevantNews({ title: 'He SAID nothing new', tickers: ['AI', 'A', 'B', 'C', 'D', 'E', 'G', 'H'] }, 'AI'), false);
});

test('filterTickerNews preserves order, caps at max, and drops the spam', () => {
  const articles = [
    { title: 'POET reports earnings', tickers: ['POET'] },
    { title: '10 Penny Stocks To Watch', tickers: ['IMMP', 'POET', 'A', 'B', 'C', 'D', 'E', 'F'] }, // spam
    { title: 'POET wins contract', tickers: ['POET', 'CSCO'] },
    { title: 'POET analyst upgrade', tickers: ['POET'] },
  ];
  const out = filterTickerNews(articles, 'POET', { max: 2 });
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'POET reports earnings');
  assert.equal(out[1].title, 'POET wins contract'); // the listicle was skipped, order preserved
});

test('filterTickerNews is safe on junk', () => {
  assert.deepEqual(filterTickerNews(null, 'POET'), []);
  assert.deepEqual(filterTickerNews(undefined, 'POET'), []);
  assert.deepEqual(filterTickerNews([{ title: 'x', tickers: ['POET'] }], ''), []);
  assert.deepEqual(filterTickerNews('nope', 'POET'), []);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
