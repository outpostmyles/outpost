// Unit tests for buildBehavioralLead. Pure function that takes counts and
// returns a friend-voice paragraph for the weekly email. Deterministic.
import assert from 'node:assert/strict';
import { buildBehavioralLead } from '../api/services/notifications.js';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// ─── Empty / no activity ────────────────────────────────────────────────

test('returns null when there is no activity', () => {
  const out = buildBehavioralLead({
    addedPositions: 0, addedWithThesis: 0, reflectionsLogged: 0, closesNoReflection: 0,
  }, 0);
  assert.equal(out, null);
});

test('returns null when behavior object is null', () => {
  assert.equal(buildBehavioralLead(null, 0), null);
  assert.equal(buildBehavioralLead(undefined, 0), null);
});

// ─── Adds with full thesis discipline ───────────────────────────────────

test('all positions with thesis: praises discipline', () => {
  const out = buildBehavioralLead({
    addedPositions: 2, addedWithThesis: 2, reflectionsLogged: 0, closesNoReflection: 0,
  }, 0);
  assert.match(out, /added 2 new positions/);
  assert.match(out, /thesis on every one/);
  assert.match(out, /That's the work/);
});

test('one position with thesis: singular phrasing', () => {
  const out = buildBehavioralLead({
    addedPositions: 1, addedWithThesis: 1, reflectionsLogged: 0, closesNoReflection: 0,
  }, 0);
  assert.match(out, /added 1 new position/);
  assert.match(out, /thesis on it/);
  assert.ok(!/every one/.test(out));
});

// ─── Adds with partial thesis ───────────────────────────────────────────

test('mixed adds: calls out the missing theses without being shamey', () => {
  const out = buildBehavioralLead({
    addedPositions: 3, addedWithThesis: 1, reflectionsLogged: 0, closesNoReflection: 0,
  }, 0);
  assert.match(out, /added 3 positions/);
  assert.match(out, /1 got a thesis/);
  assert.match(out, /2 didn't/);
  assert.match(out, /harder to defend/);
});

// ─── Adds with no thesis at all ─────────────────────────────────────────

test('zero theses on adds: surfaces the debt', () => {
  const out = buildBehavioralLead({
    addedPositions: 2, addedWithThesis: 0, reflectionsLogged: 0, closesNoReflection: 0,
  }, 0);
  assert.match(out, /added 2 new positions/);
  assert.match(out, /without writing a thesis/);
  assert.match(out, /any of them/);
  assert.match(out, /Future you/);
});

// ─── Reflections logged ─────────────────────────────────────────────────

test('all closes reflected: rare-and-good framing', () => {
  const out = buildBehavioralLead({
    addedPositions: 0, addedWithThesis: 0, reflectionsLogged: 3, closesNoReflection: 0,
  }, 3);
  assert.match(out, /closed 3 positions/);
  assert.match(out, /reflection on each/);
  assert.match(out, /Most people skip this/);
});

test('partial reflections: open in head not paper', () => {
  const out = buildBehavioralLead({
    addedPositions: 0, addedWithThesis: 0, reflectionsLogged: 2, closesNoReflection: 1,
  }, 3);
  assert.match(out, /reflections on 2 of 3 closes/);
  assert.match(out, /open in your head/);
});

test('zero reflections on closes: surfaces the debt', () => {
  const out = buildBehavioralLead({
    addedPositions: 0, addedWithThesis: 0, reflectionsLogged: 0, closesNoReflection: 2,
  }, 2);
  assert.match(out, /closed 2 positions without logging/);
  assert.match(out, /lesson is the asset/);
});

// ─── Combined paragraphs ────────────────────────────────────────────────

test('combines add and reflection paragraphs', () => {
  const out = buildBehavioralLead({
    addedPositions: 1, addedWithThesis: 1, reflectionsLogged: 2, closesNoReflection: 0,
  }, 2);
  assert.match(out, /added 1 new position/);
  assert.match(out, /closed 2 positions/);
  // Two sentences joined with a space
  assert.ok(out.split(/\.\s/).length >= 3, 'should contain at least 3 sentence-ending periods');
});

// ─── Voice quality (no em-dashes, no marketing fluff) ───────────────────

test('no em-dashes in any output sample', () => {
  const samples = [
    buildBehavioralLead({ addedPositions: 2, addedWithThesis: 2, reflectionsLogged: 0, closesNoReflection: 0 }, 0),
    buildBehavioralLead({ addedPositions: 3, addedWithThesis: 1, reflectionsLogged: 0, closesNoReflection: 0 }, 0),
    buildBehavioralLead({ addedPositions: 2, addedWithThesis: 0, reflectionsLogged: 0, closesNoReflection: 0 }, 0),
    buildBehavioralLead({ addedPositions: 0, addedWithThesis: 0, reflectionsLogged: 3, closesNoReflection: 0 }, 3),
    buildBehavioralLead({ addedPositions: 0, addedWithThesis: 0, reflectionsLogged: 0, closesNoReflection: 2 }, 2),
    buildBehavioralLead({ addedPositions: 1, addedWithThesis: 1, reflectionsLogged: 2, closesNoReflection: 0 }, 2),
  ].filter(Boolean);
  for (const s of samples) {
    assert.ok(!s.includes('—'), `em-dash leaked into: "${s}"`);
    assert.ok(!s.includes('–'), `en-dash leaked into: "${s}"`);
  }
});

test('no obvious AI hype words like "great" or "amazing"', () => {
  const out = buildBehavioralLead({
    addedPositions: 2, addedWithThesis: 2, reflectionsLogged: 2, closesNoReflection: 0,
  }, 2);
  assert.ok(!/great|amazing|excellent|fantastic|awesome/i.test(out), `hype word leaked: "${out}"`);
});

// ─── Run ────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
for (const t of tests) {
  try { t.fn(); console.log(`ok    ${t.name}`); pass++; }
  catch (e) { console.log(`FAIL  ${t.name} - ${e.message}`); fail++; }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail > 0 ? 1 : 0);
