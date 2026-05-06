// Outpost Service Worker — minimal v1.
//
// Purpose: enable PWA installability (manifest + SW = installable).
// No caching, no offline mode in v1 — let the network handle every request.
// This avoids the classic SW pitfall where a buggy cache traps users on a
// stale version after a deploy.
//
// v2 (later): layer in stale-while-revalidate for /favicon.svg and the JS
// bundle, with a version-bump cache-bust strategy.

const VERSION = 'outpost-sw-v1';

self.addEventListener('install', (event) => {
  // Activate the new SW immediately on install — no waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of any open clients (so the active SW handles their fetches).
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch — browser networking, no cache. Required for installability
// even though we don't add custom logic.
self.addEventListener('fetch', () => {});
