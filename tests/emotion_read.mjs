// Pins the emotional-state classifier (src/lib/emotionRead.js): FOMO, revenge,
// panic, or calm, from the decision and the context captured at the moment.
import assert from 'node:assert/strict';
import { classifyEmotion, emotionWarning } from '../src/lib/emotionRead.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }

test('chasing a name up big in a hot tape reads as FOMO', () => {
  const r = classifyEmotion({ type: 'open', ticker: 'NVDA', todayChangePct: 12 }, { regime: 'Risk On', fearGreed: 80 });
  assert.equal(r.kind, 'fomo');
  assert.match(r.why, /NVDA already up 12/);
});

test('a buy right after a realized loss reads as revenge', () => {
  const r = classifyEmotion({ type: 'open', ticker: 'AMC', todayChangePct: 1 }, { regime: 'Neutral', hadRecentLoss: true });
  assert.equal(r.kind, 'revenge');
});

test('selling into a risk-off tape or a hard down day reads as panic', () => {
  assert.equal(classifyEmotion({ type: 'close', ticker: 'BE', todayChangePct: -2 }, { regime: 'Risk Off' }).kind, 'panic');
  assert.equal(classifyEmotion({ type: 'trim', ticker: 'BE', todayChangePct: -7 }, { regime: 'Neutral' }).kind, 'panic');
  assert.equal(classifyEmotion({ type: 'close', ticker: 'BE' }, { fearGreed: 18 }).kind, 'panic');
});

test('a calm buy or sell is not flagged', () => {
  assert.equal(classifyEmotion({ type: 'open', ticker: 'COST', todayChangePct: 1 }, { regime: 'Neutral', fearGreed: 50 }).kind, 'calm');
  assert.equal(classifyEmotion({ type: 'close', ticker: 'COST', todayChangePct: 1 }, { regime: 'Risk On', fearGreed: 55 }).kind, 'calm');
});

test('FOMO needs both the run AND the hot tape, not just one', () => {
  // up 12% but a calm/neutral tape and middling fear-greed is not FOMO by this rule
  assert.equal(classifyEmotion({ type: 'open', ticker: 'X', todayChangePct: 12 }, { regime: 'Neutral', fearGreed: 50 }).kind, 'calm');
});

test('emotionWarning is empty when calm, a gentle nudge otherwise', () => {
  assert.equal(emotionWarning({ kind: 'calm' }), '');
  assert.match(emotionWarning(classifyEmotion({ type: 'open', ticker: 'NVDA', todayChangePct: 12 }, { regime: 'Risk On' })), /FOMO buy/);
  assert.match(emotionWarning({ kind: 'panic', why: 'x' }), /panic sell/);
});

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.f(); console.log(`ok    ${t.n}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
