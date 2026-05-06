import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { getNews } from '../utils/polygon.js';
import { getSentimentData, getMoversData } from '../services/marketData.js';
import { getPrices } from '../services/pricePool.js';

const router = express.Router();

// Sentiment — reads from MarketDataService memory, zero Polygon calls
router.get('/sentiment', requireAuth, rateLimit(20), async (req, res) => {
  try {
    const sentiment = getSentimentData();
    res.json(sentiment);
  } catch {
    res.status(500).json({ error: 'Market data unavailable' });
  }
});

// Movers — reads from MarketDataService memory, zero Polygon calls
router.get('/movers', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const movers = getMoversData();
    res.json(movers);
  } catch {
    res.status(500).json({ error: 'Movers unavailable' });
  }
});

// Prices — reads from PricePool memory, zero Polygon calls
router.get('/prices', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const { tickers } = req.query;
    if (!tickers) return res.status(400).json({ error: 'tickers required' });
    const tickerList = tickers.split(',').slice(0, 20);
    const prices = getPrices(tickerList);
    res.json({ prices });
  } catch {
    res.status(500).json({ error: 'Price data unavailable' });
  }
});

// News — still calls Polygon (per-ticker, cached in polygon.js)
router.get('/news', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const { ticker } = req.query;
    if (!ticker) return res.status(400).json({ error: 'ticker required' });
    const articles = await getNews(ticker.toUpperCase(), 20);
    res.json({ articles });
  } catch {
    res.status(500).json({ error: 'News unavailable' });
  }
});

export default router;
