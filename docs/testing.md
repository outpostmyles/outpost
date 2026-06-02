# Testing

Outpost has a fast, hermetic test suite that pins the logic a user's money and trust depend on. It runs in about a second, needs no live database, network, or API keys, and is the regression net for everything.

## Running it

```
npm test
```

Runs the deterministic suite (currently 42 files, ~370 assertions), prints a per-file summary, and exits non-zero if anything fails. Use it before any commit that touches logic.

To run one file while iterating:

```
node tests/<name>.mjs
```

If a test imports backend modules (anything that pulls in `api/config.js`), run it with the harness Anthropic vars cleared so `dotenv` loads the real keys from `.env`:

```
unset ANTHROPIC_API_KEY ANTHROPIC_BASE_URL && node tests/<name>.mjs
```

`npm test` does this stripping for you.

## What's tested, and what isn't

The suite is **hermetic on purpose**. Two kinds of test live in it:

- **Pure logic** — the decision and math modules under `src/lib/` and `api/services/` (position health, portfolio risk, stress tests, the trade-advice math, the technical indicators, the pre-trade verdict, the behavioral classifier, the market-regime classifier, the sanitizers, the caches, market hours, and more).
- **In-process integration** — `integration_smoke.mjs` boots the real Express app on an ephemeral port and exercises the middleware chain (404 shape, the auth gate, security headers, request id, body-parse) without touching the database.

Everything that needs a live service stays **out** of the suite and is listed by the runner each time (probes like `probe_*`, evals like `eval_*`, and anything prefixed `_`). Those are run by hand against real data when needed.

## The pattern (how to add a test)

The campaign that built this suite followed one repeatable move: **push decision logic into a pure function, then test the function, not the plumbing.**

1. **Extract the logic.** If a useful decision is buried inside a route handler, a React component, or a DB-coupled service, lift it into a pure function in `src/lib/` or `api/services/` that takes plain data in and returns plain data out. The caller keeps the IO (fetching, rendering); the pure function holds the rules. Examples: `preTradeRisk.js` (lifted out of a DB-coupled tool), `positionStatus.js` (lifted out of a React component), `indicators.js` and `tradeMath.js` (lifted out of the agent tools).
2. **Inject anything non-deterministic.** Time is the usual culprit: take an optional `now = new Date()` argument so a test can pin behavior at a fixed instant (see `marketHours.js`). `Date.now()`/`Math.random()` inside the logic make it untestable.
3. **Write a plain `.mjs` harness.** No framework. The shape every test file uses:

   ```js
   import assert from 'node:assert/strict';
   import { thing } from '../src/lib/thing.js';

   const tests = [];
   const test = (n, f) => tests.push({ n, f });

   test('does the expected thing', () => {
     assert.equal(thing(input), expected);
   });

   let pass = 0, fail = 0;
   for (const t of tests) {
     try { t.f(); console.log(`ok    ${t.n}`); pass++; }
     catch (e) { console.log(`FAIL  ${t.n} - ${e.message}`); fail++; }
   }
   console.log(`\n${pass}/${pass + fail} passed`);
   process.exit(fail > 0 ? 1 : 0);
   ```

   The runner keys off the `N/N passed` line and the exit code.
4. **Add the file name to `SUITE` in `tests/run-all.mjs`** so `npm test` picks it up. The runner warns about any hermetic-looking file not in the suite.

## Defensive habits the suite enforces

These came up repeatedly and are worth keeping:

- **Guard array inputs with `Array.isArray(x) ? x : []`**, not `x || []`. The latter passes a non-array truthy value straight through to `.map`/`.filter` and throws. `fuzz_robustness.mjs` hammers every pure module with hostile inputs to catch this.
- **Reject non-finite numbers at boundaries** with `Number.isFinite` (or the coercing global `isFinite` when numeric strings must still pass). `Infinity` is not `NaN`, so an `isNaN` check lets it through to a DB column or the UI.
- **Default object params don't catch `null`.** `function f({ a } = {})` still throws on `f(null)`. Destructure from `arg || {}` inside instead.
- **Fail closed.** When verification or data is missing, surface nothing or a placeholder rather than presenting an unverified value as confident.
