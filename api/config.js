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

// Model selection, per tier, behind one knob each. The model is a SWAPPABLE part:
// when one retires (Sonnet 4 retires 2026-06-15) or a better one ships (Opus 4.8,
// Fable 5, whatever's next), change the value here or via env and qualify it with
// `npm run eval:model` BEFORE it reaches a user. Never hardcode a model id at a call
// site again. Defaults are the current production models; override per environment.
//   agent: the Tier-3 conversational brain (the product). Where intelligence matters.
//   reads: Deploy Cash + position reads (ai.js). User-facing analysis.
//   cheap: greetings, lookups, scans, the grader, jobs. Trivial/high-volume tasks.
config.models = {
  // agent promoted to Opus 4.8 after it cleared the eval gate (npm run eval:model):
  // avg 96 vs Sonnet-4's 77, zero bright-line fails vs 1, and it held the line on the
  // panic-liquidation case Sonnet-4 caved on. The temperature gate (modelParams.js)
  // omits the param Opus 4.8 removed, so this is a clean swap.
  agent: process.env.AGENT_MODEL || 'claude-opus-4-8',
  // reads moved off the DEPRECATED Sonnet-4 to current Sonnet 4.6: a same-family
  // upgrade (low behavioral-shift risk, the reads prompts were tuned for Sonnet),
  // cost-appropriate for this higher-volume grounded surface, and the Deploy Cash
  // safety rules are separately audited (_deploy_cash_audit.mjs). A full A/B (the
  // deploy-cash matrix runs live-backend) is the next rigor step if we want to
  // consider Opus 4.8 here for max quality on the buy-recommendation surface.
  reads: process.env.READS_MODEL || 'claude-sonnet-4-6',
  cheap: process.env.CHEAP_MODEL || 'claude-haiku-4-5-20251001',
};

console.log('✅ Environment validated');
