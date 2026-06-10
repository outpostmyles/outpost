# Outpost deploy runbook (private beta)

This gets Outpost off localhost and in front of real people. The code side is
ready; this walks the parts only you can do (creating accounts, pasting secrets,
DNS). Budget about 60 to 90 minutes the first time.

## The shape of it

Three pieces, wired together:

```
  Vercel  (static frontend, the Vite build)
     |  calls VITE_API_URL
     v
  Railway (two services from this same repo)
     - web:    npm start      the Express API
     - worker: npm run jobs   the nightly recaps, bargain radar, alerts
     |
     v
  Supabase (Postgres, already yours)
```

Auth is custom session tokens carried in the Authorization header, and row level
security is intentionally OFF (isolation is enforced in the Express layer). That
means the frontend never talks to Supabase directly and never holds a service
key. Only the backend does.

## What you will need

- A Supabase project (you already have one, from our work).
- A Railway account (railway.app), free tier is fine to start.
- A Vercel account (vercel.com), free tier is fine.
- API keys you already have: Anthropic, Polygon, Resend.
- This repo pushed to a Git remote (GitHub) so Railway and Vercel can build it.
  It is committed locally but has no remote yet, so step 0 is push it up.

## Step 0. Push the repo to GitHub  [YOU]

Create an empty private repo on GitHub, then from the project folder:

```
git remote add origin git@github.com:YOURNAME/outpost.git
git push -u origin main
```

Railway and Vercel both deploy from the GitHub repo.

## Step 1. Supabase: schema + keys

Your existing project is migrated through `022_atomic_cash_balance.sql`. The beta
adds ONE more: run `023_atomic_close_with_cash.sql` in the SQL editor before the
beta (it folds the cash credit into the same transaction as a position close/trim
so a crash can't drift cash from holdings, and serializes "set my cash" under the
same per-user lock). The app runs correctly without it (it falls back to the
resilient two-step), so this is an upgrade, not a hard gate, but apply it. Then
grab the keys (skip to 1b). To launch on a CLEAN project with no seed data, do 1a.

### 1a. Fresh project (optional)  [YOU]
1. New project in Supabase.
2. SQL editor, run `supabase-setup.sql` (the base schema).
3. Then run, in order, every file in `api/migrations/` from `002` through `023`.
   Run them one at a time, oldest first. They are idempotent enough to re-run.

### 1b. Grab the keys  [YOU]
From Project Settings, API, copy: the Project URL, the `anon` public key, and the
`service_role` secret key. You will paste these into Railway next.

## Step 2. Backend on Railway

The API and the jobs worker are two services in one Railway project, both built
from this repo.

### 2a. The API service  [YOU]
1. New project, Deploy from GitHub repo, pick the repo.
2. Settings, set the Start Command to `npm start`. (If Railway tries to run a
   build, that is fine; the Vite build is harmless here and the API ignores it.)
3. Variables, add all of these:

   Required (the server refuses to boot without them):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ANTHROPIC_API_KEY`
   - `POLYGON_API_KEY`
   - `RESEND_API_KEY`

   App config:
   - `NODE_ENV=production`
   - `FRONTEND_URL=` leave blank for now, you will set it in step 4
   - `BETA_ALLOWLIST_OPEN=false`  (keeps signup gated to invited emails)
   - `FOUNDER_EMAILS=your@email.com`  (your admin access + founder digest)
   - `JOBS_SEPARATE_PROCESS=true`  (IMPORTANT: stops the alert monitor running
     in both the API and the worker)

   Optional (features degrade gracefully if absent):
   - `FINNHUB_API_KEY`, `FMP_API_KEY`, `ADMIN_SECRET`
4. Deploy. When it is green, open the service URL and hit `/api/health`. You want
   `200` and `supabase: true`. Copy this URL (for example
   `https://outpost-api.up.railway.app`); it is your backend URL.

### 2b. The jobs worker service  [YOU]
1. In the same Railway project, add a second service from the same repo.
2. Start Command: `npm run jobs`.
3. Give it the SAME variables as the API service, with one difference: it does
   not need `JOBS_SEPARATE_PROCESS` (or set it to `false` here). The flag's job
   is to silence the monitor on the API side so only the worker runs it.
4. Deploy. This is what generates the morning briefs, the nightly bargain scan,
   the portfolio recaps, and fires price alerts.

## Step 3. Frontend on Vercel  [YOU]

1. New Project, import the same GitHub repo. Vercel reads `vercel.json` and uses
   the Vite preset automatically (build `vite build`, output `dist`, SPA rewrite).
2. Before the first deploy, add an Environment Variable:
   - `VITE_API_URL=` your Railway backend URL from step 2a.
   This is baked into the bundle at build time, so it must be set before you
   build. If you set it after, redeploy.
3. Deploy. Copy the Vercel URL (for example `https://outpost.vercel.app`).

## Step 4. Wire them together  [YOU]

The backend's CORS only allows the exact frontend origin, so it has to know it.
1. Back on Railway, set `FRONTEND_URL` on BOTH services to your Vercel URL
   (no trailing slash, for example `https://outpost.vercel.app`).
2. Redeploy the API service so CORS picks it up.

Now the frontend at the Vercel URL can talk to the backend.

## Step 5. Custom domain (optional)  [YOU]

1. In Vercel, Project, Domains, add your domain (for example `app.outpost.co`).
2. Add the DNS records Vercel shows you at your registrar (a CNAME for a
   subdomain, or the A record for an apex).
3. Once it resolves, update `FRONTEND_URL` on both Railway services to the custom
   domain and redeploy the API. (Optional: add the custom backend domain in
   Railway too and update `VITE_API_URL` to match, then redeploy Vercel.)

## Step 6. Smoke test  [YOU]

1. `GET https://your-backend/api/health` returns 200.
2. Open the frontend. You should land on the auth screen.
3. Add your own email to the allowlist so you can sign up. Either run, against
   the prod DB, `node tests/_beta_invite.mjs you@email.com`, or in Supabase SQL:
   `insert into beta_allowlist (email) values ('you@email.com');`
4. Sign up, walk the onboarding (the live read, the five-tab tour), land in the
   app. Add a position, ask the agent a question, open Think It Through.
5. Open Settings; your `FOUNDER_EMAILS` email should see the Founder Dashboard
   with the Report Card up top.

## Step 7. Invite your beta people  [YOU]

For each person, add their email to the allowlist (same as 6.3). They can then
sign up. Keep `BETA_ALLOWLIST_OPEN=false` so only invited emails get in.

## Gotchas

- CORS errors in the browser console almost always mean `FRONTEND_URL` does not
  exactly match the origin you are visiting (http vs https, trailing slash, www
  vs apex). Fix it on Railway and redeploy the API.
- If the API logs "Missing required environment variables" and exits, one of the
  six required vars in step 2a is unset.
- The worker is what makes the app feel alive overnight. If briefs and alerts
  never arrive, check the worker service is deployed and has `RESEND_API_KEY`.
- Market data is on the minimum Polygon tier, so a few names lag or miss a
  percent. That is expected for the beta; the app degrades honestly.
- Nothing here turns on payments. Stripe is stubbed and plans are "coming soon";
  the beta runs on the free tier with the unlimited beta plan.
```
