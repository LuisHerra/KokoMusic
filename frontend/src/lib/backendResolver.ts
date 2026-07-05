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

// ─────────────────────────────────────────────────────────────────────────────

let resolvedBase: string | null = null;   // URL base resuelta (sin /api)
let resolving: Promise<string> | null = null;

/** Hace un health check con timeout. Retorna true si responde OK. */
async function probe(base: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${base}${HEALTH_PATH}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** Resuelve el backend una única vez y cachea el resultado. */
async function resolveBackend(): Promise<string> {
  // 1. Override manual del usuario (Settings panel o URL de tunnel copiada)
  const override = localStorage.getItem(STORAGE_OVERRIDE_KEY);
  if (override) {
    const base = override.replace(/\/api$/, '').replace(/\/$/, '');
    const ok = await probe(base);
    if (ok) {
      console.info(`[BackendResolver] ✅ Override: ${base}`);
      return base;
    }
    console.warn(`[BackendResolver] ⚠️  Override ${base} no responde — ignorado`);
  }

  // 2. Origen actual del navegador (si el frontend es servido por el backend o proxy)
  if (typeof window !== 'undefined' && window.location) {
    const originBase = window.location.origin;
    const isViteDev = originBase.includes(':5173') || originBase.includes(':3000'); // Puertos típicos de dev
    if (!isViteDev) {
      const ok = await probe(originBase);
      if (ok) {
        console.info(`[BackendResolver] ✅ Origen actual es backend: ${originBase}`);
        return originBase;
      }
    }
  }

  // 3. Local (residential IP — sin bloqueo YouTube)
  const localBase = LOCAL_URL.replace(/\/api$/, '');
  if (await probe(localBase)) {
    console.info('[BackendResolver] ✅ Backend local detectado');
    return localBase;
  }

  // 3. Cloudflare Tunnel guardado en localStorage
  const tunnelUrl = localStorage.getItem(STORAGE_TUNNEL_KEY);
  if (tunnelUrl) {
    const tunnelBase = tunnelUrl.replace(/\/api$/, '').replace(/\/$/, '');
    if (await probe(tunnelBase)) {
      console.info(`[BackendResolver] ✅ Tunnel activo: ${tunnelBase}`);
      return tunnelBase;
    }
    console.warn('[BackendResolver] ⚠️  Tunnel guardado no responde — limpiando');
    localStorage.removeItem(STORAGE_TUNNEL_KEY);
  }

  // 4. Fallback HF / variable de entorno
  console.info(`[BackendResolver] ℹ️  Usando backend cloud: ${HF_BASE}`);
  return HF_BASE;
}

/** Devuelve la URL base resuelta (sin /api al final). */
export async function getBaseUrl(): Promise<string> {
  if (resolvedBase) return resolvedBase;
  if (resolving)    return resolving;

  resolving = resolveBackend().then((url) => {
    resolvedBase = url;
    resolving = null;
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
