import dotenv from 'dotenv';
dotenv.config();

const required = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY', 
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'POLYGON_API_KEY',
  'RESEND_API_KEY',
];

const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error('❌ Missing required environment variables:');
  missing.forEach(k => console.error(`   ${k}`));
  process.exit(1);
}

export const config = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  polygonKey: process.env.POLYGON_API_KEY,
  resendKey: process.env.RESEND_API_KEY,
  finnhubKey: process.env.FINNHUB_API_KEY || '',
  fmpKey: process.env.FMP_API_KEY || '',
  stripeSecret: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  snaptradeClientId: process.env.SNAPTRADE_CLIENT_ID || '',
  snaptradeConsumerKey: process.env.SNAPTRADE_CONSUMER_KEY || '',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  port: process.env.PORT || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
};

// Brokerage sync. OFF by default: the app uses the 'manual' provider (positions
// are hand-entered), exactly as today. It only turns on when a provider is
// selected via BROKERAGE_PROVIDER and that provider's keys are present, so this
// can ship dormant and be flipped on the day the SnapTrade account exists.
const brokerageProvider = process.env.BROKERAGE_PROVIDER || 'manual';
config.brokerage = {
  provider: brokerageProvider,
  enabled: brokerageProvider === 'snaptrade'
    ? !!(config.snaptradeClientId && config.snaptradeConsumerKey)
    : false,
};

// Decision-intelligence base rates and retail-trap stats are COMPILED,
// FOUNDER-ONLY data. They are still being collected and the per-ticker samples
// are tiny (e.g. "25% win on 8 closed trades"), so they must NOT appear in
// user-facing agent answers yet. OFF by default; set SURFACE_RETAIL_INTEL=true to
// begin adding them back to responses once the data is concrete.
config.surfaceRetailIntel = process.env.SURFACE_RETAIL_INTEL === 'true';

console.log('✅ Environment validated');
