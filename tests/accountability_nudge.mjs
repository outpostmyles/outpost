// Unit tests for the agent's proactive accountability nudge
// (api/services/accountabilityNudge.js). Pins the precision rule (only fire for
// tickers the user holds or has a live alert on), the alert parsing, and the
// directive content, so the agent reliably closes the loop without nagging on
// every stray ticker.
import assert from 'node:assert/strict';
import { buildAccountabilityNudge, parseAlertTickers } from '../api/services/accountabilityNudge.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

const ALERTS = [
  'NVDA has PASSED its price target ($920) - now trading at $935.00',
  'AMD has BROKEN BELOW its stop loss ($145) - now at $142.30',
].join('\n');

test('parseAlertTickers maps the leading ticker of each line', () => {
  const m = parseAlertTickers(ALERTS);
  assert.ok(m.NVDA.includes('price target'));
  assert.ok(m.AMD.includes('stop loss'));
  assert.deepEqual(Object.keys(m).sort(), ['AMD', 'NVDA']);
});

test('parseAlertTickers tolerates empty / non-string input', () => {
  assert.deepEqual(parseAlertTickers(''), {});
  assert.deepEqual(parseAlertTickers(null), {});
  assert.deepEqual(parseAlertTickers(undefined), {});
});

test('no tickers in the message produces no nudge', () => {
  assert.equal(buildAccountabilityNudge({ content: 'how is the market today?', heldTickers: ['NVDA'] }), '');
});

test('a ticker the user does NOT hold and has no alert is ignored (precision)', () => {
  // TSLA is mentioned but not held and not alerted -> stay quiet.
  assert.equal(buildAccountabilityNudge({ content: 'what do you think of TSLA?', heldTickers: ['NVDA'], activeAlerts: ALERTS }), '');
});

test('mentions a held ticker -> nudge to recall their words', () => {
  const out = buildAccountabilityNudge({ content: 'should I add more AAPL?', heldTickers: ['AAPL'] });
  assert.ok(out.includes('AAPL'));
  assert.ok(out.includes('currently hold'));
  assert.ok(out.includes('recall_history'));
});

test('mentions an alerted ticker the user does not currently hold', () => {
  const out = buildAccountabilityNudge({ content: 'is NVDA still a buy?', heldTickers: [], activeAlerts: ALERTS });
  assert.ok(out.includes('NVDA'));
  assert.ok(out.includes('history with'));
  assert.ok(out.includes('Live alert'));
  assert.ok(out.includes('price target'));
});

test('held AND alerted shows both signals', () => {
  const out = buildAccountabilityNudge({ content: 'thinking about selling AMD', heldTickers: ['AMD'], activeAlerts: ALERTS });
  assert.ok(out.includes('currently hold'));
  assert.ok(out.includes('Live alert'));
  assert.ok(out.includes('stop loss'));
});

test('held tickers match case-insensitively', () => {
  const out = buildAccountabilityNudge({ content: 'update me on NVDA', heldTickers: ['nvda'] });
  assert.ok(out.includes('NVDA'));
  assert.ok(out.includes('currently hold'));
});

test('caps at three relevant tickers', () => {
  const out = buildAccountabilityNudge({
    content: 'thoughts on NVDA AMD AAPL MSFT GOOG?',
    heldTickers: ['NVDA', 'AMD', 'AAPL', 'MSFT', 'GOOG'],
  });
  const bulletCount = out.split('\n').filter(l => l.startsWith('- ')).length;
  assert.equal(bulletCount, 3);
});

test('empty / missing args never throw and return empty', () => {
  assert.equal(buildAccountabilityNudge(), '');
  assert.equal(buildAccountabilityNudge({}), '');
  assert.equal(buildAccountabilityNudge({ content: '' }), '');
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
