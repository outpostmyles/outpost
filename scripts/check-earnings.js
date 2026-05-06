// Standalone diagnostic — tests multiple strategies for fetching earnings.
// Run with:
//   cd /Users/mylesschenfield/Downloads/outpost_new && node scripts/check-earnings.js

import 'dotenv/config';

const FINNHUB = process.env.FINNHUB_API_KEY;
const FMP = process.env.FMP_API_KEY;
const TICKERS = ['OPEN', 'AMD', 'HYMC'];

function etDateStr(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  const base = Date.parse(`${y}-${m}-${d}T00:00:00Z`);
  return new Date(base + offsetDays * 86400000).toISOString().split('T')[0];
}

function filterTickers(entries, symbolKey) {
  const out = {};
  for (const e of entries) {
    const sym = e[symbolKey];
    if (TICKERS.includes(sym)) {
      (out[sym] = out[sym] || []).push(e);
    }
  }
  return out;
}

function summary(label, entries, symbolKey) {
  console.log(`  ${label}: ${entries.length} entries total`);
  if (entries.length === 0) return;
  const matched = filterTickers(entries, symbolKey);
  for (const t of TICKERS) {
    const m = matched[t];
    if (m?.length) {
      for (const e of m) {
        console.log(`    ${t}: ${e.date} (${e.hour || e.time || '—'}) epsEst=${e.epsEstimate ?? '—'}`);
      }
    }
  }
  // Also show first 3 entries so we can see what we ARE getting
  const first = entries.slice(0, 3).map(e => `${e[symbolKey]}@${e.date}`).join(', ');
  console.log(`    sample: ${first}`);
}

// ─── FINNHUB TESTS ────────────────────────────────────────────────────────
if (FINNHUB) {
  console.log('\n🔵 FINNHUB\n');

  // Test 1: 1-day window (what catalyst.js uses)
  {
    const from = etDateStr(0), to = etDateStr(1);
    console.log(`\n  Test 1: narrow window ${from} → ${to}`);
    try {
      const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${FINNHUB}`);
      console.log(`    HTTP ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        summary('1-day', data?.earningsCalendar ?? [], 'symbol');
      }
    } catch (err) { console.error(`    ❌ ${err.message}`); }
  }

  // Test 2: 7-day window
  {
    const from = etDateStr(0), to = etDateStr(7);
    console.log(`\n  Test 2: 7-day window ${from} → ${to}`);
    try {
      const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${FINNHUB}`);
      console.log(`    HTTP ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        summary('7-day', data?.earningsCalendar ?? [], 'symbol');
      }
    } catch (err) { console.error(`    ❌ ${err.message}`); }
  }

  // Test 3: no range (default)
  {
    console.log(`\n  Test 3: no range (default window)`);
    try {
      const res = await fetch(`https://finnhub.io/api/v1/calendar/earnings?token=${FINNHUB}`);
      console.log(`    HTTP ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        summary('default', data?.earningsCalendar ?? [], 'symbol');
      }
    } catch (err) { console.error(`    ❌ ${err.message}`); }
  }
} else {
  console.log('\n🔵 FINNHUB: no key\n');
}

// ─── FMP TESTS ────────────────────────────────────────────────────────────
if (FMP) {
  console.log('\n🟢 FMP\n');

  // Test 4: FMP range calendar (30-day window)
  {
    const from = etDateStr(0), to = etDateStr(30);
    console.log(`\n  Test 4: FMP range ${from} → ${to}`);
    try {
      const res = await fetch(`https://financialmodelingprep.com/api/v3/earning_calendar?from=${from}&to=${to}&apikey=${FMP}`);
      console.log(`    HTTP ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        summary('fmp-range', Array.isArray(data) ? data : [], 'symbol');
      } else {
        const body = await res.text();
        console.log(`    body: ${body.slice(0, 200)}`);
      }
    } catch (err) { console.error(`    ❌ ${err.message}`); }
  }

  // Test 5: FMP v4 alternative endpoint
  {
    console.log(`\n  Test 5: FMP v3 earning_calendar default`);
    try {
      const res = await fetch(`https://financialmodelingprep.com/api/v3/earning_calendar?apikey=${FMP}`);
      console.log(`    HTTP ${res.status}`);
      if (res.ok) {
        const data = await res.json();
        summary('fmp-default', Array.isArray(data) ? data : [], 'symbol');
      }
    } catch (err) { console.error(`    ❌ ${err.message}`); }
  }
} else {
  console.log('\n🟢 FMP: no key\n');
}

console.log('');
