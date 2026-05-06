import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { cachedFetch } from '../../lib/cache.js';

/**
 * DISCOVER — condensed top-of-Social view that surfaces 2-3 items from each
 * source (catalysts, sectors, bargains, trending). Each section has a
 * "See all →" link that opens the full deep-dive view inside the same tab.
 *
 * No new backend — pulls from the same APIs the deep-dives use, just trims
 * to the highest-signal items per category. Cached aggressively client-side.
 *
 * Props:
 *   catalystData — already loaded by SocialTab (passed in to avoid double-fetch)
 *   onSeeAll(section) — callback that switches Social to a deep-dive section
 */
export default function DiscoverView({ catalystData, onSeeAll, showToast }) {
  const [sector, setSector] = useState(null);
  const [bargain, setBargain] = useState(null);
  const [buzz, setBuzz] = useState(null);

  useEffect(() => {
    let cancelled = false;
    cachedFetch('discover_sector', () => api.ai.sectorRadar(), 15 * 60000)
      .then(d => { if (!cancelled) setSector(d); })
      .catch(() => {});
    cachedFetch('discover_bargain', () => api.ai.bargainRadar(), 30 * 60000)
      .then(d => { if (!cancelled) setBargain(d); })
      .catch(() => {});
    cachedFetch('discover_buzz', () => api.social.buzz(), 10 * 60000)
      .then(d => { if (!cancelled) setBuzz(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Top catalysts — flatten generated drops, pick the 3 most impactful.
  // Catalysts run on a schedule (premarket / mid-day / close) — if a drop
  // hasn't fired yet there's nothing to show, which is normal not "scanning".
  const topCatalysts = (() => {
    if (!catalystData?.drops) return [];
    const all = [];
    for (const drop of catalystData.drops) {
      for (const stock of (drop.stocks ?? [])) {
        all.push({ ...stock, dropTime: drop.scheduledTime, dropLabel: drop.label });
      }
    }
    return all
      .filter(c => c.changePct != null)
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, 3);
  })();

  // Pending drops we haven't reached yet — used in the empty/early-day state
  // so the user sees the actual schedule instead of misleading "scanning..."
  const pendingDrops = (catalystData?.drops ?? [])
    .filter(d => !d.isGenerated)
    .map(d => ({ time: d.scheduledTime, label: d.label }))
    .slice(0, 4);

  const heating = (sector?.heating ?? []).slice(0, 1);
  const cooling = (sector?.cooling ?? []).slice(0, 1);
  // The /api/ai/bargain-radar endpoint returns `picks` (already pre-filtered
  // server-side to buyable candidates). No client-side verdict filter needed.
  const buyables = (bargain?.picks ?? []).slice(0, 2);
  // Buzz scanner returns `buzzing` (active) + `earlierToday`. Show top 5 active.
  const trending = (buzz?.buzzing ?? []).slice(0, 5);

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* TOP CATALYSTS */}
      <Section title="TOP CATALYSTS" onSeeAll={() => onSeeAll('ondeck')} hasContent={topCatalysts.length > 0}>
        {topCatalysts.length === 0 ? (
          catalystData?.isWeekend ? (
            <Empty text="Markets closed — no live catalysts. Catalyst Watch runs Monday through Friday." />
          ) : pendingDrops.length > 0 ? (
            <div style={{ padding: '8px 16px 12px' }}>
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 6px 0', lineHeight: 1.5 }}>
                Today's catalysts haven't dropped yet. Outpost runs scans on a schedule — first one populates here as soon as it's done.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {pendingDrops.map((d, i) => (
                  <span
                    key={i}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '4px 8px', background: 'var(--raised)',
                      border: '0.5px solid var(--border)', borderRadius: 4,
                      fontSize: 10,
                    }}
                  >
                    <span style={{ color: 'var(--blue)', fontWeight: 700 }}>{d.time}</span>
                    {d.label && <span style={{ color: 'var(--faint)' }}>{d.label}</span>}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <Empty text="No catalysts to surface today. Try again tomorrow." />
          )
        ) : (
          topCatalysts.map((c, i) => (
            <Row key={`cat-${c.ticker}-${i}`} onClick={() => onSeeAll('ondeck')}>
              <RowHeader
                ticker={c.ticker}
                changePct={c.changePct}
                tag={(c.catalystLabel || 'catalyst').toLowerCase()}
                dropTime={c.dropTime}
              />
              <RowDetail text={c.detail || c.newsSource || `Big move on ${c.ticker} today.`} />
            </Row>
          ))
        )}
      </Section>

      {/* HOT SECTORS */}
      <Section title="HOT SECTORS" onSeeAll={() => onSeeAll('radar')} hasContent={heating.length + cooling.length > 0}>
        {heating.length === 0 && cooling.length === 0 ? (
          <Empty text="Sector radar still warming up. Check back shortly." />
        ) : (
          <>
            {heating.map((s, i) => (
              <Row key={`heat-${i}`} onClick={() => onSeeAll('radar')}>
                <SectorRowHeader name={s.name} ticker={s.ticker} signal={s.signal} direction="up" relStrength={s.relativeStrength} />
                <RowDetail text={s.thesis} />
              </Row>
            ))}
            {cooling.map((s, i) => (
              <Row key={`cool-${i}`} onClick={() => onSeeAll('radar')}>
                <SectorRowHeader name={s.name} ticker={s.ticker} signal={s.signal} direction="down" relStrength={s.relativeStrength} />
                <RowDetail text={s.thesis} />
              </Row>
            ))}
          </>
        )}
      </Section>

      {/* BARGAIN PICKS */}
      <Section title="BARGAIN PICKS" onSeeAll={() => onSeeAll('bargain')} hasContent={buyables.length > 0}>
        {buyables.length === 0 ? (
          <Empty text="No buyable dips in today's scan. Comes back overnight." />
        ) : (
          buyables.map((b, i) => (
            <Row key={`bargain-${i}`} onClick={() => onSeeAll('bargain')}>
              <BargainRowHeader ticker={b.ticker} drawdown={b.pctOffHigh != null ? -b.pctOffHigh : null} />
              <RowDetail text={b.thesis} />
            </Row>
          ))
        )}
      </Section>

      {/* TRENDING — compact chip footer, not a primary surface */}
      <Section title="TRENDING" onSeeAll={() => onSeeAll('buzz')} hasContent={trending.length > 0}>
        {trending.length === 0 ? (
          <Empty text="Buzz scanner refreshing." />
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 16px 12px' }}>
            {trending.map(t => (
              <span
                key={t.ticker}
                onClick={() => onSeeAll('buzz')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 8px', background: 'var(--raised)',
                  border: '0.5px solid var(--border)', borderRadius: 4,
                  fontSize: 10, cursor: 'pointer',
                }}
              >
                <b style={{ fontWeight: 700, color: 'var(--text)' }}>{t.ticker}</b>
                {t.changePct != null && (
                  <>
                    <span style={{ color: 'var(--faint)' }}>·</span>
                    <span style={{ color: t.changePct >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>
                      {t.changePct >= 0 ? '+' : ''}{t.changePct.toFixed(1)}%
                    </span>
                  </>
                )}
                {t.watchlistCount != null && (
                  <>
                    <span style={{ color: 'var(--faint)' }}>·</span>
                    <span style={{ color: 'var(--muted)' }}>{t.watchlistCount.toLocaleString()} watchers</span>
                  </>
                )}
              </span>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ───────────── helpers ─────────────

function Section({ title, onSeeAll, hasContent, children }) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div style={{ padding: '14px 16px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--faint)', letterSpacing: '1.2px' }}>{title}</span>
        {hasContent && (
          <button
            onClick={onSeeAll}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 9, fontFamily: 'inherit', letterSpacing: '0.3px' }}
          >
            See all →
          </button>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ onClick, children }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'flex-start', padding: '9px 16px',
        gap: 10, cursor: 'pointer',
        borderTop: '1px solid var(--border)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <span style={{ color: 'var(--faint)', fontSize: 13 }}>›</span>
    </div>
  );
}

function RowHeader({ ticker, changePct, tag, dropTime }) {
  const color = changePct >= 0 ? 'var(--green)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{ticker}</span>
      {changePct != null && (
        <span style={{ fontSize: 10, color, fontWeight: 700 }}>
          {changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%
        </span>
      )}
      {tag && <span style={{ fontSize: 9, color: 'var(--faint)' }}>{tag}</span>}
      {dropTime && (
        <span style={{ fontSize: 9, color: 'var(--faint)', marginLeft: 'auto' }}>
          {dropTime} ET
        </span>
      )}
    </div>
  );
}

function SectorRowHeader({ name, ticker, signal, direction, relStrength }) {
  const color = direction === 'up' ? 'var(--green)' : 'var(--red)';
  const signalLabel = signal?.toUpperCase() || 'SIGNAL';
  const bg = direction === 'up' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
  const border = direction === 'up' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{name || ticker}</span>
      {relStrength != null && (
        <span style={{ fontSize: 10, color, fontWeight: 700 }}>
          {relStrength >= 0 ? '+' : ''}{relStrength.toFixed(1)}%
        </span>
      )}
      <span style={{
        fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
        background: bg, color, border: `0.5px solid ${border}`, letterSpacing: '0.4px',
      }}>{signalLabel}</span>
    </div>
  );
}

function BargainRowHeader({ ticker, drawdown }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{ticker}</span>
      {drawdown != null && (
        <span style={{ fontSize: 10, color: 'var(--red)', fontWeight: 700 }}>
          {drawdown >= 0 ? '+' : ''}{drawdown.toFixed(0)}%
        </span>
      )}
      <span style={{
        fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
        background: 'rgba(34,197,94,0.15)', color: 'var(--green)',
        border: '0.5px solid rgba(34,197,94,0.3)', letterSpacing: '0.4px',
      }}>BUYABLE</span>
    </div>
  );
}

function RowDetail({ text }) {
  if (!text) return null;
  return <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0, lineHeight: 1.4 }}>{text}</p>;
}

function Empty({ text }) {
  return (
    <p style={{ fontSize: 11, color: 'var(--faint)', padding: '8px 16px 12px', fontStyle: 'italic', margin: 0 }}>
      {text}
    </p>
  );
}
