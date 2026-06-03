// Pins normalizeQuote (api/utils/polygon.js), THE single source of truth that
// every quote path now routes through (getSnapshot, getSnapshots, getMovers,
// lookupStock). The whole point is that one ticker can no longer show two
// different prices or today-percents across the app, so the field-precedence
// chain, the change math, the honest-null-on-missing-prev rule, and the absurd
// percent clamp are all locked here. A regression in any of them would put the
// "same number, different values" bug back into the product for every user.
import assert from 'node:assert/strict';
import { normalizeQuote } from '../api/utils/polygon.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('day.c is the primary price; change and percent computed off prevDay', () => {
  const q = normalizeQuote({ day: { c: 10, v: 1000, h: 11, l: 9, o: 9.5 }, prevDay: { c: 8 } });
  assert.equal(q.price, 10);
  assert.equal(q.change, 2);
  assert.equal(q.changePercent, 25);
  assert.equal(q.prevClose, 8);
  assert.equal(q.volume, 1000);
  assert.equal(q.dayHigh, 11);
  assert.equal(q.dayLow, 9);
  assert.equal(q.dayOpen, 9.5);
});

test('price precedence: day.c beats lastTrade.p beats min.c', () => {
  const q = normalizeQuote({ day: { c: 10 }, lastTrade: { p: 99 }, min: { c: 88 }, prevDay: { c: 9 } });
  assert.equal(q.price, 10);
});

test('falls back to lastTrade.p when day.c is missing or zero', () => {
  // day.c of 0 is not a real price (validPrice rejects <= 0): fall through.
  const q = normalizeQuote({ day: { c: 0 }, lastTrade: { p: 12 }, prevDay: { c: 10 } });
  assert.equal(q.price, 12);
  assert.equal(q.change, 2);
  assert.equal(q.changePercent, 20);
});

test('falls back to min.c when day.c and lastTrade.p are absent', () => {
  const q = normalizeQuote({ min: { c: 7 }, prevDay: { c: 6 } });
  assert.equal(q.price, 7);
  assert.equal(q.change, 1);
  assert.equal(q.changePercent, 16.67); // (1/6)*100 rounded
});

test('pre-market shape (only prevDay present) reads as flat, not unknown', () => {
  // price falls back to prevDay.c, prev is the same prevDay.c, so 0 change / 0%.
  const q = normalizeQuote({ prevDay: { c: 50 } });
  assert.equal(q.price, 50);
  assert.equal(q.change, 0);
  assert.equal(q.changePercent, 0);
  assert.equal(q.prevClose, 50);
});

test('a truly flat day (price equals prev) reports 0%, never null', () => {
  // The old `change ? ... : null` / `changePct ? ... : null` dropped a real 0
  // to null, hiding a flat stock. A genuine zero must survive as zero.
  const q = normalizeQuote({ day: { c: 50 }, prevDay: { c: 50 } });
  assert.strictEqual(q.change, 0);
  assert.strictEqual(q.changePercent, 0);
});

test('missing prior close means change is UNKNOWN (null), not a fake 0%', () => {
  // A live day.c with no prevDay.c: we have no reference, so change/percent/
  // prevClose are honest nulls rather than a fabricated "flat".
  const q = normalizeQuote({ day: { c: 25, v: 500 } });
  assert.equal(q.price, 25);
  assert.strictEqual(q.change, null);
  assert.strictEqual(q.changePercent, null);
  assert.strictEqual(q.prevClose, null);
  assert.equal(q.volume, 500); // price-independent fields still pass through
});

test('absurd positive percent is clamped to null; price and change survive', () => {
  // prev 1, price 61 => +6000%, a stale-prevClose artifact. Null the percent,
  // keep the price so the user still sees a number.
  const q = normalizeQuote({ day: { c: 61 }, prevDay: { c: 1 } });
  assert.equal(q.price, 61);
  assert.equal(q.change, 60);
  assert.strictEqual(q.changePercent, null);
});

test('absurd negative percent is clamped to null', () => {
  // prev 100, price 4 => -96%, just past the -95 floor.
  const q = normalizeQuote({ day: { c: 4 }, prevDay: { c: 100 } });
  assert.equal(q.price, 4);
  assert.strictEqual(q.changePercent, null);
});

test('percent band boundaries are inclusive (+500 and -95 are kept)', () => {
  const hi = normalizeQuote({ day: { c: 60 }, prevDay: { c: 10 } }); // exactly +500%
  assert.equal(hi.changePercent, 500);
  const lo = normalizeQuote({ day: { c: 5 }, prevDay: { c: 100 } }); // exactly -95%
  assert.equal(lo.changePercent, -95);
});

test('rounds price, change, and percent to two decimals', () => {
  const q = normalizeQuote({ day: { c: 3.333333 }, prevDay: { c: 3 } });
  assert.equal(q.price, 3.33);
  assert.equal(q.change, 0.33);
  assert.equal(q.changePercent, 11.11); // (0.333333/3)*100
});

test('price-independent fields default to null when the day bucket is absent', () => {
  const q = normalizeQuote({ lastTrade: { p: 20 }, prevDay: { c: 20 } });
  assert.equal(q.price, 20);
  assert.strictEqual(q.volume, null);
  assert.strictEqual(q.dayHigh, null);
  assert.strictEqual(q.dayLow, null);
  assert.strictEqual(q.dayOpen, null);
});

test('no usable price anywhere returns null (not a zero-priced ghost)', () => {
  assert.strictEqual(normalizeQuote({ day: { c: 0 }, prevDay: { c: 0 } }), null);
  assert.strictEqual(normalizeQuote({ day: { c: -5 } }), null);       // negative rejected
  assert.strictEqual(normalizeQuote({ day: { c: NaN } }), null);      // NaN rejected
  assert.strictEqual(normalizeQuote({ day: { c: Infinity } }), null); // Infinity rejected by the finite guard
  assert.strictEqual(normalizeQuote({ day: {} }), null);
});

test('junk and non-object inputs degrade to null instead of throwing', () => {
  assert.strictEqual(normalizeQuote(null), null);
  assert.strictEqual(normalizeQuote(undefined), null);
  assert.strictEqual(normalizeQuote('AAPL'), null);
  assert.strictEqual(normalizeQuote(42), null);
  assert.strictEqual(normalizeQuote({}), null);
});

test('string-typed price fields are not accepted as numbers', () => {
  // Polygon sometimes returns nothing; a stray string must not slip through as
  // a price. validPrice requires typeof number.
  const q = normalizeQuote({ day: { c: '10' }, prevDay: { c: '8' } });
  assert.strictEqual(q, null);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
