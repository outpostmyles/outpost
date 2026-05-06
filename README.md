# Outpost — Trade like you know something.

## Setup

### 1. Add your API keys
Copy `.env.example` to `.env` and fill in your keys:
```
cp .env.example .env
```

Open `.env` and replace each placeholder with your real key:
- `VITE_SUPABASE_ANON_KEY` — Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key
- `POLYGON_API_KEY` — Polygon/Massive API key
- `ANTHROPIC_API_KEY` — Anthropic API key
- `FMP_API_KEY` — FMP API key

### 2. Set up the database
Go to your Supabase project → SQL Editor → paste the entire contents of `schema.sql` → click Run.

### 3. Install dependencies
```
npm install
```

### 4. Run locally
Open two terminals:

Terminal 1 — Frontend:
```
npm run dev
```

Terminal 2 — Backend:
```
npm run server
```

Open http://localhost:5173

## Deploy to Vercel

1. Push this folder to a GitHub repo
2. Go to vercel.com → New Project → import your repo
3. Add all environment variables in Vercel project settings
4. Deploy

## Stack
- Frontend: Vite + React
- Backend: Node.js + Express
- Database: Supabase (Postgres)
- Market Data: Polygon.io
- AI: Claude API (Anthropic)
- Payments: Stripe (coming soon)
