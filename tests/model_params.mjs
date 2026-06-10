// Pins acceptsTemperature: the gate that lets a model swap behind config never 400.
// Newer frontier models (Opus 4.7/4.8, Fable 5) removed the sampling params and reject
// `temperature` with a 400; older ones still accept it. If this drifts, flipping
// AGENT_MODEL to Opus 4.8 would crash the agent on every Tier-3 turn.
import { acceptsTemperature } from '../api/utils/modelParams.js';

let bad = 0;
const ok = (m) => console.log(`ok   ${m}`);
const fail = (m) => { console.log(`FAIL ${m}`); bad++; };

// Models that REMOVED sampling params -> must omit temperature.
for (const m of ['claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-9', 'claude-fable-5']) {
  acceptsTemperature(m) ? fail(`${m} must NOT accept temperature`) : ok(`${m} -> omits temperature`);
}
// Models that still accept it (current + older) -> must keep sending it.
for (const m of ['claude-sonnet-4-20250514', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6', 'claude-opus-4-5']) {
  acceptsTemperature(m) ? ok(`${m} -> sends temperature`) : fail(`${m} should accept temperature`);
}
// Garbage in -> default to accepts (preserves current behavior; never throws).
acceptsTemperature(null); acceptsTemperature(undefined); acceptsTemperature('');
ok('nullish input handled without throwing');

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
