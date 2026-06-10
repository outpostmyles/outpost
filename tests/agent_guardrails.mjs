// Pins the agent's highest-stakes detection: the structural layer that forces a
// crisis offramp or a hold-the-line directive when the system prompt might cave
// under pressure. Over-triggering is annoying; UNDER-triggering on a real crisis
// or a panic-liquidation is the failure that matters, so the bias is toward catching.
import { classifyHighStakes, GUARDRAIL_DIRECTIVES } from '../src/lib/agentGuardrails.js';

const tests = [];
function test(n, f) { tests.push({ n, f }); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'eq'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c, msg) { if (!c) throw new Error(msg || 'expected truthy'); }

test('self-harm signals classify as crisis', () => {
  for (const m of [
    'i want to kill myself',
    "honestly i don't want to be here anymore",
    'i feel better off dead after this loss',
    'thinking about ending it all',
    "there's no reason to live",
  ]) eq(classifyHighStakes(m), 'crisis', m);
});

test('life-altering money moves classify as high_stakes', () => {
  for (const m of [
    'i sold everything today',
    'should i go all in on NVDA',
    "i'm thinking of putting my life savings into this",
    'i might just liquidate my entire portfolio',
    'this is money i need for rent but the setup looks good',
    "i want to bet everything on one trade",
    'should i take out a loan to buy more',
  ]) eq(classifyHighStakes(m), 'high_stakes', m);
});

test('crisis takes precedence when a message has both', () => {
  eq(classifyHighStakes('i sold everything and i want to die'), 'crisis', 'crisis wins');
});

test('normal trading talk does not trigger', () => {
  for (const m of [
    'what do you think about AAPL today',
    'should i trim my NVDA a little',
    'hey, how are the markets',
    'i bought 5 shares of COST',
    'is the sector rotating',
    'thanks for the help',
  ]) eq(classifyHighStakes(m), null, m);
});

test('garbage input never throws and returns null', () => {
  for (const bad of [null, undefined, 42, '', {}, []]) eq(classifyHighStakes(bad), null, String(bad));
});

test('the directives carry the load-bearing instructions', () => {
  ok(/988/.test(GUARDRAIL_DIRECTIVES.crisis), 'crisis directive names 988');
  ok(/wellbeing|not alone/i.test(GUARDRAIL_DIRECTIVES.crisis), 'crisis directive is supportive');
  ok(/never (grade|invent)|hard to undo|re-entry/i.test(GUARDRAIL_DIRECTIVES.high_stakes), 'high-stakes directive holds the line');
});

let pass = 0, fail = 0;
for (const { n, f } of tests) {
  try { f(); console.log(`ok   ${n}`); pass++; }
  catch (e) { console.log(`FAIL ${n}: ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
