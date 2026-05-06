/**
 * Sector Radar — Forward-looking sector rotation detection.
 *
 * Tracks sector ETFs for relative strength, volume anomalies, and news clustering.
 * Uses Claude to synthesize signals into actionable sector outlook.
 *
 * Updates every 30 minutes during market hours, cached for efficiency.
 */
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { getSnapshots } from '../utils/polygon.js';
import { getBreakingNews, isFinnhubAvailable } from '../utils/finnhub.js';
import { config } from '../config.js';

const router = express.Router();
const anthropic = new Anthropic({ apiKey: config.anthropicKey });
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';

// Major sector ETFs — covers the full market
const SECTOR_ETFS = [
  { ticker: 'XLK',  name: 'Technology',       themes: ['AI', 'cloud', 'semiconductor', 'software', 'chip'] },
  { ticker: 'XLF',  name: 'Financials',        themes: ['banking', 'interest rate', 'fed', 'credit'] },
  { ticker: 'XLE',  name: 'Energy',            themes: ['oil', 'gas', 'OPEC', 'crude', 'drilling'] },
  { ticker: 'XLV',  name: 'Healthcare',        themes: ['FDA', 'pharma', 'biotech', 'drug', 'clinical trial'] },
  { ticker: 'XLI',  name: 'Industrials',       themes: ['manufacturing', 'infrastructure', 'defense', 'aerospace'] },
  { ticker: 'XLC',  name: 'Communications',    themes: ['social media', 'streaming', 'telecom', 'advertising'] },
  { ticker: 'XLY',  name: 'Consumer Disc.',    themes: ['retail', 'consumer spending', 'luxury', 'auto'] },
  { ticker: 'XLP',  name: 'Consumer Staples',  themes: ['grocery', 'household', 'defensive', 'dividend'] },
  { ticker: 'XLRE', name: 'Real Estate',       themes: ['housing', 'REIT', 'mortgage', 'property'] },
  { ticker: 'XLU',  name: 'Utilities',         themes: ['power', 'electric', 'nuclear', 'renewable', 'grid'] },
  { ticker: 'XLB',  name: 'Materials',         themes: ['mining', 'steel', 'gold', 'lithium', 'commodities'] },
];

// Emerging theme ETFs — catches hype cycles early
const THEME_ETFS = [
  { ticker: 'ARKK', name: 'Innovation/Disruptive', themes: ['AI', 'genomics', 'fintech', 'robotics', 'autonomous'] },
  { ticker: 'ARKG', name: 'Genomics',              themes: ['CRISPR', 'gene therapy', 'biotech', 'genomic'] },
  { ticker: 'TAN',  name: 'Solar Energy',           themes: ['solar', 'clean energy', 'renewable'] },
  { ticker: 'LIT',  name: 'Lithium/Battery',        themes: ['lithium', 'EV', 'battery', 'electric vehicle'] },
  { ticker: 'HACK', name: 'Cybersecurity',          themes: ['cyber', 'security', 'breach', 'hack'] },
  { ticker: 'BOTZ', name: 'Robotics & AI',          themes: ['robot', 'automation', 'artificial intelligence', 'machine learning'] },
  { ticker: 'URA',  name: 'Uranium/Nuclear',        themes: ['uranium', 'nuclear', 'atomic', 'reactor'] },
  { ticker: 'QTUM', name: 'Quantum Computing',      themes: ['quantum', 'qubit', 'quantum computing'] },
];

const ALL_ETFS = [...SECTOR_ETFS, ...THEME_ETFS];

// In-memory radar data
let radarData = null;
let lastGenerated = null;

/**
 * Fetch sector ETF snapshots and calculate relative performance vs SPY.
 */
async function getSectorPerformance() {
  const allTickers = [...ALL_ETFS.map(e => e.ticker), 'SPY'];
  const snapshots = await getSnapshots(allTickers);

  const spy = snapshots['SPY'];
  const spyChange = spy?.changePercent ?? 0;

  const sectors = ALL_ETFS.map(etf => {
    const snap = snapshots[etf.ticker];
    if (!snap?.price) return null;

    const absChange = snap.changePercent ?? 0;
    const relativeStrength = parseFloat((absChange - spyChange).toFixed(2));

    return {
      ticker: etf.ticker,
      name: etf.name,
      themes: etf.themes,
      price: snap.price,
      change: absChange,
      relativeStrength,
      volume: snap.volume ?? 0,
      isTheme: THEME_ETFS.some(t => t.ticker === etf.ticker),
    };
  }).filter(Boolean);

  return { sectors, spyChange };
}

/**
 * Scan news headlines for sector/theme clustering.
 * Returns a map of sector names to headline counts and key headlines.
 */
async function getNewsClusters() {
  if (!isFinnhubAvailable()) return {};

  try {
    const news = await getBreakingNews(50);
    const clusters = {};

    for (const article of news) {
      const text = (article.title + ' ' + (article.summary || '')).toLowerCase();

      for (const etf of ALL_ETFS) {
        const matchCount = etf.themes.filter(theme => text.includes(theme.toLowerCase())).length;
        if (matchCount > 0) {
          if (!clusters[etf.ticker]) {
            clusters[etf.ticker] = { count: 0, headlines: [], themes: [] };
          }
          clusters[etf.ticker].count++;
          if (clusters[etf.ticker].headlines.length < 3) {
            clusters[etf.ticker].headlines.push(article.title);
          }
          const matched = etf.themes.filter(theme => text.includes(theme.toLowerCase()));
          for (const m of matched) {
            if (!clusters[etf.ticker].themes.includes(m)) {
              clusters[etf.ticker].themes.push(m);
            }
          }
        }
      }
    }

    return clusters;
  } catch (err) {
    console.error('[SectorRadar] News clustering failed:', err.message);
    return {};
  }
}

/**
 * Use Claude to synthesize sector signals into a forward-looking radar.
 */
async function generateRadarAnalysis(sectors, newsClusters, spyChange) {
  // Build the signal summary for Claude
  const sortedByStrength = [...sectors].sort((a, b) => b.relativeStrength - a.relativeStrength);
  const topSectors = sortedByStrength.slice(0, 5);
  const bottomSectors = sortedByStrength.slice(-5).reverse();

  const sectorSignals = sectors.map(s => {
    const newsCluster = newsClusters[s.ticker];
    const newsStr = newsCluster ? `${newsCluster.count} news mentions (themes: ${newsCluster.themes.join(', ')})` : 'no notable news clustering';
    return `${s.ticker} (${s.name}): ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}% today, ${s.relativeStrength >= 0 ? '+' : ''}${s.relativeStrength.toFixed(2)}% vs SPY, ${newsStr}`;
  }).join('\n');

  const systemPrompt = `You are a sector rotation analyst. Your job: identify which sectors are showing EARLY signs of money flowing in or out BEFORE the move becomes obvious. Think like a fund manager allocating capital.

ANALYSIS RULES:
1. Look for DIVERGENCES — sectors outperforming in a down market or underperforming in an up market are telling you something.
2. News clustering matters — when multiple headlines cluster around a theme, institutional money follows within days.
3. Separate SECTORS (core market sectors) from THEMES (emerging trends like quantum, AI, uranium). Both matter but for different reasons.
4. For each signal, explain the THESIS in one sentence — not just "it's up" but WHY money is flowing there.
5. Be forward-looking — what's the NEXT move, not what already happened.
6. Maximum 3 heating up + 2 cooling down. Quality over quantity.
7. Return ONLY valid JSON, no markdown.`;

  try {
    const msg = await anthropic.messages.create({
      model: MODEL_HAIKU,
      max_tokens: 600,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: `SPY is ${spyChange >= 0 ? '+' : ''}${spyChange.toFixed(2)}% today. Analyze these sector signals and identify where money is rotating:

${sectorSignals}

Return JSON with:
{
  "heating": [{ "ticker": "XLK", "name": "Technology", "signal": "strong" or "early", "thesis": "one sentence why", "relativeStrength": number }],
  "cooling": [{ "ticker": "XLE", "name": "Energy", "signal": "warning" or "risk", "thesis": "one sentence why", "relativeStrength": number }],
  "themeWatch": { "name": "theme name", "thesis": "one sentence on an emerging theme to watch", "ticker": "ETF ticker" } or null
}`,
      }],
    });

    const text = msg.content[0].text;
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (err) {
    console.error('[SectorRadar] AI analysis failed:', err.message);
  }

  // Fallback: use raw relative strength
  const heating = sortedByStrength.slice(0, 3).map(s => ({
    ticker: s.ticker, name: s.name, signal: s.relativeStrength > 1 ? 'strong' : 'early',
    thesis: `Outperforming SPY by ${s.relativeStrength.toFixed(1)}%`, relativeStrength: s.relativeStrength,
  }));
  const cooling = sortedByStrength.slice(-2).map(s => ({
    ticker: s.ticker, name: s.name, signal: s.relativeStrength < -1 ? 'risk' : 'warning',
    thesis: `Underperforming SPY by ${Math.abs(s.relativeStrength).toFixed(1)}%`, relativeStrength: s.relativeStrength,
  }));

  return { heating, cooling, themeWatch: null };
}

/**
 * Generate a full sector radar update.
 */
async function generateRadar() {
  console.log('[SectorRadar] Generating sector radar...');

  try {
    const [perfData, newsClusters] = await Promise.all([
      getSectorPerformance(),
      getNewsClusters(),
    ]);

    const analysis = await generateRadarAnalysis(perfData.sectors, newsClusters, perfData.spyChange);

    const result = {
      ...analysis,
      sectors: perfData.sectors,
      spyChange: perfData.spyChange,
      generatedAt: new Date().toISOString(),
      newsClusters: Object.entries(newsClusters)
        .filter(([, v]) => v.count >= 2)
        .map(([ticker, v]) => ({ ticker, ...v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };

    console.log(`[SectorRadar] Generated — ${result.heating?.length ?? 0} heating, ${result.cooling?.length ?? 0} cooling`);
    return result;
  } catch (err) {
    console.error('[SectorRadar] Generation failed:', err.message);
    return null;
  }
}

/**
 * Get radar data, generating if stale (30 min TTL).
 */
async function getRadar(force = false) {
  const TTL = 30 * 60 * 1000; // 30 minutes

  if (!force && radarData && lastGenerated && Date.now() - lastGenerated < TTL) {
    return radarData;
  }

  // Check Supabase cache
  if (!force) {
    try {
      const { data: cached } = await supabase.from('ai_cache').select('*').eq('cache_key', 'sector_radar').maybeSingle();
      if (cached?.result && Date.now() - new Date(cached.created_at).getTime() < TTL) {
        try {
          radarData = JSON.parse(cached.result);
          lastGenerated = new Date(cached.created_at).getTime();
          return radarData;
        } catch (parseErr) {
          console.warn('[SectorRadar] Corrupt cache data, regenerating:', parseErr.message);
        }
      }
    } catch {}
  }

  // Generate fresh
  const result = await generateRadar();
  if (result) {
    radarData = result;
    lastGenerated = Date.now();

    // Persist to Supabase
    try {
      const payload = JSON.stringify(result);
      const { data: existing } = await supabase.from('ai_cache').select('id').eq('cache_key', 'sector_radar').maybeSingle();
      if (existing) {
        await supabase.from('ai_cache').update({ result: payload, created_at: new Date().toISOString() }).eq('id', existing.id);
      } else {
        await supabase.from('ai_cache').insert({ cache_key: 'sector_radar', result: payload, created_at: new Date().toISOString() });
      }
    } catch {}
  }

  return radarData;
}

// ============ API ROUTES ============

// GET /api/ai/sector-radar — main endpoint
router.get('/', requireAuth, rateLimit(10), async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const data = await getRadar(force);

    if (!data) {
      return res.json({
        heating: [],
        cooling: [],
        themeWatch: null,
        sectors: [],
        generatedAt: null,
        disclaimer: 'Sector analysis for informational purposes only. Not financial advice.',
      });
    }

    res.json({
      ...data,
      disclaimer: 'Sector analysis for informational purposes only. Not financial advice.',
    });
  } catch (err) {
    console.error('[SectorRadar] API error:', err);
    res.status(500).json({ error: 'Sector radar unavailable' });
  }
});

export default router;
