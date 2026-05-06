const store = new Map();
const MAX_STORE_SIZE = 10000; // Cap to prevent unbounded memory growth

// Clean expired entries every 2 minutes (down from 5)
setInterval(() => {
  const now = Date.now();
  for (const [key, calls] of store.entries()) {
    const fresh = calls.filter(t => now - t < 60000);
    if (!fresh.length) store.delete(key);
    else store.set(key, fresh);
  }
}, 2 * 60 * 1000);

export function rateLimit(max = 30, windowMs = 60000) {
  return (req, res, next) => {
    const key = `${req.user?.id || req.ip}:${req.path}`;
    const now = Date.now();
    if (!store.has(key)) {
      // Prevent unbounded growth — evict oldest entries if at capacity
      if (store.size >= MAX_STORE_SIZE) {
        const oldest = store.keys().next().value;
        store.delete(oldest);
      }
      store.set(key, []);
    }
    const calls = store.get(key).filter(t => now - t < windowMs);
    if (calls.length >= max) {
      return res.status(429).json({ error: 'Too many requests — please slow down' });
    }
    calls.push(now);
    store.set(key, calls);
    next();
  };
}

const ipStore = new Map();
const MAX_IP_STORE_SIZE = 5000;

// Clean IP store too
setInterval(() => {
  const now = Date.now();
  for (const [key, calls] of ipStore.entries()) {
    const fresh = calls.filter(t => now - t < 60000);
    if (!fresh.length) ipStore.delete(key);
    else ipStore.set(key, fresh);
  }
}, 2 * 60 * 1000);

export function globalRateLimit() {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const now = Date.now();
    if (!ipStore.has(ip)) {
      if (ipStore.size >= MAX_IP_STORE_SIZE) {
        const oldest = ipStore.keys().next().value;
        ipStore.delete(oldest);
      }
      ipStore.set(ip, []);
    }
    const calls = ipStore.get(ip).filter(t => now - t < 60000);
    if (calls.length >= 500) {
      return res.status(429).json({ error: 'Too many requests' });
    }
    calls.push(now);
    ipStore.set(ip, calls);
    next();
  };
}
