// Unit tests for buildGrowthArc (src/lib/growthArc.js).
import assert from 'node:assert/strict';
import { buildGrowthArc } from '../src/lib/growthArc.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// Build N trades in date order; `spec(i)` returns { win, thesis } for trade i.
function makeTrades(n, spec) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const { win, thesis } = spec(i);
    const day = String(i + 1).padStart(2, '0');
    out.push({ closed_at: `2026-${i < 9 ? '01' : '02'}-${i < 9 ? day : String(i - 8).padStart(2, '0')}`, pnl: win ? 100 : -100, entry_thesis: thesis ? 'a reason' : '' });
  }
  return out;
}

test('not enough history yet', () => {
  const r = buildGrowthArc(makeTrades(6, () => ({ win: true, thesis: true })));
  assert.equal(r.hasEnough, false);
  assert.deepEqual(r.lines, []);
});

test('a rising win rate is surfaced as growth', () => {
  // First half mostly losses, second half mostly wins.
  const r = buildGrowthArc(makeTrades(12, i => ({ win: i >= 6, thesis: false })));
  const wr = r.lines.find(l => l.metric === 'win_rate');
  assert.ok(wr && wr.improved);
  assert.ok(wr.now > wr.then);
});

test('growing thesis discipline is surfaced', () => {
  // Early: no theses. Recent: all theses.
  const r = buildGrowthArc(makeTrades(12, i => ({ win: true, thesis: i >= 6 })));
  const th = r.lines.find(l => l.metric === 'thesis');
  assert.ok(th && th.improved);
  assert.match(th.text, /habit/);
});

test('a steady record produces no growth lines (nothing to claim)', () => {
  const r = buildGrowthArc(makeTrades(12, () => ({ win: true, thesis: true })));
  assert.equal(r.hasEnough, true);
  assert.deepEqual(r.lines, []);
});

test('a real slip in win rate is flagged honestly', () => {
  // Early all wins, recent all losses.
  const r = buildGrowthArc(makeTrades(12, i => ({ win: i < 6, thesis: true })));
  const wr = r.lines.find(l => l.metric === 'win_rate');
  assert.ok(wr && wr.improved === false);
});

test('handles missing input', () => {
  assert.equal(buildGrowthArc(null).hasEnough, false);
  assert.equal(buildGrowthArc(undefined).hasEnough, false);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
