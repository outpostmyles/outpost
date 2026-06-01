// Single source of truth for the monthly credit grant per plan. Imported by
// signup (api/functions/auth.js) and the monthly reset (api/jobs/runner.js) so
// the two can never silently drift apart, which would mis-fund whole cohorts.
//
// 'unlimited' is the beta tier: a balance so large it never depletes in
// practice. It passes every gate (non-free), the agent is free on any paid
// plan, and the 300-calls-per-day AI ceiling stays as the real cost guard.
export const PLAN_CREDITS = { free: 50, starter: 500, pro: 2500, elite: 10000, unlimited: 999_999_999 };
