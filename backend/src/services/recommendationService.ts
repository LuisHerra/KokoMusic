import { cache } from './cacheService';
import { searchTracks, getTrackById, type TrackMetadata } from './metadataService';
import { readHistory, type HistoryEntry } from './historyService';
import { audioExists } from './ytdlpService';
import { trackExistsInCDN } from './cdnService';

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

/**
 * Motor de recomendaciones premium multinivel:
 * 1. Semilla (seedTrackId): Si se proporciona, busca canciones similares en Last.fm.
 * 2. Historial de usuario: Identifica artistas preferidos del usuario y busca similares / canciones populares.
 * 3. Filtrado por Mood: Si se solicita un estado de ánimo, refina el set de búsqueda.
 * 4. Fallback: Búsqueda dinámica en YouTube de temas populares o lofi chill.
 */
function historyTrackToMetadata(h: HistoryEntry): TrackMetadata {
  return {
    id: h.trackId,
    itunesId: 0,
    artistId: 0,
    title: h.title,
    artist: h.artist,
    album: 'Historial',
    cover: h.cover || '',
    duration: 180000, // 3 min default
    genre: 'Historial',
    releaseDate: null,
    popularity: h.playCount,
    preview_url: null,
  };
}

export async function getRecommendations(
  limit = 10,
  userId?: string,
  mood?: string,
  seedTrackId?: string
): Promise<TrackMetadata[]> {
  const cacheKey = `recs:${userId || 'global'}:${mood || 'none'}:${seedTrackId || 'none'}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const candidatePool = new Map<string, { track: TrackMetadata; source: string; baseScore: number }>();

  // 1. OBTENER HISTORIAL DEL USUARIO Y MAPAS DE PLAYCOUNT
  const history = readHistory().filter(h => !userId || h.userId === userId);
  const trackPlayCounts = new Map<string, number>();
  const artistPlayCounts = new Map<string, number>();

  history.forEach(h => {
    trackPlayCounts.set(h.trackId, (trackPlayCounts.get(h.trackId) || 0) + (h.playCount || 1));
    if (h.artist) {
      const normArtist = h.artist.toLowerCase().trim();
      artistPlayCounts.set(normArtist, (artistPlayCounts.get(normArtist) || 0) + (h.playCount || 1));
    }
  });

  // 2. CAPA 1: Semilla (si el usuario está escuchando un track)
  if (seedTrackId) {
    try {
      const seedTrack = await getTrackById(seedTrackId);
      if (seedTrack) {
        console.log(`[Recommendations] Generando recomendaciones con semilla: "${seedTrack.title}" de ${seedTrack.artist}`);
        
        // Consultar similares de Last.fm
        const similarList = await fetchLastFmSimilar(seedTrack.artist, seedTrack.title, 15);
        if (similarList.length > 0) {
          // Resolver en paralelo
          const resolvePromises = similarList.map(t => resolveSimilarTrack(t.artist.name, t.name));
          const resolved = await Promise.all(resolvePromises);
          
          for (const track of resolved) {
            if (track) {
              candidatePool.set(track.id, { track, source: 'seed_similarity', baseScore: 100 });
            }
          }
        }
      }
    } catch (err) {
      console.error('[Recommendations] Error procesando semilla:', err);
    }
  }

  // 3. CAPA 2: Historial del usuario
  try {
    if (history.length > 0) {
      // Agregar los tracks más escuchados del historial directamente
      const topHistory = [...history]
        .sort((a, b) => (b.playCount || 1) - (a.playCount || 1))
        .slice(0, 10);
      
      for (const h of topHistory) {
        const track = historyTrackToMetadata(h);
        candidatePool.set(track.id, { track, source: 'user_history', baseScore: 80 });
      }

      // Obtener artistas top del usuario para buscar similares
      const topArtists = [...artistPlayCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([a]) => a);

      if (topArtists.length > 0) {
        const randomArtist = topArtists[Math.floor(Math.random() * topArtists.length)];
        const similarArtists = await fetchLastFmSimilarArtists(randomArtist, 5);
        
        if (similarArtists.length > 0) {
          const artistPromises = similarArtists.map(artName => searchTracks(`${artName} top hits`, 3, 'itunes'));
          const artistTrackPools = await Promise.all(artistPromises);
          for (const pool of artistTrackPools) {
            for (const track of pool) {
              if (track && !candidatePool.has(track.id)) {
                candidatePool.set(track.id, { track, source: 'artist_similarity', baseScore: 60 });
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[Recommendations] Error procesando historial:', err);
  }

  // 4. CAPA 3: Palabras clave y Moods
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

  const activeMood = mood?.toLowerCase();
  const keywords = (activeMood && moodKeywords[activeMood]) ? moodKeywords[activeMood] : ['pop hits 2026', 'lofi chill beats'];
  const chosenKeyword = keywords[Math.floor(Math.random() * keywords.length)];
  
  try {
    const searchResults = await searchTracks(chosenKeyword, limit * 3, 'itunes');
    for (const track of searchResults) {
      if (track && !candidatePool.has(track.id)) {
        candidatePool.set(track.id, { track, source: 'fallback', baseScore: 30 });
      }
    }
  } catch (err) {
    console.error('[Recommendations] Error en búsqueda de fallback:', err);
  }

  // Evitar recomendar el track semilla actual
  if (seedTrackId) {
    candidatePool.delete(seedTrackId);
  }

  // 5. EVALUACIÓN Y PRIORIZACIÓN (LOCAL / CDN / PLAYCOUNT) EN PARALELO
  const candidates = Array.from(candidatePool.values());
  const checkPromises = candidates.map(async (c) => {
    const isLocal = audioExists(c.track.id);
    let isCDN = false;
    if (!isLocal) {
      try {
        isCDN = await trackExistsInCDN(c.track.id);
      } catch (err) {
        // Ignorar errores de red
      }
    }
    return { id: c.track.id, isLocal, isCDN };
  });

  const checkResults = await Promise.all(checkPromises);
  const cacheMap = new Map(checkResults.map(r => [r.id, r]));

  // 6. CÁLCULO DE SCORE CON JITTER PARA VARIEDAD
  const scoredCandidates = candidates.map(c => {
    const track = c.track;
    const playCount = trackPlayCounts.get(track.id) || 0;
    
    const normArtist = track.artist.toLowerCase().trim();
    const artistPlayCount = artistPlayCounts.get(normArtist) || 0;

    // Aumentar peso por reproducciones de canción y artista (preferencias implícitas)
    const historyScore = playCount * 25 + artistPlayCount * 5;

    // Aumentar peso si existe localmente o en CDN para descarga instantánea
    const cacheInfo = cacheMap.get(track.id);
    let cacheScore = 0;
    if (cacheInfo?.isLocal) {
      cacheScore = 150; // Gran prioridad a cache local
    } else if (cacheInfo?.isCDN) {
      cacheScore = 100; // Prioridad alta a CDN
    }

    const totalScore = c.baseScore + historyScore + cacheScore;

    // Aplicar jitter aleatorio para no ser 100% rígidos ("aunque no siempre")
    const jitteredScore = totalScore * (0.7 + Math.random() * 0.6);

    return { track, score: jitteredScore };
  });

  // 7. ORDENACIÓN Y RETORNO
  const finalRecs = scoredCandidates
    .sort((a, b) => b.score - a.score)
    .map(sc => sc.track)
    .slice(0, limit);

  // Guardar en cache por 10 minutos
  cache.setex(cacheKey, 600, JSON.stringify(finalRecs));
  return finalRecs;
}
