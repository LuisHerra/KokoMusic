/**
 * Metadata Service (anteriormente Spotify Service)
 * 
 * Debido a los cambios en la API de Spotify (que ahora bloquea las búsquedas 
 * con Client Credentials Flow arrojando 403 Forbidden), hemos migrado a YouTube Search.
 * Esto hace que la app sea 100% independiente, sin necesidad de API Keys,
 * y garantiza que los metadatos coincidan exactamente con el audio descargado por yt-dlp.
 */

import { searchYtdlp, getVideoByIdYtdlp, isYtSearchDisabled, recordYtSearchFailure, recordYtSearchSuccess } from './ytdlpSearchService';

export interface TrackMetadata {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;   // ms
  popularity: number;
  preview_url: string | null;
}

export async function searchTracks(query: string, limit = 20): Promise<TrackMetadata[]> {
  let videos: any[] = [];

  if (!isYtSearchDisabled()) {
    try {
      const yts = (await import('yt-search')).default;
      const result = await yts(query);
      videos = result.videos || [];
      recordYtSearchSuccess();
    } catch (ytsErr) {
      recordYtSearchFailure();
    }
  }

  try {
    if (videos.length === 0) {
      videos = await searchYtdlp(query, limit);
    }
    
    // Priorizar videos que contengan "lyrics" o "letra" en el título
    // para evitar videoclips con audios extra/desincronizados
    const sortedVideos = videos.sort((a, b) => {
      const aHasLyrics = /\b(lyrics|letra)\b/i.test(a.title);
      const bHasLyrics = /\b(lyrics|letra)\b/i.test(b.title);
      if (aHasLyrics && !bHasLyrics) return -1;
      if (!aHasLyrics && bHasLyrics) return 1;
      return 0; // Mantener orden original si ambos o ninguno tienen
    });

    const slicedVideos = sortedVideos.slice(0, limit);

    return slicedVideos.map((v) => ({
      id: v.videoId,
      title: v.title,
      artist: v.author?.name || 'Desconocido',
      album: 'YouTube Audio',
      cover: v.thumbnail ?? `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
      duration: (v.duration?.seconds || 0) * 1000,
      popularity: v.views || 0,
      preview_url: null,
    }));
  } catch (error) {
    console.error('[Search] Error en searchTracks fallback:', error);
    return [];
  }
}

export async function getTrackById(id: string): Promise<TrackMetadata | null> {
  let video: any = null;

  // Siempre usar yt-dlp para lookup por ID
  try {
    video = await getVideoByIdYtdlp(id);
  } catch (err) {
    console.warn('[SpotifyService] getVideoByIdYtdlp falló:', (err as Error).message);
  }

  if (!video) return null;

  return {
    id: video.videoId,
    title: video.title,
    artist: video.author?.name || 'Desconocido',
    album: 'YouTube Audio',
    cover: video.thumbnail || `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
    duration: (video.duration?.seconds || 0) * 1000,
    popularity: video.views || 0,
    preview_url: null,
  };
}
