import './config.js';
import express from 'express';
import cors from 'cors';
import { globalRateLimit } from './middleware/rateLimit.js';
import authRoutes from './functions/auth.js';
import marketRoutes from './functions/market.js';
import aiRoutes from './functions/ai.js';
import portfolioRoutes from './functions/portfolio.js';
import socialRoutes, { startBackgroundScanner } from './functions/social.js';
import catalystRoutes, { startCatalystScheduler } from './functions/catalyst.js';
import agentRoutes from './functions/agent.js';
import settingsRoutes from './functions/settings.js';
import sectorRadarRoutes from './functions/sectorRadar.js';
import bargainRadarRoutes from './functions/bargainRadar.js';
import portfolioExplainerRoutes from './functions/portfolioExplainer.js';
import proactiveDigestRoutes from './functions/proactiveDigest.js';
import todayRoutes from './functions/today.js';
import journalRoutes from './functions/journal.js';
import alertsRoutes from './functions/alerts.js';
import adminRoutes from './functions/admin.js';
import { config } from './config.js';
import { initMarketDataService, getMarketData } from './services/marketData.js';
import { initPricePool, poolStats } from './services/pricePool.js';
import { alertMonitorTick } from './services/alertMonitor.js';
import { memStats } from './services/memoryCache.js';
import { supabase } from './db.js';
import { getMetrics, trackError } from './services/monitor.js';
import { generateInsights, getAnalyticsSummary } from './services/analytics.js';

const app = express();

// Behind Railway/Vercel/Cloudflare etc, the real client IP is in X-Forwarded-For.
// Without this, req.ip returns the load balancer's IP — making per-IP rate
// limits useless (all traffic appears to come from one bucket) and trivially
// bypassable by spoofing XFF without Express's trust filter. Trust the first
// hop only (Railway's edge proxy).
app.set('trust proxy', 1);

app.use(cors({
  origin: [
    'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175',
    'http://localhost:4173', config.frontendUrl,
  ].filter(Boolean),
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// Security headers — prevent clickjacking, MIME sniffing, etc.
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (config.nodeEnv === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(globalRateLimit());

app.use('/api/auth', authRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/social/catalyst', catalystRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/ai/sector-radar', sectorRadarRoutes);
app.use('/api/ai/bargain-radar', bargainRadarRoutes);
app.use('/api/ai/move-explainer', portfolioExplainerRoutes);
app.use('/api/ai/proactive-digest', proactiveDigestRoutes);
app.use('/api/ai/today', todayRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/admin', adminRoutes);

// ============ HEALTH & MONITORING ============

// Quick health check — monitoring services ping this every 60s
// Returns 200 if core systems are up, 503 if something critical is down
app.get('/api/health', async (req, res) => {
  const checks = { supabase: false, pricePool: false, marketData: false };
  const issues = [];

  // Check 1: Supabase connectivity
  try {
    const { error } = await supabase.from('user_profiles').select('id').limit(1);
    checks.supabase = !error;
    if (error) issues.push(`Supabase: ${error.message}`);
  } catch (e) { issues.push(`Supabase: ${e.message}`); }

  // Check 2: PricePool has data and is refreshing
  const pool = poolStats();
  checks.pricePool = pool.tickers > 0 || pool.allTickers.length === 0; // OK if no tickers exist yet
  const priceAgeMin = pool.lastFetchAt ? Math.round((Date.now() - pool.lastFetchAt) / 60000) : null;
  if (priceAgeMin != null && priceAgeMin > 10) {
    issues.push(`PricePool: last refresh was ${priceAgeMin}m ago`);
  }

  // Check 3: MarketData service has loaded
  const market = getMarketData();
  checks.marketData = market.vix?.value != null || market.fearGreed?.value != null;
  if (!checks.marketData) issues.push('MarketData: no VIX or F&G data loaded');

  // Overall status
  const allOk = checks.supabase && checks.pricePool;
  const status = allOk ? 'healthy' : 'degraded';

  // Full metrics if requested (for dashboards, not public — requires admin key)
  const adminSecret = process.env.ADMIN_SECRET;
  const providedKey = req.headers['x-admin-key']; // Only accept via header — never query params (logged by proxies/CDNs)
  const verbose = req.query.verbose === 'true' && adminSecret && providedKey === adminSecret;
  const cache = memStats();
  const mon = getMetrics();

  const response = {
    status,
    timestamp: new Date().toISOString(),
    checks,
    issues: issues.length > 0 ? issues : undefined,
    pricePool: {
      tickers: pool.tickers,
      lastRefreshAgo: priceAgeMin != null ? `${priceAgeMin}m` : 'never',
    },
    cache: { entries: cache.size },
    uptime: `${mon.uptime.hours}h`,
  };

  // Verbose mode adds full metrics (for your dashboard, not public monitoring)
  if (verbose) {
    response.metrics = mon;
  }

  res.status(allOk ? 200 : 503).json(response);
});

// Admin insights — your daily product digest
// Protected by a simple secret key (set ADMIN_SECRET in .env)
app.get('/api/admin/insights', async (req, res) => {
  const secret = req.headers['x-admin-key']; // Only accept via header — never query params (logged by proxies/CDNs)
  if (!process.env.ADMIN_SECRET) {
    return res.status(503).json({ error: 'Admin endpoint not configured — set ADMIN_SECRET in .env' });
  }
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const insights = generateInsights();
  const health = getMetrics();

  res.json({
    ...insights,
    health: {
      uptime: health.uptime,
      requests: health.requests,
      ai: health.ai,
      data: health.data,
    },
  });
});

// ============ ERROR HANDLING ============

app.use((err, req, res, next) => {
  trackError(req.path, err, 'critical');
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Catch unhandled promise rejections — prevents silent crashes
process.on('unhandledRejection', (reason) => {
  trackError('unhandledRejection', reason, 'critical');
  console.error('[CRITICAL] Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  trackError('uncaughtException', err, 'critical');
  console.error('[CRITICAL] Uncaught exception:', err);
  // Give time to log, then exit (process manager will restart)
  setTimeout(() => process.exit(1), 1000);
});

async function boot() {
  // Initialize services before starting the server
  console.log('');
  console.log('━━━ OUTPOST ━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Phase 1: Shared market data (VIX, F&G, RSI, movers)
  await initMarketDataService();

  // Phase 2: Global price pool (all portfolio tickers)
  await initPricePool();

  // Phase 3: Memory cache initialized on import (automatic)
  console.log('[Cache] Server-side memory cache active');

  // Start Express
  const server = app.listen(config.port, () => {
    console.log('');
    console.log(`[Server] Outpost API running on port ${config.port}`);
    console.log('');

    // Start background jobs (social scanner, catalyst watch, briefs, snapshots)
    startBackgroundScanner();
    startCatalystScheduler();

    // Price alert monitor — checks active alerts against the live price pool
    // every 5 minutes during market hours. Owned by jobs/runner.js in production
    // (set JOBS_SEPARATE_PROCESS=true in the API service env). In local dev where
    // jobs is optional, the server runs the monitor so single-terminal dev still works.
    if (process.env.JOBS_SEPARATE_PROCESS !== 'true') {
      setInterval(() => {
        alertMonitorTick().catch(err => console.error('[AlertMonitor] Tick failed:', err.message));
      }, 5 * 60 * 1000);
      setTimeout(() => alertMonitorTick().catch(() => {}), 30 * 1000);
      console.log('[AlertMonitor] Scheduled every 5 minutes (market hours only)');
    } else {
      console.log('[AlertMonitor] Skipped — running in jobs process');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
  });

  // Graceful shutdown — clean up connections and intervals on deploy/restart
  process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received — shutting down gracefully');
    server.close(() => {
      console.log('[Server] HTTP server closed');
      process.exit(0);
    });
    // Force exit after 10s if connections don't drain
    setTimeout(() => { console.error('[Server] Forced shutdown after timeout'); process.exit(1); }, 10000);
  });
}

boot().catch(err => {
  console.error('Failed to boot:', err);
  process.exit(1);
});
