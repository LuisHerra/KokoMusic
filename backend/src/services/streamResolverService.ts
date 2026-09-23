/**
 * Stream Resolver Service — KokoMusic
 *
 * Resuelve el stream de audio exclusivamente a través del microservicio
 * KokoMusic-lite (InnerTube / youtubei.js), sin yt-dlp ni CDN local.
 *
 * Estrategia de caché:
 *   1. L1 Memory Cache con TTL exacto derivado del `expiresAt` real de googlevideo.
 *   2. Resolución directa vía KokoMusic-lite.
 */

import { cache } from './cacheService';
import { resolveLiteStream, purgeLiteCache, type KokoLiteResolvedStream } from './kokoLiteService';
import { resolveYoutubeId } from './ytResolverService';
import { metrics } from './metricsService';
import { findTrackInCDN } from './cdnService';

export type StreamSourceType = 'innertube' | 'lite';

export interface ResolvedStream {
  url: string;
  source: string;
  mimeType: string;
  bitrate?: number;
  durationMs?: number;
  expiresAt?: number;
  client?: string;
  cached?: boolean;
}

export interface StreamResolutionHints {
  artist?: string;
  title?: string;
  itunesId?: number | string;
  quality?: string;
}

/**
 * Purga la entrada de caché local y la del microservicio KokoMusic-lite.
 */
export async function purgeStreamCache(youtubeId: string): Promise<boolean> {
  const cacheKey = `resolved-stream:${youtubeId}`;
  cache.del(cacheKey);
  const litePurged = await purgeLiteCache(youtubeId);
  console.log(`[StreamResolver] Cache purgada para ${youtubeId} (L1 local + Lite: ${litePurged})`);
  return litePurged;
}

/**
 * Resuelve la mejor URL de streaming disponible para un video/track dado
 * utilizando KokoMusic-lite.
 */
export async function resolveAudioStream(
  youtubeId: string,
  hints?: StreamResolutionHints
): Promise<ResolvedStream | null> {
  const quality = hints?.quality;
  const cacheKey = quality ? `resolved-stream:${youtubeId}:${quality}` : `resolved-stream:${youtubeId}`;

  // ── 1. Cache L1 de memoria ───────────────────────────────────────────────────
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ResolvedStream;
      metrics.recordStreamResolution('cached');
      return { ...parsed, cached: true };
    } catch {
      // Ignorar fallo de parseo
    }
  }

  // ── 2. KokoMusic-lite API (InnerTube microservice) ────────────────────────────
  try {
    const liteResult = await resolveLiteStream(youtubeId, { quality });
    if (liteResult && liteResult.url) {
      const res: ResolvedStream = {
        url: liteResult.url,
        source: liteResult.source || 'innertube',
        mimeType: liteResult.mimeType || 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: liteResult.bitrate,
        expiresAt: liteResult.expiresAt,
        client: liteResult.client,
        cached: false,
      };

      // Calcular TTL real en segundos a partir de expiresAt con margen de seguridad de 30s
      let ttlSec = 1800; // 30 min por defecto
      if (liteResult.expiresAt) {
        const remainingMs = liteResult.expiresAt - Date.now();
        ttlSec = Math.max(60, Math.floor(remainingMs / 1000) - 30);
      }

      cache.setex(cacheKey, ttlSec, JSON.stringify(res));
      metrics.recordStreamResolution('hit');
      console.log(`[StreamResolver] ⚡ KokoMusic-lite Hit: ${youtubeId} via ${liteResult.client || 'InnerTube'} (TTL: ${ttlSec}s)`);
      return res;
    }
  } catch (err: any) {
    metrics.recordStreamResolution('error');
    console.error(`[StreamResolver] Error resolviendo ${youtubeId} vía KokoMusic-lite:`, err.message || err);
    return null;
  }

  metrics.recordStreamResolution('miss');
  return null;
}

export interface PrewarmableTrack {
  id: string;
  itunesId?: number;
  artist: string;
  title: string;
  duration?: number; // ms
}

const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Resuelve por adelantado el youtubeId + stream de un track de resultados de
 * búsqueda, en segundo plano, para que cuando el usuario pulse play ya esté
 * en caché (L1 de streamResolverService/kokoLiteClient) y la reproducción
 * arranque casi al instante.
 */
export async function prewarmTrackStream(track: PrewarmableTrack): Promise<void> {
  try {
    if (!track?.id || track.id.startsWith('custom_')) return;
    // Ya en R2 (incluidas las canciones subidas por artistas Koko, que NO
    // existen en YouTube): no hay nada que precalentar ni que gastar en proxy.
    if (await findTrackInCDN(track.id)) return;

    let youtubeId: string | null = null;

    // Tracks que ya vienen de YouTube (búsqueda ?source=youtube) traen el
    // propio videoId como id — no necesitan pasar por resolveYoutubeId.
    if (YOUTUBE_ID_RE.test(track.id) && isNaN(Number(track.id))) {
      youtubeId = track.id;
    } else {
      const itunesId = track.itunesId || Math.abs(hashCode(track.id));
      const durationSec = track.duration ? Math.round(track.duration / 1000) : undefined;
      youtubeId = await resolveYoutubeId(itunesId, track.artist, track.title, durationSec);
    }

    if (!youtubeId) return;
    await resolveAudioStream(youtubeId, { artist: track.artist, title: track.title });
  } catch (err) {
    console.warn('[StreamResolver] Prewarm falló para', track?.id, err);
  }
}

function hashCode(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = (hash * 33) ^ str.charCodeAt(i);
  return hash;
}

/**
 * Precalienta en segundo plano los primeros `count` resultados de una
 * búsqueda, con concurrencia limitada para no saturar KokoMusic-lite ni
 * disparar demasiadas búsquedas de YouTube en paralelo.
 */
export function prewarmTopTracks(tracks: PrewarmableTrack[], count = 4): void {
  const targets = tracks.slice(0, count);
  (async () => {
    for (const track of targets) {
      await prewarmTrackStream(track);
    }
  })().catch(() => {});
}

