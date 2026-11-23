/**
 * backendResolver.ts
 *
 * Resuelve automáticamente qué backend usar en orden de prioridad:
 *
 *   1. Override manual  → localStorage 'koko_backend_url'
 *   2. Local             → http://localhost:3001  (dev / local mode)
 *   3. Cloudflare Tunnel → URL dinámica guardada en localStorage 'koko_tunnel_url'
 *   4. Hugging Face      → VITE_API_URL del .env (fallback cloud)
 *
 * El resultado se cachea en memoria para la sesión y se expone vía getBaseUrl().
 */

const STORAGE_OVERRIDE_KEY = 'koko_backend_url';
const STORAGE_TUNNEL_KEY   = 'koko_tunnel_url';
const HEALTH_PATH          = '/api/health';
const TIMEOUT_MS           = 3000;

const HF_URL       = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';
const LOCAL_URL    = 'http://localhost:3001/api';

// Resuelve la URL base (sin /api) del .env para construir candidatos
const HF_BASE = HF_URL.replace(/\/api$/, '');

// Backend de respaldo (otra cuenta de Render). Solo se usa si el principal no
// responde — p. ej. suspendido por agotar el ancho de banda del mes. Dejar la
// variable vacía desactiva por completo el respaldo (y su health check extra).
const FALLBACK_BASE = ((import.meta.env.VITE_API_URL_FALLBACK as string | undefined) ?? '')
  .trim()
  .replace(/\/api\/?$/, '')
  .replace(/\/$/, '');

// ─────────────────────────────────────────────────────────────────────────────

let resolvedBase: string | null = null;   // URL base resuelta (sin /api)
let resolving: Promise<string> | null = null;

/**
 * Hace un health check con timeout. Retorna true si responde OK.
 *
 * `requireKokoSignature`: además de un 200, exige que el body tenga la forma
 * del /api/health de KokoMusic (campo `kokoLite`). Necesario para el check
 * de "origen actual" (paso 2) — cuando el frontend vive embebido en un dominio
 * ajeno (kokoworks.es/kokoMusic dentro de KokoPortfolio), ese mismo dominio
 * puede tener su PROPIO /api/health (de otro proyecto) que también devuelve
 * 200, haciendo que el resolver confunda ese origen con el backend real.
 */
async function probe(base: string, requireKokoSignature = false): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${base}${HEALTH_PATH}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    if (!requireKokoSignature) return true;
    const data = await res.json();
    return typeof data === 'object' && data !== null && 'kokoLite' in data;
  } catch {
    return false;
  }
}

const clean = (u: string) => u.replace(/\/api\/?$/, '').replace(/\/$/, '');

// Túnel de Cloudflare fijo (p. ej. https://api.midominio.com → backend en casa,
// IP residencial: YouTube no lo bloquea y busca más rápido que el cloud).
// Se define al compilar con VITE_TUNNEL_URL; vacío = desactivado.
const BUILD_TUNNEL_BASE = clean(((import.meta.env.VITE_TUNNEL_URL as string | undefined) ?? '').trim());

const LAST_GOOD_KEY = 'koko_last_backend';

/** lazy: solo se prueba si fallan los anteriores (el respaldo no admite CORS desde la web y ensuciaba la consola). */
interface Candidate { base: string; label: string; signature: boolean; onFail?: () => void; lazy?: boolean }

function candidates(): Candidate[] {
  const list: Candidate[] = [];
  const override = localStorage.getItem(STORAGE_OVERRIDE_KEY);
  if (override) list.push({ base: clean(override), label: 'Override', signature: false });

  if (typeof window !== 'undefined' && window.location) {
    const originBase = window.location.origin;
    const isViteDev = originBase.includes(':5173') || originBase.includes(':3000');
    if (!isViteDev) list.push({ base: originBase, label: 'Origen actual', signature: true });
  }

  // Desde una página https el navegador bloquea http://localhost (contenido mixto)
  const pageIsHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
  if (!pageIsHttps || /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)) {
    list.push({ base: clean(LOCAL_URL), label: 'Local', signature: false });
  }

  const tunnelUrl = localStorage.getItem(STORAGE_TUNNEL_KEY);
  if (tunnelUrl) {
    list.push({ base: clean(tunnelUrl), label: 'Tunnel guardado', signature: false, onFail: () => localStorage.removeItem(STORAGE_TUNNEL_KEY) });
  }
  if (BUILD_TUNNEL_BASE) list.push({ base: BUILD_TUNNEL_BASE, label: 'Cloudflare Tunnel', signature: true });

  list.push({ base: HF_BASE, label: 'Cloud', signature: true });
  if (FALLBACK_BASE && FALLBACK_BASE !== HF_BASE) list.push({ base: FALLBACK_BASE, label: 'Respaldo', signature: true, lazy: true });

  // Sin duplicados (conserva la prioridad)
  return list.filter((c, i) => list.findIndex((o) => o.base === c.base) === i);
}

/**
 * Resuelve el backend una única vez. Antes cada candidato se probaba en serie
 * (hasta 3 s cada uno), así que la primera búsqueda podía esperar 6-9 s.
 * Ahora se prueban todos a la vez y gana el de más prioridad que responda.
 */
async function resolveBackend(): Promise<string> {
  const list = candidates();
  const probes = list.map((c) => (c.lazy ? null : probe(c.base, c.signature)));
  for (let i = 0; i < list.length; i++) {
    if (await (probes[i] ?? probe(list[i].base, list[i].signature))) {
      console.info(`[BackendResolver] ✅ ${list[i].label}: ${list[i].base}`);
      try { localStorage.setItem(LAST_GOOD_KEY, list[i].base); } catch { /* sin storage */ }
      return list[i].base;
    }
    list[i].onFail?.();
  }
  console.info(`[BackendResolver] ℹ️  Ninguno respondió; usando backend cloud: ${HF_BASE}`);
  return HF_BASE;
}

/**
 * Arranque sin espera: si el último backend bueno sigue siendo candidato se usa
 * ya y se revalida en segundo plano; si la revalidación elige otro, se cambia.
 */
function optimisticBackend(): string | null {
  try {
    const last = localStorage.getItem(LAST_GOOD_KEY);
    // Nunca arrancar contra el respaldo: solo se usa si el principal falla en
    // este momento (y puede estar suspendido por haber superado su límite).
    if (last && last === FALLBACK_BASE) { localStorage.removeItem(LAST_GOOD_KEY); return null; }
    if (last && candidates().some((c) => c.base === last && !c.lazy)) return last;
  } catch { /* sin storage */ }
  return null;
}

/** Devuelve la URL base resuelta (sin /api al final). */
export async function getBaseUrl(): Promise<string> {
  if (resolvedBase) return resolvedBase;
  if (resolving)    return resolving;

  const optimistic = optimisticBackend();
  if (optimistic) {
    resolvedBase = optimistic;
    resolveBackend().then((url) => {
      if (url !== resolvedBase) console.info(`[BackendResolver] 🔁 Cambio de backend: ${resolvedBase} → ${url}`);
      resolvedBase = url;
    }).catch(() => {});
    return optimistic;
  }

  resolving = resolveBackend().then((url) => {
    resolvedBase = url;
    resolving = null;
    // Log resolved backend to the server console
    import('./logger').then(({ logToServer }) => {
      logToServer('INFO', `Backend resolver finalized. Resolved URL: ${url}`, {
        userAgent: navigator.userAgent,
        href: window.location.href,
        origin: window.location.origin
      });
    }).catch(() => {});
    return url;
  });

  return resolving;
}

/** Devuelve la URL /api resuelta. */
export async function getApiUrl(): Promise<string> {
  const base = await getBaseUrl();
  return `${base}/api`;
}

/** Devuelve el valor actual en caché (puede ser null si aún no se resolvió). */
export function getCachedBaseUrl(): string | null {
  return resolvedBase;
}

/** Invalida el caché para forzar re-detección. */
export function invalidateBackendCache(): void {
  resolvedBase = null;
  resolving    = null;
}

// ── API pública de configuración de tunnel ────────────────────────────────────

/** Guarda la URL del Cloudflare Tunnel en localStorage. */
export function setTunnelUrl(url: string): void {
  const clean = url.replace(/\/api$/, '').replace(/\/$/, '');
  localStorage.setItem(STORAGE_TUNNEL_KEY, clean);
  invalidateBackendCache();
  console.info(`[BackendResolver] Tunnel configurado: ${clean}`);
}

/** Limpia el tunnel guardado. */
export function clearTunnelUrl(): void {
  localStorage.removeItem(STORAGE_TUNNEL_KEY);
  invalidateBackendCache();
}

/** Devuelve la URL del tunnel guardado, si existe. */
export function getTunnelUrl(): string | null {
  return localStorage.getItem(STORAGE_TUNNEL_KEY);
}

/** Override manual permanente (útil para devs o builds móviles). */
export function setBackendOverride(url: string): void {
  const clean = url.replace(/\/api$/, '').replace(/\/$/, '');
  localStorage.setItem(STORAGE_OVERRIDE_KEY, clean);
  invalidateBackendCache();
}

export function clearBackendOverride(): void {
  localStorage.removeItem(STORAGE_OVERRIDE_KEY);
  invalidateBackendCache();
}

export function getBackendStatus(): {
  mode: 'override' | 'local' | 'tunnel' | 'cloud' | 'unknown';
  url: string | null;
} {
  const cached = getCachedBaseUrl();
  if (!cached) return { mode: 'unknown', url: null };

  const override = localStorage.getItem(STORAGE_OVERRIDE_KEY);
  if (override && cached === override.replace(/\/api$/, '').replace(/\/$/, ''))
    return { mode: 'override', url: cached };

  const localBase = LOCAL_URL.replace(/\/api$/, '');
  if (cached === localBase)
    return { mode: 'local', url: cached };

  const tunnel = localStorage.getItem(STORAGE_TUNNEL_KEY);
  if (tunnel && cached === tunnel.replace(/\/api$/, '').replace(/\/$/, ''))
    return { mode: 'tunnel', url: cached };

  return { mode: 'cloud', url: cached };
}
