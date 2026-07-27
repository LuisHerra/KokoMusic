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

/** Normaliza la salida de yt-dlp dump-json a formato VideoResult común */
function parseYtdlpVideo(v: any): any | null {
  if (!v?.id) return null;
  return {
    videoId: v.id,
    title: v.title || '',
    author: { name: v.channel || v.uploader || 'Desconocido' },
    duration: { seconds: v.duration || 0 },
    thumbnail: v.thumbnail || `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`,
    views: v.view_count || 0,
  };
}

/**
 * Busca videos en YouTube usando yt-dlp ytsearch.
 * Más lento que Invidious API (~2-4s) pero 100% fiable con IP residencial.
 */
export function searchYtdlp(query: string, limit = 5): Promise<any[]> {
  return new Promise((resolve) => {
    const cookiesArg = getCookiesArg();
    // Build args as an array — execFile does NOT use a shell, so no injection risk
    const args = [
      ...(cookiesArg ? cookiesArg.split(' ').filter(Boolean) : []),
      '--force-ipv4',
      `ytsearch${limit}:${query}`,
      '--dump-json',
      '--no-playlist',
      '--flat-playlist',
      '--no-warnings',
      '--no-progress',
    ];

    execFile('yt-dlp', args, { timeout: 20000 }, (err, stdout) => {
      if (!stdout?.trim()) return resolve([]);
      try {
        const videos = stdout.trim()
          .split('\n')
          .filter(l => l.trim().startsWith('{'))
          .map(l => {
            try { return parseYtdlpVideo(JSON.parse(l)); } catch { return null; }
          })
          .filter(Boolean);
        resolve(videos);
      } catch {
        resolve([]);
      }
    });
  });
}

/**
 * Obtiene metadatos de un video concreto de YouTube usando yt-dlp.
 * Útil cuando el usuario busca un video directamente (no por iTunes ID).
 */
export function getVideoByIdYtdlp(videoId: string): Promise<any | null> {
  return new Promise((resolve) => {
    const cookiesArg = getCookiesArg();
    // Build args as an array — no shell expansion, no injection risk
    const args = [
      ...(cookiesArg ? cookiesArg.split(' ').filter(Boolean) : []),
      '--force-ipv4',
      `https://www.youtube.com/watch?v=${videoId}`,
      '--dump-json',
      '--skip-download',
      '--no-playlist',
      '--no-warnings',
    ];

    execFile('yt-dlp', args, { timeout: 15000 }, (err, stdout) => {
      if (!stdout?.trim()) return resolve(null);
      try {
        resolve(parseYtdlpVideo(JSON.parse(stdout.trim())));
      } catch {
        resolve(null);
      }
    });
  });
}
