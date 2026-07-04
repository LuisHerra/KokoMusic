/**
 * YouTube Resolver Service
 *
 * Resuelve el YouTube video ID correcto para un track de iTunes.
 * Busca con query inteligente y prioriza canales oficiales (VEVO, Topic).
 *
 * Estrategia de caché:
 *   L1: memoria (permanente en proceso) → L2: Supabase (permanente) → yt-search / yt-dlp
 *
 * Modos:
 *   PREFER_YTDLP=true  → yt-search → yt-dlp search (sin Invidious, para Termux/local)
 *   Por defecto        → yt-search → Invidious (para servidores en la nube)
 */

import yts from 'yt-search';
import { cache } from './cacheService';
import { getYouTubeResolution, upsertYouTubeResolution } from './supabaseService';
import { isYtSearchDisabled, recordYtSearchFailure, recordYtSearchSuccess } from './invidiousService';

// Canales considerados oficiales (prioridad máxima)
const OFFICIAL_CHANNEL_PATTERNS = [
  /vevo$/i,
  /- topic$/i,
  /official$/i,
];

function isOfficialChannel(channelName: string): boolean {
  return OFFICIAL_CHANNEL_PATTERNS.some(p => p.test(channelName));
}

/**
 * Resuelve el YouTube ID para un artista + título dados.
 * Prioriza canales VEVO/Topic/Official para evitar lyrics videos de terceros.
 */
export async function resolveYoutubeId(
  itunesId: number,
  artistName: string,
  trackName: string
): Promise<string | null> {
  const cacheKey = `yt-res:${itunesId}`;

  // L1: memoria
  const inMemory = cache.get(cacheKey);
  if (inMemory) return inMemory;

  // L2: Supabase
  const fromDB = await getYouTubeResolution(itunesId);
  if (fromDB) {
    cache.setex(cacheKey, 86400 * 30, fromDB); // recalentar L1 (30 días)
    return fromDB;
  }

  // L3: búsqueda de YouTube
  try {
    // L3: búsqueda — yt-search primero (rápido), yt-dlp search como fallback
    const query = `${artistName} ${trackName} official audio`;
    let videos: any[] = [];

    if (!isYtSearchDisabled()) {
      try {
        const result = await yts(query);
        videos = result.videos.slice(0, 10);
        recordYtSearchSuccess();
      } catch {
        recordYtSearchFailure();
      }
    }

    if (videos.length === 0) {
      const { searchYtdlp } = await import('./ytdlpSearchService');
      console.log(`[YTResolver] yt-search vacío — buscando via yt-dlp: "${query}"`);
      videos = await searchYtdlp(query, 10);
    }

    if (videos.length === 0) return null;

    // Prioridad 1: canal oficial (VEVO, Topic, Official)
    const officialVideo = videos.find(v => isOfficialChannel(v.author?.name ?? ''));

    // Prioridad 2: primer resultado sin "lyrics" en el título
    const nonLyricsVideo = videos.find(v =>
      !/\b(lyrics|letra|letras|lyric video)\b/i.test(v.title)
    );

    // Prioridad 3: primer resultado de todos
    const chosen = officialVideo ?? nonLyricsVideo ?? videos[0];
    const youtubeId = chosen.videoId;

    console.log(`[YTResolver] "${artistName} - ${trackName}" → ${youtubeId} (canal: ${chosen.author?.name})`);

    // Persistir en L1 + L2
    cache.setex(cacheKey, 86400 * 30, youtubeId);
    upsertYouTubeResolution(itunesId, youtubeId).catch(() => {});

    return youtubeId;
  } catch (error) {
    console.error('[YTResolver] Error resolviendo YouTube ID:', error);
    return null;
  }
}
