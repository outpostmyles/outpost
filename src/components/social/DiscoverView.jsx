import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { cachedFetch } from '../../lib/cache.js';
import { buildDiscoverFeed } from './discoverRanker.js';
import { personalizeDiscover } from './personalizeDiscover.js';

/**
 * DISCOVER — one ranked feed.
 *
 * Used to be 4 stacked sections (catalysts, sectors, bargains, trending) and
 * users said it was a wall of text they had to scan through. Now every source
 * feeds one priority-ranked column so the most actionable thing is always on
 * top. Same data, same deep-links, just merged and sorted.
 *
 * Each row: a type-colored accent bar, the ticker (or sector name), the move,
 * a type pill, a one-line read, and a tap that deep-links to that source's
 * full view via onSeeAll.
 *
 * Props:
 *   catalystData — already loaded by SocialTab (passed in to avoid double-fetch)
 *   onSeeAll(section) — switches Social to a deep-dive section
 */

// No --orange in the theme, so the catalyst accent gets a literal one. The
// rest map to existing CSS vars so they track the palette.
const ACCENT = {
  orange: '#f97316',
  amber: 'var(--amber)',
  green: 'var(--green)',
  red: 'var(--red)',
  blue: 'var(--blue)',
};
const ACCENT_DIM = {
  orange: 'rgba(249,115,22,0.15)',
  amber: 'var(--amber-dim)',
  green: 'var(--green-dim)',
  red: 'var(--red-dim)',
  blue: 'var(--blue-dim)',
};
const ACCENT_BORDER = {
  orange: 'rgba(249,115,22,0.32)',
  amber: 'rgba(245,158,11,0.3)',
  green: 'rgba(34,197,94,0.3)',
  red: 'rgba(239,68,68,0.3)',
  blue: 'rgba(59,130,246,0.3)',
};

// Generic one-word titles that just echo the type pill. No point repeating
// them as a subtitle under the ticker.
const GENERIC_TITLES = new Set(['trending', 'catalyst', 'signal']);

export default function DiscoverView({ catalystData, onSeeAll, showToast }) {
  const [sector, setSector] = useState(null);
  const [bargain, setBargain] = useState(null);
  const [buzz, setBuzz] = useState(null);
  const [held, setHeld] = useState([]);   // tickers the user owns (drop from feed)
  const [watch, setWatch] = useState([]); // tickers they watch (float to the top)

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
    // Personalization inputs: what they own (drop) and what they watch (boost).
    cachedFetch('discover_held', () => api.portfolio.value(), 5 * 60000)
      .then(d => { if (!cancelled) setHeld((d?.positions ?? []).map(p => p.ticker)); })
      .catch(() => {});
    cachedFetch('discover_watch', () => api.social.watchlist(), 5 * 60000)
      .then(d => { if (!cancelled) setWatch((d?.items ?? []).map(w => w.ticker)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const feed = personalizeDiscover(
    buildDiscoverFeed({ catalystData, sector, bargain, buzz }, 12),
    { held, watch },
  );
  const hasCatalystRow = feed.some(i => i.type === 'catalyst');

  // Catalysts run on a schedule. If a drop hasn't fired yet there's nothing to
  // show for it, which is normal not "scanning". Surface the actual schedule so
  // the user knows more is coming rather than wondering if it's broken.
  const pendingDrops = (catalystData?.drops ?? [])
    .filter(d => !d.isGenerated)
    .map(d => ({ time: d.scheduledTime, label: d.label }))
    .slice(0, 4);

  if (feed.length === 0) {
    return (
      <div style={{ paddingBottom: 24 }}>
        <EmptyFeed catalystData={catalystData} pendingDrops={pendingDrops} />
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: '14px 16px 8px' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--faint)', letterSpacing: '1.2px' }}>
          STRONGEST SIGNALS FIRST
        </span>
      </div>

      {feed.map(item => (
        <FeedRow key={item.id} item={item} onClick={() => onSeeAll(item.deepLink)} />
      ))}

      {/* If catalysts are still pending, tell the user when they land instead of
          silently dropping that source from the feed. */}
      {!hasCatalystRow && pendingDrops.length > 0 && (
        <PendingDropsHint drops={pendingDrops} />
      )}
    </div>
  );
}

// ───────────── feed row ─────────────

function FeedRow({ item, onClick }) {
  const accent = ACCENT[item.accent] || 'var(--muted)';
  const accentDim = ACCENT_DIM[item.accent] || 'var(--raised)';
  const accentBorder = ACCENT_BORDER[item.accent] || 'var(--border)';

  const headline = item.ticker || item.title;
  const subtitle = item.ticker && item.title && !GENERIC_TITLES.has(item.title.toLowerCase())
    ? item.title
    : null;

  const pctColor = item.pct >= 0 ? 'var(--green)' : 'var(--red)';
  const dropTime = item.meta?.dropTime;

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'stretch', cursor: 'pointer',
        borderTop: '1px solid var(--border)', transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {/* type-colored accent bar */}
      <div style={{ width: 3, background: accent, flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0, padding: '10px 14px' }}>
        {/* line 1: headline + move + type pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: subtitle || item.detail ? 3 : 0 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{headline}</span>
          {item.pct != null && (
            <span style={{ fontSize: 10.5, color: pctColor, fontWeight: 700 }}>
              {item.pct >= 0 ? '+' : ''}{item.pct.toFixed(1)}%
            </span>
          )}
          <span style={{
            fontSize: 8, fontWeight: 700, padding: '1.5px 5px', borderRadius: 3,
            background: accentDim, color: accent, border: `0.5px solid ${accentBorder}`,
            letterSpacing: '0.4px',
          }}>{item.signal}</span>
          {item.forYou && (
            <span style={{
              fontSize: 8, fontWeight: 700, padding: '1.5px 5px', borderRadius: 3,
              background: 'rgba(34,197,94,0.12)', color: 'var(--green)', border: '0.5px solid rgba(34,197,94,0.3)',
              letterSpacing: '0.4px',
            }}>WATCHLIST</span>
          )}
          {dropTime && (
            <span style={{ fontSize: 9, color: 'var(--faint)', marginLeft: 'auto' }}>{dropTime} ET</span>
          )}
        </div>

        {subtitle && (
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 2px 0', lineHeight: 1.4 }}>
            {subtitle}
          </p>
        )}
        {item.detail && (
          <p style={{ fontSize: 11, color: 'var(--faint)', margin: 0, lineHeight: 1.4 }}>
            {item.detail}
          </p>
        )}
      </div>

      <span style={{ color: 'var(--faint)', fontSize: 13, alignSelf: 'center', paddingRight: 12 }}>›</span>
    </div>
  );
}

// ───────────── empty + pending states ─────────────

function PendingDropsHint({ drops }) {
  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
      <p style={{ fontSize: 10.5, color: 'var(--muted)', margin: '0 0 6px 0', lineHeight: 1.5 }}>
        More catalysts land on a schedule today:
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {drops.map((d, i) => (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '4px 8px', background: 'var(--raised)',
            border: '0.5px solid var(--border)', borderRadius: 4, fontSize: 10,
          }}>
            <span style={{ color: 'var(--blue)', fontWeight: 700 }}>{d.time}</span>
            {d.label && <span style={{ color: 'var(--faint)' }}>{d.label}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function EmptyFeed({ catalystData, pendingDrops }) {
  if (catalystData?.isWeekend) {
    return (
      <Empty text="Markets are closed, so there's nothing live to surface. Discover refreshes Monday through Friday." />
    );
  }
  if (pendingDrops.length > 0) {
    return (
      <div style={{ padding: '16px' }}>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10px 0', lineHeight: 1.5 }}>
          Today's signals haven't landed yet. Outpost scans on a schedule, and the feed fills in as each one finishes.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {pendingDrops.map((d, i) => (
            <span key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '4px 8px', background: 'var(--raised)',
              border: '0.5px solid var(--border)', borderRadius: 4, fontSize: 10,
            }}>
              <span style={{ color: 'var(--blue)', fontWeight: 700 }}>{d.time}</span>
              {d.label && <span style={{ color: 'var(--faint)' }}>{d.label}</span>}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return <Empty text="Nothing strong enough to surface right now. Check back shortly." />;
}

function Empty({ text }) {
  return (
    <p style={{ fontSize: 12, color: 'var(--faint)', padding: '16px', fontStyle: 'italic', margin: 0, lineHeight: 1.5 }}>
      {text}
    </p>
  );
}
