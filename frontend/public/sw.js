const CACHE_NAME = 'kokomusic-shell-v1';

// Resolución dinámica del path base a partir del scope del service worker (por ejemplo, /kokoMusic/)
const getBase = () => {
  const scope = self.registration ? self.registration.scope : '/';
  const path = new URL(scope).pathname;
  return path.endsWith('/') ? path : path + '/';
};

// Rutas que NUNCA se cachean (siempre van a la red)
const NEVER_CACHE = [
  '/api/',
  '/stream/',
  'localhost:3001',
];

// ── Install: cachear el shell ─────────────────────────────
self.addEventListener('install', (event) => {
  const base = getBase();
  const assets = [
    base,
    `${base}index.html`,
    `${base}manifest.json`,
  ];
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assets).catch(() => {
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

  const base = getBase();

  // Para navegación (HTML) → network-first con fallback a cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(`${base}index.html`))
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

// ── Web Push ─────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'KokoMusic', body: event.data ? event.data.text() : '' }; }
  const base = getBase();
  event.waitUntil(
    self.registration.showNotification(data.title || 'KokoMusic', {
      body: data.body || '',
      icon: data.icon || `${base}icons/icon-192.png`,
      badge: `${base}icons/icon-monochrome-512.png`,
      tag: data.tag,
      renotify: !!data.tag,
      data: { url: data.url || '' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(getBase() + (event.notification.data?.url || ''), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.focus();
          if ('navigate' in w) return w.navigate(target).catch(() => {});
          return;
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
