// Isolation audit (founder/security tool). Scans every route handler for a
// per-user-table query with no user_id scope nearby. Row-level security is OFF,
// so any hit is a potential cross-user data leak, the worst thing that could
// happen to a money app. Run: node tests/_isolation_audit.mjs
// NOT in the hermetic suite (it reads the filesystem). The auditor logic itself
// is unit-tested in tests/isolation_audit.mjs.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUnscopedUserQueries } from '../src/lib/isolationAudit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fnDir = path.join(here, '..', 'api', 'functions');

// Files whose cross-user queries are intentional and gated. admin.js is the
// founder dashboard (requireAdmin, aggregates across all users on purpose).
const SKIP_FILES = new Set(['admin.js']);

// Reviewed-safe occurrences, matched by a stable snippet substring (not a line
// number, which shifts). Each below is an INSERT whose object carries user_id,
// built a few lines above the insert, outside the scanner's forward window.
// Confirmed safe by reading the code; populate ONLY after doing the same.
const ALLOW = {
  'agent.js': ["from('agent_messages').insert(assistantMsg)"],
  'social.js': ["from('watchlist').insert(insertData)"],
};

let total = 0;
const files = readdirSync(fnDir).filter(f => f.endsWith('.js') && !SKIP_FILES.has(f));
for (const file of files.sort()) {
  const src = readFileSync(path.join(fnDir, file), 'utf8');
  const flags = findUnscopedUserQueries(src).filter(fl => !(ALLOW[file]?.some(s => fl.snippet.includes(s))));
  if (flags.length) {
    console.log(`\n${file}`);
    for (const fl of flags) { console.log(`  L${fl.line}  ${fl.table}  ${fl.snippet}`); total++; }
  }
}
console.log(`\n${total} unscoped per-user query flag(s) across ${files.length} route files (admin.js excluded).`);
process.exit(total > 0 ? 1 : 0);
