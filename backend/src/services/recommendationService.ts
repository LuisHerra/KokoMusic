import { cache } from './cacheService';
import { searchTracks, getTrackById, searchYouTube, type TrackMetadata } from './metadataService';
import { readHistory } from './historyService';
import { getInnerTubeRadioTracks } from './innerTubeService';

const LFM_KEY = process.env.LASTFM_KEY || '';
const LFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

interface LastFmSimilarTrack {
  name: string;
  artist: {
    name: string;
  };
}

/**
 * Consulta a Last.fm para obtener canciones similares a un track semilla (artista + título)
 */
async function fetchLastFmSimilar(artist: string, track: string, limit = 15): Promise<LastFmSimilarTrack[]> {
  if (!LFM_KEY) return [];
  try {
    const url = `${LFM_BASE}?method=track.getsimilar&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&api_key=${LFM_KEY}&format=json&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[LastFm] Error fetching similar tracks: ${res.status}`);
      return [];
    }
    const data = await res.json() as any;
    const tracks = data?.similartracks?.track;
    if (Array.isArray(tracks)) {
      return tracks.map((t: any) => ({
        name: t.name,
        artist: {
          name: typeof t.artist === 'string' ? t.artist : t.artist?.name || '',
        },
      }));
    }
    return [];
  } catch (error) {
    console.error('[LastFm] track.getsimilar error:', error);
    return [];
  }
}

/**
 * Consulta a Last.fm para obtener artistas similares a un artista semilla
 */
async function fetchLastFmSimilarArtists(artist: string, limit = 5): Promise<string[]> {
  if (!LFM_KEY) return [];
  try {
    const url = `${LFM_BASE}?method=artist.getsimilar&artist=${encodeURIComponent(artist)}&api_key=${LFM_KEY}&format=json&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as any;
    const artists = data?.similarartists?.artist;
    if (Array.isArray(artists)) {
      return artists.map((a: any) => a.name);
    }
    return [];
  } catch (error) {
    console.error('[LastFm] artist.getsimilar error:', error);
    return [];
  }
}

/**
 * Resuelve un par (Artista, Canción) en un objeto TrackMetadata válido usando iTunes o YouTube fallback.
 * Emplea cache para evitar llamadas innecesarias.
 */
async function resolveSimilarTrack(artist: string, title: string): Promise<TrackMetadata | null> {
  const query = `${artist} ${title}`.trim();
  const cacheKey = `resolve-similar:${query.toLowerCase()}`;
  
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    // 1. Intentar iTunes (devuelve mejor calidad de metadatos/portada)
    const itunesResults = await searchTracks(query, 1, 'itunes');
    if (itunesResults && itunesResults.length > 0) {
      const match = itunesResults[0];
      cache.setex(cacheKey, 86400, JSON.stringify(match)); // Cache 24 horas
      return match;
    }

    // 2. Fallback a YouTube
    const ytResults = await searchTracks(query, 1, 'youtube');
    if (ytResults && ytResults.length > 0) {
      const match = ytResults[0];
      cache.setex(cacheKey, 86400, JSON.stringify(match));
      return match;
    }
  } catch (error) {
    console.error(`[Recommendations] Error resolving track "${query}":`, error);
  }

  return null;
}
export interface RecommendationOptions {
  decadeMode?: string;      // 'modern' | 'recent' | 'nostalgia' | 'vintage' | 'all'
  languagePref?: string;    // 'es' | 'en' | 'bilingual' | 'global' | 'auto'
  studioMaster?: boolean;
  producerAffinity?: boolean;
  skipPenalty?: boolean;
  earlySkipIds?: string[];
}

/**
 * Motor de recomendaciones premium multinivel:
 * 1. Semilla (seedTrackId): Si se proporciona, busca canciones similares en InnerTube Radio / Last.fm.
 * 2. Historial de usuario: Identifica artistas preferidos del usuario y busca similares.
 * 3. Filtrado por Mood y Preferencias (Década, Idioma, Master Studio).
 * 4. Fallback: Búsqueda dinámica de temas populares o lofi chill.
 */
export async function getRecommendations(
  limit = 10,
  userId?: string,
  mood?: string,
  seedTrackId?: string,
  options?: RecommendationOptions
): Promise<TrackMetadata[]> {
  const decadeMode = options?.decadeMode || 'all';
  const languagePref = options?.languagePref || 'auto';
  const cacheKey = `recs:${userId || 'global'}:${mood || 'none'}:${seedTrackId || 'none'}:${decadeMode}:${languagePref}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  let recommendations: TrackMetadata[] = [];
  const seenIds = new Set<string>();

  // Add early skipped IDs to seen set if skipPenalty is enabled
  if (options?.earlySkipIds && options.earlySkipIds.length > 0) {
    options.earlySkipIds.forEach(id => seenIds.add(id));
  }

  // 1. CAPA 1: Semilla (si el usuario está escuchando un track)
  if (seedTrackId) {
    try {
      const seedTrack = await getTrackById(seedTrackId);
      if (seedTrack) {
        seenIds.add(seedTrack.id);
        console.log(`[Recommendations] Generando recomendaciones con semilla: "${seedTrack.title}" de ${seedTrack.artist}`);
        
        // A) Intentar Radio de InnerTube (50 tracks contextualmente perfectos de YouTube Music)
        let videoId = seedTrack.id.startsWith('yt_') ? seedTrack.id.replace('yt_', '') : '';
        if (!videoId) {
          const ytHits = await searchYouTube(`${seedTrack.artist} ${seedTrack.title}`, 1);
          if (ytHits && ytHits.length > 0) {
            videoId = ytHits[0].id.replace('yt_', '');
          }
        }

        if (videoId) {
          try {
            const radioTracks = await getInnerTubeRadioTracks(videoId);
            for (const rt of radioTracks) {
              if (!seenIds.has(rt.id)) {
                seenIds.add(rt.id);
                recommendations.push({
                  id: rt.id,
                  itunesId: 0,
                  artistId: 0,
                  title: rt.title,
                  artist: rt.artist,
                  album: seedTrack.album || '',
                  duration: rt.duration,
                  cover: rt.cover,
                  genre: seedTrack.genre || 'Pop',
                  releaseDate: seedTrack.releaseDate || null,
                  popularity: 80,
                  preview_url: null,
                });
              }
            }
          } catch (e) {
            console.warn('[Recommendations] InnerTube Radio no disponible, probando Last.fm:', e);
          }
        }

        // B) Si InnerTube no devolvió suficientes, consultar Last.fm
        if (recommendations.length < limit) {
          const similarList = await fetchLastFmSimilar(seedTrack.artist, seedTrack.title, 15);
          if (similarList.length > 0) {
            const resolvePromises = similarList.map(t => resolveSimilarTrack(t.artist.name, t.name));
            const resolved = await Promise.all(resolvePromises);
            for (const track of resolved) {
              if (track && !seenIds.has(track.id)) {
                seenIds.add(track.id);
                recommendations.push(track);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[Recommendations] Error procesando semilla:', err);
    }
  }

  // 2. CAPA 2: Historial del usuario (si no hay suficientes o no hay semilla)
  if (recommendations.length < limit) {
    try {
      const history = readHistory().filter(h => !userId || h.userId === userId);
      if (history.length > 0) {
        // Obtener artistas top del usuario
        const artistCounts: Record<string, number> = {};
        history.forEach(h => {
          if (h.artist) {
            artistCounts[h.artist] = (artistCounts[h.artist] || 0) + (h.playCount || 1);
          }
          seenIds.add(h.trackId); // Evitar sugerir lo que ya ha escuchado mucho recientemente
        });

        const topArtists = Object.entries(artistCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([a]) => a);

        if (topArtists.length > 0) {
          // Tomar un artista top al azar y buscar similares en Last.fm
          const randomArtist = topArtists[Math.floor(Math.random() * topArtists.length)];
          console.log(`[Recommendations] Historial activo. Buscando artistas similares a: ${randomArtist}`);
          const similarArtists = await fetchLastFmSimilarArtists(randomArtist, 5);
          
          if (similarArtists.length > 0) {
            // Buscar una canción popular para cada artista similar
            const artistPromises = similarArtists.map(async (artName) => {
              const tracks = await searchTracks(`${artName} top hits`, 3, 'itunes');
              return tracks;
            });
            const artistTrackPools = await Promise.all(artistPromises);
            for (const pool of artistTrackPools) {
              for (const track of pool) {
                if (track && !seenIds.has(track.id)) {
                  seenIds.add(track.id);
                  recommendations.push(track);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('[Recommendations] Error procesando historial:', err);
    }
  }

  // 3. CAPA 3: Palabras clave y Moods (para completar o si el usuario pide mood específico)
  const moodKeywords: Record<string, string[]> = {
    workout: ['workout hits 2026', 'gym motivation electro', 'cardio fitness hits'],
    chill: ['chill vibes lofi', 'relaxing r&b', 'acoustic chill lounge'],
    study: ['lofi study beats', 'ambient concentration piano', 'binaural study beats'],
    party: ['reggaeton party hits', 'dance pop club anthems', 'party EDM hits'],
    rock: ['classic rock hits', 'alternative rock essential', 'grunge metal hits'],
    sad: ['sad acoustic songs', 'emotional pop ballads', 'melancholic indie'],
    happy: ['uplifting feel good pop', 'happy summer hits', 'positive vibes pop'],
    latin: ['reggaeton hits urbano', 'latin pop essential', 'bachata salsa dance'],
    electronic: ['EDM hits house', 'deep house mix', 'techno club tracks'],
    hiphop: ['hip hop rap essentials', 'trap vibes playlist', 'lofi hip hop beats'],
    classical: ['relaxing classical piano', 'orchestral masterpiece symphony', 'violin chill classical'],
    focus: ['deep focus concentration', 'ambient drone white noise', 'study focus alpha waves']
  };

  if (recommendations.length < limit || mood) {
    const activeMood = mood?.toLowerCase();
    const keywords = (activeMood && moodKeywords[activeMood]) ? moodKeywords[activeMood] : ['pop hits 2026', 'lofi chill beats'];
    const chosenKeyword = keywords[Math.floor(Math.random() * keywords.length)];
    
    console.log(`[Recommendations] Usando capa de búsqueda con término: "${chosenKeyword}"`);
    try {
      const searchResults = await searchTracks(chosenKeyword, limit * 2, 'itunes');
      for (const track of searchResults) {
        if (track && !seenIds.has(track.id)) {
          seenIds.add(track.id);
          recommendations.push(track);
        }
      }
    } catch (err) {
      console.error('[Recommendations] Error en búsqueda de fallback:', err);
    }
  }

  // Mezclar un poco y recortar al límite requerido
  const finalRecs = recommendations
    .sort(() => 0.5 - Math.random())
    .slice(0, limit);

  // Guardar en cache por 10 minutos
  cache.setex(cacheKey, 600, JSON.stringify(finalRecs));
  return finalRecs;
}
