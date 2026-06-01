// Market-hours helpers, all pinned to US Eastern (NYSE/Nasdaq) and correct
// regardless of the server's own timezone.
//
// Each function takes an optional `now` (defaulting to the real clock) purely so
// the open/closed/holiday logic is unit-testable at fixed instants.

const HOLIDAYS_2025_2026 = new Set([
  '2025-01-01','2025-01-20','2025-02-17','2025-04-18','2025-05-26',
  '2025-06-19','2025-07-04','2025-09-01','2025-11-27','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25',
  '2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25',
]);

const EARLY_CLOSE = new Set([
  '2025-07-03','2025-11-28','2025-12-24',
  '2026-07-02','2026-11-27','2026-12-24',
]);

// A Date whose LOCAL fields (getHours/getMinutes/getDay) read as the ET
// wall-clock. Use it ONLY for those field reads, never for toISOString: that
// would re-encode through the server's own offset. For the calendar date use
// etDateStr(), which formats in ET directly.
function etWallClock(now) {
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

// The ET calendar date as YYYY-MM-DD, formatted in ET so it is correct on any
// server (en-CA's locale date format is YYYY-MM-DD). Round-tripping through
// toISOString() instead would land on the wrong day near midnight ET on a
// server that does not happen to run in UTC.
function etDateStr(now) {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function isMarketHours(now = new Date()) {
  const et = etWallClock(now);
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const dateStr = etDateStr(now);
  if (HOLIDAYS_2025_2026.has(dateStr)) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  const closeTime = EARLY_CLOSE.has(dateStr) ? 13 * 60 : 16 * 60;
  return mins >= 9 * 60 + 30 && mins < closeTime;
}

export function isPreMarket(now = new Date()) {
  const et = etWallClock(now);
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 4 * 60 && mins < 9 * 60 + 30;
}

export function getETTime(now = new Date()) {
  return etWallClock(now);
}

export function todayStr(now = new Date()) {
  return etDateStr(now);
}

export function isWeekday(now = new Date()) {
  const day = etWallClock(now).getDay();
  return day >= 1 && day <= 5;
}
