// One-off schema-drift audit: compare the DEV database's REAL schema (what the code
// was built against) to exactly what PROD was built from (schema.sql + supabase-setup.sql
// + migrations). Anything DEV has that the repo files do NOT create is a prod gap that
// silently breaks a feature (e.g. agent_messages.conversation_id). Read-only.
import '../api/config.js'; // loads .env (module-relative); file reads below are CWD-relative (run from repo root)
import { readFileSync, readdirSync } from 'node:fs';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 1) DEV schema, complete, from PostgREST's OpenAPI (covers EVERY table incl. empty ones).
const res = await fetch(url.replace(/\/$/, '') + '/rest/v1/', { headers: { apikey: key, Authorization: 'Bearer ' + key } });
const spec = await res.json();
const defs = spec.definitions || {};
const dev = {}; // table -> [cols]
for (const [t, d] of Object.entries(defs)) dev[t] = Object.keys(d.properties || {});

// 2) PROD schema reconstructed from the repo files the bundle is built from.
const files = ['schema.sql', 'supabase-setup.sql',
  ...readdirSync('api/migrations').filter(f => f.endsWith('.sql')).sort().map(f => 'api/migrations/' + f)];
const prod = {}; // table -> Set(cols)
const add = (t, c) => (prod[t.toLowerCase()] = prod[t.toLowerCase()] || new Set()).add(c.toLowerCase());
const CONSTRAINT = new Set(['primary', 'foreign', 'unique', 'constraint', 'check', 'exclude', 'like']);
for (const f of files) {
  let sql; try { sql = readFileSync(f, 'utf8'); } catch { continue; }
  const ct = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\)\s*;/gi;
  let m;
  while ((m = ct.exec(sql))) {
    const table = m[1];
    for (const raw of m[2].split('\n')) {
      const line = raw.trim().replace(/,$/, '');
      if (!line || line.startsWith('--')) continue;
      const first = (line.split(/\s+/)[0] || '').replace(/["(,]/g, '').toLowerCase();
      if (!first || CONSTRAINT.has(first)) continue;
      add(table, first);
    }
  }
  const al = /alter\s+table\s+(?:public\.)?"?(\w+)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi;
  while ((m = al.exec(sql))) add(m[1], m[2]);
}

// 3) Diff. Skip PostgREST internal/view-ish entries we can't map cleanly.
const skipTables = new Set(['agent_conversations']); // known dead/leftover, referenced nowhere
const missingTables = [], missingCols = [];
for (const [t, cols] of Object.entries(dev)) {
  if (skipTables.has(t)) continue;
  const pcols = prod[t.toLowerCase()];
  if (!pcols) { missingTables.push([t, cols.length]); continue; }
  const gap = cols.filter(c => !pcols.has(c.toLowerCase()));
  if (gap.length) missingCols.push([t, gap]);
}

console.log('=== TABLES in DEV but NOT created by the repo schema (prod is missing them) ===');
console.log(missingTables.length ? missingTables.map(([t, n]) => `  ${t}  (${n} cols)`).join('\n') : '  (none)');
console.log('\n=== COLUMNS in DEV but NOT created by the repo schema (prod is missing them) ===');
console.log(missingCols.length ? missingCols.map(([t, g]) => `  ${t}: ${g.join(', ')}`).join('\n') : '  (none)');
console.log(`\n(dev tables seen: ${Object.keys(dev).length}; repo tables parsed: ${Object.keys(prod).length})`);
