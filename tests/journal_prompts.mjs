// Pins the Journal REFLECT prompts (src/lib/journalPrompts.js): which moments
// become a prompt, the priority + per-ticker dedup, the handled filter, and that
// each prompt carries a pre-seeded entry so the user never faces a blank page.
import assert from 'node:assert/strict';
import { buildReflectionPrompts } from '../src/lib/journalPrompts.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
const NOW = Date.parse('2026-06-02T00:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

test('a recent unreflected close becomes a prompt with a seeded entry', () => {
  const p = buildReflectionPrompts({
    closes: [{ id: 't1', ticker: 'VRT', pnl: 340, hold_days: 12, closed_at: daysAgo(3) }],
    now: NOW,
  });
  assert.equal(p.length, 1);
  assert.equal(p[0].kind, 'close');
  assert.match(p[0].title, /Reflect on your VRT exit \(\+\$340\)/);
  assert.match(p[0].seedBody, /You closed VRT for a gain of \$340, held 12 days/);
  assert.match(p[0].seedBody, /Why you bought it/);
});

test('a close that was already reflected on does not prompt', () => {
  const p = buildReflectionPrompts({
    closes: [{ id: 't1', ticker: 'VRT', pnl: 340, closed_at: daysAgo(3), reflection_lesson: 'let winners run' }],
    now: NOW,
  });
  assert.equal(p.length, 0);
});

test('an old close (past the window) does not prompt', () => {
  const p = buildReflectionPrompts({
    closes: [{ id: 't1', ticker: 'VRT', pnl: 340, closed_at: daysAgo(60) }],
    now: NOW,
  });
  assert.equal(p.length, 0);
});

test('a loss is framed honestly', () => {
  const p = buildReflectionPrompts({
    closes: [{ id: 't1', ticker: 'PTON', pnl: -210, closed_at: daysAgo(2) }],
    now: NOW,
  });
  assert.match(p[0].title, /\(-\$210\)/);
  assert.match(p[0].seedBody, /a loss of \$210/);
});

test('a breaking thesis outranks a weakening one; intact does not prompt', () => {
  const p = buildReflectionPrompts({
    theses: [
      { ticker: 'DELL', verdict: 'broken', headline: 'Margins fell again' },
      { ticker: 'BE', verdict: 'weakening', headline: 'A contract slipped' },
      { ticker: 'COST', verdict: 'intact', headline: 'Steady' },
      { ticker: 'NVDA', verdict: 'strengthening', headline: 'New deal' },
    ],
    now: NOW,
  });
  assert.deepEqual(p.map(x => x.ticker), ['DELL', 'BE']);
  assert.match(p[0].title, /DELL thesis is breaking/);
  assert.match(p[0].seedBody, /Margins fell again/);
});

test('one prompt per ticker: the close outranks the thesis flag for the same name', () => {
  const p = buildReflectionPrompts({
    closes: [{ id: 't1', ticker: 'DELL', pnl: 500, closed_at: daysAgo(1) }],
    theses: [{ ticker: 'DELL', verdict: 'broken', headline: 'x' }],
    now: NOW,
  });
  const dell = p.filter(x => x.ticker === 'DELL');
  assert.equal(dell.length, 1);
  assert.equal(dell[0].kind, 'close'); // severity 90 > 85
});

test('handled prompts are filtered out', () => {
  const closes = [{ id: 't1', ticker: 'VRT', pnl: 100, closed_at: daysAgo(1) }];
  assert.equal(buildReflectionPrompts({ closes, now: NOW }).length, 1);
  assert.equal(buildReflectionPrompts({ closes, handled: ['close:t1'], now: NOW }).length, 0);
});

test('caps at four prompts, highest priority first', () => {
  const closes = [];
  for (let i = 0; i < 6; i++) closes.push({ id: `t${i}`, ticker: `T${i}`, pnl: 100, closed_at: daysAgo(i + 1) });
  const p = buildReflectionPrompts({ closes, now: NOW });
  assert.equal(p.length, 4);
  assert.ok(p.every((x, i) => i === 0 || p[i - 1].severity >= x.severity));
});

test('junk input never throws', () => {
  assert.deepEqual(buildReflectionPrompts(), []);
  assert.deepEqual(buildReflectionPrompts({ closes: null, theses: null, handled: null }), []);
  assert.deepEqual(buildReflectionPrompts({ closes: [{}], theses: [{}] }), []);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
