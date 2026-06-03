// Unit tests for the TODAY mover-compositing logic.
//
// Before this fix, a volatile day where 5+ holdings each moved >=5% would
// fill every TODAY slot with the same "Big move on one of your holdings"
// boilerplate, crowding out catalysts, sector heat, and other signals. Now
// the buildTodayFeed pipeline runs items through compositeMovers, which
// collapses 3+ mover rows into a single mover_group card.
import assert from 'node:assert/strict';
import { compositeMovers, frameSectorHeat, cacheFreshness } from '../api/services/today.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ── cacheFreshness: hybrid freshness gate (intraday hidden if not today; daily
//    valid into next morning, labeled). Mid-day UTC times avoid ET-midnight edge.
const JUN3_4PM = new Date('2026-06-03T20:00:00Z'); // ~16:00 ET Jun 3 (EDT)
test('intraday signal shows only on the same ET day', () => {
  assert.equal(cacheFreshness('intraday', '2026-06-03T14:00:00Z', JUN3_4PM).show, true);  // earlier today
  assert.equal(cacheFreshness('intraday', '2026-06-02T20:00:00Z', JUN3_4PM).show, false); // yesterday
  assert.equal(cacheFreshness('intraday', '2026-06-03T14:00:00Z', JUN3_4PM).asOf, null);
});

test('daily signal stays valid into the next morning, labeled when not same-day', () => {
  const morning = new Date('2026-06-03T13:00:00Z'); // ~9am ET Jun 3
  const sameDay = cacheFreshness('daily', '2026-06-03T12:00:00Z', morning);
  assert.equal(sameDay.show, true);
  assert.equal(sameDay.asOf, null); // today => no "as of" label
  const lastNight = cacheFreshness('daily', '2026-06-02T21:00:00Z', morning); // prior 5pm scan, ~16h old
  assert.equal(lastNight.show, true);
  assert.match(lastNight.asOf, /last night/);
});

test('daily signal older than the max age is dropped', () => {
  const now = new Date('2026-06-03T13:00:00Z');
  assert.equal(cacheFreshness('daily', '2026-06-01T21:00:00Z', now).show, false); // ~40h old
});

test('cacheFreshness is safe on missing/invalid timestamps', () => {
  assert.equal(cacheFreshness('intraday', null, JUN3_4PM).show, false);
  assert.equal(cacheFreshness('daily', 'not-a-date', JUN3_4PM).show, false);
  assert.equal(cacheFreshness('intraday', undefined, JUN3_4PM).show, false);
});

// ── frameSectorHeat: the HEAT item must not cheerlead during a selloff ──────
test('frameSectorHeat cheers a heating sector in calm regimes', () => {
  const h = frameSectorHeat({ name: 'Technology', signal: 'strong' }, 'Risk On');
  assert.match(h.title, /heating up/);
  assert.equal(h.priorityBonus, 5); // strong-signal bump applies when calm
});

test('frameSectorHeat reframes (does not cheer) when the market is Risk Off', () => {
  const h = frameSectorHeat({ name: 'Utilities', signal: 'strong' }, 'Risk Off');
  assert.doesNotMatch(h.title, /heating up/);
  assert.match(h.title, /holding up|jittery/i);
  assert.match(h.detail, /defensive leadership|green light/i);
  assert.equal(h.priorityBonus, 0); // no priority bump on a risk-off day
});

test('frameSectorHeat returns null when there is no heating sector', () => {
  assert.strictEqual(frameSectorHeat(null, 'Neutral'), null);
  assert.strictEqual(frameSectorHeat(undefined, 'Risk Off'), null);
});

test('frameSectorHeat prefers the source thesis for detail when present', () => {
  const h = frameSectorHeat({ name: 'Energy', thesis: 'Oil breaking out.' }, 'Neutral');
  assert.equal(h.detail, 'Oil breaking out.');
});

test('frameSectorHeat names the ETF scope so Energy is not mistaken for clean-energy', () => {
  const h = frameSectorHeat({ name: 'Energy', ticker: 'XLE', signal: 'strong' }, 'Risk Off');
  assert.match(h.title, /XLE: oil & gas majors/);
  const t = frameSectorHeat({ name: 'Technology', ticker: 'XLK' }, 'Risk On');
  assert.match(t.title, /XLK: big tech/);
  assert.match(t.title, /heating up/);
});

test('frameSectorHeat falls back to just the name when the ETF scope is unknown', () => {
  const h = frameSectorHeat({ name: 'Frontier', ticker: 'ZZZ' }, 'Neutral');
  assert.match(h.title, /^Frontier heating up/);
  assert.doesNotMatch(h.title, /\(/); // no scope parens
});

// Helper. Build a minimal mover item for tests.
const m = (ticker, pct, priority = 70) => ({
  type: 'mover',
  subtype: 'portfolio_mover',
  ticker,
  title: `${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct).toFixed(1)}% today`,
  detail: 'Big move on one of your holdings.',
  priority,
  link: { tab: 'portfolio', ticker },
  pct,
  direction: pct >= 0 ? 'up' : 'down',
});

// Helper. Non-mover item.
const other = (type, ticker, priority) => ({
  type,
  ticker,
  title: `${type} for ${ticker}`,
  detail: 'whatever',
  priority,
  link: { tab: 'home' },
});

// ─── Below threshold ────────────────────────────────────────────────────

test('zero movers: returns input unchanged', () => {
  const input = [other('catalyst', 'AAPL', 65), other('heat', 'XLE', 55)];
  const out = compositeMovers(input, 3);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, 'catalyst');
});

test('one mover: not composited', () => {
  const input = [m('FCEL', -11.1), other('catalyst', 'AAPL', 65)];
  const out = compositeMovers(input, 3);
  assert.equal(out.length, 2);
  assert.ok(out.some(i => i.type === 'mover' && i.ticker === 'FCEL'));
  assert.ok(!out.some(i => i.type === 'mover_group'));
});

test('two movers: not composited (below threshold)', () => {
  const input = [m('FCEL', -11.1), m('DELL', 28.6)];
  const out = compositeMovers(input, 3);
  assert.equal(out.length, 2);
  assert.ok(!out.some(i => i.type === 'mover_group'));
});

// ─── At and above threshold ─────────────────────────────────────────────

test('three movers: composited into one mover_group', () => {
  const input = [m('FCEL', -11.1), m('DELL', 28.6), m('POET', -7.0)];
  const out = compositeMovers(input, 3);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'mover_group');
  assert.equal(out[0].movers.length, 3);
  assert.match(out[0].title, /3 positions moved 5%\+/);
});

test('five movers (the actual bug from the screenshot): one composite', () => {
  // Reproduces the exact case the user reported: FCEL, DELL, POET, BE, EOSE
  const input = [
    m('FCEL', -11.1),
    m('DELL', 28.6),
    m('POET', -7.0),
    m('BE',   -5.0),
    m('EOSE', -5.5),
  ];
  const out = compositeMovers(input, 3);
  assert.equal(out.length, 1, 'all 5 movers collapse to 1 card');
  assert.equal(out[0].type, 'mover_group');
  assert.equal(out[0].movers.length, 5);
  assert.match(out[0].title, /5 positions moved 5%\+/);
});

test('composite sorts movers by absolute % desc (biggest first)', () => {
  const input = [m('SMALL', 5.1), m('BIG', -28.6), m('MID', 11.1)];
  const out = compositeMovers(input, 3);
  assert.equal(out[0].movers[0].ticker, 'BIG');   // |-28.6| = 28.6
  assert.equal(out[0].movers[1].ticker, 'MID');   // |11.1|  = 11.1
  assert.equal(out[0].movers[2].ticker, 'SMALL'); // |5.1|   = 5.1
});

test('composite preserves direction and pct fields per mover', () => {
  const input = [m('FCEL', -11.1), m('DELL', 28.6), m('POET', -7.0)];
  const out = compositeMovers(input, 3);
  const dell = out[0].movers.find(x => x.ticker === 'DELL');
  assert.equal(dell.direction, 'up');
  assert.equal(dell.pct, 28.6);
  const fcel = out[0].movers.find(x => x.ticker === 'FCEL');
  assert.equal(fcel.direction, 'down');
  assert.equal(fcel.pct, -11.1);
});

// ─── Mixed input ────────────────────────────────────────────────────────

test('composite + non-movers: non-movers preserved alongside composite', () => {
  const input = [
    m('FCEL', -11.1),
    m('DELL', 28.6),
    m('POET', -7.0),
    other('catalyst', 'NVDA', 65),
    other('heat', 'XLE', 55),
  ];
  const out = compositeMovers(input, 3);
  assert.equal(out.length, 3, 'one composite + 2 non-movers');
  const types = out.map(i => i.type).sort();
  assert.deepEqual(types, ['catalyst', 'heat', 'mover_group']);
});

test('composite priority = max priority of the movers in the group', () => {
  const input = [
    m('FCEL', -11.1, 70),
    m('DELL', 28.6, 75),  // bigger move, higher priority
    m('POET', -7.0, 70),
  ];
  const out = compositeMovers(input, 3);
  const composite = out.find(i => i.type === 'mover_group');
  assert.equal(composite.priority, 75);
});

// ─── Custom threshold ──────────────────────────────────────────────────

test('custom threshold of 4: 3 movers stay individual', () => {
  const input = [m('A', 5.5), m('B', 6.5), m('C', 7.5)];
  const out = compositeMovers(input, 4);
  assert.equal(out.length, 3);
  assert.ok(!out.some(i => i.type === 'mover_group'));
});

test('custom threshold of 2: 2 movers DO composite', () => {
  const input = [m('A', 5.5), m('B', 6.5)];
  const out = compositeMovers(input, 2);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'mover_group');
});

// ─── Defensive ─────────────────────────────────────────────────────────

test('empty input: returns empty array', () => {
  assert.deepEqual(compositeMovers([], 3), []);
});

test('does not mutate input', () => {
  const input = [m('A', 5.1), m('B', 6.1), m('C', 7.1)];
  const before = input.length;
  compositeMovers(input, 3);
  assert.equal(input.length, before);
  // First item still a mover (not converted in-place)
  assert.equal(input[0].type, 'mover');
});

test('items with null type are passed through harmlessly', () => {
  const input = [{ type: null }, m('A', 5.1), m('B', 6.1), m('C', 7.1)];
  const out = compositeMovers(input, 3);
  assert.ok(out.some(i => i.type === null));
  assert.ok(out.some(i => i.type === 'mover_group'));
});

// ─── Run ───────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
