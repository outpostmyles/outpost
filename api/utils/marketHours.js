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

export function isMarketHours() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const dateStr = et.toISOString().split('T')[0];
  if (day === 0 || day === 6) return false;
  if (HOLIDAYS_2025_2026.has(dateStr)) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  const closeTime = EARLY_CLOSE.has(dateStr) ? 13 * 60 : 16 * 60;
  return mins >= 9 * 60 + 30 && mins < closeTime;
}

export function isPreMarket() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const mins = et.getHours() * 60 + et.getMinutes();
  return mins >= 4 * 60 && mins < 9 * 60 + 30;
}

export function getETTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

export function todayStr() {
  // Use ET to stay consistent with market hours logic — avoids UTC/ET date mismatch after 7pm ET
  return getETTime().toISOString().split('T')[0];
}

export function isWeekday() {
  const day = getETTime().getDay();
  return day >= 1 && day <= 5;
}
