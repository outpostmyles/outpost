// Pins the pure core of the living thesis watch (api/services/thesisWatch.js):
// the cache signatures that decide when to re-judge, the staleness window, the
// fail-closed JSON parser, and the prompt assembly. The Claude call itself is not
// exercised here (that is a live concern); everything that decides WHETHER and
// WITH WHAT to call it is.
import assert from 'node:assert/strict';
import {
  hashStr, thesisSignature, newsSignature, isStale, verdictSeverity,
  parseVerdict, buildThesisPrompt, priceLine, VERDICTS,
} from '../api/services/thesisWatch.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('hashStr is deterministic and varies with input', () => {
  assert.equal(hashStr('abc'), hashStr('abc'));
  assert.notEqual(hashStr('abc'), hashStr('abd'));
  assert.equal(typeof hashStr('abc'), 'string');
  assert.equal(hashStr(null), hashStr('')); // null-safe
});

test('thesisSignature changes when the thesis or reversal is edited', () => {
  const a = thesisSignature('AI demand keeps it bid', 'demand stalls');
  assert.equal(a, thesisSignature('AI demand keeps it bid', 'demand stalls'));
  assert.equal(a, thesisSignature('  ai   DEMAND keeps it  bid ', 'demand stalls')); // whitespace/case insensitive
  assert.notEqual(a, thesisSignature('AI demand keeps it bid', 'margins compress')); // reversal changed
  assert.notEqual(a, thesisSignature('totally different reason', 'demand stalls'));   // thesis changed
});

test('newsSignature is stable to reorder/dupes but moves on genuinely new news', () => {
  const base = [{ title: 'Nvidia signs deal' }, { title: 'Margins compress' }];
  const reordered = [{ title: 'Margins compress' }, { title: 'Nvidia signs deal' }];
  assert.equal(newsSignature(base), newsSignature(reordered));
  assert.notEqual(newsSignature(base), newsSignature([...base, { title: 'New catalyst lands' }]));
  assert.equal(newsSignature([]), newsSignature(null)); // null-safe, stable empty
});

test('isStale forces a refresh past the window and on a bad date', () => {
  const now = Date.parse('2026-06-02T00:00:00Z');
  assert.equal(isStale(new Date(now - 1 * 86400000).toISOString(), now), false); // 1 day old: fresh
  assert.equal(isStale(new Date(now - 5 * 86400000).toISOString(), now), true);  // 5 days old: stale
  assert.equal(isStale('not a date', now), true);
  assert.equal(isStale(undefined, now), true);
});

test('verdictSeverity ranks broken highest, strengthening lowest', () => {
  assert.ok(verdictSeverity('broken') > verdictSeverity('weakening'));
  assert.ok(verdictSeverity('weakening') > verdictSeverity('intact'));
  assert.ok(verdictSeverity('intact') > verdictSeverity('strengthening'));
  assert.equal(verdictSeverity('nonsense'), -1);
  for (const v of VERDICTS) assert.ok(verdictSeverity(v) >= 0);
});

test('parseVerdict accepts a valid judgment, even wrapped in prose', () => {
  const o = parseVerdict('Here is my read: {"verdict":"weakening","headline":"Margins slipping","evidence":"Q3 gross margin fell 300bps"} done');
  assert.equal(o.verdict, 'weakening');
  assert.equal(o.headline, 'Margins slipping');
  assert.match(o.evidence, /300bps/);
});

test('parseVerdict fails closed on garbage or an out-of-enum verdict', () => {
  assert.equal(parseVerdict('no json here'), null);
  assert.equal(parseVerdict('{"verdict":"doomed","headline":"x"}'), null); // not in enum
  assert.equal(parseVerdict('{"verdict":"broken"}'), null);                // no headline
  assert.equal(parseVerdict(''), null);
  assert.equal(parseVerdict(null), null);
});

test('parseVerdict caps runaway lengths', () => {
  const o = parseVerdict(JSON.stringify({ verdict: 'intact', headline: 'h'.repeat(500), evidence: 'e'.repeat(500) }));
  assert.ok(o.headline.length <= 160);
  assert.ok(o.evidence.length <= 240);
});

test('buildThesisPrompt carries the thesis and the reversal condition', () => {
  const p = buildThesisPrompt({
    ticker: 'DELL', name: 'Dell', thesis: 'Server margins expand', reversal: 'Margins compress two quarters',
    priceLine: 'up 76% from cost', articles: [{ title: 'Dell margins fall', source: 'Reuters' }],
  });
  assert.match(p, /DELL/);
  assert.match(p, /Server margins expand/);
  assert.match(p, /Margins compress two quarters/);
  assert.match(p, /Dell margins fall/);
  assert.match(p, /Return ONLY JSON/);
});

test('buildThesisPrompt is null-safe and notes when there is no news', () => {
  const p = buildThesisPrompt({ ticker: 'X', thesis: 'good co' }); // no name/reversal/fundamentals/news
  assert.match(p, /good co/);
  assert.match(p, /none in the last while/i);
  assert.doesNotThrow(() => buildThesisPrompt({}));
});

test('priceLine summarizes cost and momentum, empty when nothing to say', () => {
  assert.match(priceLine({ currentPrice: 176, avgCost: 100, momentum1m: 12 }), /up 76% from cost/);
  assert.match(priceLine({ currentPrice: 176, avgCost: 100, momentum1m: 12 }), /\+12% past month/);
  assert.match(priceLine({ currentPrice: 80, avgCost: 100 }), /down 20% from cost/);
  assert.equal(priceLine({}), '');
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
