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

import { exec } from 'child_process';
import { getCookiesArg } from './ytdlpService';

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
    // Sanear query: quitar comillas dobles y saltos de línea
    const safeQuery = query.replace(/"/g, "'").replace(/[\n\r]/g, ' ').trim();
    const cmd = [
      'yt-dlp',
      cookiesArg || '',
      '--force-ipv4',
      `"ytsearch${limit}:${safeQuery}"`,
      '--dump-json',
      '--no-playlist',
      '--flat-playlist',
      '--no-warnings',
      '--no-progress',
    ].filter(Boolean).join(' ');

    exec(cmd, { timeout: 20000 }, (err, stdout) => {
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
    const cmd = [
      'yt-dlp',
      cookiesArg || '',
      '--force-ipv4',
      `"https://www.youtube.com/watch?v=${videoId}"`,
      '--dump-json',
      '--skip-download',
      '--no-playlist',
      '--no-warnings',
    ].filter(Boolean).join(' ');

    exec(cmd, { timeout: 15000 }, (err, stdout) => {
      if (!stdout?.trim()) return resolve(null);
      try {
        resolve(parseYtdlpVideo(JSON.parse(stdout.trim())));
      } catch {
        resolve(null);
      }
    });
  });
}
