// Offline ticker -> sector fallback. The live provider (FMP) gives accurate,
// granular sectors but is rate-limited and occasionally down, and when it fails
// the sector card collapses to "Unknown 100%", which looks broken. This static
// map covers the popular names a retail book actually holds so a sector still
// shows when FMP is unavailable. It uses FMP's own sector vocabulary, so the
// live and fallback sources blend into one consistent set of slices instead of
// "Tech" and "Technology" splitting a pie. Pure and dependency-free.
//
// This is a FALLBACK, not the source of truth: FMP wins when it answers. The map
// does not need every ticker, only the ones people commonly hold; anything not
// here and not resolved by FMP is honestly labeled Unknown.

const TICKER_SECTOR = {
  // Technology
  AAPL: 'Technology', MSFT: 'Technology', NVDA: 'Technology', AVGO: 'Technology', ORCL: 'Technology',
  CRM: 'Technology', AMD: 'Technology', INTC: 'Technology', ADBE: 'Technology', CSCO: 'Technology',
  QCOM: 'Technology', TXN: 'Technology', AMAT: 'Technology', MU: 'Technology', LRCX: 'Technology',
  SNPS: 'Technology', CDNS: 'Technology', KLAC: 'Technology', MRVL: 'Technology', ON: 'Technology',
  SMCI: 'Technology', ARM: 'Technology', PLTR: 'Technology', NOW: 'Technology', SNOW: 'Technology',
  DDOG: 'Technology', NET: 'Technology', PANW: 'Technology', ZS: 'Technology', FTNT: 'Technology',
  CRWD: 'Technology', MDB: 'Technology', HUBS: 'Technology', IBM: 'Technology', DELL: 'Technology',
  HPQ: 'Technology', HPE: 'Technology', WDAY: 'Technology', TEAM: 'Technology', ANET: 'Technology',
  UBER: 'Technology', SHOP: 'Technology', QBTS: 'Technology', CRWV: 'Technology', POET: 'Technology',
  RGTI: 'Technology', IONQ: 'Technology', SOUN: 'Technology', AI: 'Technology', BBAI: 'Technology',
  // Communication Services
  GOOGL: 'Communication Services', GOOG: 'Communication Services', META: 'Communication Services',
  NFLX: 'Communication Services', DIS: 'Communication Services', SNAP: 'Communication Services',
  PINS: 'Communication Services', ROKU: 'Communication Services', TTD: 'Communication Services',
  T: 'Communication Services', VZ: 'Communication Services', TMUS: 'Communication Services',
  // Financial Services
  JPM: 'Financial Services', BAC: 'Financial Services', WFC: 'Financial Services', GS: 'Financial Services',
  MS: 'Financial Services', C: 'Financial Services', BLK: 'Financial Services', SCHW: 'Financial Services',
  AXP: 'Financial Services', V: 'Financial Services', MA: 'Financial Services', ICE: 'Financial Services',
  CME: 'Financial Services', SPGI: 'Financial Services', COIN: 'Financial Services', HOOD: 'Financial Services',
  SOFI: 'Financial Services', PYPL: 'Financial Services', 'BRK.B': 'Financial Services', KKR: 'Financial Services',
  // Healthcare
  UNH: 'Healthcare', JNJ: 'Healthcare', PFE: 'Healthcare', ABBV: 'Healthcare', MRK: 'Healthcare',
  LLY: 'Healthcare', TMO: 'Healthcare', ABT: 'Healthcare', BMY: 'Healthcare', AMGN: 'Healthcare',
  GILD: 'Healthcare', ISRG: 'Healthcare', VRTX: 'Healthcare', REGN: 'Healthcare', MRNA: 'Healthcare',
  DXCM: 'Healthcare', BSX: 'Healthcare', HCA: 'Healthcare', CI: 'Healthcare', ELV: 'Healthcare',
  HIMS: 'Healthcare',
  // Consumer Cyclical
  AMZN: 'Consumer Cyclical', TSLA: 'Consumer Cyclical', HD: 'Consumer Cyclical', NKE: 'Consumer Cyclical',
  SBUX: 'Consumer Cyclical', MCD: 'Consumer Cyclical', ABNB: 'Consumer Cyclical', BKNG: 'Consumer Cyclical',
  CMG: 'Consumer Cyclical', TGT: 'Consumer Cyclical', LOW: 'Consumer Cyclical', LULU: 'Consumer Cyclical',
  DECK: 'Consumer Cyclical', ROST: 'Consumer Cyclical', TJX: 'Consumer Cyclical', ONON: 'Consumer Cyclical',
  CAVA: 'Consumer Cyclical', RIVN: 'Consumer Cyclical', LCID: 'Consumer Cyclical', NIO: 'Consumer Cyclical',
  F: 'Consumer Cyclical', GM: 'Consumer Cyclical', DASH: 'Consumer Cyclical',
  // Consumer Defensive
  WMT: 'Consumer Defensive', COST: 'Consumer Defensive', PG: 'Consumer Defensive', KO: 'Consumer Defensive',
  PEP: 'Consumer Defensive', ULTA: 'Consumer Defensive', MDLZ: 'Consumer Defensive', CL: 'Consumer Defensive',
  // Energy
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', EOG: 'Energy', SLB: 'Energy', FANG: 'Energy',
  OKE: 'Energy', WMB: 'Energy',
  // Industrials
  BA: 'Industrials', CAT: 'Industrials', DE: 'Industrials', UNP: 'Industrials', HON: 'Industrials',
  GE: 'Industrials', RTX: 'Industrials', LMT: 'Industrials', FDX: 'Industrials', UPS: 'Industrials',
  AXON: 'Industrials', ETN: 'Industrials', PWR: 'Industrials', PLUG: 'Industrials', RKLB: 'Industrials',
  LUV: 'Industrials', DAL: 'Industrials', UAL: 'Industrials',
  // Basic Materials
  FCX: 'Basic Materials', NEM: 'Basic Materials', APD: 'Basic Materials', LIN: 'Basic Materials',
  SHW: 'Basic Materials',
  // Utilities
  NEE: 'Utilities', SO: 'Utilities', DUK: 'Utilities',
  // Real Estate
  AMT: 'Real Estate', PLD: 'Real Estate', CCI: 'Real Estate', O: 'Real Estate',
};

/**
 * Best-effort offline sector for a ticker, or null if unknown.
 * @param {string} ticker
 * @returns {string|null}
 */
export function staticSector(ticker) {
  return TICKER_SECTOR[String(ticker || '').toUpperCase().trim()] || null;
}

/**
 * Resolve a sector preferring the live value, falling back to the static map,
 * then to 'Unknown'. Keeps the "FMP wins, map is the safety net" rule in one place.
 * @param {string} ticker
 * @param {string|null|undefined} liveSector - sector from FMP, if any
 * @returns {string}
 */
export function resolveSector(ticker, liveSector) {
  const live = liveSector && String(liveSector).trim();
  return live || staticSector(ticker) || 'Unknown';
}
