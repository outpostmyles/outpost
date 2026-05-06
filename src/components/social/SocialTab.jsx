import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../lib/api.js';
import { cachedFetch, clearCachePrefix } from '../../lib/cache.js';
import { fmt } from '../../utils/market.js';
import { TickerIcon, EmptyState, Spinner, DisclaimerBadge } from '../shared/UI.jsx';
import SaveToJournalSheet, { BookmarkButton } from '../journal/SaveToJournalSheet.jsx';
import BargainRadarCard from '../home/BargainRadarCard.jsx';
import DiscoverView from './DiscoverView.jsx';

// ============ FLAME RATING ============
function FlameRating({ rating }) {
  const flames = Math.min(3, Math.max(1, rating || 1));
  return (
    <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }} title={`Catalyst strength: ${flames}/3`}>
      {Array.from({ length: 3 }, (_, i) => (
        <svg key={i} width="12" height="14" viewBox="0 0 12 14" fill={i < flames ? '#f97316' : 'none'} stroke={i < flames ? '#f97316' : 'var(--border)'} strokeWidth="1.2">
          <path d="M6 1C6 1 2 5 2 8.5C2 11 3.8 13 6 13C8.2 13 10 11 10 8.5C10 5 6 1 6 1Z"/>
        </svg>
      ))}
    </span>
  );
}

// ============ CATALYST STOCK CARD ============
function CatalystCard({ stock, onWatch, showToast }) {
  const [adding, setAdding] = useState(false);
  const [watching, setWatching] = useState(false);
  const [journalSave, setJournalSave] = useState(null);

  async function handleWatch() {
    if (watching) return;
    setAdding(true);
    try {
      await onWatch(stock.ticker, stock.ticker);
      setWatching(true);
      showToast(`${stock.ticker} added to watchlist`, 'success');
    } catch (e) { showToast(e.error || 'Failed to add', 'error'); }
    setAdding(false);
  }

  const changeColor = (stock.changePct ?? 0) >= 0 ? 'var(--green)' : 'var(--red)';
  const changeStr = stock.changePct != null && !isNaN(stock.changePct) ? `${stock.changePct >= 0 ? '+' : ''}${stock.changePct.toFixed(2)}%` : '';

  // Catalyst label colors
  const labelColors = {
    'EARNINGS': '#f59e0b',
    'REPORTS TODAY': '#f59e0b',
    'REPORTS TONIGHT': '#f97316',
    'REPORTS TOMORROW': '#8b5cf6',
    'ANALYST UPGRADE': '#22c55e',
    'ANALYST DOWNGRADE': '#ef4444',
    'BREAKING NEWS': '#3b82f6',
  };
  const labelColor = labelColors[stock.catalystLabel] || 'var(--blue)';

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 13px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <TickerIcon ticker={stock.ticker} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.3px' }}>{stock.ticker}</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: labelColor, background: `${labelColor}18`, padding: '1px 5px', borderRadius: 3, letterSpacing: '0.5px' }}>
              {stock.catalystLabel}
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 60 }}>
          {stock.price && <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>${stock.price.toFixed(2)}</p>}
          {changeStr && <p style={{ fontSize: 11, fontWeight: 700, color: changeColor }}>{changeStr}</p>}
        </div>
      </div>

      {/* Catalyst detail / WHY */}
      <div style={{ padding: '7px 9px', background: 'var(--raised)', borderRadius: 5, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
          <FlameRating rating={stock.flameRating} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {stock.volume && (
              <span style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.3px' }}>
                VOL {(stock.volume / 1000000).toFixed(1)}M
              </span>
            )}
            <BookmarkButton
              onClick={() => setJournalSave({
                content: `${stock.ticker} — ${stock.catalystLabel}\n\n${stock.detail}${stock.newsSource ? `\n\nSource: ${stock.newsSource}` : ''}${stock.analystAction ? `\n\n${stock.analystAction}` : ''}`,
              })}
            />
          </div>
        </div>
        <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
          {stock.detail}
          {stock.newsSource && <span style={{ color: 'var(--faint)', fontSize: 9 }}> — {stock.newsSource}</span>}
        </p>
        {stock.analystAction && (
          <p style={{ fontSize: 9, color: 'var(--green)', marginTop: 3 }}>{stock.analystAction}</p>
        )}
      </div>

      <button onClick={handleWatch} disabled={adding || watching}
        className={`btn ${watching ? 'btn-muted' : 'btn-blue'}`}
        style={{ width: '100%', opacity: watching ? 0.6 : 1 }}>
        {watching ? 'WATCHING' : adding ? '...' : 'WATCH'}
      </button>

      <SaveToJournalSheet
        open={journalSave !== null}
        onClose={() => setJournalSave(null)}
        initialContent={journalSave?.content || ''}
        showToast={showToast}
      />
    </div>
  );
}

// ============ CATALYST DROP SECTION ============
function CatalystDrop({ drop, onWatch, showToast }) {
  const hasStocks = drop.stocks?.length > 0;
  const isPending = !drop.isActive;
  const isActiveNoData = drop.isActive && !drop.isGenerated;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Drop header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: hasStocks ? 'var(--green)' : isPending ? 'var(--border)' : 'var(--amber)',
        }} />
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: isPending ? 'var(--faint)' : 'var(--text)', letterSpacing: '0.3px' }}>
            {drop.label}
          </p>
          <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.3px' }}>
            {drop.scheduledTime} ET
            {drop.generatedAtET && ` · Generated ${drop.generatedAtET}`}
          </p>
        </div>
        {isPending && (
          <span style={{ fontSize: 9, color: 'var(--faint)', fontWeight: 600, letterSpacing: '0.5px' }}>UPCOMING</span>
        )}
        {drop.dataQuality === 'partial' && (
          <span style={{ fontSize: 8, color: 'var(--amber)', fontWeight: 600, letterSpacing: '0.3px', padding: '2px 5px', background: 'var(--amber)12', borderRadius: 3 }}>LIMITED DATA</span>
        )}
        {drop.dataQuality === 'degraded' && (
          <span style={{ fontSize: 8, color: 'var(--red)', fontWeight: 600, letterSpacing: '0.3px', padding: '2px 5px', background: 'var(--red)12', borderRadius: 3 }}>DATA ISSUE</span>
        )}
      </div>

      {/* Stocks */}
      {hasStocks && drop.stocks.map(stock => (
        <CatalystCard key={stock.ticker} stock={stock} onWatch={onWatch} showToast={showToast} />
      ))}

      {isActiveNoData && (
        <div style={{ padding: '12px 13px', background: 'var(--raised)', borderRadius: 8, border: '1px dashed var(--border)' }}>
          <p style={{ fontSize: 10, color: 'var(--faint)', textAlign: 'center' }}>
            No catalyst data for this window yet. Generating...
          </p>
        </div>
      )}

      {isPending && (
        <div style={{ padding: '12px 13px', background: 'var(--raised)', borderRadius: 8, border: '1px dashed var(--border)' }}>
          <p style={{ fontSize: 10, color: 'var(--faint)', textAlign: 'center' }}>
            Drops at {drop.scheduledTime} ET
          </p>
        </div>
      )}
    </div>
  );
}

// ============ RECAP CARD ============
function RecapCard({ stock }) {
  const changeColor = (stock.dayChange ?? 0) >= 0 ? 'var(--green)' : 'var(--red)';
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 13px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
      <TickerIcon ticker={stock.ticker} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{stock.ticker}</span>
          <span style={{ fontSize: 8, color: 'var(--faint)', letterSpacing: '0.3px' }}>{stock.dropLabel}</span>
        </div>
        <p style={{ fontSize: 9, color: 'var(--faint)', marginTop: 1 }}>
          {stock.catalystLabel} · Called at {stock.dropTime}
        </p>
      </div>
      <div style={{ textAlign: 'right', minWidth: 55 }}>
        {stock.currentPrice && <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>${stock.currentPrice.toFixed(2)}</p>}
        {stock.dayChange != null && (
          <p style={{ fontSize: 11, fontWeight: 700, color: changeColor }}>
            {stock.dayChange >= 0 ? '+' : ''}{stock.dayChange.toFixed(2)}%
          </p>
        )}
      </div>
    </div>
  );
}

// ============ BUZZING STOCK CARD ============
function BuzzCard({ stock, onWatch, showToast }) {
  const [adding, setAdding] = useState(false);
  const [watching, setWatching] = useState(stock.inWatchlist);

  async function handleWatch() {
    if (watching) return;
    setAdding(true);
    try {
      await onWatch(stock.ticker, stock.name);
      setWatching(true);
      showToast(`${stock.ticker} added to watchlist`, 'success');
    } catch (e) { showToast(e.error || 'Failed to add', 'error'); }
    setAdding(false);
  }

  const changeColor = (stock.changePct ?? 0) >= 0 ? 'var(--green)' : 'var(--red)';
  const changeStr = stock.changePct != null && !isNaN(stock.changePct) ? `${stock.changePct >= 0 ? '+' : ''}${stock.changePct.toFixed(2)}%` : '';

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 13px', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <TickerIcon ticker={stock.ticker} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.3px' }}>{stock.ticker}</span>
            {stock.type === 'largecap' && <span className="badge badge-blue" style={{ fontSize: 8 }}>LARGE CAP</span>}
            {stock.inPortfolio && <span className="badge badge-blue" style={{ fontSize: 8 }}>IN PORT</span>}
          </div>
          {stock.name && <p style={{ fontSize: 10, color: 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stock.name}</p>}
        </div>
        <div style={{ textAlign: 'right', minWidth: 70 }}>
          {stock.price && <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>${stock.price.toFixed(2)}</p>}
          {changeStr && <p style={{ fontSize: 11, fontWeight: 700, color: changeColor }}>{changeStr}</p>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px' }}>
          {stock.watchlistCount?.toLocaleString()} WATCHERS
        </span>
        <span style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px' }}>·</span>
        <span style={{ fontSize: 9, color: 'var(--blue)', letterSpacing: '0.5px', fontWeight: 600 }}>
          FLAGGED {stock.flaggedAt}
        </span>
        {stock.volume > 0 && (
          <>
            <span style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px' }}>·</span>
            <span style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px' }}>
              VOL {(stock.volume / 1000000).toFixed(1)}M
            </span>
          </>
        )}
      </div>

      {/* WHY — news headline or data-driven reason */}
      {stock.reason && (
        <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 8, padding: '6px 8px', background: 'var(--raised)', borderRadius: 4 }}>
          {stock.reason}
          {stock.reasonSource && <span style={{ color: 'var(--faint)', fontSize: 9 }}> — {stock.reasonSource}</span>}
        </p>
      )}

      <div style={{ display: 'flex', gap: 7 }}>
        <button onClick={handleWatch} disabled={adding || watching} className={`btn ${watching ? 'btn-muted' : 'btn-blue'}`} style={{ flex: 2, opacity: watching ? 0.6 : 1 }}>
          {watching ? 'WATCHING' : adding ? '...' : 'WATCH'}
        </button>
        <a href={`https://stocktwits.com/symbol/${stock.ticker}`} target="_blank" rel="noopener noreferrer"
          className="btn btn-muted" style={{ flex: 1, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          title="View on StockTwits">
          STOCKTWITS
        </a>
      </div>
    </div>
  );
}

// ============ EARLIER TODAY CARD (compact) ============
function EarlierCard({ stock, onWatch, showToast }) {
  const [adding, setAdding] = useState(false);
  const [watching, setWatching] = useState(stock.inWatchlist);

  async function handleWatch() {
    if (watching) return;
    setAdding(true);
    try {
      await onWatch(stock.ticker, stock.name);
      setWatching(true);
      showToast(`${stock.ticker} added to watchlist`, 'success');
    } catch (e) { showToast(e.error || 'Failed to add', 'error'); }
    setAdding(false);
  }

  const changePct = stock.currentChangePct ?? stock.changePct ?? 0;
  const changeColor = changePct >= 0 ? 'var(--green)' : 'var(--red)';

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 13px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
      <TickerIcon ticker={stock.ticker} size={28} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{stock.ticker}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: changeColor }}>
            {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
          </span>
        </div>
        <p style={{ fontSize: 9, color: 'var(--faint)', marginTop: 1 }}>
          Flagged {stock.flaggedAt}{stock.droppedAt ? ` · Dropped ${stock.droppedAt}` : ''}
        </p>
      </div>
      <button onClick={handleWatch} disabled={adding || watching} className={`btn ${watching ? 'btn-muted' : 'btn-blue'}`} style={{ fontSize: 9, padding: '5px 10px', opacity: watching ? 0.6 : 1 }}>
        {watching ? '✓' : 'WATCH'}
      </button>
    </div>
  );
}

// ============ WATCHLIST CARD ============
function WatchlistCard({ item, onRemove, onEdit, showToast }) {
  const [removing, setRemoving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(item.notes || '');
  const [alertPrice, setAlertPrice] = useState(item.alert_price || '');
  const [saving, setSaving] = useState(false);

  async function handleRemove() {
    if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 3000); return; }
    setRemoving(true);
    try { await onRemove(item.id); showToast(`${item.ticker} removed`, 'success'); }
    catch { showToast('Failed to remove', 'error'); setRemoving(false); }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onEdit(item.id, { notes: notes.trim(), alertPrice: alertPrice ? parseFloat(alertPrice) : null });
      showToast('Updated', 'success');
      setEditing(false);
    } catch { showToast('Failed to save', 'error'); }
    setSaving(false);
  }

  const hasAlert = item.alert_price && item.last_price;
  const alertHit = hasAlert && item.last_price >= item.alert_price;
  // Distance to alert as a percent of current — positive means alert is above current.
  const alertDistPct = hasAlert && item.last_price > 0
    ? ((item.alert_price - item.last_price) / item.last_price) * 100
    : null;
  // "Approaching" — within 10% but not yet hit. Tells the user to look without spamming.
  const alertNear = !alertHit && alertDistPct != null && alertDistPct > 0 && alertDistPct <= 10;

  return (
    <div style={{ background: 'var(--surface)', border: `1px solid ${alertHit ? 'var(--green)' : alertNear ? 'var(--amber)' : 'var(--border)'}`, borderRadius: 8, padding: '10px 13px', marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <TickerIcon ticker={item.ticker} size={30} />
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 1 }}>{item.ticker}</p>
          {item.last_price && (
            <p style={{ fontSize: 11, color: 'var(--muted)' }}>
              ${item.last_price?.toFixed(2)}
              {item.change_percent != null && (
                <span style={{ color: item.change_percent >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 700, marginLeft: 6 }}>
                  {item.change_percent >= 0 ? '+' : ''}{item.change_percent?.toFixed(2)}%
                </span>
              )}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={() => setEditing(!editing)} className="btn btn-muted" style={{ fontSize: 9, padding: '5px 8px' }}>
            {editing ? 'CANCEL' : 'EDIT'}
          </button>
          <button onClick={handleRemove} disabled={removing} className={`btn ${confirm ? 'btn-red' : 'btn-muted'}`} style={{ fontSize: 9, padding: '5px 8px' }}>
            {confirm ? 'CONFIRM' : '×'}
          </button>
        </div>
      </div>

      {/* Notes & alert display (when not editing) */}
      {!editing && (item.notes || item.alert_price) && (
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
          {item.notes && (
            <p style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.4, marginBottom: item.alert_price ? 4 : 0 }}>{item.notes}</p>
          )}
          {item.alert_price && (
            <p style={{ fontSize: 9, color: alertHit ? 'var(--green)' : alertNear ? 'var(--amber)' : 'var(--faint)', fontWeight: 600, letterSpacing: '0.3px' }}>
              {alertHit ? '● ' : alertNear ? '◐ ' : ''}ALERT @ ${item.alert_price.toFixed(2)}
              {alertHit && ' — TARGET HIT'}
              {alertNear && ` — ${alertDistPct.toFixed(1)}% AWAY`}
            </p>
          )}
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Add notes (thesis, reason for watching...)"
            maxLength={500}
            style={{
              width: '100%', background: 'var(--raised)', border: '1px solid var(--border)',
              borderRadius: 5, padding: '7px 9px', fontSize: 11, color: 'var(--text)',
              fontFamily: 'inherit', resize: 'vertical', minHeight: 48, maxHeight: 120,
              outline: 'none', boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 9, color: 'var(--faint)', whiteSpace: 'nowrap' }}>PRICE ALERT $</span>
            <input
              type="number" value={alertPrice} onChange={e => setAlertPrice(e.target.value)}
              placeholder="0.00" step="0.01" min="0"
              style={{
                flex: 1, background: 'var(--raised)', border: '1px solid var(--border)',
                borderRadius: 4, padding: '5px 8px', fontSize: 11, color: 'var(--text)',
                fontFamily: 'inherit', outline: 'none', maxWidth: 100,
              }}
            />
            <button onClick={handleSave} disabled={saving} className="btn btn-blue" style={{ fontSize: 9, padding: '5px 12px', marginLeft: 'auto' }}>
              {saving ? '...' : 'SAVE'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ SECTOR RADAR FULL VIEW ============
function RadarView({ showToast }) {
  const [radar, setRadar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sectorView, setSectorView] = useState('all'); // 'all', 'sectors', 'themes'

  const loadRadar = useCallback(async (force = false) => {
    setLoading(true);
    try {
      if (force) clearCachePrefix('radar_');
      const d = await cachedFetch('radar_full', () => api.ai.sectorRadar(force ? { force: true } : undefined), 15 * 60000);
      setRadar(d);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { loadRadar(); }, [loadRadar]);

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

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>;

  const sectors = (radar?.sectors ?? []).filter(s => !s.isTheme);
  const themes = (radar?.sectors ?? []).filter(s => s.isTheme);
  const displaySectors = sectorView === 'themes' ? themes : sectorView === 'sectors' ? sectors : (radar?.sectors ?? []);

  // Sort by relative strength
  const sorted = [...displaySectors].sort((a, b) => b.relativeStrength - a.relativeStrength);

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '10px 16px 6px' }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.8px', marginBottom: 4 }}>SECTOR & THEME ROTATION TRACKER</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.3px' }}>
            SPY {radar?.spyChange != null ? `${radar.spyChange >= 0 ? '+' : ''}${radar.spyChange.toFixed(2)}%` : '—'}
            {radar?.generatedAt && ` · Updated ${new Date(radar.generatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`}
          </span>
          <button onClick={() => loadRadar(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 9, fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.5px' }}>
            REFRESH
          </button>
        </div>

        {/* Filter pills */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {[
            { key: 'all', label: 'ALL' },
            { key: 'sectors', label: 'SECTORS' },
            { key: 'themes', label: 'THEMES' },
          ].map(f => (
            <button key={f.key} onClick={() => setSectorView(f.key)}
              style={{
                background: sectorView === f.key ? 'var(--blue)' : 'var(--raised)',
                color: sectorView === f.key ? '#fff' : 'var(--faint)',
                border: `1px solid ${sectorView === f.key ? 'var(--blue)' : 'var(--border)'}`,
                borderRadius: 4, padding: '4px 10px', fontSize: 9, fontWeight: 700,
                letterSpacing: '0.5px', cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* AI Signals — Heating / Cooling / Theme Watch */}
      {(radar?.heating?.length > 0 || radar?.cooling?.length > 0 || radar?.themeWatch) && (
        <div style={{ padding: '0 16px 12px' }}>
          {/* Heating up */}
          {(radar.heating ?? []).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 9, color: 'var(--green)', letterSpacing: '1px', fontWeight: 700, marginBottom: 6 }}>MONEY FLOWING IN</p>
              {radar.heating.map(s => (
                <div key={s.ticker} style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.12)', borderRadius: 8, padding: '10px 13px', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{s.ticker}</span>
                      <span style={{ fontSize: 10, color: 'var(--faint)' }}>{s.name}</span>
                    </div>
                    <span style={{ fontSize: 8, fontWeight: 700, color: signalColor(s.signal), letterSpacing: '0.5px', padding: '2px 6px', background: `${signalColor(s.signal)}15`, borderRadius: 3 }}>{signalLabel(s.signal)}</span>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>{s.thesis}</p>
                  {s.relativeStrength != null && (
                    <p style={{ fontSize: 9, color: 'var(--green)', marginTop: 4, fontWeight: 600 }}>{s.relativeStrength >= 0 ? '+' : ''}{typeof s.relativeStrength === 'number' ? s.relativeStrength.toFixed(1) : s.relativeStrength}% vs SPY</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Cooling down */}
          {(radar.cooling ?? []).length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 9, color: 'var(--red)', letterSpacing: '1px', fontWeight: 700, marginBottom: 6 }}>MONEY FLOWING OUT</p>
              {radar.cooling.map(s => (
                <div key={s.ticker} style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.12)', borderRadius: 8, padding: '10px 13px', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{s.ticker}</span>
                      <span style={{ fontSize: 10, color: 'var(--faint)' }}>{s.name}</span>
                    </div>
                    <span style={{ fontSize: 8, fontWeight: 700, color: signalColor(s.signal), letterSpacing: '0.5px', padding: '2px 6px', background: `${signalColor(s.signal)}15`, borderRadius: 3 }}>{signalLabel(s.signal)}</span>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>{s.thesis}</p>
                  {s.relativeStrength != null && (
                    <p style={{ fontSize: 9, color: 'var(--red)', marginTop: 4, fontWeight: 600 }}>{s.relativeStrength >= 0 ? '+' : ''}{typeof s.relativeStrength === 'number' ? s.relativeStrength.toFixed(1) : s.relativeStrength}% vs SPY</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Theme Watch */}
          {radar.themeWatch && (
            <div style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.12)', borderRadius: 8, padding: '10px 13px', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--amber)', letterSpacing: '0.8px' }}>EMERGING THEME</span>
                {radar.themeWatch.ticker && <span style={{ fontSize: 10, color: 'var(--faint)' }}>{radar.themeWatch.ticker}</span>}
              </div>
              <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                <b style={{ color: 'var(--text)' }}>{radar.themeWatch.name}:</b> {radar.themeWatch.thesis}
              </p>
            </div>
          )}

          {/* News clusters */}
          {(radar.newsClusters ?? []).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700, marginBottom: 6 }}>NEWS CLUSTERING</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {radar.newsClusters.map(c => (
                  <div key={c.ticker} style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 5, padding: '5px 9px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)' }}>{c.ticker}</span>
                    <span style={{ fontSize: 9, color: 'var(--faint)', marginLeft: 5 }}>{c.count} mentions</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Full sector heatmap table */}
      <div style={{ padding: '0 16px 24px' }}>
        <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', fontWeight: 700, marginBottom: 8 }}>
          {sectorView === 'themes' ? 'THEME ETFS' : sectorView === 'sectors' ? 'SECTOR ETFS' : 'ALL ETFS'} — RELATIVE STRENGTH
        </p>
        <div style={{ background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {sorted.map((s, i) => {
            const barWidth = Math.min(100, Math.abs(s.relativeStrength) * 10);
            const isPositive = s.relativeStrength >= 0;
            const barColor = isPositive ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)';
            const textColor = isPositive ? 'var(--green)' : 'var(--red)';

            return (
              <div key={s.ticker} style={{
                display: 'flex', alignItems: 'center', padding: '8px 13px', gap: 10,
                borderBottom: i < sorted.length - 1 ? '1px solid var(--border)' : 'none',
                position: 'relative', overflow: 'hidden',
              }}>
                {/* Background bar showing relative strength */}
                <div style={{
                  position: 'absolute', top: 0, bottom: 0,
                  [isPositive ? 'left' : 'right']: 0,
                  width: `${barWidth}%`, background: barColor, transition: 'width 0.3s',
                }} />
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                  <div style={{ minWidth: 42 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.2px' }}>{s.ticker}</p>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 10, color: 'var(--faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.name}
                      {s.isTheme && <span style={{ color: 'var(--amber)', marginLeft: 4, fontSize: 8 }}>THEME</span>}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 55, flexShrink: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: s.change >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {s.change >= 0 ? '+' : ''}{s.change.toFixed(2)}%
                    </p>
                    <p style={{ fontSize: 9, color: textColor, fontWeight: 600 }}>
                      {isPositive ? '+' : ''}{s.relativeStrength.toFixed(1)} vs SPY
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <DisclaimerBadge />
      </div>
    </div>
  );
}

// ============ MAIN SOCIAL TAB ============
export default function SocialTab({ showToast }) {
  const [buzzData, setBuzzData] = useState(null);
  const [catalystData, setCatalystData] = useState(null);
  const [watchlist, setWatchlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [catalystLoading, setCatalystLoading] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  // Internal sections still work — DISCOVER is the new default. The deep
  // sections ('ondeck', 'radar', 'bargain', 'buzz') are reachable via the
  // "See all →" links inside DiscoverView. They render with a "← Discover"
  // back-link when accessed that way.
  const [activeSection, setActiveSection] = useState('discover');
  const [countdown, setCountdown] = useState(30);
  const timerRef = useRef(null);

  const loadBuzz = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.social.buzz();
      setBuzzData(d);
      setCountdown(d.nextScanIn ?? 30);
    } catch {}
    setLoading(false);
  }, []);

  const loadCatalyst = useCallback(async () => {
    setCatalystLoading(true);
    try {
      const d = await api.social.catalyst();
      setCatalystData(d);
    } catch {}
    setCatalystLoading(false);
  }, []);

  const loadWatchlist = useCallback(async () => {
    setWatchlistLoading(true);
    try { const d = await api.social.watchlist(); setWatchlist(d.items ?? []); } catch {}
    setWatchlistLoading(false);
  }, []);

  useEffect(() => {
    loadBuzz();
    loadCatalyst();
    loadWatchlist();
  }, []);

  // Countdown timer for buzz scanner
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          loadBuzz();
          return 30;
        }
        return c - 1;
      });
    }, 60000);
    return () => clearInterval(timerRef.current);
  }, [loadBuzz]);

  // Refresh catalyst data every 5 minutes
  useEffect(() => {
    const catalystTimer = setInterval(loadCatalyst, 5 * 60000);
    return () => clearInterval(catalystTimer);
  }, [loadCatalyst]);

  async function addWatch(ticker, name) {
    await api.social.addToWatchlist({ ticker, companyName: name || ticker });
    await loadWatchlist();
  }

  async function removeWatch(id) {
    await api.social.removeFromWatchlist(id);
    setWatchlist(w => w.filter(i => i.id !== id));
  }

  async function editWatch(id, updates) {
    await api.social.editWatchlistItem(id, updates);
    setWatchlist(w => w.map(i => i.id === id ? { ...i, notes: updates.notes ?? i.notes, alert_price: updates.alertPrice ?? i.alert_price } : i));
  }

  const buzzing = buzzData?.buzzing ?? [];
  const earlier = buzzData?.earlierToday ?? [];
  const drops = catalystData?.drops ?? [];
  const recap = catalystData?.recap ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Tab bar */}
      <div className="tab-bar">
        {/* Top-level tabs collapsed from 5 to 2. Deep-dive sections still
            exist internally — reachable from DiscoverView's "See all →" links. */}
        {[
          { key: 'discover', label: 'DISCOVER' },
          { key: 'watchlist', label: 'WATCHLIST' },
        ].map(t => {
          // Highlight DISCOVER when any deep-dive section is active too —
          // they're conceptually under it.
          const isActive = t.key === 'discover'
            ? ['discover', 'ondeck', 'radar', 'bargain', 'buzz'].includes(activeSection)
            : activeSection === t.key;
          return (
            <button key={t.key} onClick={() => setActiveSection(t.key)}
              className={`tab-btn ${isActive ? 'tab-btn-active' : ''}`}>
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="scrollable" style={{ flex: 1 }}>

        {/* ============ DISCOVER (default) ============ */}
        {activeSection === 'discover' && (
          <DiscoverView
            catalystData={catalystData}
            onSeeAll={(section) => setActiveSection(section)}
            showToast={showToast}
          />
        )}

        {/* Back-to-Discover affordance — shows on every deep-dive section */}
        {['ondeck', 'radar', 'bargain', 'buzz'].includes(activeSection) && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => setActiveSection('discover')}
              style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: 10, fontFamily: 'inherit', letterSpacing: '0.4px', padding: 0 }}
            >
              ← Discover
            </button>
          </div>
        )}

        {/* ============ ON DECK (Catalyst Watch) ============ */}
        {activeSection === 'ondeck' && (
          <div>
            <div style={{ padding: '10px 16px 6px' }}>
              <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.8px', marginBottom: 4 }}>EARNINGS · ANALYST · NEWS · CATALYSTS</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.3px' }}>
                  {catalystData?.currentTimeET ? `${catalystData.currentTimeET} ET` : ''}
                  {catalystData?.nextDropIn != null && ` · NEXT DROP IN ${catalystData.nextDropIn}M`}
                </span>
                <button onClick={loadCatalyst} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 9, fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.5px' }}>
                  REFRESH
                </button>
              </div>
            </div>

            {catalystLoading && !catalystData ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
            ) : catalystData?.isWeekend ? (
              <EmptyState
                title="Markets closed"
                subtitle="Catalyst Watch runs Monday through Friday. Check back on the next trading day."
              />
            ) : drops.length === 0 ? (
              <EmptyState
                title="Catalyst Watch loading"
                subtitle="Catalyst drops generate at 9:15 AM, 12:00 PM, and 3:30 PM ET"
              />
            ) : (
              <div style={{ padding: '0 16px 16px' }}>
                {drops.map(drop => (
                  <CatalystDrop key={drop.id} drop={drop} onWatch={addWatch} showToast={showToast} />
                ))}

                {/* END OF DAY RECAP */}
                {recap && recap.stocks?.length > 0 && (
                  <>
                    <div style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <p style={{ fontSize: 9, color: 'var(--amber)', letterSpacing: '1.5px', fontWeight: 700 }}>
                          END OF DAY RECAP
                        </p>
                        <span style={{ fontSize: 9, color: 'var(--faint)' }}>
                          {recap.winners}W / {recap.losers}L
                        </span>
                      </div>
                      {recap.stocks.map((stock, i) => (
                        <RecapCard key={`${stock.ticker}-${i}`} stock={stock} />
                      ))}
                    </div>
                  </>
                )}

                <DisclaimerBadge />
              </div>
            )}
          </div>
        )}

        {/* ============ SECTOR RADAR VIEW ============ */}
        {activeSection === 'radar' && <RadarView showToast={showToast} />}

        {/* ============ BARGAINS ============ */}
        {/* Promoted from Home tab — full Bargain Radar lives here now. */}
        {activeSection === 'bargain' && (
          <div>
            <BargainRadarCard refreshKey={0} showToast={showToast} />
          </div>
        )}

        {/* ============ SCANNER VIEW ============ */}
        {activeSection === 'buzz' && (
          <div>
            {/* Header */}
            <div style={{ padding: '10px 16px 6px' }}>
              <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.8px', marginBottom: 6 }}>STOCKTWITS · POLYGON · REAL-TIME</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.5px' }}>NEXT SCAN IN {countdown}M</span>
                <button onClick={loadBuzz} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 9, fontFamily: 'inherit', fontWeight: 700, letterSpacing: '0.5px' }}>REFRESH</button>
              </div>
              <div className="cbar">
                <div className="cfill" style={{ width: `${Math.max(5, 100 - (countdown / 30) * 100)}%` }} />
              </div>
              {buzzData?.scannedAt && (
                <p style={{ fontSize: 9, color: 'var(--faint)', marginTop: 4, letterSpacing: '0.3px' }}>
                  LAST SCAN {Math.floor((Date.now() - new Date(buzzData.scannedAt).getTime()) / 60000)}M AGO
                </p>
              )}
            </div>

            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner /></div>
            ) : buzzing.length === 0 && earlier.length === 0 ? (
              <EmptyState
                title="Scanner warming up"
                subtitle="First scan runs on startup — buzzing stocks will appear here shortly"
              />
            ) : (
              <div style={{ padding: '0 16px 24px' }}>
                {/* BUZZING NOW */}
                {buzzing.length > 0 && (
                  <>
                    <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', marginBottom: 8, marginTop: 4 }}>
                      BUZZING NOW
                    </p>
                    {buzzing.map(stock => (
                      <BuzzCard key={stock.ticker} stock={stock} onWatch={addWatch} showToast={showToast} />
                    ))}
                  </>
                )}

                {/* EARLIER TODAY */}
                {earlier.length > 0 && (
                  <>
                    <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1.5px', marginBottom: 8, marginTop: 16 }}>
                      EARLIER TODAY
                    </p>
                    {earlier.map(stock => (
                      <EarlierCard key={stock.ticker} stock={stock} onWatch={addWatch} showToast={showToast} />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ============ WATCHLIST VIEW ============ */}
        {activeSection === 'watchlist' && (
          <div style={{ padding: '10px 16px 24px' }}>
            {watchlistLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><Spinner /></div>
            ) : watchlist.length === 0 ? (
              <EmptyState
                title="Watchlist is empty"
                subtitle="Tap WATCH on any buzzing stock to track it here"
                tips={[
                  { title: 'How to use', body: 'Watch stocks from the Scanner to track them. Prices update during market hours.' },
                  { title: 'Stay informed', body: 'The Agent knows your watchlist and can analyze any ticker you are watching.' },
                ]}
              />
            ) : (
              <>
                <p style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '1px', marginBottom: 10 }}>{watchlist.length} WATCHING</p>
                {watchlist.map(item => (
                  <WatchlistCard key={item.id} item={item} onRemove={removeWatch} onEdit={editWatch} showToast={showToast} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
