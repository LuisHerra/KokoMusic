/**
 * kokoLiteClient.ts
 *
 * Cliente delgado hacia el backend kokomusic-lite (InnerTube, resolve &
 * redirect, sin yt-dlp). Este archivo va en TU BACKEND ORIGINAL — reemplaza
 * el rol combinado de:
 *   - services/streamResolverService.ts (el waterfall viejo)
 *   - services/ytdlpService.ts
 *   - services/ytdlpSearchService.ts
 *   - services/innerTubeService.ts (el hecho a mano, con fingerprints 2024)
 *   - services/jiosaavnService.ts / invidiousService.ts (como fuentes del
 *     camino crítico — JioSaavn puede seguir viviendo como fallback tardío
 *     si ya lo tenés andando bien, este cliente no lo reemplaza)
 *
 * Variables de entorno nuevas que necesita tu backend original:
 *   KOKO_LITE_BASE_URL=https://backendkokomusic.onrender.com
 *   KOKO_LITE_API_KEY=tu-api-key (la misma que configuraste en Render)
 */

const BASE_URL = process.env.KOKO_LITE_BASE_URL;
const API_KEY = process.env.KOKO_LITE_API_KEY;

if (!BASE_URL) {
  console.warn(
    '[kokoLiteClient] KOKO_LITE_BASE_URL no está configurada — toda resolución de streams va a fallar.'
  );
}

function buildUrl(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${BASE_URL}${path}${API_KEY ? `${sep}key=${encodeURIComponent(API_KEY)}` : ''}`;
}

/**
 * Timeout por defecto generoso (10s). Si tenés el GitHub Action de
 * keep-alive corriendo, el servicio nunca debería estar en cold start, pero
 * conviene no confiar ciegamente en eso — si algún día el ping falla, un
 * cold start real puede tardar hasta ~60s en Render free.
 */
async function fetchJson<T>(path: string, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(buildUrl(path), { signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export interface ResolvedStream {
  url: string;
  mimeType: string;
  bitrate?: number;
  contentLength?: number;
  expiresAt: number;
  source: 'innertube';
  client: string;
  cached: boolean;
}

/**
 * Reemplaza a streamResolverService.resolveAudioStream(youtubeId).
 * Devuelve null (en vez de tirar) si falla, para que el caller decida el
 * fallback (404 al usuario, o tu propio fallback de JioSaavn si lo tenés).
 */
export async function resolveStream(youtubeId: string): Promise<ResolvedStream | null> {
  try {
    return await fetchJson<ResolvedStream>(`/api/stream/${youtubeId}/resolve`);
  } catch (err) {
    console.error(`[kokoLiteClient] resolveStream(${youtubeId}) falló:`, err);
    return null;
  }
}

/** Purga la caché del lado del servicio lite — llamar cuando el cliente reporta una URL rota (403/404 al reproducir). */
export async function purgeStreamCache(youtubeId: string): Promise<void> {
  try {
    await fetch(buildUrl(`/api/stream/${youtubeId}/cache`), { method: 'DELETE' });
  } catch {
    // no crítico si la purga falla
  }
}

export interface SearchResultItem {
  id: string;
  title: string;
  author?: string;
  durationSeconds?: number;
  thumbnail?: string;
}

/**
 * Reemplaza la búsqueda de video que hacían yt-search (npm) + yt-dlp search
 * en services/ytdlpSearchService.ts / ytResolverService.ts.
 */
export async function searchVideos(query: string): Promise<SearchResultItem[]> {
  const data = await fetchJson<{ results: SearchResultItem[] }>(
    `/api/search?q=${encodeURIComponent(query)}`
  );
  return data.results;
}

export interface ArtistProfile {
  id: string;
  name: string;
  description?: string;
  thumbnail?: string;
  topSongs: Array<{ id: string; title: string; thumbnail?: string; durationSeconds?: number }>;
  albums: Array<{ id?: string; title: string; year?: string; thumbnail?: string }>;
  relatedArtists: Array<{ id: string; name: string; thumbnail?: string }>;
}

/**
 * Complementa (no reemplaza necesariamente) a services/artistService.ts.
 * Útil como fuente de bio/foto/top-songs cuando iTunes/Last.fm no tienen
 * buena cobertura para un artista de nicho — que es justo el caso que
 * motivó esta pregunta.
 */
export async function lookupArtist(query: string): Promise<ArtistProfile | null> {
  try {
    return await fetchJson<ArtistProfile>(`/api/artist/lookup?q=${encodeURIComponent(query)}`);
  } catch (err) {
    console.error(`[kokoLiteClient] lookupArtist(${query}) falló:`, err);
    return null;
  }
}
