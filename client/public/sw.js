self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Keep authenticated data and application updates on the network, never in an offline cache.
self.addEventListener('fetch', (event) => event.respondWith(fetch(event.request)));
