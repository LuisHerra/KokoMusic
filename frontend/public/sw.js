const CACHE_NAME = 'kokomusic-shell-v1';

// Assets del shell de la app que cacheamos para offline/fast load
// NO cacheamos streams de audio ni llamadas a la API
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// Rutas que NUNCA se cachean (siempre van a la red)
const NEVER_CACHE = [
  '/api/',
  '/stream/',
  'localhost:3001',
];

// ── Install: cachear el shell ─────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch(() => {
        // En modo local no hay shell remoto que cachear — ignorar error
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: limpiar caches viejos ──────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first para API, cache-first para shell ─
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Nunca interceptar streams de audio ni API calls
  const isApi = NEVER_CACHE.some((pattern) => event.request.url.includes(pattern));
  if (isApi || event.request.method !== 'GET') return;

  // Para navegación (HTML) → network-first con fallback a cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Para assets estáticos → cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    })
  );
});
