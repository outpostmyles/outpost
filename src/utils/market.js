export function fmt(val, decimals = 2) {
  if (val == null || !isFinite(val)) return '—';
  return parseFloat(val).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtPct(val) {
  if (val == null || !isFinite(val)) return '—';
  const n = parseFloat(val);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function fmtDollar(val) {
  if (val == null || !isFinite(val)) return '—';
  const n = parseFloat(val);
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function colorFor(val) {
  if (val == null || !isFinite(val)) return 'var(--muted)';
  return parseFloat(val) >= 0 ? 'var(--green)' : 'var(--red)';
}

/**
 * Today's date in Eastern Time as a YYYY-MM-DD string.
 *
 * Earnings dates from our backend (Finnhub calendar) refer to the trading day
 * in ET. If we computed "today" using `new Date().toISOString()` we'd get the
 * UTC date — which is already TOMORROW between 8pm ET and midnight ET. That
 * caused badges to flicker between TODAY/TOMORROW each evening. Always use ET
 * for any comparison against an earnings date string.
 */
export function getETDateStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function getMarketStatus() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  const isWeekend = day === 0 || day === 6;
  const isOpen = !isWeekend && mins >= 570 && mins < 960;
  const isPreMarket = !isWeekend && mins >= 240 && mins < 570;
  const isAfterHours = !isWeekend && mins >= 960 && mins < 1200;

  if (isOpen) return { isOpen: true, label: 'OPEN', color: 'var(--green)' };
  if (isPreMarket) return { isOpen: false, label: 'PRE', color: 'var(--amber)' };
  if (isAfterHours) return { isOpen: false, label: 'AH', color: 'var(--amber)' };
  return { isOpen: false, label: 'CLOSED', color: 'var(--red)' };
}

export function getNextOpenLabel() {
  return 'Market opens at 9:30am ET';
}

const TICKER_COLORS = [
  ['rgba(59,130,246,0.18)','#60a5fa'],
  ['rgba(124,58,237,0.18)','#a78bfa'],
  ['rgba(34,197,94,0.15)','#4ade80'],
  ['rgba(245,158,11,0.15)','#fbbf24'],
  ['rgba(239,68,68,0.15)','#f87171'],
  ['rgba(6,182,212,0.15)','#22d3ee'],
  ['rgba(236,72,153,0.15)','#f472b6'],
  ['rgba(16,185,129,0.15)','#34d399'],
];

export function getTickerColor(ticker) {
  if (!ticker) return TICKER_COLORS[0];
  let hash = 0;
  for (let i = 0; i < ticker.length; i++) { hash = ticker.charCodeAt(i) + ((hash << 5) - hash); }
  return TICKER_COLORS[Math.abs(hash) % TICKER_COLORS.length];
}

export function getInitials(ticker) {
  if (!ticker) return '?';
  return ticker.slice(0, 2);
}

export function minutesAgo(iso) {
  if (!iso) return null;
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
