// Per-request correlation IDs. Generates a short base36 ID per inbound request,
// attaches it to `req.requestId`, mirrors it back as an `X-Request-Id` response
// header (the frontend echoes this in error reports), and stores it in an
// AsyncLocalStorage so any deep call site can pull the current ID without
// having to thread it through every function signature.
//
// Why bother for a 10-user beta: the moment one of them DMs you "Outpost
// crashed when I clicked Close on my NVDA position," you want to grep the
// Railway logs for that user's request and see every log line that fired
// during it — not pick through interleaved stdout from concurrent requests.
//
// Tradeoff: we don't ship a structured logger (no pino) — the existing
// console.* calls stay untouched. Routes that handle real failures can opt
// into `req.log` for prefixed output; everything else flows through as-is.
import { AsyncLocalStorage } from 'node:async_hooks';

const ridStorage = new AsyncLocalStorage();

// 7 chars of base36 ≈ 78 bits of entropy — plenty for correlation, short
// enough to read in logs. Not cryptographically random (Math.random); this
// is for log readability, not security.
function newId() {
  return Math.random().toString(36).slice(2, 9);
}

export function getRequestId() {
  return ridStorage.getStore()?.requestId ?? null;
}

export function requestIdMiddleware() {
  return (req, res, next) => {
    // Trust client-provided X-Request-Id only if it looks safe (7-32 chars,
    // alnum + hyphen). Otherwise generate our own. This lets a frontend
    // pre-tag a request and follow it through, but blocks log injection.
    const incoming = req.headers['x-request-id'];
    const safe = typeof incoming === 'string' && /^[a-zA-Z0-9-]{7,32}$/.test(incoming);
    const rid = safe ? incoming : newId();
    req.requestId = rid;
    res.setHeader('X-Request-Id', rid);

    // Lightweight per-request log helper. Routes can call req.log.error('msg')
    // and the line will be prefixed [req:abc1234] so it's greppable.
    req.log = {
      info:  (...args) => console.log(`[req:${rid}]`, ...args),
      warn:  (...args) => console.warn(`[req:${rid}]`, ...args),
      error: (...args) => console.error(`[req:${rid}]`, ...args),
    };

    ridStorage.run({ requestId: rid }, next);
  };
}
