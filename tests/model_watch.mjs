// Pins the model-watch analysis: which models you use are gone / deprecated / new.
// If this drifts, the tripwire goes quiet on a model that's actually retiring, and you
// find out the way we found the deprecated Sonnet-4 agent: by accident.
import { analyzeModels, hasAlerts } from '../api/services/modelWatch.js';

let bad = 0;
const ok = (m) => console.log(`ok   ${m}`);
const fail = (m) => { console.log(`FAIL ${m}`); bad++; };
const eq = (a, b, m) => { (a === b) ? ok(m) : fail(`${m}: expected ${b}, got ${a}`); };

const live = ['claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-20250514'];
const known = new Set(['claude-opus-4-8', 'claude-haiku-4-5-20251001', 'claude-sonnet-4-20250514']);
const deprecated = { 'claude-sonnet-4-20250514': '2026-06-15' };

// A used model that is deprecated (still live) is flagged with its retire date.
{
  const f = analyzeModels({ liveIds: live, used: { agent: 'claude-opus-4-8', reads: 'claude-sonnet-4-20250514', cheap: 'claude-haiku-4-5-20251001' }, known, deprecated });
  eq(f.deprecated.length, 1, 'one deprecated hit');
  eq(f.deprecated[0].tier, 'reads', 'flags the right tier');
  eq(f.deprecated[0].retires, '2026-06-15', 'carries the retire date');
  eq(f.gone.length, 0, 'nothing gone');
  eq(f.newModels.length, 0, 'nothing new');
  ok('deprecated case clean');
}

// A used model that's GONE from the live list is flagged as broken-now.
{
  const f = analyzeModels({ liveIds: ['claude-opus-4-8'], used: { agent: 'claude-opus-4-8', reads: 'claude-retired-model' }, known, deprecated });
  eq(f.gone.length, 1, 'one gone');
  eq(f.gone[0].id, 'claude-retired-model', 'names the gone model');
}

// A live model we don't recognize is flagged as NEW.
{
  const f = analyzeModels({ liveIds: [...live, 'claude-fable-6'], used: { agent: 'claude-opus-4-8' }, known, deprecated });
  eq(f.newModels.length, 1, 'one new');
  eq(f.newModels[0], 'claude-fable-6', 'names the new model');
}

// All current: nothing to report.
{
  const f = analyzeModels({ liveIds: live, used: { agent: 'claude-opus-4-8', cheap: 'claude-haiku-4-5-20251001' }, known, deprecated });
  eq(hasAlerts(f), false, 'no alerts when everything is current');
}

// Robust against empty/missing inputs (never throws).
{
  const f = analyzeModels({ liveIds: [], used: {} });
  eq(hasAlerts(f), false, 'empty inputs -> no alerts, no throw');
}

console.log(bad ? `\n${bad} failed` : '\nall passed');
process.exit(bad ? 1 : 0);
