// Founder tool: check the live model landscape against what Outpost uses, right now.
// Hits the live /v1/models endpoint, so it needs your Outpost ANTHROPIC_API_KEY. If your
// shell has an inherited key, clear it first:  unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL
//
// Exits non-zero if there's anything to act on (a used model retiring/gone, or a new
// model worth evaluating), so it can gate a CI/cron alert too.
//
// Usage: node tests/_model_watch.mjs
import { runModelWatch, formatFindings, hasAlerts } from '../api/services/modelWatch.js';

const r = await runModelWatch();

console.log(`\nModel watch: ${r.liveIds.length} models live on the API\n`);
console.log('You currently use:');
for (const [tier, id] of Object.entries(r.used)) console.log(`  ${tier.padEnd(6)} ${id}`);
console.log('');
console.log(formatFindings(r));
console.log('');

process.exit(hasAlerts(r.findings) ? 1 : 0);
