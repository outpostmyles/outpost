import { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api.js';
import { cachedFetch, clearCachePrefix } from '../../lib/cache.js';
import { useAuth } from '../../hooks/useAuth.jsx';
import { fmt, colorFor, greeting } from '../../utils/market.js';
import { renderPlainText } from '../../utils/renderText.js';
import { TickerIcon, EmptyState, DisclaimerBadge, FeedbackButtons, SkeletonCard } from '../shared/UI.jsx';
import ActivationChecklist from './ActivationChecklist.jsx';
import PortfolioExplainerCard from './PortfolioExplainerCard.jsx';
import TodayCard from './TodayCard.jsx';
import DeployCashFlow from './DeployCashFlow.jsx';

// "Outpost noticed" card. Surfaces up to 3 passive observations the user
// might miss otherwise. Closes without reflections. Aged positions without
// theses. Tickers they keep mentioning in chat but don't own.
//
// Dismissals tracked in localStorage by notice id. Survives page reload but
// not cross-device. Acceptable for a 10-user beta. Migrate to durable
// server-side dismissals if users complain about repeat nudges on another
// browser.
//
// CTA actions handled inline. None of them are blocking. Worst case: the
// CTA jumps to the relevant tab and the user finds the thing themselves.
const NOTICE_DISMISS_KEY = 'outpost_dismissed_notices';

function loadDismissedNotices() {
  try {
    const raw = localStorage.getItem(NOTICE_DISMISS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

function persistDismissedNotices(set) {
  try {
    localStorage.setItem(NOTICE_DISMISS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

function NoticesCard({ onTabSwitch, refreshKey }) {
  const [notices, setNotices] = useState([]);
  const [dismissed, setDismissed] = useState(() => loadDismissedNotices());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    cachedFetch('home_notices', () => api.portfolio.notices(), 5 * 60000)
      .then(d => { if (!cancelled) setNotices(d?.notices || []); })
      .catch(() => { if (!cancelled) setNotices([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  function dismiss(id) {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      persistDismissedNotices(next);
      return next;
    });
  }

  function handleAction(notice) {
    // Best-effort routing. Each action goes to the tab where the user can
    // act on the thing. We dismiss the notice so it stops nagging once the
    // user has taken a step toward addressing it. Not perfect but honest.
    switch (notice.cta?.action) {
      case 'open_close_reflection':
        onTabSwitch && onTabSwitch('journal');
        break;
      case 'add_thesis':
        onTabSwitch && onTabSwitch('portfolio');
        break;
      case 'look_at_ticker':
        onTabSwitch && onTabSwitch('agent');
        break;
      default:
        break;
    }
    dismiss(notice.id);
  }

  if (loading) return null;  // no skeleton, just hide until ready (avoids layout flash)
  const visible = notices.filter(n => !dismissed.has(n.id));
  if (visible.length === 0) return null;

  return (
    <div style={{ padding: '6px 16px 14px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, marginTop: 6 }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.2px', fontWeight: 700 }}>OUTPOST NOTICED</p>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map(notice => {
          const accent = notice.severity === 'high' ? 'var(--amber)'
            : notice.severity === 'medium' ? 'var(--blue)'
            : 'var(--faint)';
          return (
            <div
              key={notice.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderLeft: `2px solid ${accent}`,
                borderRadius: 7,
                padding: '11px 12px',
              }}
            >
              <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.55, marginBottom: 9 }}>{notice.text}</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {notice.cta?.label && (
                  <button
                    onClick={() => handleAction(notice)}
                    style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.4px',
                      background: 'rgba(59,130,246,0.12)', color: 'var(--blue)',
                      border: '1px solid rgba(59,130,246,0.3)',
                      borderRadius: 4, padding: '5px 10px', cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {notice.cta.label.toUpperCase()}
                  </button>
                )}
                <button
                  onClick={() => dismiss(notice.id)}
                  style={{
                    fontSize: 10, color: 'var(--faint)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: '5px 6px', fontFamily: 'inherit', letterSpacing: '0.4px',
                  }}
                >
                  DISMISS
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// PULSE — the single-sentence personal moment at the top of Home.
//
// Reads from GET /api/portfolio/pulse, which returns one short line (80-160
// chars) tailored to the user's onboarding anchors + current portfolio state
// + market regime. Free-tier eligible. Cached server-side per-hour per-user
// so reloads don't fire new Claude calls.
//
// Voice: friend texting you, not analyst report. Examples the backend can
// produce: "Quiet morning. Coffee, not panic." / "AAPL just touched your
// stop. Same setup as last August." / "Nothing pressing on your book."
//
// Loading state shows a subtle line so the layout doesn't jump. Errors fall
// through silently — the endpoint itself returns a deterministic fallback
// rather than 5xx, so the network failure case is rare.
function PulseCard({ refreshKey }) {
  const [pulse, setPulse] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // 30-min client cache so opening Home repeatedly doesn't re-hit the
    // backend; the backend itself caches for 2h, so the typical request
    // round-trip is a 304-equivalent (it just hits the ai_cache table).
    cachedFetch('home_pulse', () => api.portfolio.pulse(), 30 * 60000)
      .then(d => { if (!cancelled) setPulse(d?.pulse || ''); })
      .catch(() => { if (!cancelled) setPulse(''); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  // If the line failed to load entirely, don't render — better to show
  // nothing than a "could not load" error message at the top of Home.
  if (!loading && !pulse) return null;

  return (
    <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)' }}>
      <div style={{
        background: 'linear-gradient(180deg, rgba(59,130,246,0.08), rgba(59,130,246,0.02))',
        border: '1px solid rgba(59,130,246,0.18)',
        borderRadius: 10,
        padding: '13px 15px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: 'var(--blue)',
            // Subtle pulse animation — keeps the "live" feel without being distracting.
            animation: 'pulseDot 2s ease-in-out infinite',
          }} />
          <p style={{ fontSize: 9, color: 'var(--blue)', letterSpacing: '1.3px', fontWeight: 700 }}>OUTPOST</p>
        </div>
        {loading ? (
          <p style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.6, fontStyle: 'italic' }}>Reading your book…</p>
        ) : (
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, letterSpacing: '-0.1px' }}>{pulse}</p>
        )}
        <style>{`@keyframes pulseDot { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
      </div>
    </div>
  );
}
// SectorRadarCard (defined below) and BargainRadarCard remain; their signals
// also feed TODAY's ranked 5-pick list, and Bargain Radar has its own drawer
// under the Social tab. Two cards that TODAY fully replaced
// (ConcentrationAlertCard, ProactiveDigestCard) have been deleted.
import SaveToJournalSheet, { BookmarkButton } from '../journal/SaveToJournalSheet.jsx';

function SectorRadarCard({ refreshKey }) {
  const [radar, setRadar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    cachedFetch('home_radar', () => api.ai.sectorRadar(), 15 * 60000)
      .then(d => { if (!cancelled) setRadar(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (loading) return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', marginBottom: 8 }}>SECTOR RADAR</p>
      <div style={{ background: 'var(--raised)', borderRadius: 8, padding: 16, textAlign: 'center' }}>
        <p style={{ fontSize: 10, color: 'var(--faint)' }}>Scanning sectors...</p>
      </div>
    </div>
  );

  if (!radar || (!radar.heating?.length && !radar.cooling?.length)) return null;

  const signalColor = (signal) => {
    if (signal === 'strong') return 'var(--green)';
    if (signal === 'early') return 'var(--amber)';
    if (signal === 'risk') return 'var(--red)';
    if (signal === 'warning') return 'var(--amber)';
    return 'var(--faint)';
  };

  const signalLabel = (signal) => {
    if (signal === 'strong') return 'STRONG';
    if (signal === 'early') return 'EARLY';
    if (signal === 'risk') return 'RISK';
    if (signal === 'warning') return 'CAUTION';
    return signal?.toUpperCase() ?? '';
  };

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="var(--amber)"/></svg>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700 }}>SECTOR RADAR</p>
          {radar.generatedAt && <span style={{ fontSize: 8, color: 'var(--faint)', fontWeight: 400, letterSpacing: 0 }}>{new Date(radar.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
        </div>
        <button onClick={() => setExpanded(e => !e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, fontFamily: 'inherit' }}>
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {/* Compact view — always visible */}
      <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {/* Heating up */}
        {(radar.heating ?? []).slice(0, expanded ? 5 : 2).map((s, i, arr) => (
          <div key={s.ticker} style={{ display: 'flex', alignItems: 'center', padding: '9px 13px', gap: 10, borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: signalColor(s.signal), flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{s.ticker}</span>
                <span style={{ fontSize: 9, color: 'var(--faint)' }}>{s.name}</span>
              </div>
              <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded ? 'normal' : 'nowrap' }}>{s.thesis}</p>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <span style={{ fontSize: 8, fontWeight: 700, color: signalColor(s.signal), letterSpacing: '0.5px', padding: '2px 5px', background: `${signalColor(s.signal)}15`, borderRadius: 3 }}>{signalLabel(s.signal)}</span>
              {s.relativeStrength != null && (
                <p style={{ fontSize: 9, color: 'var(--green)', marginTop: 3, fontWeight: 600 }}>{s.relativeStrength != null && !isNaN(s.relativeStrength) ? `${s.relativeStrength >= 0 ? '+' : ''}${s.relativeStrength.toFixed(1)}` : '—'}% vs SPY</p>
              )}
            </div>
          </div>
        ))}

        {/* Cooling down */}
        {(radar.cooling ?? []).slice(0, expanded ? 5 : 1).map((s, i) => (
          <div key={s.ticker} style={{ display: 'flex', alignItems: 'center', padding: '9px 13px', gap: 10, borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: signalColor(s.signal), flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{s.ticker}</span>
                <span style={{ fontSize: 9, color: 'var(--faint)' }}>{s.name}</span>
              </div>
              <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expanded ? 'normal' : 'nowrap' }}>{s.thesis}</p>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <span style={{ fontSize: 8, fontWeight: 700, color: signalColor(s.signal), letterSpacing: '0.5px', padding: '2px 5px', background: `${signalColor(s.signal)}15`, borderRadius: 3 }}>{signalLabel(s.signal)}</span>
              {s.relativeStrength != null && (
                <p style={{ fontSize: 9, color: 'var(--red)', marginTop: 3, fontWeight: 600 }}>{s.relativeStrength != null && !isNaN(s.relativeStrength) ? `${s.relativeStrength >= 0 ? '+' : ''}${s.relativeStrength.toFixed(1)}` : '—'}% vs SPY</p>
              )}
            </div>
          </div>
        ))}

        {/* Theme Watch — emerging theme alert */}
        {radar.themeWatch && (
          <div style={{ padding: '9px 13px', background: 'rgba(245,158,11,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
              <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--amber)', letterSpacing: '0.8px' }}>THEME WATCH</span>
              {radar.themeWatch.ticker && <span style={{ fontSize: 9, color: 'var(--faint)' }}>{radar.themeWatch.ticker}</span>}
            </div>
            <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
              <b style={{ color: 'var(--text)' }}>{radar.themeWatch.name}:</b> {radar.themeWatch.thesis}
            </p>
          </div>
        )}
      </div>
      <DisclaimerBadge />
    </div>
  );
}

export default function HomeTab({ marketStatus, sentiment, onSentimentLoad, onTabSwitch, showToast }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [briefExpanded, setBriefExpanded] = useState(true);
  const [briefGenerating, setBriefGenerating] = useState(false);
  const [journalSave, setJournalSave] = useState(null); // { content, source, sectionName } or null

  const firstName = user?.display_name?.split(' ')[0] ?? 'Trader';

  const isPaid = (user?.plan ?? 'free') !== 'free';

  const fetchAll = useCallback(async (force = false) => {
    setLoading(true);
    // Portfolio cache is 30s to match the price-pool tick — anything longer makes
    // the card visibly stale during market hours. Sentiment is folded in here so
    // its failures surface in the same error banner as the other fetches.
    const [summary, movers, portfolio, brief, sentimentRes] = await Promise.allSettled([
      cachedFetch('home_summary', () => api.ai.summary(force ? { force: true } : undefined), 5 * 60000),
      cachedFetch('home_movers', () => api.market.movers(), 3 * 60000),
      cachedFetch('home_portfolio', () => api.portfolio.value(), 30000),
      isPaid ? cachedFetch('home_brief', () => api.ai.brief(force ? { force: true } : undefined), 10 * 60000) : Promise.resolve(null),
      cachedFetch('home_sentiment', () => api.market.sentiment(), 5 * 60000),
    ]);
    if (sentimentRes.status === 'fulfilled' && onSentimentLoad) onSentimentLoad(sentimentRes.value);
    const errors = [];
    if (summary.status === 'rejected') errors.push('summary');
    if (movers.status === 'rejected') errors.push('movers');
    if (portfolio.status === 'rejected') errors.push('portfolio');
    // Don't surface brief errors for free users — it's intentionally paid-only
    if (brief.status === 'rejected' && isPaid) errors.push('brief');
    if (sentimentRes.status === 'rejected') errors.push('sentiment');
    setData({
      summary: summary.status === 'fulfilled' ? summary.value : null,
      movers: movers.status === 'fulfilled' ? movers.value : null,
      portfolio: portfolio.status === 'fulfilled' ? portfolio.value : null,
      brief: brief.status === 'fulfilled' ? brief.value : null,
      errors,
    });
    setLastUpdated(new Date());
    setLoading(false);
  }, [isPaid]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const forceRefresh = useCallback(() => {
    clearCachePrefix('home_');
    fetchAll(true);
  }, [fetchAll]);

  const generateBriefNow = useCallback(async () => {
    setBriefGenerating(true);
    try {
      clearCachePrefix('home_brief');
      const fresh = await api.ai.brief({ force: true });
      setData(d => ({ ...d, brief: fresh }));
      if (showToast) showToast('Brief generated', 'success');
    } catch (err) {
      const msg = err?.error || err?.message || `Brief unavailable (${err?.status ?? 'network'})`;
      if (showToast) showToast(msg, 'error');
      console.error('[HomeTab] Brief generation failed:', err);
    } finally {
      setBriefGenerating(false);
    }
  }, [showToast]);

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="scrollable" style={{ flex: 1 }}>
      {/* Header */}
      <div style={{ padding: '13px 16px 10px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', marginBottom: 2 }}>TERMINAL</p>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>{greeting()}, {firstName}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px' }}>{today}</p>
            {lastUpdated && <p style={{ fontSize: 8, color: 'var(--faint)', marginTop: 2 }}>{lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</p>}
            <button onClick={forceRefresh} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 9, fontFamily: 'inherit', letterSpacing: '0.5px', marginTop: 2 }}>REFRESH</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '16px' }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div style={{ paddingBottom: 24 }}>

          {/* Error banner for partial failures */}
          {data.errors?.length > 0 && (
            <div style={{ padding: '8px 16px', background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.15)' }}>
              <p style={{ fontSize: 10, color: 'var(--red)', letterSpacing: '0.3px' }}>
                Some data couldn't load ({data.errors.join(', ')}). <button onClick={fetchAll} style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 10, fontWeight: 700 }}>Retry</button>
              </p>
            </div>
          )}

          {/* PULSE — one personal sentence. Lives ABOVE everything else so it's
              the first felt moment when the user opens the app. The reason it's
              not Deploy Cash anymore: Deploy Cash only matters if you have
              cash to deploy. Pulse always matters. */}
          <PulseCard refreshKey={lastUpdated?.getTime() ?? 0} />

          {/* OUTPOST NOTICED — passive observations. Shown only when there
              are non-dismissed notices to surface. Renders nothing in the
              empty-state, so a calm week sees no card at all. */}
          <NoticesCard onTabSwitch={onTabSwitch} refreshKey={lastUpdated?.getTime() ?? 0} />

          {/* Deploy Cash — the recurring engagement moment for users with
              new money to put to work. */}
          <DeployCashCard onTabSwitch={onTabSwitch} showToast={showToast} />

          {/* TODAY — Outpost's 5 ranked picks, always at the top of Home.
              Each row deep-links to its origin (portfolio, watchlist, etc.). */}
          <TodayCard
            onTabSwitch={onTabSwitch}
            onItemTap={(item) => {
              if (item?.link?.tab) onTabSwitch(item.link.tab);
            }}
          />

          {/* Activation checklist — only for users still onboarding (≤2 positions).
              Once they have 3+ positions they're activated; the checklist hides. */}
          {(data.portfolio?.positions?.length ?? 0) < 3 && (
            <ActivationChecklist
              portfolio={data.portfolio}
              userId={user?.id}
              plan={user?.plan}
              onTabSwitch={onTabSwitch}
              showToast={showToast}
            />
          )}

          {/* Pre-market brief — upgrade hint for free users */}
          {!isPaid && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ background: 'var(--raised)', borderLeft: '2px solid var(--faint)', borderRadius: '0 8px 8px 0', padding: '11px 13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--faint)"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  <span style={{ fontSize: 9, color: 'var(--faint)', fontWeight: 700, letterSpacing: '1px' }}>AI BRIEF · PAID</span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55 }}>
                  Personal pre-market briefs are part of the paid plan. Paid plans are coming soon.
                </p>
              </div>
            </div>
          )}

          {/* Pre-market brief — empty state with Generate Now button */}
          {isPaid && !data.brief?.brief && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ background: 'var(--raised)', borderLeft: '2px solid var(--blue)', borderRadius: '0 8px 8px 0', padding: '11px 13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--blue)"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  <span style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1px' }}>AI BRIEF</span>
                </div>
                <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.55, marginBottom: 10 }}>
                  Your personal pre-market brief runs automatically at 7:30am ET weekdays. Generate one now for today's market context and position-specific notes.
                </p>
                <button
                  onClick={generateBriefNow}
                  disabled={briefGenerating}
                  style={{
                    background: briefGenerating ? 'var(--raised)' : 'var(--blue)',
                    color: briefGenerating ? 'var(--faint)' : 'white',
                    border: briefGenerating ? '1px solid var(--border)' : 'none',
                    borderRadius: 6,
                    padding: '8px 14px',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.8px',
                    fontFamily: 'inherit',
                    cursor: briefGenerating ? 'default' : 'pointer',
                  }}
                >
                  {briefGenerating ? 'GENERATING…' : 'GENERATE BRIEF'}
                </button>
              </div>
            </div>
          )}

          {/* Pre-market brief */}
          {data.brief?.brief && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ background: 'var(--raised)', borderLeft: '2px solid var(--blue)', borderRadius: '0 8px 8px 0', padding: '11px 13px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--blue)"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    <span style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1px' }}>AI BRIEF</span>
                    {data.brief.generated_at && (
                      <span style={{ fontSize: 8, color: 'var(--faint)', fontWeight: 400, letterSpacing: 0 }}>
                        {new Date(data.brief.generated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button
                      onClick={generateBriefNow}
                      disabled={briefGenerating}
                      title="Regenerate (8 credits)"
                      aria-label="Regenerate brief"
                      style={{
                        background: 'none', border: 'none',
                        cursor: briefGenerating ? 'default' : 'pointer',
                        color: briefGenerating ? 'var(--faint)' : 'var(--muted)',
                        padding: '2px 6px', fontFamily: 'inherit',
                        opacity: briefGenerating ? 0.5 : 1,
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: briefGenerating ? 'spin 1s linear infinite' : 'none' }}>
                        <polyline points="23 4 23 10 17 10"/>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                      </svg>
                      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
                    </button>
                    <BookmarkButton onClick={() => setJournalSave({ content: data.brief.brief, source: 'ai_brief' })} />
                    <button onClick={() => setBriefExpanded(e => !e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 10, fontFamily: 'inherit' }}>
                      {briefExpanded ? '▲' : '▼'}
                    </button>
                  </div>
                </div>
                {briefExpanded && (
                  <>
                    <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>{renderPlainText(data.brief.brief)}</p>
                    <DisclaimerBadge />
                    <FeedbackButtons feature="brief" response={data.brief.brief} />
                  </>
                )}
              </div>
            </div>
          )}

          {/* Portfolio value */}
          <div style={{ padding: '13px 16px 11px', borderBottom: '1px solid var(--border)' }}>
            <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', marginBottom: 4 }}>PORTFOLIO VALUE</p>
            {data.portfolio?.totalValue > 0 ? (
              <>
                <p style={{ fontSize: 28, fontWeight: 700, fontFamily: 'JetBrains Mono', color: 'var(--text)', letterSpacing: '-1px', marginBottom: 5 }}>
                  ${fmt(data.portfolio.totalValue)}
                </p>
                <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
                  <span style={{ color: 'var(--faint)' }}>P&L <span style={{ color: colorFor(data.portfolio.totalPnl), fontWeight: 700 }}>{data.portfolio.totalPnl >= 0 ? '+' : ''}${fmt(data.portfolio.totalPnl)}</span></span>
                  <span style={{ color: 'var(--faint)' }}>{data.portfolio.marketOpen === false ? 'AT CLOSE' : 'TODAY'} <span style={{ color: colorFor(data.portfolio.todayChange), fontWeight: 700 }}>{data.portfolio.todayChange >= 0 ? '+' : ''}${fmt(data.portfolio.todayChange)}</span></span>
                </div>
                {/* Position pills */}
                {data.portfolio.positions?.length > 0 && (
                  <div style={{ display: 'flex', gap: 7, marginTop: 10, overflowX: 'auto', paddingBottom: 2 }}>
                    {data.portfolio.positions.map(p => (
                      <div key={p.ticker} onClick={() => onTabSwitch('portfolio')} style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', flexShrink: 0, cursor: 'pointer' }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.3px' }}>{p.ticker}</p>
                        <p style={{ fontSize: 10, color: colorFor(p.todayChangePercent), fontWeight: 700, marginTop: 1 }}>
                          {p.todayChangePercent >= 0 ? '+' : ''}{fmt(p.todayChangePercent)}%
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Add positions to track your portfolio value</p>
                <button onClick={() => onTabSwitch('portfolio')} className="btn btn-blue">ADD POSITION</button>
              </div>
            )}
          </div>

          {/* Portfolio Recap — why the portfolio moved today (passive card, auto-hides when empty) */}
          <PortfolioExplainerCard refreshKey={lastUpdated} showToast={showToast} />

          {/* Market metrics */}
          {sentiment && (
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
              {[
                {
                  label: sentiment.vix?.estimated ? 'VIX (EST)' : 'VIX',
                  value: sentiment.vix?.value?.toFixed(1) ?? '—',
                  sub: sentiment.vix?.label,
                  color: sentiment.vix?.value >= 25 ? 'var(--red)' : sentiment.vix?.value >= 20 ? 'var(--amber)' : 'var(--green)',
                },
                {
                  label: 'FEAR & GREED',
                  value: sentiment.fearGreed?.value ?? '—',
                  sub: sentiment.fearGreed?.label?.toUpperCase(),
                  color: (sentiment.fearGreed?.value ?? 50) < 30 ? 'var(--red)' : (sentiment.fearGreed?.value ?? 50) > 70 ? 'var(--green)' : 'var(--amber)',
                  warn: sentiment.fearGreed?.source === 'crypto_fallback',
                },
                {
                  label: 'SPY RSI',
                  value: sentiment.rsi?.SPY?.value?.toFixed(1) ?? '—',
                  sub: sentiment.rsi?.SPY?.label?.toUpperCase(),
                  color: 'var(--muted)',
                },
              ].map((m, i) => (
                <div key={m.label} style={{ flex: 1, padding: '10px 12px', borderRight: i < 2 ? '1px solid var(--border)' : 'none' }}>
                  <p style={{ fontSize: 8, color: 'var(--faint)', marginBottom: 3, letterSpacing: '0.8px' }}>
                    {m.label}{m.warn && <span style={{ color: 'var(--amber)', marginLeft: 3 }}>*</span>}
                  </p>
                  <p style={{ fontSize: 18, fontWeight: 700, color: m.color, letterSpacing: '-0.5px' }}>{m.value}</p>
                  {m.sub && <p style={{ fontSize: 8, color: m.color, marginTop: 2, letterSpacing: '0.5px' }}>{m.sub}</p>}
                </div>
              ))}
            </div>
          )}

          {/* AI Market Summary */}
          {data.summary?.summary_text && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px' }}>AI MARKET SUMMARY</p>
                <BookmarkButton onClick={() => setJournalSave({ content: data.summary.summary_text, source: 'ai_brief' })} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7, marginBottom: 6 }}>{renderPlainText(data.summary.summary_text)}</p>
              <DisclaimerBadge />
              <FeedbackButtons feature="summary" response={data.summary.summary_text} />
            </div>
          )}

          {/* Top Movers */}
          {(data.movers?.gainers?.length > 0 || data.movers?.losers?.length > 0) && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px' }}>{data.movers?.live === false ? 'LAST SESSION' : 'TOP MOVERS'}</p>
                {data.movers?.live === false && <span style={{ fontSize: 8, color: 'var(--faint)', opacity: 0.6 }}>MARKET CLOSED</span>}
              </div>
              <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                {[...(data.movers.gainers ?? []).map(m => ({ ...m, pos: true })), ...(data.movers.losers ?? []).map(m => ({ ...m, pos: false }))].slice(0, 5).map((m, i, arr) => (
                  <div key={m.ticker} style={{ display: 'flex', alignItems: 'center', padding: '9px 13px', gap: 10, borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <TickerIcon ticker={m.ticker} size={32} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.3px' }}>{m.ticker}</p>
                      <p style={{ fontSize: 10, color: 'var(--faint)' }}>${fmt(m.price)}</p>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: m.pos ? 'var(--green)' : 'var(--red)', letterSpacing: '-0.2px' }}>
                      {m.pos ? '+' : ''}{fmt(m.changePercent)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ask your agent — opportunity scan CTA */}
          <div style={{ padding: '12px 16px' }}>
            <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', marginBottom: 10 }}>ASK YOUR AGENT</p>
            <div style={{ background: 'var(--raised)', border: '1px solid rgba(59,130,246,0.18)', borderRadius: 8, padding: '13px 14px' }}>
              <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 10 }}>
                Ask your Agent to scan for opportunities based on current market conditions, social sentiment, and your portfolio.
              </p>
              <button onClick={() => onTabSwitch('agent')} className="btn btn-blue btn-full">
                OPEN AGENT
              </button>
            </div>
          </div>

        </div>
      )}

      {/* Save to Journal sheet — opens when user bookmarks the brief or summary */}
      <SaveToJournalSheet
        open={journalSave !== null}
        onClose={() => setJournalSave(null)}
        initialContent={journalSave?.content || ''}
        source={journalSave?.source || 'manual'}
        preferredSectionName="AI Insights"
        showToast={showToast}
      />
    </div>
  );
}

/**
 * Phase 4 — Home Deploy Cash card.
 * Always visible (this is the recurring engagement moment). Tapping opens
 * the full-screen DeployCashFlow. When the user picks an option, we dispatch
 * a window event that PortfolioTab listens for to open AddModal with the
 * recommendation pre-filled, then switch to the Portfolio tab.
 *
 * Adaptive copy: if the user has used the feature recently, the headline
 * shifts from first-timer framing to recurring framing. We detect "recent
 * use" by checking the timeline for a deploy_cash entry in the last 30 days.
 */
function DeployCashCard({ onTabSwitch, showToast }) {
  const [open, setOpen] = useState(false);
  const [hasUsedRecently, setHasUsedRecently] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Light check — once the timeline aggregator surfaces deploy_cash, this
    // returns >0 events. Until migration 015 is applied + timeline integration
    // ships (step 18), this returns 0 and we just show first-timer copy.
    const from = new Date(Date.now() - 30 * 86400000).toISOString();
    api.journal.timeline({ sources: ['deploy_cash'], dateFrom: from, limit: 1 })
      .then(d => { if (!cancelled) setHasUsedRecently((d?.events?.length ?? 0) > 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  function handlePick(opt, sessionId) {
    // Record the choice (best-effort — non-blocking)
    if (sessionId) {
      api.ai.deployCashChoice({ session_id: sessionId, option_id: opt.id }).catch(() => {});
    }
    // Hand the option + session to PortfolioTab to open AddModal pre-filled.
    window.dispatchEvent(new CustomEvent('deploy_cash_pick', { detail: { option: opt, sessionId } }));
    setOpen(false);
    onTabSwitch?.('portfolio');
  }

  function handleAgentFallback(amount, optionsShown) {
    const titles = (optionsShown || []).map(o => o.title).join('; ');
    const message = `I have $${amount} to invest. The recommendations Outpost gave me — ${titles} — didn't quite feel right because`;
    window.dispatchEvent(new CustomEvent('agent_prefill', { detail: { message } }));
    setOpen(false);
    onTabSwitch?.('agent');
  }

  const headline = hasUsedRecently
    ? 'Same question — what do you want to do with new cash this month?'
    : 'Tell Outpost what you have, get three personalized ways to put it to work.';

  return (
    <>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{
          background: 'linear-gradient(135deg, rgba(59,130,246,0.10), rgba(168,85,247,0.06))',
          border: '1px solid rgba(59,130,246,0.30)',
          borderRadius: 10,
          padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div>
            <p style={{ fontSize: 9, color: 'var(--blue)', fontWeight: 700, letterSpacing: '1.2px', marginBottom: 4 }}>
              GOT CASH TO PUT TO WORK?
            </p>
            <p style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>
              {headline}
            </p>
          </div>
          <button
            onClick={() => setOpen(true)}
            style={{
              background: 'var(--blue)', color: '#fff', border: 'none',
              borderRadius: 6, padding: '10px 16px', fontSize: 11,
              fontWeight: 700, letterSpacing: '1px', cursor: 'pointer',
              alignSelf: 'flex-start', fontFamily: 'inherit',
            }}
          >
            DEPLOY IT →
          </button>
        </div>
      </div>

      {open && (
        <DeployCashFlow
          onClose={() => setOpen(false)}
          onPickRecommendation={handlePick}
          onOpenAgent={handleAgentFallback}
          showToast={showToast}
        />
      )}
    </>
  );
}
