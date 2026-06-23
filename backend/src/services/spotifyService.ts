/**
 * Metadata Service (anteriormente Spotify Service)
 * 
 * Debido a los cambios en la API de Spotify (que ahora bloquea las búsquedas 
 * con Client Credentials Flow arrojando 403 Forbidden), hemos migrado a YouTube Search.
 * Esto hace que la app sea 100% independiente, sin necesidad de API Keys,
 * y garantiza que los metadatos coincidan exactamente con el audio descargado por yt-dlp.
 */

import yts from 'yt-search';

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
  try {
    const result = await yts(query);
    
    // Priorizar videos que contengan "lyrics" o "letra" en el título
    // para evitar videoclips con audios extra/desincronizados
    const sortedVideos = result.videos.sort((a, b) => {
      const aHasLyrics = /\b(lyrics|letra)\b/i.test(a.title);
      const bHasLyrics = /\b(lyrics|letra)\b/i.test(b.title);
      if (aHasLyrics && !bHasLyrics) return -1;
      if (!aHasLyrics && bHasLyrics) return 1;
      return 0; // Mantener orden original si ambos o ninguno tienen
    });

    const videos = sortedVideos.slice(0, limit);

    return videos.map((v) => ({
      id: v.videoId,
      title: v.title,
      artist: v.author.name,
      album: 'YouTube Audio',
      cover: v.thumbnail ?? '',
      duration: v.duration.seconds * 1000,
      popularity: v.views,
      preview_url: null,
    }));
  } catch (error) {
    console.error('[Search] Error en yt-search:', error);
    return [];
  }
}

export async function getTrackById(id: string): Promise<TrackMetadata | null> {
  try {
    const video = await yts({ videoId: id });
    if (!video) return null;

    return {
      id: video.videoId,
      title: video.title,
      artist: video.author.name,
      album: 'YouTube Audio',
      cover: video.thumbnail,
      duration: video.duration.seconds * 1000,
      popularity: video.views,
      preview_url: null,
    };
  } catch (error) {
    console.error('[Search] Error obteniendo track por ID:', error);
    return null;
  }
}
