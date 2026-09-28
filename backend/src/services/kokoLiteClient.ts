/**
 * KokoMusic-Lite Client
 *
 * Cliente oficial para el microservicio KokoMusic-lite (InnerTube sin yt-dlp).
 * Basado en la especificación de INTEGRATION.md.
 */

import { cache } from './cacheService';

const BASE_URL = (
  process.env.KOKO_LITE_BASE_URL ||
  process.env.KOKO_LITE_URL ||
  'https://backendkokomusic.onrender.com'
).replace(/\/$/, '');

const API_KEY = process.env.KOKO_LITE_API_KEY || '';

// ── Circuit breaker ──────────────────────────────────────────────────────────
// Si KokoMusic-lite empieza a fallar (caído, Render dormido, rate-limited),
// sin esto cada request de búsqueda/stream esperaría el timeout completo
// (10-20s) antes de poder hacer fallback, y la app entera se sentiría "colgada".
// Tras varios fallos seguidos, cortamos durante un enfriamiento y devolvemos
// null al instante para que el resto del pipeline pueda hacer fallback rápido.
const BREAKER_FAILURE_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 30_000;

let consecutiveFailures = 0;
let breakerOpenUntil = 0;

// ── Caché negativa por-video ───────────────────────────────────────────────
// Un video "problemático" (bloqueado por región, retirado, sin pistas de
// audio disponibles) puede hacer que KokoMusic-lite tarde 15-36s en fallar
// mientras prueba varios player_client de InnerTube por dentro. Sin esto,
// cada usuario que lo pida —o cada reintento nuestro— vuelve a pagar esa
// espera completa. Recordamos el fallo un rato para responder null al
// instante en vez de repetir la espera larga.
const NEGATIVE_CACHE_TTL_SEC = 600; // 10 min — suficiente para no repetir el golpe en la misma sesión, corto para reintentar si fue algo transitorio
function badVideoCacheKey(videoId: string): string {
  return `bad-video:${videoId}`;
}

function isBreakerOpen(): boolean {
  return Date.now() < breakerOpenUntil;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
}

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
    breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
    console.error(
      `[KokoLiteClient] 🔴 Circuit breaker abierto tras ${consecutiveFailures} fallos seguidos. ` +
      `Cortando llamadas durante ${BREAKER_COOLDOWN_MS / 1000}s.`
    );
  }
}

export interface ResolvedStream {
  url: string;
  mimeType: string;
  bitrate?: number;
  contentLength?: number;
  expiresAt: number; // Unix ms
  source: string;    // 'innertube'
  client?: string;   // 'IOS' | 'ANDROID' | 'YTMUSIC' | 'MWEB' | 'WEB_CREATOR'
  cached?: boolean;
}

export interface VideoSearchResult {
  id: string;
  title: string;
  author: string;
  durationSeconds: number;
  thumbnail: string;
}

export type KokoLiteResolvedStream = ResolvedStream;
export type KokoLiteSearchResult = VideoSearchResult;


function appendKey(url: string): string {
  if (!API_KEY) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}key=${encodeURIComponent(API_KEY)}`;
}

/**
 * URL del endpoint de KokoMusic-lite que reenvía los bytes de audio (ya no
 * un 302 a la URL cruda de googlevideo). Google firma esa URL con la IP
 * exacta del proxy que la pidió y su CDN rechaza con 403 cualquier IP
 * distinta — confirmado con un test aislado. Como el usuario final (navegador
 * o app móvil) nunca comparte IP con el pool de proxies residenciales de
 * KokoMusic-lite, redirigir al usuario a ESTE endpoint (en vez de a la URL
 * cruda) es lo que mantiene resolución y descarga en la misma IP.
 */
export function getStreamRelayUrl(videoId: string): string {
  return appendKey(`${BASE_URL}/api/stream/${encodeURIComponent(videoId)}`);
}

/**
 * Resuelve el stream de audio vía KokoMusic-lite.
 * Utiliza caché L1 en memoria calculando el TTL real a partir de `expiresAt`.
 */
export async function resolveStream(
  videoId: string,
  options?: { quality?: string; bitrate?: number }
): Promise<ResolvedStream | null> {
  const quality = options?.quality;
  const cacheKey = quality ? `resolved-stream:${videoId}:${quality}` : `resolved-stream:${videoId}`;

  // 1. Revisar caché L1 de memoria
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return { ...(JSON.parse(cached) as ResolvedStream), cached: true };
    } catch {}
  }

  // 1.4. Caché negativa — si este video concreto ya falló hace poco, no
  // repetir la espera larga (hasta 15-36s) de InnerTube probando client tras
  // client para nada. Ver comentario en badVideoCacheKey.
  if (cache.get(badVideoCacheKey(videoId))) {
    console.warn(`[KokoLiteClient] ⏸️  Video marcado como fallido recientemente — saltando resolución de ${videoId}`);
    return null;
  }

  // 1.5. Circuit breaker — si el servicio lleva varios fallos seguidos, no
  // esperar el timeout completo: fallar rápido para que el caller (stream.ts)
  // pueda decidir qué hacer sin bloquear al usuario.
  if (isBreakerOpen()) {
    console.warn(`[KokoLiteClient] ⏸️  Circuit breaker abierto — saltando resolución de ${videoId}`);
    return null;
  }

  // 2. Consulta al microservicio KokoMusic-lite
  const qParam = quality ? `quality=${encodeURIComponent(quality)}` : '';
  const urlWithQuery = `${BASE_URL}/api/stream/${encodeURIComponent(videoId)}/resolve${qParam ? `?${qParam}` : ''}`;
  const endpoint = appendKey(urlWithQuery);

  try {
    const res = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 404) {
      recordSuccess(); // el servicio respondió correctamente, solo no tiene el video
      console.warn(`[KokoLiteClient] Stream no encontrado para videoId: ${videoId}`);
      cache.setex(badVideoCacheKey(videoId), NEGATIVE_CACHE_TTL_SEC, '1');
      return null;
    }

    if (!res.ok) {
      recordFailure();
      console.error(`[KokoLiteClient] Error HTTP ${res.status} al resolver ${videoId}`);
      cache.setex(badVideoCacheKey(videoId), NEGATIVE_CACHE_TTL_SEC, '1');
      return null;
    }

    const data = (await res.json()) as ResolvedStream;
    if (!data?.url) {
      recordFailure();
      cache.setex(badVideoCacheKey(videoId), NEGATIVE_CACHE_TTL_SEC, '1');
      return null;
    }

    recordSuccess();

    // Calcular TTL con 30s de margen
    let ttlSec = 1800;
    if (data.expiresAt) {
      const remainingMs = data.expiresAt - Date.now();
      ttlSec = Math.max(60, Math.floor(remainingMs / 1000) - 30);
    }

    cache.setex(cacheKey, ttlSec, JSON.stringify(data));
    console.log(`[KokoLiteClient] ⚡ Stream resuelto: ${videoId} via ${data.client || 'InnerTube'} (TTL: ${ttlSec}s)`);
    return { ...data, cached: false };
  } catch (err: any) {
    recordFailure();
    // Timeout / error de red = problema del servicio (Render despertando,
    // proxy caído), no del video: no lo marcamos como malo — de eso ya se
    // encarga el circuit breaker.
    console.error(`[KokoLiteClient] Error resolviendo stream para ${videoId}:`, err.message || err);
    return null;
  }
}

/**
 * Purga la caché local y la del microservicio KokoMusic-lite.
 */
export async function purgeStreamCache(videoId: string): Promise<boolean> {
  cache.del(`resolved-stream:${videoId}`);
  // Sin esto, los reintentos del frontend (que purgan antes de reintentar)
  // chocaban siempre con la caché negativa y nunca volvían a preguntar a Lite.
  cache.del(badVideoCacheKey(videoId));
  const endpoint = appendKey(`${BASE_URL}/api/stream/${encodeURIComponent(videoId)}/cache`);

  try {
    const res = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (err: any) {
    console.warn(`[KokoLiteClient] Error purgando cache en Lite para ${videoId}:`, err.message || err);
    return false;
  }
}

/**
 * Busca videos en YouTube vía InnerTube en KokoMusic-lite.
 */
export async function searchVideos(query: string): Promise<VideoSearchResult[]> {
  if (isBreakerOpen()) {
    console.warn(`[KokoLiteClient] ⏸️  Circuit breaker abierto — saltando búsqueda de "${query}"`);
    return [];
  }

  const endpoint = appendKey(`${BASE_URL}/api/search?q=${encodeURIComponent(query)}`);

  try {
    const res = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      recordFailure();
      console.error(`[KokoLiteClient] Error en búsqueda HTTP ${res.status} para: "${query}"`);
      return [];
    }

    recordSuccess();
    const data = (await res.json()) as { count?: number; results?: VideoSearchResult[] };
    return Array.isArray(data?.results) ? data.results : [];
  } catch (err: any) {
    recordFailure();
    console.error(`[KokoLiteClient] Error en búsqueda para "${query}":`, err.message || err);
    return [];
  }
}

/**
 * Diagnóstico de todos los clientes de InnerTube para un video.
 */
export async function diagnoseStream(videoId: string): Promise<any> {
  const endpoint = appendKey(`${BASE_URL}/api/stream/${encodeURIComponent(videoId)}/diagnose`);
  try {
    const res = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      },
      signal: AbortSignal.timeout(20000),
    });
    return await res.json();
  } catch (err: any) {
    return { error: err.message || String(err) };
  }
}

/**
 * Chequeo de salud del servicio.
 */
export async function checkHealth(): Promise<{ ok: boolean; status?: string; cache?: any; error?: string; breaker: { open: boolean; consecutiveFailures: number; reopensAt: number | null } }> {
  const breaker = {
    open: isBreakerOpen(),
    consecutiveFailures,
    reopensAt: isBreakerOpen() ? breakerOpenUntil : null,
  };
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, breaker };
    const data = (await res.json()) as any;
    return { ok: true, status: data.status, cache: data.cache, breaker };
  } catch (err: any) {
    return { ok: false, error: err.message || String(err), breaker };
  }
}

/**
 * Consulta el perfil de un artista vía InnerTube en KokoMusic-lite.
 */
export async function lookupArtist(query: string): Promise<any | null> {
  const endpoint = appendKey(`${BASE_URL}/api/artist/lookup?q=${encodeURIComponent(query)}`);
  try {
    const res = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}


export interface LiteLyricsResult {
  videoId: string;
  title?: string;
  artists: string[];
  lyrics: string;
  source?: string;
}

/**
 * Letra en texto plano desde YouTube Music (Musixmatch/LyricFind) vía
 * KokoMusic-lite. Respaldo para cuando LRCLIB no tiene la canción. Lite ya
 * valida artista/título y cachea aciertos (7 días) y fallos (6h).
 */
export async function getLiteLyrics(artist: string, title: string): Promise<LiteLyricsResult | null> {
  if (isBreakerOpen()) return null;
  const params = new URLSearchParams({ artist, title });
  const endpoint = appendKey(`${BASE_URL}/api/lyrics?${params.toString()}`);
  try {
    const res = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as LiteLyricsResult;
    return data?.lyrics ? data : null;
  } catch (err: any) {
    console.warn(`[KokoLiteClient] Error obteniendo letra de "${artist} - ${title}":`, err.message || err);
    return null;
  }
}

// Aliases para máxima compatibilidad con el resto del proyecto
export const resolveAudioStream = resolveStream;
export const resolveLiteStream = resolveStream;
export const searchLite = searchVideos;
export const checkLiteHealth = checkHealth;
export const diagnoseLiteStream = diagnoseStream;
export const purgeLiteCache = purgeStreamCache;
