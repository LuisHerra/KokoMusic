/**
 * Stream Resolver Service — KokoMusic
 *
 * Coordina la resolución multi-fuente de audio con estrategia waterfall:
 *   1. L1 Memory Cache (URL directa ya resuelta y vigente)
 *   2. Cloudflare R2 CDN (si el track ya fue cacheado en R2)
 *   3. InnerTube API (YouTube Music Android Client, <300ms)
 *   4. JioSaavn API (Akamai CDN directo 320k, <200ms)
 *   5. Invidious (Instancias descentralizadas como fallback, 500-2000ms)
 *   6. yt-dlp (Último recurso, solo entornos locales)
 */

import { cache } from './cacheService';
import { isCDNEnabled, findTrackInCDN } from './cdnService';
import { getInnerTubeStreamUrl } from './innerTubeService';
import { searchJioSaavn, type JioSaavnTrackResult } from './jiosaavnService';
import { getInvidiousStreamUrl } from './invidiousService';
import { exec } from 'child_process';
import { getCookiesArg } from './ytdlpService';

export type StreamSourceType = 'cdn' | 'innertube' | 'jiosaavn' | 'invidious' | 'ytdlp';

export interface ResolvedStream {
  url: string;
  source: StreamSourceType;
  mimeType: string;
  bitrate?: number;
  durationMs?: number;
  isDirectCdn: boolean;    // true = no necesita proxy, se puede redirigir 302 o descargar directo
  jioSaavnMeta?: JioSaavnTrackResult;
}

export interface StreamResolutionHints {
  artist?: string;
  title?: string;
  itunesId?: number | string;
  allowCdnRedirect?: boolean;
}

/** Extrae la URL de streaming directa de YouTube via yt-dlp como fallback de último recurso */
function getYTStreamUrlWithYtDlp(youtubeId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const formatSelector = `bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best`;
    const ytUrl = `"https://www.youtube.com/watch?v=${youtubeId}"`;
    const cookiesArg = getCookiesArg();
    const baseArgs = `${cookiesArg ? cookiesArg + ' ' : ''}--force-ipv4 --legacy-server-connect --get-url --no-playlist -f ${formatSelector}`;

    let cmd = `yt-dlp ${baseArgs} ${ytUrl}`;

    if (process.platform === 'win32') {
      const wingetPath = `"%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\yt-dlp.exe"`;
      cmd = `yt-dlp ${baseArgs} ${ytUrl} || ${wingetPath} ${baseArgs} ${ytUrl}`;
    }

    exec(cmd, (error, stdout, stderr) => {
      if (error && !stdout) {
        console.error('[yt-dlp fallback] Error extrayendo URL:', stderr);
        return reject(error);
      }
      const lines = stdout.trim().split('\n').filter(l => l.trim().length > 0);
      const url = lines[lines.length - 1].trim();
      if (!url) {
        return reject(new Error('yt-dlp no devolvió ninguna URL de stream'));
      }
      resolve(url);
    });
  });
}

/**
 * Resuelve la mejor URL de streaming disponible para un video/track dado.
 */
export async function resolveAudioStream(
  youtubeId: string,
  hints?: StreamResolutionHints
): Promise<ResolvedStream | null> {
  const cacheKey = `resolved-stream:${youtubeId}`;

  // ── 1. Cache L1 de memoria ───────────────────────────────────────────────────
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ResolvedStream;
      return parsed;
    } catch {
      // Ignorar fallo de parseo
    }
  }

  // ── 2. Cloudflare R2 CDN (si está activo y el track ya fue procesado) ────────
  if (isCDNEnabled()) {
    const cdnUrl = await findTrackInCDN(youtubeId);
    if (cdnUrl) {
      const res: ResolvedStream = {
        url: cdnUrl,
        source: 'cdn',
        mimeType: 'audio/ogg; codecs=opus',
        isDirectCdn: true,
      };
      cache.setex(cacheKey, 86400 * 30, JSON.stringify(res));
      console.log(`[StreamResolver] 🚀 Nivel 1 (CDN R2 Hit): ${youtubeId} → ${cdnUrl}`);
      return res;
    }
  }

  // ── 3. InnerTube API (YouTube Music Android Client) ───────────────────────────
  try {
    const innerTubeResult = await getInnerTubeStreamUrl(youtubeId);
    if (innerTubeResult && innerTubeResult.url) {
      const res: ResolvedStream = {
        url: innerTubeResult.url,
        source: 'innertube',
        mimeType: innerTubeResult.mimeType,
        bitrate: innerTubeResult.bitrate,
        durationMs: innerTubeResult.durationMs,
        isDirectCdn: false, // googlevideo se suele servir con proxy para evitar CORS en navegador
      };
      // Cachear por 30 minutos (googlevideo tokens duran ~6h)
      cache.setex(cacheKey, 1800, JSON.stringify(res));
      console.log(`[StreamResolver] ⚡ Nivel 2 (InnerTube Hit): ${youtubeId} via ${innerTubeResult.clientUsed}`);
      return res;
    }
  } catch (err) {
    console.warn(`[StreamResolver] InnerTube falló para ${youtubeId}:`, (err as Error).message);
  }

  // ── 4. JioSaavn API (Si se dispone de artista y título) ───────────────────────
  if (hints?.artist && hints?.title) {
    try {
      const jioResult = await searchJioSaavn(hints.artist, hints.title);
      if (jioResult && jioResult.streamUrl) {
        const res: ResolvedStream = {
          url: jioResult.streamUrl320 || jioResult.streamUrl,
          source: 'jiosaavn',
          mimeType: 'audio/mp4; codecs="mp4a.40.2"',
          bitrate: 320000,
          durationMs: jioResult.durationMs,
          isDirectCdn: true, // Akamai CDN de Saavn tiene CORS y soporte nativo
          jioSaavnMeta: jioResult,
        };
        cache.setex(cacheKey, 7200, JSON.stringify(res));
        console.log(`[StreamResolver] 🎵 Nivel 3 (JioSaavn Hit): "${hints.artist} - ${hints.title}" → Akamai CDN (320k)`);
        return res;
      }
    } catch (err) {
      console.warn(`[StreamResolver] JioSaavn falló para "${hints.artist} - ${hints.title}":`, (err as Error).message);
    }
  }

  // ── 5. Invidious API (Fallback descentralizado) ──────────────────────────────
  try {
    const invidiousUrl = await getInvidiousStreamUrl(youtubeId);
    if (invidiousUrl) {
      const res: ResolvedStream = {
        url: invidiousUrl,
        source: 'invidious',
        mimeType: 'audio/webm; codecs="opus"',
        isDirectCdn: false,
      };
      cache.setex(cacheKey, 1500, JSON.stringify(res));
      console.log(`[StreamResolver] 🌐 Nivel 4 (Invidious Hit): ${youtubeId}`);
      return res;
    }
  } catch (err) {
    console.warn(`[StreamResolver] Invidious falló para ${youtubeId}:`, (err as Error).message);
  }

  // ── 6. yt-dlp (Último recurso, generalmente solo en local) ───────────────────
  try {
    console.log(`[StreamResolver] ⚠️ Intentando último recurso (yt-dlp) para ${youtubeId}...`);
    const ytdlpUrl = await getYTStreamUrlWithYtDlp(youtubeId);
    if (ytdlpUrl) {
      const res: ResolvedStream = {
        url: ytdlpUrl,
        source: 'ytdlp',
        mimeType: 'audio/webm',
        isDirectCdn: false,
      };
      cache.setex(cacheKey, 1800, JSON.stringify(res));
      console.log(`[StreamResolver] 💾 Nivel 5 (yt-dlp Hit): ${youtubeId}`);
      return res;
    }
  } catch (err) {
    console.error(`[StreamResolver] ❌ Todos los métodos del waterfall fallaron para ${youtubeId}:`, (err as Error).message);
  }

  return null;
}
