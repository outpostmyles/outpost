# The Daily Round

The signature daily ritual. A short, guided, completable flow that does the
all-day market watching *for* the user and then tells them they are done. The
product earns the daily return not by hijacking attention but by absorbing the
anxiety the user already feels: "did I miss anything, are my holdings safe."
Finish the round and you are covered, a little sharper, and free to step away.

North star: **the ten-minute (often one-minute) daily round that replaces the
all-day watch.** Not "maximize time in app." The reward is permission to put the
phone down.

## Locked decisions (v1)

1. **Full-screen step-through**, launched from a small entry card on Home. The
   payoff is a ritual that ends; only a focused flow delivers the "done" moment.
2. **No cross-day streak in v1.** Per-round completion is the reward. A streak
   counter is the mechanic most likely to become guilt/pressure, the opposite of
   the goal. Start pure; add a gentle version later only if genuinely missed.
3. **Keep the sharpen step**, the part that makes them better over time. Always
   skippable; on a day with nothing good to ask it shows a one-line insight from
   their own record instead of a task, so it never becomes a nag.

## The flow

Entry card (Home): adapts to the day. Quiet -> "Your round's ready, and it's a
quiet one." Something up -> "Two things want your eyes today." Done -> "Done for
today. You're covered." with a faint "run it again."

Step 1, **Am I safe?** Leads on purpose. Only items that need a decision: a
broken stop, a target hit, a hard drawdown, a fired alert. If none: a calm
all-clear, "Nothing on your book needs a decision today. I checked all N."

Step 2, **Where you stand.** One glance: today's P&L, biggest mover, the PULSE
line. Satisfies the "check my gains" itch once.

Step 3, **Am I missing anything?** Exactly one or two curated ideas worth a
look, never a feed. The FOMO-absorber. Tap to dig in with the agent.

Step 4, **Get a little sharper.** One contextual, skippable ask: write a missing
thesis, or a one-line insight from their own track record. The training. One
bite, never homework.

Step 5, **You're done.** The payoff. "That's your round. Holdings watched, one
idea noted, you're covered. See you tomorrow." Calm and final.

## Data mapping (reuse, do not rebuild)

- Safety: TODAY items of `type === 'alert'` (subtypes stop_broken, target_hit,
  deep_drawdown, moderate_drawdown). Source: `GET /api/ai/today`.
- Standing: `GET /api/portfolio/value` (P&L) + `GET /api/portfolio/pulse`.
- Opportunity: TODAY items of type bargain / catalyst / heat / watch, excluding
  held tickers, top 1-2 by priority.
- Sharpen: positions with empty `entry_thesis` (ask to write one), else an
  insight from `GET /api/portfolio/attribution` (thesis win-rate lift, or the
  hold-winners-vs-losers tell from the scorecard), else nothing.
- Close: summary of what the round surfaced.

Step-composition is pure logic in `api/.../dailyRound.js` style module on the
client (`src/lib/dailyRound.js`), unit-tested. The UI fetches the four payloads
in parallel (all cached server-side) and renders the steps.

## Feeling rules

- The reward is the close screen, not points.
- Bounded: finishable in under a minute on a quiet day, then over.
- Honest: a quiet day still runs; the value is the reassurance.
- Never guilt: missing days is fine, no punishment.

## Adapts to

- Market closed / weekend: lighter "review + one idea for Monday" round.
- Brand-new user, no positions: becomes the get-started round (folds in the
  existing onboarding checklist).
- Nothing happening: fast, ends on "all quiet, you're covered."
- Already done today: calm done state, re-runnable.

## Build phases

1. Step-composition logic + tests; the full-screen round UI; Home entry;
   completion state (localStorage keyed by date). The MVP that delivers the feel.
2. Adaptive logic (weekend, no-positions, quiet) and richer sharpen selection.
3. Optional gentle consistency, deeper personalization.
