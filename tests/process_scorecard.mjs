// Pins the Progress process scorecard (src/lib/processScorecard.js): the friendly
// empty state, the grade and letter, the worst-habit focus, and an always-present
// strength.
import assert from 'node:assert/strict';
import { buildProcessScorecard } from '../src/lib/processScorecard.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('no graded history yields a friendly, non-scary empty state', () => {
  const c = buildProcessScorecard({ quality: { index: null }, summary: {}, patterns: [] });
  assert.equal(c.hasData, false);
  assert.match(c.title, /process score is coming/i);
  assert.match(c.body, /HOW you traded/);
  assert.ok(!('score' in c)); // no zero grade that reads as failing
});

test('grades on the index with the right letter band', () => {
  const c = buildProcessScorecard({ quality: { index: 58, trend: 'flat', sample: 12 }, summary: { winRate: 45, thesisCoverage: 70 }, patterns: [] });
  assert.equal(c.hasData, true);
  assert.equal(c.score, 58);
  assert.equal(c.letter, 'C'); // 55..69
  assert.equal(c.trend, 'flat');
});

test('a thin record is provisional (no hard letter for three trades); a real one is not', () => {
  const thin = buildProcessScorecard({ quality: { index: 30, sample: 4 }, summary: { total: 4 }, patterns: [] });
  assert.equal(thin.provisional, true);
  assert.equal(thin.score, 30); // the number is still there, just presented gently
  const real = buildProcessScorecard({ quality: { index: 30, sample: 28 }, summary: { total: 28 }, patterns: [] });
  assert.equal(real.provisional, false);
});

test('focus is the worst habit by severity', () => {
  const patterns = [
    { key: 'no_thesis', severity: 70, label: 'Buying without a reason', stat: '60% no thesis', detail: '...' },
    { key: 'hold_losers', severity: 85, label: 'Holding losers, cutting winners', stat: 'losers ~16d vs winners ~7d', detail: '...' },
  ];
  const c = buildProcessScorecard({ quality: { index: 40 }, summary: {}, patterns });
  assert.equal(c.focus.label, 'Holding losers, cutting winners'); // severity 85 beats 70
  assert.match(c.focus.stat, /16d/);
});

test('with no patterns, focus is a calm "nothing major"', () => {
  const c = buildProcessScorecard({ quality: { index: 80 }, summary: { thesisCoverage: 90 }, patterns: [] });
  assert.match(c.focus.label, /Nothing major/);
});

test('strength reflects the best real habit, thesis coverage first', () => {
  const c = buildProcessScorecard({ quality: { index: 70 }, summary: { thesisCoverage: 80 }, patterns: [] });
  assert.match(c.strength, /80% of your buys/);
});

test('strength always returns something, even for a thin record', () => {
  const c = buildProcessScorecard({ quality: { index: 50 }, summary: { total: 2 }, patterns: [] });
  assert.ok(typeof c.strength === 'string' && c.strength.length > 0);
});

test('a not-chasing trader gets credited when chasing is absent from patterns', () => {
  const patterns = [{ key: 'no_thesis', severity: 70, label: 'x', stat: 'y', detail: 'z' }];
  const c = buildProcessScorecard({ quality: { index: 50 }, summary: { thesisCoverage: 20 }, patterns });
  assert.match(c.strength, /not chasing green days/);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
