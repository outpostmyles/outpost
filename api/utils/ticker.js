export const GARBAGE_WORDS = new Set([
  'I','A','THE','AND','FOR','ARE','BUT','NOT','YOU','ALL','CAN','GET','HAS','HOW',
  'ITS','NEW','NOW','SEE','WHO','DID','LET','SAY','TOO','USE','CEO','IPO','ATH',
  'ETF','SEC','FED','GDP','CPI','NFP','WSB','DD','TA','EPS','PE','IV','OI','COT',
  'IT','IS','IN','AT','AN','OF','TO','BE','DO','GO','NO','OR','SO','UP','US',
  'WE','MY','ME','IF','BY','ON','AS','YOLO','FOMO','HODL','MOON','PUMP','DUMP',
  'AI','VIX','USD','GBP','EUR','JPY','DXY','SPX','NDX','RUT','DOW','OIL','IRA',
  'GOLD','BOND','RATE','DEBT','CASH','BANK','FUND','RISK','BEAR','BULL','IRS',
  'PUT','CALL','BUY','SELL','LONG','SHORT','HOLD','LOSS','GAIN','PROFIT','CEO',
  'STOCK','TRADE','CHART','NEWS','EARN','BEAT','MISS','GUIDE','RAISE','CFO',
  'CUT','HALT','RALLY','CRASH','DIP','RIP','SEND','RICH','POOR','CTO','COO',
  'THANK','WHAT','WHEN','WHERE','THEN','THAN','BEEN','HAVE','FROM','THEY',
  'WITH','WILL','YOUR','ABOUT','AFTER','BEFORE','COULD','WOULD','SHOULD',
  'THEIR','THERE','WHICH','WHILE','THESE','THOSE','OTHER','FIRST','LAST',
  'INTO','OVER','JUST','LIKE','SOME','MAKE','KNOW','TAKE','COME','THINK',
  'ALSO','BACK','GOOD','MORE','TIME','VERY','MUCH','WELL','EVEN','DOWN',
  'DOES','BOTH','EACH','MOST','SUCH','ONLY','MANY','SAME','OWN','LOL',
  'IMO','IMHO','TBH','NGL','SMH','WTF','FUD','APES','APE','MEME','HYPE',
  'THIS','THAT','SAYS','SAID','WEEK','YEAR','MONTH','DAY','TODAY','NEXT',
  'LAST','BEST','WORST','HIGH','LOW','OPEN','CLOSE','PRE','POST','EOD',
  'EOW','EOM','YTD','ATL','VWAP','EMA','SMA','RSI','MACD','ONE','TWO',
  'THREE','FOUR','FIVE','SIX','TEN','BEING','GOING','DOING','HAVING',
  'SAID','SAYS','GETS','WENT','GOES','CAME','COME','MADE','MAKE','TAKE',
  'TOOK','GIVE','GAVE','KNOW','KNEW','FIND','FOUND','KEEP','KEPT','SEEM',
  'LEFT','LET','MEAN','MOVE','NEED','SHOW','FEEL','TURN','HOLD','TOLD',
  'LOST','LEAD','LIVE','PLAN','PLAY','REAL','SURE','IDEA','PLACE','WORLD',
  'CASE','FACT','HAND','PART','SIDE','KIND','FORM','LIFE','LONG','LOOK',
  'MUCH','MUST','NEXT','ONCE','OPEN','PAST','READ','RISK','SAID','SAME',
  'SEEM','SOON','STOP','SUCH','THEY','THUS','TOLD','TOOK','TRUE','TURN',
  'TYPE','UPON','USED','VERY','WAIT','WANT','WELL','WENT','WERE','WITH',
  'WORK','YEAR','YOUR','ZERO','ALSO','BACK','BEEN','BOTH','DONE','DOWN',
  'EACH','EVEN','EVER','FOUR','FROM','GAVE','GAVE','GIVE','GOES','GONE',
  'GOOD','HARD','HAVE','HEAD','HELP','HERE','HIGH','HOME','HOPE','HOUR',
  'INTO','JUST','KEEP','KNOW','LATE','LESS','LIKE','LINE','LIVE','LONG',
  'LOOK','LOSE','LOST','MADE','MAIN','MAKE','MANY','MEAN','MEET','MIND',
]);

export function isValidTicker(t) {
  if (!t || typeof t !== 'string') return false;
  if (t.length < 1 || t.length > 5) return false;
  if (GARBAGE_WORDS.has(t)) return false;
  if (!/^[A-Z]+$/.test(t)) return false;
  return true;
}

export function extractTickers(text) {
  const tickers = new Set();
  const re = /\$([A-Z]{1,5})\b|\b([A-Z]{2,5})\b/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const t = match[1] ?? match[2];
    if (isValidTicker(t)) tickers.add(t);
  }
  return [...tickers];
}
