import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { buildAgentReportCard } from '../../lib/agentReportCard.js';

/**
 * Founder dashboard — internal-only page for tracking app health.
 *
 * Hidden from non-admins via the /api/admin/check probe in SettingsPage.
 * The endpoint itself returns 404 to non-admins so it's not enumerable.
 */
export default function FounderDashboard({ onBack }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // The decision-ledger aggregate: our private, compiled view of what the whole
  // user base is doing. Loaded separately so a failure here never blocks the
  // rest of the dashboard, and so it stays empty-safe before any decisions land.
  const [intel, setIntel] = useState(null);
  // Real Claude API cost, attributed by feature and model. FOUNDER ONLY: this is
  // never shown to a user, it exists so we can see where the AI spend goes.
  const [aiUsage, setAiUsage] = useState(null);
  // The "open sheet": everything compiled into one plain-text block to copy to Claude.
  const [brief, setBrief] = useState(null);

  async function load() {
    try {
      const d = await api.admin.dashboard();
      setData(d);
      setErr('');
    } catch (e) {
      setErr(e.error || 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { api.decisions.aggregate().then(setIntel).catch(() => setIntel(null)); }, []);
  useEffect(() => { api.admin.aiUsage(30).then(setAiUsage).catch(() => setAiUsage(null)); }, []);
  useEffect(() => { api.admin.brief().then(setBrief).catch(() => setBrief(null)); }, []);

  function refresh() {
    setRefreshing(true);
    api.decisions.aggregate().then(setIntel).catch(() => {});
    api.admin.aiUsage(30).then(setAiUsage).catch(() => {});
    api.admin.brief().then(setBrief).catch(() => {});
    load();
  }

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--faint)', fontSize: 12 }}>
        Loading dashboard…
      </div>
    );
  }

  if (err) {
    return (
      <div style={{ padding: 24 }}>
        <Header onBack={onBack} onRefresh={refresh} refreshing={refreshing} />
        <p style={{ color: 'var(--red)', fontSize: 12, marginTop: 24 }}>{err}</p>
      </div>
    );
  }

  if (!data) return null;

  const { users, engagement, aiQuality, errors, live, insights, suggestions, dailyHistory, signupSeries, generatedAt, experiments } = {
    ...data,
    signupSeries: data.users?.signupSeries ?? [],
  };

  // The Report Card: one synthesized weekly verdict built from data already
  // loaded (dashboard + decision intel + AI cost + brief). It fills in as those
  // sources arrive, and is honest about thin data, so it never fakes a grade.
  const reportCard = buildAgentReportCard({
    approvalRate7d: aiQuality?.approvalRate7d,
    thumbsUp7d: aiQuality?.thumbsUp7d,
    thumbsDown7d: aiQuality?.thumbsDown7d,
    qualityTrend: brief?.qualityTrend || null,
    adviceLift: intel?.adviceLift || null,
    projectedMonthly: aiUsage?.projectedMonthly,
    cost7d: aiUsage?.totals?.last7d?.cost,
    errors7d: errors?.last7d,
    active7d: users?.activeIn7d,
    totalUsers: users?.total,
    topObservation: brief?.observations?.[0] || null,
  });

  return (
    <div className="scrollable" style={{ flex: 1 }}>
      <Header onBack={onBack} onRefresh={refresh} refreshing={refreshing} generatedAt={generatedAt} />

      <ReportCard card={reportCard} />

      {/* FOUNDER BRIEF: everything compiled into one plain-text block to copy or
          screenshot and hand to Claude, with a recommendations list. FOUNDER ONLY. */}
      <div style={{ padding: '12px 16px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <SectionTitle>Founder brief (copy to Claude)</SectionTitle>
          {brief?.text && <CopyButton text={brief.text} />}
        </div>
        {!brief?.text ? (
          <Card><p style={{ padding: 14, fontSize: 11, color: 'var(--faint)' }}>Compiling the brief…</p></Card>
        ) : (
          <Card>
            <pre style={{ margin: 0, padding: 12, fontSize: 10.5, lineHeight: 1.5, color: 'var(--muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, Menlo, monospace', maxHeight: 360, overflowY: 'auto' }}>{brief.text}</pre>
          </Card>
        )}
      </div>

      {/* DECISION INTELLIGENCE: our private, compiled view of what the user base
          is doing. This is the data asset, for us to learn from, never shown to
          users. They feel it only as an app that gets smarter. */}
      <div style={{ padding: '12px 16px 4px' }}>
        <SectionTitle>Decision Intelligence</SectionTitle>
        {!intel ? (
          <Card><p style={{ padding: 14, fontSize: 11, color: 'var(--faint)' }}>Loading, or no decisions captured yet. Rows land here as users trade.</p></Card>
        ) : (
          <>
            {/* THE OBJECTIVE + THE REWARD: the two numbers the whole machine
                exists to move. Decision quality is our loss function; advice
                lift is whether the product actually earns its keep. */}
            <Card>
              <Row label="Decision Quality Index (the objective)"
                   value={intel.quality?.avgIndex != null ? `${intel.quality.avgIndex} / 100` : 'no data yet'}
                   accent={intel.quality?.avgIndex != null ? (intel.quality.avgIndex >= 65 ? 'var(--green)' : intel.quality.avgIndex >= 50 ? 'var(--amber)' : 'var(--red)') : null} />
              <Row label="Does our advice help (the reward)"
                   value={intel.adviceLift?.lift != null
                     ? `${intel.adviceLift.lift >= 0 ? '+' : ''}${intel.adviceLift.lift} pts  (advised ${intel.adviceLift.advised.winRate}% vs self ${intel.adviceLift.selfDirected.winRate}%)`
                     : 'not enough resolved trades yet'}
                   accent={intel.adviceLift?.lift != null ? (intel.adviceLift.lift > 0 ? 'var(--green)' : 'var(--red)') : null} />
            </Card>
            <div style={{ height: 10 }} />
            <StatGrid>
              <Stat label="Decisions" value={intel.totalDecisions ?? 0} sub={`${intel.windowDays}d window`} />
              <Stat label="Tickers seen" value={intel.tickersTracked ?? 0} />
              <Stat label="Users active" value={intel.behavior?.totalUsers ?? 0} />
              <Stat label="Crowded names" value={intel.crowded?.length ?? 0} />
            </StatGrid>

            <div style={{ height: 10 }} />
            <SectionTitle>What our users do wrong</SectionTitle>
            <Card>
              {(intel.behavior?.patterns ?? []).length === 0
                ? <p style={{ padding: 14, fontSize: 11, color: 'var(--faint)' }}>No patterns yet. Needs more decisions per user.</p>
                : intel.behavior.patterns.map(p => (
                    <Row key={p.key} label={p.label} value={`${p.pctOfUsers}% of users (${p.users})`} accent={p.pctOfUsers >= 40 ? 'var(--amber)' : null} />
                  ))}
            </Card>

            <div style={{ height: 10 }} />
            <SectionTitle>Crowded right now</SectionTitle>
            <Card>
              {(intel.crowded ?? []).length === 0
                ? <p style={{ padding: 14, fontSize: 11, color: 'var(--faint)' }}>No crowding yet.</p>
                : intel.crowded.slice(0, 10).map(c => (
                    <Row key={c.ticker} label={c.ticker} value={`${c.uniqueUsers} users, ${c.opens} buys`} />
                  ))}
            </Card>

            <div style={{ height: 10 }} />
            <SectionTitle>Where retail gets hurt</SectionTitle>
            <Card>
              {(intel.retailTraps ?? []).length === 0
                ? <p style={{ padding: 14, fontSize: 11, color: 'var(--faint)' }}>Not enough resolved trades yet to call a trap.</p>
                : intel.retailTraps.slice(0, 10).map(t => (
                    <Row key={t.ticker} label={t.ticker} value={`${t.retailWinRate}% win rate (${t.resolved} closed)`} accent={'var(--red)'} />
                  ))}
            </Card>

            <div style={{ height: 10 }} />
            <SectionTitle>Setup base rates (how each kind of buy works out)</SectionTitle>
            <Card>
              {intel.baseRates?.overall?.winRate != null && (
                <Row label="All buys (baseline)" value={`${intel.baseRates.overall.winRate}% win (${intel.baseRates.overall.n})`} />
              )}
              {(intel.baseRates?.buckets ?? []).filter(b => b.winRate != null).length === 0
                ? <p style={{ padding: 14, fontSize: 11, color: 'var(--faint)' }}>Not enough resolved buys yet to compute base rates.</p>
                : intel.baseRates.buckets.filter(b => b.winRate != null).map(b => (
                    <Row key={b.setup} label={b.setup} value={`${b.winRate}% win (${b.n})`}
                         accent={b.winRate <= 35 ? 'var(--red)' : b.winRate >= 60 ? 'var(--green)' : null} />
                  ))}
            </Card>
          </>
        )}
      </div>

      {/* AI COST: real Claude spend, attributed by feature and model from the
          token usage we capture on every call. This is where the bill scales, so
          it sits up top. FOUNDER ONLY, never shown to a user. */}
      <div style={{ padding: '12px 16px 4px' }}>
        <SectionTitle>AI cost (Claude API)</SectionTitle>
        {!aiUsage ? (
          <Card><p style={{ padding: 14, fontSize: 11, color: 'var(--faint)' }}>Loading, or no calls captured yet. Rows land here as the app calls Claude. If this stays empty, run migration 019_ai_usage.sql in Supabase.</p></Card>
        ) : (
          <>
            <StatGrid>
              <Stat label="Last 24h" value={usd(aiUsage.totals?.last24h?.cost)} sub={`${aiUsage.totals?.last24h?.calls ?? 0} calls`} />
              <Stat label="Last 7d" value={usd(aiUsage.totals?.last7d?.cost)} sub={`${aiUsage.totals?.last7d?.calls ?? 0} calls`} />
              <Stat label={`Last ${aiUsage.windowDays ?? 30}d`} value={usd(aiUsage.totals?.lastWindow?.cost)} sub={`${aiUsage.totals?.lastWindow?.calls ?? 0} calls`} />
              <Stat label="Projected / mo" value={usd(aiUsage.projectedMonthly)} sub="from last 7d" accent={'var(--amber)'} />
            </StatGrid>

            <div style={{ height: 10 }} />
            <SectionTitle>Cost by feature ({aiUsage.windowDays ?? 30}d)</SectionTitle>
            <Card>
              {(aiUsage.byFeature ?? []).length === 0
                ? <p style={{ padding: 14, fontSize: 11, color: 'var(--faint)' }}>No usage captured yet.</p>
                : aiUsage.byFeature.map(f => (
                    <Row key={f.feature} label={f.feature} value={`${usd(f.cost)} (${f.calls} calls)`}
                         accent={f.cost >= (aiUsage.totals?.lastWindow?.cost || 0) * 0.4 ? 'var(--amber)' : null} />
                  ))}
            </Card>

            <div style={{ height: 10 }} />
            <SectionTitle>Cost by model ({aiUsage.windowDays ?? 30}d)</SectionTitle>
            <Card>
              {(aiUsage.byModel ?? []).length === 0
                ? <p style={{ padding: 14, fontSize: 11, color: 'var(--faint)' }}>No usage captured yet.</p>
                : aiUsage.byModel.map(m => (
                    <Row key={m.tier} label={m.tier} value={`${usd(m.cost)} (${m.calls} calls)`} />
                  ))}
            </Card>
          </>
        )}
      </div>

      {/* Top stat grid */}
      <div style={{ padding: '12px 16px 4px' }}>
        <SectionTitle>Userbase</SectionTitle>
        <StatGrid>
          <Stat label="Total users" value={users.total} />
          <Stat label="Active 7d" value={users.activeIn7d} sub={`${pct(users.activeIn7d, users.total)}%`} />
          <Stat label="Active 24h" value={users.activeIn24h} />
          <Stat label="Signups 7d" value={users.signups7d} accent={users.signups7d > 0 ? 'var(--green)' : null} />
        </StatGrid>
      </div>

      {/* Plan mix */}
      <div style={{ padding: '12px 16px 4px' }}>
        <SectionTitle>Plan mix</SectionTitle>
        <Card>
          {Object.entries(users.planMix || {}).sort((a, b) => b[1] - a[1]).map(([plan, count]) => (
            <Row key={plan} label={plan.toUpperCase()} value={`${count} (${pct(count, users.total)}%)`} />
          ))}
          {(!users.planMix || Object.keys(users.planMix).length === 0) && (
            <p style={{ padding: 14, fontSize: 11, color: 'var(--faint)' }}>No users yet.</p>
          )}
        </Card>
      </div>

      {/* Signup spark */}
      {signupSeries?.length > 0 && (
        <div style={{ padding: '12px 16px 4px' }}>
          <SectionTitle>Signups, last 7 days</SectionTitle>
          <Card>
            <Spark series={signupSeries.map(p => p.count)} labels={signupSeries.map(p => p.date.slice(5))} />
          </Card>
        </div>
      )}

      {/* Engagement */}
      <div style={{ padding: '12px 16px 4px' }}>
        <SectionTitle>Engagement</SectionTitle>
        <StatGrid>
          <Stat label="Open positions" value={engagement.positions} />
          <Stat label="Watchlist items" value={engagement.watchlistEntries} />
          <Stat label="Agent messages" value={engagement.agentMessages} />
          <Stat label="Credits used (mo)" value={users.totalCreditsUsedThisMonth} />
        </StatGrid>
      </div>

      {/* Live counters */}
      <div style={{ padding: '12px 16px 4px' }}>
        <SectionTitle>Today (live, since restart)</SectionTitle>
        <Card>
          <Row label="Active users" value={live.activeUsers} />
          <Row label="New signups" value={live.newUsers} />
          <Row label="Sessions" value={live.sessions} />
          <Row label="Feature uses" value={live.totalFeatureUses} />
          <Row label="Top feature" value={live.topFeature || '—'} />
          <Row label="Credit-limit hits" value={live.creditLimitHits} accent={live.creditLimitHits > 0 ? 'var(--amber)' : null} />
          {live.aiApproval != null && (
            <Row label="AI approval (today)" value={`${live.aiApproval}%`} accent={live.aiApproval >= 70 ? 'var(--green)' : 'var(--red)'} />
          )}
        </Card>
      </div>

      {/* AI quality */}
      <div style={{ padding: '12px 16px 4px' }}>
        <SectionTitle>AI quality (last 7 days)</SectionTitle>
        <Card>
          <Row
            label="Approval rate"
            value={aiQuality.approvalRate7d == null ? '—' : `${aiQuality.approvalRate7d}%`}
            accent={aiQuality.approvalRate7d == null ? null : aiQuality.approvalRate7d >= 70 ? 'var(--green)' : 'var(--red)'}
          />
          <Row label="Thumbs up" value={aiQuality.thumbsUp7d} />
          <Row label="Thumbs down" value={aiQuality.thumbsDown7d} accent={aiQuality.thumbsDown7d > 0 ? 'var(--red)' : null} />
          {Object.entries(aiQuality.byFeature || {}).map(([feat, v]) => {
            const total = v.up + v.down;
            const rate = total > 0 ? Math.round((v.up / total) * 100) : null;
            return (
              <Row
                key={feat}
                label={feat}
                value={`${v.up}↑ / ${v.down}↓${rate != null ? ` · ${rate}%` : ''}`}
                accent={rate != null && rate < 60 ? 'var(--red)' : null}
              />
            );
          })}
        </Card>
      </div>

      {/* Experiments */}
      {experiments?.length > 0 && (
        <div style={{ padding: '12px 16px 4px' }}>
          <SectionTitle>Prompt Experiments</SectionTitle>
          {experiments.map(exp => (
            <div key={exp.key} style={{ marginBottom: 8 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', padding: '4px 0 6px' }}>{exp.key}</p>
              {exp.description && <p style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.5, marginBottom: 6 }}>{exp.description}</p>}
              <Card>
                {exp.variants.map(v => {
                  const r = exp.results?.[v.id] || { up: 0, down: 0, total: 0, approval: null };
                  const value = r.total > 0
                    ? `${r.up}↑ / ${r.down}↓ · ${r.approval}%`
                    : 'no feedback yet';
                  const accent = r.approval == null ? null : r.approval >= 70 ? 'var(--green)' : r.approval >= 50 ? 'var(--amber)' : 'var(--red)';
                  return <Row key={v.id} label={`${v.id} — ${v.label}`} value={value} accent={accent} />;
                })}
                {exp.results?.untagged && (
                  <Row label="untagged (pre-experiment)" value={`${exp.results.untagged.up}↑ / ${exp.results.untagged.down}↓`} />
                )}
              </Card>
            </div>
          ))}
        </div>
      )}

      {/* AI Quality Review Queue */}
      <ReviewQueueSection />

      {/* Errors */}
      <div style={{ padding: '12px 16px 4px' }}>
        <SectionTitle>Errors</SectionTitle>
        <StatGrid>
          <Stat label="Last 24h" value={errors.last24h} accent={errors.last24h > 0 ? 'var(--red)' : null} />
          <Stat label="Last 7d" value={errors.last7d} accent={errors.last7d > 10 ? 'var(--red)' : null} />
        </StatGrid>
      </div>

      {/* Insights / suggestions */}
      {(insights?.length > 0 || suggestions?.length > 0) && (
        <div style={{ padding: '12px 16px 4px' }}>
          <SectionTitle>Live insights</SectionTitle>
          <Card>
            {insights.map((line, i) => (
              <Row key={`i${i}`} label="•" value={line} />
            ))}
            {suggestions.map((line, i) => (
              <Row key={`s${i}`} label="!" value={line} accent="var(--amber)" />
            ))}
          </Card>
        </div>
      )}

      {/* Daily history */}
      {dailyHistory?.length > 0 && (
        <div style={{ padding: '12px 16px 24px' }}>
          <SectionTitle>Last {dailyHistory.length} days</SectionTitle>
          <Card>
            <div style={{ padding: '8px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8, fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px', borderBottom: '1px solid var(--border)' }}>
              <span>DATE</span><span>ACTIVE</span><span>NEW</span><span>USES</span><span>AI%</span>
            </div>
            {dailyHistory.slice().reverse().map(d => (
              <div key={d.date} style={{ padding: '6px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8, fontSize: 11, color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                <span>{d.date}</span>
                <span>{d.activeUsers ?? '—'}</span>
                <span>{d.newUsers ?? '—'}</span>
                <span>{d.totalFeatureUses ?? '—'}</span>
                <span>{d.aiApprovalRate != null ? `${d.aiApprovalRate}%` : '—'}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

function Header({ onBack, onRefresh, refreshing, generatedAt }) {
  return (
    <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.5px', marginBottom: 2 }}>FOUNDER DASHBOARD</p>
        <p style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.3px' }}>
          {generatedAt ? `Snapshot ${new Date(generatedAt).toLocaleTimeString()}` : 'Internal — admin only'}
        </p>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={onRefresh} disabled={refreshing} className="btn btn-muted" style={{ padding: '6px 10px', fontSize: 10 }}>{refreshing ? '...' : 'REFRESH'}</button>
        <button onClick={onBack} className="btn btn-muted" style={{ padding: '6px 10px', fontSize: 10 }}>BACK</button>
      </div>
    </div>
  );
}

// The synthesized weekly verdict that sits on top of the raw dashboard. The
// founder reads this first: a status, a plain-English headline, four color-coded
// vitals (landed / accurate / helping / cost), and the one thing to look at.
function ReportCard({ card }) {
  if (!card) return null;
  const tone = {
    healthy:   { color: 'var(--green)', bg: 'rgba(52,211,153,0.10)',  border: 'rgba(52,211,153,0.30)' },
    watch:     { color: 'var(--amber)', bg: 'rgba(245,158,11,0.10)',  border: 'rgba(245,158,11,0.30)' },
    attention: { color: 'var(--red)',   bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.32)' },
    thin:      { color: 'var(--blue)',  bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.24)' },
  }[card.status] || { color: 'var(--faint)', bg: 'var(--surface)', border: 'var(--border)' };
  const stateColor = (st) => st === 'good' ? 'var(--green)' : st === 'warn' ? 'var(--amber)' : st === 'bad' ? 'var(--red)' : 'var(--faint)';

  return (
    <div style={{ padding: '14px 16px 4px' }}>
      <div style={{ background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--faint)', textTransform: 'uppercase' }}>Agent report card</span>
          <span style={{ fontSize: 9, color: 'var(--faint)' }}>this week</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', color: tone.color }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone.color }} />
            {card.statusLabel}
          </span>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55, margin: '0 0 12px' }}>{card.headline}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {card.vitals.map(v => (
            <div key={v.key} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: `2px solid ${stateColor(v.state)}`, borderRadius: 8, padding: '10px 12px' }}>
              <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px', textTransform: 'uppercase', marginBottom: 4 }}>{v.label}</p>
              <p style={{ fontSize: 15, fontWeight: 700, color: v.state === 'none' ? 'var(--muted)' : stateColor(v.state) }}>{v.value}</p>
              <p style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 2 }}>{v.sub}</p>
            </div>
          ))}
        </div>
        {card.topAction && (
          <div style={{ marginTop: 10, padding: '9px 12px', background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 3 }}>Look at this first</p>
            <p style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.5, margin: 0 }}>{card.topAction}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '1.5px', padding: '6px 0' }}>{children}</p>;
}

function Card({ children }) {
  return <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>{children}</div>;
}

function StatGrid({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>{children}</div>;
}

function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
      <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.6px', marginBottom: 4 }}>{label.toUpperCase()}</p>
      <p style={{ fontSize: 20, fontWeight: 700, color: accent || 'var(--text)' }}>{value ?? '—'}</p>
      {sub && <p style={{ fontSize: 10, color: 'var(--faint)', marginTop: 2 }}>{sub}</p>}
    </div>
  );
}

function Row({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 11, color: 'var(--muted)', flexShrink: 0, marginRight: 12 }}>{label}</span>
      <span style={{ fontSize: 11, color: accent || 'var(--text)', textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function Spark({ series, labels }) {
  if (!series?.length) return null;
  const max = Math.max(1, ...series);
  const w = 280;
  const h = 50;
  const step = w / Math.max(1, series.length - 1);
  const path = series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(h - (v / max) * h).toFixed(1)}`).join(' ');
  return (
    <div style={{ padding: 14 }}>
      <svg viewBox={`0 0 ${w} ${h + 14}`} width="100%" preserveAspectRatio="none" style={{ display: 'block' }}>
        <path d={path} stroke="var(--blue)" strokeWidth="1.5" fill="none" />
        {series.map((v, i) => (
          <circle key={i} cx={(i * step).toFixed(1)} cy={(h - (v / max) * h).toFixed(1)} r="2" fill="var(--blue)" />
        ))}
        {labels.map((l, i) => (
          <text key={i} x={(i * step).toFixed(1)} y={h + 12} fontSize="7" textAnchor="middle" fill="rgba(255,255,255,0.4)">{l}</text>
        ))}
      </svg>
      <p style={{ fontSize: 10, color: 'var(--faint)', textAlign: 'right', marginTop: 4 }}>peak {max}</p>
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}
      className="btn btn-blue"
      style={{ fontSize: 10, padding: '4px 10px' }}
    >{copied ? 'Copied' : 'Copy'}</button>
  );
}

function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
// Money formatter that keeps precision for tiny beta-scale costs (a few cents)
// while staying readable once the totals grow.
function usd(n) {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

/**
 * Review queue — flagged AI responses that scored low. The founder reviews
 * each one and marks it 'fine' (false alarm) or 'problem' (real issue worth
 * fixing in the prompt).
 */
function ReviewQueueSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null); // id of expanded item
  const [busy, setBusy] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const d = await api.admin.reviewQueue({ threshold: 80 });
      setData(d);
    } catch {} finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function mark(id, verdict) {
    setBusy(id);
    try {
      await api.admin.markReviewed(id, verdict);
      // Optimistically remove from the list
      setData(d => ({ ...d, items: (d?.items || []).filter(i => i.id !== id) }));
    } catch {} finally { setBusy(null); }
  }

  if (loading) {
    return (
      <div style={{ padding: '12px 16px 4px' }}>
        <SectionTitle>AI Review Queue</SectionTitle>
        <p style={{ fontSize: 11, color: 'var(--faint)' }}>Loading…</p>
      </div>
    );
  }
  if (!data) return null;

  const items = data.items || [];

  return (
    <div style={{ padding: '12px 16px 4px' }}>
      <SectionTitle>AI Review Queue</SectionTitle>
      <StatGrid>
        <Stat label="Flagged" value={items.length} accent={items.length > 5 ? 'var(--amber)' : null} />
        <Stat label="Low quality (≤50)" value={data.lowQualityCount ?? 0} accent={data.lowQualityCount > 0 ? 'var(--red)' : null} />
      </StatGrid>

      {items.length === 0 ? (
        <p style={{ fontSize: 11, color: 'var(--faint)', padding: '8px 0' }}>
          Queue empty. AI outputs are all scoring above 80.
        </p>
      ) : (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.slice(0, 8).map(item => (
            <div key={item.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              <div
                onClick={() => setExpanded(e => e === item.id ? null : item.id)}
                style={{ padding: '9px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(245,158,11,0.15)', color: 'var(--amber)', fontWeight: 700, letterSpacing: '0.4px' }}>
                      {item.score ?? '?'}/100
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text)' }}>{item.feature}{item.ticker ? ` · ${item.ticker}` : ''}</span>
                    {item.variant && <span style={{ fontSize: 9, color: 'var(--faint)' }}>variant: {item.variant}</span>}
                  </div>
                  {item.failures?.length > 0 && (
                    <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.4, margin: 0 }}>
                      {item.failures.slice(0, 2).join(' · ')}
                    </p>
                  )}
                </div>
                <span style={{ color: 'var(--faint)', fontSize: 12 }}>{expanded === item.id ? '⌃' : '›'}</span>
              </div>

              {expanded === item.id && (
                <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--border)' }}>
                  <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px', margin: '8px 0 4px' }}>OUTPUT</p>
                  <p style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.5, marginBottom: 8 }}>{item.output}</p>
                  {item.input_preview && (
                    <>
                      <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px', margin: '8px 0 4px' }}>INPUT (preview)</p>
                      <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 8, maxHeight: 120, overflowY: 'auto', background: 'var(--raised)', padding: '6px 8px', borderRadius: 4 }}>{item.input_preview}</p>
                    </>
                  )}
                  {item.grader_notes && (
                    <p style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic', margin: '4px 0 8px' }}>Grader note: {item.grader_notes}</p>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); mark(item.id, 'fine'); }}
                      disabled={busy === item.id}
                      className="btn btn-muted"
                      style={{ flex: 1, fontSize: 10 }}
                    >This is fine</button>
                    <button
                      onClick={(e) => { e.stopPropagation(); mark(item.id, 'problem'); }}
                      disabled={busy === item.id}
                      className="btn btn-red"
                      style={{ flex: 1, fontSize: 10 }}
                    >Real problem</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {items.length > 8 && (
            <p style={{ fontSize: 9, color: 'var(--faint)', textAlign: 'center', padding: 4 }}>
              +{items.length - 8} more. Review the top items first.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
