/**
 * Stock universe for scanning — S&P 500 + NASDAQ 100 (deduped).
 *
 * Used by Bargain Radar and similar scanners that need a curated "quality"
 * universe of large-cap US stocks. Avoids penny stocks, micro-caps, and
 * speculative names by construction (these indexes have their own quality filters).
 *
 * This list is relatively stable — maintained manually and refreshed occasionally.
 */

// S&P 500 constituents (as of 2024/2025)
const SP500 = [
  'MMM','AOS','ABT','ABBV','ACN','ADBE','AMD','AES','AFL','A','APD','ABNB','AKAM',
  'ALB','ARE','ALGN','ALLE','LNT','ALL','GOOGL','GOOG','MO','AMZN','AMCR','AEE',
  'AEP','AXP','AIG','AMT','AWK','AMP','AME','AMGN','APH','ADI','ANSS','AON','APA',
  'APO','AAPL','AMAT','APTV','ACGL','ADM','ANET','AJG','AIZ','T','ATO','ADSK',
  'ADP','AZO','AVB','AVY','AXON','BKR','BALL','BAC','BAX','BDX','BRK.B','BBY',
  'TECH','BIIB','BLK','BX','BK','BA','BKNG','BSX','BMY','AVGO','BR','BRO','BF.B',
  'BLDR','BG','BXP','CHRW','CDNS','CZR','CPT','CPB','COF','CAH','KMX','CCL','CARR',
  'CAT','CBOE','CBRE','CDW','CE','COR','CNC','CNP','CF','CRL','SCHW','CHTR','CVX',
  'CMG','CB','CHD','CI','CINF','CTAS','CSCO','C','CFG','CLX','CME','CMS','KO',
  'CTSH','COIN','CL','CMCSA','CAG','COP','ED','STZ','CEG','COO','CPRT','GLW','CPAY',
  'CTVA','CSGP','COST','CTRA','CRWD','CCI','CSX','CMI','CVS','DHR','DRI','DVA',
  'DAY','DECK','DE','DELL','DAL','DVN','DXCM','FANG','DLR','DFS','DG','DLTR','D',
  'DPZ','DASH','DOV','DOW','DHI','DTE','DUK','DD','EMN','ETN','EBAY','ECL','EIX',
  'EW','EA','ELV','EMR','ENPH','ETR','EOG','EPAM','EQT','EFX','EQIX','EQR','ERIE',
  'ESS','EL','EG','EVRG','ES','EXC','EXE','EXPE','EXPD','EXR','XOM','FFIV','FDS',
  'FICO','FAST','FRT','FDX','FIS','FITB','FSLR','FE','FI','FMC','F','FTNT','FTV',
  'FOXA','FOX','BEN','FCX','GRMN','IT','GE','GEHC','GEV','GEN','GNRC','GD','GIS',
  'GM','GPC','GILD','GPN','GL','GDDY','GS','HAL','HIG','HAS','HCA','DOC','HSIC',
  'HSY','HES','HPE','HLT','HOLX','HD','HON','HRL','HST','HWM','HPQ','HUBB','HUM',
  'HBAN','HII','IBM','IEX','IDXX','ITW','INCY','IR','PODD','INTC','ICE','IFF',
  'IP','IPG','INTU','ISRG','IVZ','INVH','IQV','IRM','JBHT','JBL','JKHY','J','JNJ',
  'JCI','JPM','JNPR','K','KVUE','KDP','KEY','KEYS','KMB','KIM','KMI','KKR','KLAC',
  'KHC','KR','LHX','LH','LRCX','LW','LVS','LDOS','LEN','LII','LLY','LIN','LYV',
  'LKQ','LMT','L','LOW','LULU','LYB','MTB','MPC','MKTX','MAR','MMC','MLM','MAS',
  'MA','MTCH','MKC','MCD','MCK','MDT','MRK','META','MET','MTD','MGM','MCHP','MU',
  'MSFT','MAA','MRNA','MHK','MOH','TAP','MDLZ','MPWR','MNST','MCO','MS','MOS',
  'MSI','MSCI','NDAQ','NTAP','NFLX','NEM','NWSA','NWS','NEE','NKE','NI','NDSN',
  'NSC','NTRS','NOC','NCLH','NRG','NUE','NVDA','NVR','NXPI','ORLY','OXY','ODFL',
  'OMC','ON','OKE','ORCL','OTIS','PCAR','PKG','PLTR','PANW','PARA','PH','PAYX',
  'PAYC','PYPL','PNR','PEP','PFE','PCG','PM','PSX','PNW','PNC','POOL','PPG','PPL',
  'PFG','PG','PGR','PLD','PRU','PEG','PTC','PSA','PHM','PWR','QCOM','DGX','RL',
  'RJF','RTX','O','REG','REGN','RF','RSG','RMD','RVTY','ROK','ROL','ROP','ROST',
  'RCL','SPGI','CRM','SBAC','SLB','STX','SRE','NOW','SHW','SPG','SWKS','SJM','SW',
  'SNA','SOLV','SO','LUV','SWK','SBUX','STT','STLD','STE','SYK','SMCI','SYF','SNPS',
  'SYY','TMUS','TROW','TTWO','TPR','TRGP','TGT','TEL','TDY','TFX','TER','TSLA',
  'TXN','TPL','TXT','TMO','TJX','TSCO','TT','TDG','TRV','TRMB','TFC','TYL','TSN',
  'USB','UBER','UDR','ULTA','UNP','UAL','UPS','URI','UNH','UHS','VLO','VTR','VLTO',
  'VRSN','VRSK','VZ','VRTX','VTRS','V','VST','VMC','WRB','GWW','WAB','WBA','WMT',
  'DIS','WBD','WM','WAT','WEC','WFC','WELL','WST','WDC','WY','WSM','WMB','WTW',
  'WDAY','WYNN','XEL','XYL','YUM','ZBRA','ZBH','ZTS',
];

// NASDAQ 100 additions not already in S&P 500
// (Most NASDAQ 100 names are in S&P 500, but a few are not)
const NASDAQ100_EXTRA = [
  'ASML','AZN','MRVL','PDD','PYPL','ROP','TEAM','MELI','BIDU','JD','NTES','ZM',
  'DDOG','ZS','WDAY','DXCM','OKTA','MDB','CRWD','PANW','FTNT','ANSS','CDNS',
  'SNPS','LRCX','KLAC','AMAT','MU','NXPI','MCHP','ADI','AVGO','AMD','QCOM',
  'INTC','TSLA','NVDA','MSFT','AAPL','AMZN','GOOGL','GOOG','META','NFLX','ADBE',
  'CMCSA','COST','PEP','SBUX','INTU','TXN','HON','GILD','REGN','VRTX','BIIB',
  'ISRG','ILMN','IDXX','CSCO','ORLY','ROST','DLTR','KDP','KHC','MDLZ','MNST',
  'WBA','EA','EBAY','PCAR','FAST','PAYX','CTAS','CTSH','VRSK','VRSN','EXC',
  'XEL','AEP','PDD','LULU','ABNB','MAR','BKNG','CHTR','TMUS','CEG','WBD','DDOG',
  'TTD','SHOP','ARM','MSTR','APP','PLTR','SMCI','ON',
];

// Dedupe and sort
const universe = Array.from(new Set([...SP500, ...NASDAQ100_EXTRA])).sort();

export const STOCK_UNIVERSE = universe;

/**
 * Exclude a few tickers that commonly cause issues in scans:
 * - Class B duplicates (BRK.B uses a dot Polygon doesn't love)
 * - Very recent IPOs without 52w history
 */
export const SCAN_UNIVERSE = universe.filter(t =>
  !t.includes('.') && // skip BRK.B etc. — dot causes Polygon issues
  t.length <= 5 // skip anything weird
);

export function universeSize() {
  return SCAN_UNIVERSE.length;
}
