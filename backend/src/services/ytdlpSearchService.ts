/**
 * yt-dlp Search Service
 *
 * Reemplaza Invidious para búsqueda y metadatos de YouTube cuando PREFER_YTDLP=true.
 * Funciona con IP residencial (Termux/local) donde yt-dlp no está bloqueado.
 *
 * Dos operaciones:
 *   - searchYtdlp(query, limit)  → busca videos por término
 *   - getVideoByIdYtdlp(videoId) → obtiene metadatos de un video concreto
 */

import { execFile } from 'child_process';
import { getCookiesArg } from './ytdlpService';

// ── Circuit breaker global de yt-search ────────────────────────────────────────
const YT_SEARCH_FAIL_THRESHOLD = 2;    // Fallos consecutivos para activar
const YT_SEARCH_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutos de cooldown

let ytSearchFailCount = 0;
let ytSearchDisabledUntil = 0;

/** Indica si yt-search debe saltarse por estar en cooldown. */
export function isYtSearchDisabled(): boolean {
  if (ytSearchDisabledUntil && Date.now() < ytSearchDisabledUntil) return true;
  return false;
}

/** Registra un fallo de yt-search y activa el circuit breaker si es necesario. */
export function recordYtSearchFailure(): void {
  if (isYtSearchDisabled()) {
    ytSearchDisabledUntil = Date.now() + YT_SEARCH_COOLDOWN_MS;
    return;
  }
  ytSearchFailCount++;
  if (ytSearchFailCount >= YT_SEARCH_FAIL_THRESHOLD) {
    ytSearchDisabledUntil = Date.now() + YT_SEARCH_COOLDOWN_MS;
    console.warn(
      `[ytdlpSearchService] yt-search desactivado por ${YT_SEARCH_COOLDOWN_MS / 60000} min ` +
      `(${ytSearchFailCount} fallos). Usando yt-dlp directamente.`
    );
  }
}

/** Registra un éxito de yt-search y resetea el circuit breaker. */
export function recordYtSearchSuccess(): void {
  if (ytSearchFailCount > 0) {
    ytSearchFailCount = 0;
    ytSearchDisabledUntil = 0;
  }
}

import { searchVideos } from './kokoLiteClient';

/**
 * Busca videos en YouTube usando KokoMusic-lite (InnerTube) sin yt-dlp.
 */
export async function searchYtdlp(query: string, limit = 5): Promise<any[]> {
  try {
    const results = await searchVideos(query);
    return results.slice(0, limit).map(v => ({
      videoId: v.id,
      title: v.title || '',
      author: { name: v.author || 'Desconocido' },
      duration: { seconds: v.durationSeconds || 0 },
      thumbnail: v.thumbnail || `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`,
      views: 0,
    }));
  } catch (err) {
    console.error('[ytdlpSearchService] Error delegando búsqueda a KokoMusic-lite:', err);
    return [];
  }
}

/**
 * Obtiene metadatos de un video concreto de YouTube sin yt-dlp.
 */
export async function getVideoByIdYtdlp(videoId: string): Promise<any | null> {
  try {
    const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`);
    if (!oembedRes.ok) return null;
    const v = (await oembedRes.json()) as any;
    return {
      videoId,
      title: v.title || '',
      author: { name: v.author_name || 'Desconocido' },
      duration: { seconds: 180 },
      thumbnail: v.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      views: 0,
    };
  } catch {
    return null;
  }
}

