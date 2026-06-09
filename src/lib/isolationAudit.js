// Static guard for THE highest-stakes invariant in the app. Row-level security is
// OFF by design, so every query that returns a user's data must be scoped to that
// user in code. One unscoped query on a per-user table is a cross-user data leak,
// the single most catastrophic thing that could happen to a money app. This scans
// route source for `.from('<user table>')` statements that carry no user_id scope
// in the surrounding statement, so a new route can never quietly ship an unscoped
// read. Pure: it operates on source text, so it is unit-testable and repeatable.

// Tables that hold PER-USER data: a route returning them MUST scope by user_id.
// Deliberately excluded (and why): user_profiles is scoped by id/email/session;
// ai_cache is a shared keyed cache; market_summary / analytics_daily / errors are
// aggregate; beta_allowlist / password_reset_tokens are admin-or-token scoped;
// ai_response_log is the founder review queue.
export const USER_TABLES = [
  'positions', 'closed_trades', 'watchlist', 'agent_messages', 'agent_memory',
  'decisions', 'price_alerts', 'journal_notes', 'portfolio_snapshots', 'screeners',
  'deploy_cash_sessions', 'portfolio_analyses', 'research_status', 'ai_feedback',
];

/**
 * Find `.from('<userTable>')` queries with no user_id scope within the
 * surrounding statement window (a query chain rarely spans more than a handful
 * of lines). Pure. Returns [{ line, table, snippet }] for human review.
 */
export function findUnscopedUserQueries(source, { userTables = USER_TABLES, windowLines = 12 } = {}) {
  const lines = String(source || '').split('\n');
  const tableSet = new Set(userTables);
  const re = /\.from\(\s*['"]([a-z_]+)['"]\s*\)/g;
  const flags = [];
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(re)) {
      if (!tableSet.has(m[1])) continue;
      // The scope (.eq('user_id', ...), an insert with user_id, an RPC's p_user_id)
      // usually sits within a few lines of the .from(). Scan a window for it.
      const windowText = lines.slice(Math.max(0, i - 1), i + windowLines).join('\n');
      if (!/user_id/.test(windowText)) {
        flags.push({ line: i + 1, table: m[1], snippet: lines[i].trim().slice(0, 120) });
      }
    }
  }
  return flags;
}
