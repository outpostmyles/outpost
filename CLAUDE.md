# Outpost — Claude Session Notes

## Launch commands

The project lives at `/Users/mylesschenfield/Downloads/outpost_new` on Myles's machine. To start the app locally, open two terminals and run:

**Backend (Express API):**
```
cd /Users/mylesschenfield/Downloads/outpost_new && npm run server
```

**Frontend (Vite dev server):**
```
cd /Users/mylesschenfield/Downloads/outpost_new && npm run dev
```

Frontend serves on http://localhost:5173 and talks to the backend automatically. Both must be running for the app to work — the frontend will load with an empty backend but every position card / data fetch will silently return nothing.

Optional third terminal for scheduled jobs (Portfolio Recap auto-generation, Bargain Radar nightly scan, Pre-market briefs, Portfolio Explainers):
```
cd /Users/mylesschenfield/Downloads/outpost_new && npm run jobs
```

These are the ONLY launch commands. Do not invent variations like `node api/server.js` directly, or omit the `cd` prefix, or guess at relative paths — the absolute path matters because Myles runs these from a fresh terminal each time.
