/**
 * Metadata Service — iTunes Search API
 *
 * Reemplaza spotifyService.ts. Fuente de verdad para metadatos musicales.
 * iTunes es gratuito, sin API key, y devuelve artistas reales (no uploaders de YouTube).
 *
 * Estrategia de caché:
 *   Búsquedas:      L1 (memoria, 1h)         → iTunes (siempre fresco, nuevas canciones visibles)
 *   Track por ID:   L1 (memoria, 24h) → L2 (Supabase, permanente) → iTunes
 *   UPSERT:         Cada track devuelto por iTunes se persiste en Supabase automáticamente
 */

import { cache } from './cacheService';
import {
  supabase,
  upsertTracks,
  getTrackFromDB,
  type TrackRow,
} from './supabaseService';
import { searchLite } from './kokoLiteService';
import { metrics } from './metricsService';

const ITUNES_BASE = 'https://itunes.apple.com';

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface TrackMetadata {
  id: string;           // iTunesTrackId (string para compatibilidad con el resto del código)
  itunesId: number;     // iTunesTrackId (number, clave primaria en Supabase)
  artistId: number;     // iTunesArtistId — para navegar a página de artista
  title: string;
  artist: string;
  album: string;
  cover: string;        // artworkUrl escalada a 600x600
  duration: number;     // ms
  genre: string;
  releaseDate: string | null;
  popularity: number;   // views aproximadas (posición en resultados)
  preview_url: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeStr(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

/** Escala la URL de artwork de iTunes a 600x600 */
function scaleArtwork(url: string | undefined): string {
  if (!url) return '';
  return url.replace(/\d+x\d+bb\.jpg$/, '600x600bb.jpg');
}

/** Convierte un resultado de iTunes al formato interno */
function itunesResultToTrack(item: any, index = 0): TrackMetadata {
  return {
    id: String(item.trackId),
    itunesId: item.trackId,
    artistId: item.artistId,
    title: item.trackName ?? 'Sin título',
    artist: item.artistName ?? 'Artista desconocido',
    album: item.collectionName ?? '',
    cover: scaleArtwork(item.artworkUrl100),
    duration: item.trackTimeMillis ?? 0,
    genre: item.primaryGenreName ?? '',
    releaseDate: item.releaseDate ?? null,
    popularity: Math.max(1, 20 - index), // Posición relativa suave (1-20)
    preview_url: item.previewUrl ?? null,
  };
}

/** Convierte TrackMetadata al formato para Supabase */
function trackToRow(track: TrackMetadata): TrackRow {
  return {
    itunes_id:   track.itunesId,
    title:       track.title,
    artist:      track.artist,
    artist_id:   track.artistId,
    album:       track.album || null,
    cover_url:   track.cover || null,
    duration_ms: track.duration || null,
    genre:       track.genre || null,
    release_date: track.releaseDate ? track.releaseDate.split('T')[0] : null,
  };
}
import { hashStringToInteger } from './artistService';

export type SearchSource = 'itunes' | 'youtube' | 'lyrics';

/** Convierte un resultado de YouTube (KokoMusic-lite o yt-search) al formato interno */
function ytResultToTrack(v: any, index = 0): TrackMetadata {
  let authorName = (typeof v.author === 'string' ? v.author : v.author?.name) ?? 'Artista desconocido';
  let trackTitle = v.title ?? 'Sin título';

  // Si el título tiene el formato "Artista - Canción", lo extraemos
  // Si el título viene con separador " - ", extraer artista y título
  // Cuidado: en YouTube a menudo viene "TÍTULO - ARTISTA 1 x ARTISTA 2" o "ARTISTA - TÍTULO"
  const separatorIdx = trackTitle.indexOf(' - ');
  if (separatorIdx !== -1) {
    const partA = trackTitle.substring(0, separatorIdx).trim();
    const partB = trackTitle.substring(separatorIdx + 3).trim();
    if (partA && partB) {
      const partBHasCollab = /\b(x|feat\.?|ft\.?|featuring|&|con)\b/i.test(partB);
      const partAHasCollab = /\b(x|feat\.?|ft\.?|featuring|&|con)\b/i.test(partA);
      if (partBHasCollab && !partAHasCollab) {
        // TÍTULO - ARTISTA 1 x ARTISTA 2 (ej: "SE FUE - Moncho Chavea x Morad")
        trackTitle = partA;
        authorName = partB;
      } else {
        // ARTISTA - TÍTULO estándar (ej: "Morad - SE FUE")
        authorName = partA;
        trackTitle = partB;
      }
    }
  }

  // Quitar la palabra "- Topic" del nombre del artista si viene del autor
  authorName = authorName.replace(/ - Topic$/i, '').trim();

  const { cleanTitle, cleanArtist } = cleanTrackNameAndArtist(trackTitle, authorName);

  const durationSec = v.duration?.seconds ?? v.durationSeconds ?? 0;

  return {
    id: v.id || v.videoId,
    itunesId: 0,        // no tiene iTunesId
    artistId: hashStringToInteger(cleanArtist),
    title: cleanTitle,
    artist: cleanArtist,
    album: 'YouTube',
    cover: v.thumbnail ?? '',
    duration: durationSec * 1000,
    genre: 'Urbano / Pop',
    releaseDate: null,
    popularity: v.views || (1000 - index),
    preview_url: null,
  };
}

/**
 * Cleans YouTube noise from titles and artist names.
 */
export function cleanTrackNameAndArtist(rawTitle: string, rawArtist: string): { cleanTitle: string; cleanArtist: string } {
  let artist = rawArtist.replace(/ - Topic$/i, '').replace(/vevo$/i, '').trim();
  let title = rawTitle;

  const sepIdx = title.indexOf(' - ');
  if (sepIdx !== -1) {
    const partA = title.substring(0, sepIdx).trim();
    const partB = title.substring(sepIdx + 3).trim();
    const partBHasCollab = /\b(x|feat\.?|ft\.?|featuring|&|con)\b/i.test(partB);
    const partAHasCollab = /\b(x|feat\.?|ft\.?|featuring|&|con)\b/i.test(partA);
    if (partBHasCollab && !partAHasCollab) {
      title = partA;
      artist = partB;
    } else {
      artist = partA;
      title = partB;
    }
  }

  title = title
    .replace(/\[(Official|Music|Video|Lyrics|Letra|Audio|HD|4K|Visualizer|Clip).*?\]/gi, '')
    .replace(/\((Official|Music|Video|Lyrics|Letra|Audio|HD|4K|Visualizer|Paroles|Clip).*?\)/gi, '')
    .replace(/\s*[\(\[](letra|lyrics|paroles|audio\s*oficial|official\s*audio|video\s*oficial|official\s*video)[\)\]]/gi, '')
    .replace(/Official\s+Video/gi, '')
    .replace(/Music\s+Video/gi, '')
    .replace(/Clip\s+Officiel/gi, '')
    .replace(/Video\s+Oficial/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  artist = artist
    .replace(/\s*[\(\[](letra|lyrics|paroles|audio\s*oficial|official\s*audio|video\s*oficial|official\s*video)[\)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { cleanTitle: title, cleanArtist: artist };
}

/**
 * Cross-resolves track metadata via iTunes & Last.fm to enrich YouTube tracks with genres, official artist names, release dates, and album art.
 */
export async function enrichTrackWithExternalAPIs(track: TrackMetadata): Promise<TrackMetadata> {
  if (track.genre && track.genre !== 'Desconocido' && track.genre !== 'Urbano / Pop' && track.itunesId > 0) {
    return track;
  }

  const { cleanTitle, cleanArtist } = cleanTrackNameAndArtist(track.title, track.artist);
  const cacheKey = `enrich:${normalizeStr(`${cleanArtist}-${cleanTitle}`)}`;
  const cached = cache.get(cacheKey);
  if (cached) return { ...track, ...JSON.parse(cached) };

  try {
    const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(cleanArtist + ' ' + cleanTitle)}&media=music&entity=musicTrack&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const data = await res.json() as any;
      const match = data.results?.[0];
      if (match) {
        const enriched = {
          title: match.trackName || cleanTitle,
          artist: match.artistName || cleanArtist,
          artistId: match.artistId || track.artistId,
          itunesId: match.trackId || track.itunesId,
          album: match.collectionName || track.album,
          cover: scaleArtwork(match.artworkUrl100) || track.cover,
          genre: match.primaryGenreName || 'Pop',
          releaseDate: match.releaseDate || track.releaseDate,
        };
        cache.setex(cacheKey, 86400, JSON.stringify(enriched));
        return { ...track, ...enriched };
      }
    }
  } catch (err) {
    // ignore lookup error
  }

  return {
    ...track,
    title: cleanTitle,
    artist: cleanArtist,
    genre: track.genre || 'Urbano / Pop',
  };
}

/**
 * Normaliza el título de una canción para detectar duplicados (Live, Lyrics, etc).
 */
function normalizeTrackTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, '') // Quita corchetes y paréntesis con su contenido
    .replace(/official|video|audio|lyric|lyrics|paroles|clip|music/g, '') // Quita palabras comunes de YouTube
    .replace(/[^a-z0-9]/g, '');      // Deja solo alfanuméricos
}

/**
 * Normaliza una lista de artistas de forma independiente al orden de créditos.
 * "Jay Wheeler, Brytiago & DJ Nelson" y "Jay Wheeler, DJ Nelson & Brytiago" son
 * literalmente el mismo tema (mismo recording, créditos reordenados en un
 * relanzamiento/single distinto) — antes el dedup los trataba como canciones
 * distintas porque comparaba el string de artista completo, en orden.
 */
function normalizeArtistSet(artist: string): string {
  const names = artist
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bx\b|\band\b|\bcon\b/i)
    .map(n => normalizeTrackTitle(n))
    .filter(Boolean)
    .sort();
  return names.join('+');
}

/** Huella título+artista (orden de colaboradores no importa) para detectar duplicados. */
function trackFingerprint(t: { title: string; artist: string }): string {
  let normTitle = normalizeTrackTitle(t.title);
  let normArtist = normalizeArtistSet(t.artist);
  if (normTitle.length < 2) normTitle = t.title.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normArtist.length < 2) normArtist = t.artist.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${normTitle}-${normArtist}`;
}

/**
 * Filtra la lista de tracks manteniendo solo canciones únicas (huella de titulo+artista).
 */
function deduplicateTracks(tracks: TrackMetadata[]): TrackMetadata[] {
  const seen = new Set<string>();
  const uniqueTracks: TrackMetadata[] = [];

  for (const t of tracks) {
    const fingerprint = trackFingerprint(t);

    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      uniqueTracks.push(t);
    }
  }

  return uniqueTracks;
}

/**
 * Busca tracks en iTunes. Si no hay resultados, hace fallback a yt-search.
 * La lista de resultados SOLO se cachea en L1 (memoria, 1h) para garantizar freshness.
 * Los metadatos individuales se persisten en Supabase via UPSERT.
 */
export async function searchTracks(
  query: string,
  limit = 20,
  source: SearchSource = 'itunes',
  bypassCache = false
): Promise<TrackMetadata[]> {
  const queryTrim = query.trim();
  const isYoutubeChannelQuery = queryTrim.startsWith('@') || 
                               queryTrim.includes('youtube.com/channel/') || 
                               queryTrim.includes('youtube.com/c/') || 
                               queryTrim.includes('youtube.com/user/') ||
                               queryTrim.includes('youtube.com/@');

  if (isYoutubeChannelQuery) {
    try {
      let channelSearchName = queryTrim;
      if (queryTrim.includes('youtube.com/')) {
        const parts = queryTrim.split('/');
        const lastPart = parts.find(p => p.startsWith('@')) || parts[parts.length - 1];
        if (lastPart) {
          channelSearchName = decodeURIComponent(lastPart);
        }
      }
      console.log(`[Metadata] Detectada búsqueda de canal de YouTube: "${channelSearchName}"`);
      const { getArtistInfo } = await import('./artistService');
      const ytArtistInfo = await getArtistInfo(channelSearchName);
      if (ytArtistInfo && ytArtistInfo.topTracks && ytArtistInfo.topTracks.length > 0) {
        return ytArtistInfo.topTracks;
      }
    } catch (err) {
      console.error('[Metadata] Error resolviendo canal de YouTube en búsqueda:', err);
    }
  }

  const cacheKey = `search:${source}:${query.toLowerCase().trim()}`;

  // L1: memoria (1h)
  if (!bypassCache) {
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  // Si el usuario elige YouTube directamente, ir a yt-search
  if (source === 'youtube') {
    return searchYouTube(query, limit, cacheKey);
  }

  // Si el usuario elige letras, ir a LRCLIB
  if (source === 'lyrics') {
    return searchLyrics(query, limit, cacheKey);
  }

  try {
    const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(query)}&entity=musicTrack&limit=${limit}&media=music`;
    const defaultHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    };
    let res = await fetch(url, { headers: defaultHeaders, signal: AbortSignal.timeout(8000) });

    // If rate-limited (429), retry once after a short 350ms backoff
    if (res.status === 429) {
      console.warn(`[Metadata] iTunes API 429 rate limit reached for "${query}". Retrying after 350ms...`);
      await new Promise(resolve => setTimeout(resolve, 350));
      res = await fetch(url, { headers: defaultHeaders, signal: AbortSignal.timeout(8000) });
    }

    if (!res.ok) throw new Error(`iTunes API error: ${res.status}`);

    const data = (await res.json()) as any;
    const results: any[] = data.results ?? [];
    const songs = results.filter((r: any) => r.kind === 'song' && r.trackId);
    const rawTracks = songs.map((item, idx) => itunesResultToTrack(item, idx));
    const tracks = deduplicateTracks(rawTracks);

    // Fallback a Deezer, Supabase DB o YouTube si iTunes no devuelve resultados
    if (tracks.length === 0) {
      metrics.recordSearchSource('itunes', false);
      console.log(`[Metadata] iTunes sin resultados para "${query}", buscando en Deezer...`);
      const dzTracks = await searchDeezer(query, limit);
      if (dzTracks.length > 0) { metrics.recordSearchSource('deezer', true); cacheTracksById(dzTracks); return dzTracks; }
      metrics.recordSearchSource('deezer', false);

      const dbTracks = await searchTracksFromDB(query, limit);
      if (dbTracks.length > 0) { metrics.recordSearchSource('db', true); cacheTracksById(dbTracks); return dbTracks; }
      metrics.recordSearchSource('db', false);
      return searchYouTube(query, limit, cacheKey);
    }
    metrics.recordSearchSource('itunes', true);

    // Evaluar relevancia de los resultados de iTunes con respecto a la búsqueda
    const queryTokens = query.toLowerCase().replace(/[^a-z0-9áéíóúñ\s]/gi, '').split(/\s+/).filter(t => t.length >= 3);
    const hasPoorRelevance = queryTokens.length >= 2 && !tracks.some(t => {
      const fullText = `${t.title} ${t.artist}`.toLowerCase();
      const matchCount = queryTokens.filter(tok => fullText.includes(tok)).length;
      return matchCount >= Math.min(queryTokens.length, 2);
    });

    // Si iTunes devolvió muy pocos resultados o no coinciden con los términos principales (ej. temas exclusivos de YouTube como "SE FUE de Morad con Moncho Chavea"),
    // consultar automáticamente YouTube para enriquecer y asegurar resultados relevantes
    if (tracks.length < 4 || hasPoorRelevance) {
      console.log(`[Metadata] Pocos resultados o baja relevancia en iTunes para "${query}", complementando con YouTube...`);

      // Reintento con query recortada: si el usuario escribió "de lejitos jhay
      // wheeler" (con una errata como "jhay" en vez de "jay"), ni iTunes ni
      // YouTube devuelven NUNCA la canción real como candidata — no es un
      // problema de ranking, el proveedor no la trae. Buscar solo con la
      // mitad inicial de la query (normalmente el título) suele esquivar la
      // palabra que rompió la búsqueda completa.
      if (hasPoorRelevance && queryTokens.length >= 3) {
        const trimmedQuery = query.trim().split(/\s+/).slice(0, Math.ceil(queryTokens.length / 2)).join(' ');
        if (trimmedQuery.toLowerCase() !== query.trim().toLowerCase()) {
          try {
            const trimmedTracks = await fetchItunesRaw(trimmedQuery, limit);
            if (trimmedTracks.length > 0) {
              console.log(`[Metadata] Reintento con query recortada "${trimmedQuery}" encontró ${trimmedTracks.length} resultado(s) que "${query}" no traía.`);
              const existingFp = new Set(tracks.map(trackFingerprint));
              for (const t of trimmedTracks) {
                const fp = trackFingerprint(t);
                if (!existingFp.has(fp)) {
                  existingFp.add(fp);
                  tracks.push(t);
                }
              }
            }
          } catch (err) {
            console.warn('[Metadata] Error en reintento con query recortada:', err);
          }
        }
      }

      try {
        const ytTracks = await searchYouTube(query, limit);
        if (ytTracks.length > 0) {
          const existingFingerprints = new Set(tracks.map(trackFingerprint));
          for (const yt of ytTracks) {
            const fp = trackFingerprint(yt);
            if (!existingFingerprints.has(fp)) {
              existingFingerprints.add(fp);
              tracks.push(yt);
            }
          }

          // Reordenar por relevancia de coincidencia con los términos de búsqueda
          if (queryTokens.length > 0) {
            tracks.sort((a, b) => {
              const aText = `${a.title} ${a.artist}`.toLowerCase();
              const bText = `${b.title} ${b.artist}`.toLowerCase();
              const aMatches = queryTokens.reduce((acc, tok) => acc + (aText.includes(tok) ? 1 : 0), 0);
              const bMatches = queryTokens.reduce((acc, tok) => acc + (bText.includes(tok) ? 1 : 0), 0);
              return bMatches - aMatches;
            });
          }
        }
      } catch (err) {
        console.warn('[Metadata] Error en fallback YouTube complementario:', err);
      }
    }

    // Guardar en L1 (1h)
    cache.setex(cacheKey, 3600, JSON.stringify(tracks));

    // UPSERT en Supabase L2 solo tracks de iTunes (tienen iTunesId válido)
    upsertTracks(tracks.map(trackToRow)).catch(err =>
      console.error('[Metadata] Error en UPSERT a Supabase:', err)
    );

    return tracks;
  } catch (error) {
    console.warn(`[Metadata] Warning en searchTracks (iTunes): ${error}. Probando Deezer...`);
    // 1st Fallback: Deezer API
    const dzTracks = await searchDeezer(query, limit);
    if (dzTracks.length > 0) {
      cache.setex(cacheKey, 1800, JSON.stringify(dzTracks));
      cacheTracksById(dzTracks);
      return dzTracks;
    }
    // 2nd Fallback: Supabase tracks_meta DB table
    const dbTracks = await searchTracksFromDB(query, limit);
    if (dbTracks.length > 0) {
      cache.setex(cacheKey, 1800, JSON.stringify(dbTracks));
      cacheTracksById(dbTracks);
      return dbTracks;
    }
    // 3rd Fallback: YouTube
    return searchYouTube(query, limit, cacheKey);
  }
}

/**
 * Búsqueda "cruda" en iTunes, sin fallbacks ni post-procesado — la usa tanto
 * el flujo principal como el reintento con query recortada (ver más abajo).
 */
async function fetchItunesRaw(term: string, limit: number): Promise<TrackMetadata[]> {
  const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(term)}&entity=musicTrack&limit=${limit}&media=music`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as any;
  const results: any[] = data.results ?? [];
  const songs = results.filter((r: any) => r.kind === 'song' && r.trackId);
  return deduplicateTracks(songs.map((item, idx) => itunesResultToTrack(item, idx)));
}

/** Fallback search in Deezer API when iTunes API blocks or yields no results */
export async function searchDeezer(query: string, limit = 10): Promise<TrackMetadata[]> {
  try {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    if (!data || !Array.isArray(data.data)) return [];
    return data.data.map((item: any, idx: number) => ({
      id: String(item.id),
      itunesId: Math.abs(Number(item.id)) || hashStringToInteger(String(item.id)),
      artistId: item.artist?.id ? Number(item.artist.id) : hashStringToInteger(item.artist?.name ?? 'unknown'),
      title: item.title ?? 'Sin título',
      artist: item.artist?.name ?? 'Artista desconocido',
      album: item.album?.title ?? '',
      cover: item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || '',
      duration: (item.duration ?? 0) * 1000,
      genre: 'Music',
      releaseDate: null,
      popularity: Math.max(1, 20 - idx),
      preview_url: item.preview ?? null,
    }));
  } catch {
    return [];
  }
}

/** Fallback search in Supabase tracks_meta table when iTunes rate limits or yields no results */
export async function searchTracksFromDB(query: string, limit = 20): Promise<TrackMetadata[]> {
  if (!supabase) return [];
  try {
    const cleanQ = query.trim().replace(/['"]/g, '');
    if (!cleanQ) return [];
    const { data, error } = await supabase
      .schema('kokomusic')
      .from('tracks_meta')
      .select('id, title, artist, album, cover, duration_ms, genre')
      .or(`title.ilike.%${cleanQ}%,artist.ilike.%${cleanQ}%,genre.ilike.%${cleanQ}%`)
      .limit(limit);

    if (error || !data || data.length === 0) return [];
    return data.map(row => ({
      id: row.id,
      title: row.title,
      artist: row.artist,
      album: row.album || '',
      cover: row.cover || '',
      duration: row.duration_ms || 180000,
      genre: row.genre || 'Music',
      itunesId: parseInt(row.id, 10) || 0,
      artistId: 0,
      releaseDate: '',
      popularity: 50,
      preview_url: null,
    }));
  } catch {
    return [];
  }
}

/** Búsqueda por letra a través de LRCLIB y resolución de metadatos */
async function searchLyrics(query: string, limit: number, cacheKey: string): Promise<TrackMetadata[]> {
  try {
    const lrcUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(lrcUrl, {
      headers: {
        'User-Agent': 'KokoMusic/1.0 (https://github.com/lherraa/KokoMusic)'
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`LRCLIB API error: ${res.status}`);
    const results = await res.json() as any[];

    if (!Array.isArray(results) || results.length === 0) {
      return [];
    }

    const uniqueMatches = results.slice(0, limit);
    const resolvedTracks: TrackMetadata[] = [];

    // Resolver cada coincidencia en iTunes para obtener carátulas y metadatos limpios
    for (const item of uniqueMatches) {
      try {
        const itunesUrl = `${ITUNES_BASE}/search?term=${encodeURIComponent(item.artistName + ' ' + item.trackName)}&entity=musicTrack&limit=1&media=music`;
        const itunesRes = await fetch(itunesUrl, { signal: AbortSignal.timeout(8000) });
        if (itunesRes.ok) {
          const itunesData = await itunesRes.json() as any;
          if (itunesData.results && itunesData.results.length > 0) {
            const track = itunesResultToTrack(itunesData.results[0], 0);
            resolvedTracks.push(track);
            continue;
          }
        }
      } catch (err) {
        console.warn(`[Lyrics Search] Falló resolución iTunes para ${item.artistName} - ${item.trackName}:`, err);
      }

      // Fallback si iTunes no lo encuentra: armar track con la info de LRCLIB
      const fallbackTrackId = String(item.id || hashStringToInteger(item.trackName + item.artistName));
      resolvedTracks.push({
        id: fallbackTrackId,
        itunesId: 0,
        artistId: hashStringToInteger(item.artistName),
        title: item.trackName,
        artist: item.artistName,
        album: item.albumName || 'Coincidencia de letra',
        cover: '', // Sin carátula o fallback
        duration: (item.duration || 0) * 1000,
        genre: 'Desconocido',
        releaseDate: null,
        popularity: 50,
        preview_url: null,
      });
    }

    const tracks = deduplicateTracks(resolvedTracks);
    if (tracks.length > 0) {
      cache.setex(cacheKey, 3600, JSON.stringify(tracks));
    }

    // UPSERT en Supabase L2 los tracks válidos de iTunes
    const itunesTracks = tracks.filter(t => t.itunesId > 0);
    if (itunesTracks.length > 0) {
      upsertTracks(itunesTracks.map(trackToRow)).catch(err =>
        console.error('[Metadata] Error en UPSERT a Supabase (lyrics):', err)
      );
    }
    cacheTracksById(tracks);

    return tracks;
  } catch (error) {
    console.error('[Metadata] Error en searchLyrics:', error);
    return [];
  }
}

/** Búsqueda de YouTube vía KokoMusic-lite (InnerTube) */
export async function searchYouTube(query: string, limit: number, cacheKey?: string): Promise<TrackMetadata[]> {
  try {
    const videos = await searchLite(query);

    // Priorizar canales oficiales (VEVO, Topic)
    const filteredVideos = videos
      .filter(v => v.id && (v.durationSeconds > 0 || v.durationSeconds === undefined))
      .sort((a, b) => {
        const aOfficial = /vevo$|- topic$/i.test(a.author ?? '');
        const bOfficial = /vevo$|- topic$/i.test(b.author ?? '');
        if (aOfficial && !bOfficial) return -1;
        if (!aOfficial && bOfficial) return 1;
        return 0;
      })
      .slice(0, limit);

    const rawTracks = filteredVideos.map((v, idx) => ytResultToTrack(v, idx));

    // Cross-resolve YouTube metadata with iTunes & Last.fm to populate real genres, official artist names, release dates and album art
    const enrichedTracks = await Promise.all(rawTracks.map(t => enrichTrackWithExternalAPIs(t)));

    // Deduplicar DESPUÉS de enriquecer, no antes: dos vídeos de YouTube con
    // título/canal distintos (p. ej. "OTRO FILI (Audio)" de un canal random y
    // "Otro Fili ft Jay Wheeler" de otro) pueden homogeneizarse al mismo track
    // de iTunes durante el enrichment. Si deduplicamos antes, ambos pasan como
    // "distintos" y el usuario ve la misma canción repetida en los resultados.
    const uniqueTracks = deduplicateTracks(enrichedTracks);

    if (cacheKey && uniqueTracks.length > 0) {
      cache.setex(cacheKey, 3600, JSON.stringify(uniqueTracks));
    }
    metrics.recordSearchSource('youtube', uniqueTracks.length > 0);
    cacheTracksById(uniqueTracks);
    return uniqueTracks;
  } catch (err) {
    console.error('[Metadata] Error en searchYouTube:', err);
    return [];
  }
}

/**
 * Cachea tracks por su `id` (L1, 24h) para que getTrackById pueda resolverlos luego.
 * Imprescindible para tracks de Deezer/DB/YouTube: su `id` no existe en el catálogo
 * de iTunes, así que sin esto getTrackById nunca los volvería a encontrar y
 * /api/stream/:id terminaría en 404 aunque el track se haya mostrado en la búsqueda.
 */
function cacheTracksById(tracks: TrackMetadata[]): void {
  for (const t of tracks) {
    if (t?.id) cache.setex(`track:${t.id}`, 86400, JSON.stringify(t));
  }
}

/**
 * Obtiene metadata de un track por iTunesId.
 * Caché: L1 (memoria, 24h) → L2 (Supabase, permanente) → iTunes lookup
 */
export async function getTrackById(itunesId: string | number): Promise<TrackMetadata | null> {
  const idStr = String(itunesId);
  const cacheKey = `track:${idStr}`;

  // L1: memoria (24h)
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  if (idStr.startsWith('custom_')) {
    const { getCustomTrackById: localGetCustom } = await import('./customTracksService');
    const custom = localGetCustom(idStr);
    if (!custom) return null;
    const track: TrackMetadata = {
      id: custom.id,
      itunesId: 0,
      artistId: hashStringToInteger(custom.artist),
      title: custom.title,
      artist: custom.artist,
      album: custom.album || 'Custom',
      cover: custom.cover || '',
      duration: custom.duration,
      genre: 'Custom',
      releaseDate: custom.createdAt,
      popularity: 100,
      preview_url: null,
    };
    cache.setex(cacheKey, 86400, JSON.stringify(track));
    return track;
  }

  const id = Number(itunesId);
  if (isNaN(id) || id === 0) {
    // Es un ID de YouTube — obtener metadata vía oEmbed sin yt-dlp
    try {
      // Sin timeout, un oEmbed lento/colgado bloqueaba TODA la petición de
      // stream indefinidamente (el try/catch no ayuda contra una promesa que
      // nunca se resuelve, solo contra un rechazo) — sin dar ningún error
      // visible en cliente. Con AbortSignal.timeout, si no responde a
      // tiempo, la promesa rechaza y cae al catch de abajo normalmente.
      const oembedRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(idStr)}&format=json`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!oembedRes.ok) return null;
      const v = (await oembedRes.json()) as any;

      const authorName = v.author_name ?? 'Artista desconocido';
      const rawTitle = v.title ?? 'Sin título';
      const { cleanTitle, cleanArtist } = cleanTrackNameAndArtist(rawTitle, authorName);

      let track: TrackMetadata = {
        id: idStr,
        itunesId: 0,
        artistId: hashStringToInteger(cleanArtist),
        title: cleanTitle,
        artist: cleanArtist,
        album: 'YouTube',
        cover: v.thumbnail_url ?? `https://img.youtube.com/vi/${idStr}/hqdefault.jpg`,
        duration: 180000,
        genre: 'Urbano / Pop',
        releaseDate: null,
        popularity: 50,
        preview_url: null,
      };

      // Enrich YouTube tracks with iTunes & Last.fm to get real genre, official artist & title
      try {
        track = await enrichTrackWithExternalAPIs(track);
      } catch { /* ignore enrichment error */ }

      cache.setex(cacheKey, 86400, JSON.stringify(track));
      return track;
    } catch (err) {
      console.error('[Metadata] Error getTrackById YouTube:', err);
      return null;
    }
  }

  // L2: Supabase (permanente)
  const row = await getTrackFromDB(id);
  if (row) {
    const track: TrackMetadata = {
      id: String(row.itunes_id),
      itunesId: row.itunes_id,
      artistId: row.artist_id,
      title: row.title,
      artist: row.artist,
      album: row.album ?? '',
      cover: row.cover_url ?? '',
      duration: row.duration_ms ?? 0,
      genre: row.genre ?? '',
      releaseDate: row.release_date ?? null,
      popularity: 0,
      preview_url: null,
    };
    cache.setex(cacheKey, 86400, JSON.stringify(track)); // recalentar L1
    return track;
  }

  // L3: iTunes API
  try {
    const url = `${ITUNES_BASE}/lookup?id=${id}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

    // 400 = ID no existe en el catálogo de iTunes — no es un error recuperable, retornar null silenciosamente
    if (res.status === 400 || res.status === 404) {
      return null;
    }

    if (!res.ok) {
      console.warn(`[Metadata] iTunes lookup devolvió ${res.status} para ID ${id}`);
      return null;
    }

    const data = (await res.json()) as any;
    const item = data.results?.[0];
    if (!item || item.kind !== 'song') return null;

    const track = itunesResultToTrack(item);

    // Persistir en L1 + L2
    cache.setex(cacheKey, 86400, JSON.stringify(track));
    upsertTracks([trackToRow(track)]).catch(() => {});

    return track;
  } catch (error) {
    console.warn('[Metadata] Error en getTrackById (network/parse):', error);
    return null;
  }
}

/**
 * Obtiene las canciones más populares de un artista por iTunesArtistId.
 * Caché: L1 (memoria, 1h) → iTunes lookup
 */
// Sufijos de versión que debemos ignorar al deduplicar títulos de tracks
// Ejemplos: "(Karaoke Version)", "(Live)", "(Sped Up)", "(Remastered 2021)"
const VERSION_SUFFIX_RE = /\s*[\[(](?:karaoke|karaoké|instrumental|backing\s*track|piano\s*(?:version|cover)?|acoustic\s*(?:version|cover)?|cover\s*version|live(?:\s+at\s+.+)?|en\s+vivo|sped[\s-]up|speed\s*up|slowed|reverb|nightcore|lofi|lo-fi|remix(?:\s+by\s+\w+)?|remaster(?:ed)?(?:\s+\d{4})?|radio\s*edit|single\s*version|original\s*mix|demo|bonus\s*track|deluxe|\d{4}\s*remaster)[^\])]*/gi;


// Versiones que no queremos en los top tracks (se filtran al final)
const BAD_ARTIST_TRACK_RE = /\b(karaoke|karaoké|instrumental|backing\s*track|nightcore|sped[\s-]up|slowed)\b/i;

export interface ArtistTracksResult {
  topTracks: TrackMetadata[];
  collaborations: TrackMetadata[];
  collaborators: { name: string; count: number; image?: string }[];
}

export async function getArtistTracksAndCollabs(artistId: number, limit = 25): Promise<ArtistTracksResult> {
  const cacheKey = `artist-collabs-v3:${artistId}`;

  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const url = `${ITUNES_BASE}/lookup?id=${artistId}&entity=song&limit=${Math.min(limit * 4, 200)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`iTunes artist lookup error: ${res.status}`);

    const data = (await res.json()) as any;
    const rawSongItems = (data.results ?? []).filter((item: any) => item.wrapperType === 'track' && item.kind === 'song');
    const artistEntry = (data.results ?? []).find((r: any) => r.wrapperType === 'artist');
    const targetArtistName = (artistEntry?.artistName || '').toLowerCase().trim();

    const nonLatinRegex = /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0600-\u06FF]/;
    let latinCount = 0;
    for (const s of rawSongItems) {
      if (!nonLatinRegex.test(s.trackName || '')) latinCount++;
    }
    const isDominantlyLatin = (latinCount / (rawSongItems.length || 1)) >= 0.80;

    const uniqueTopTracks: TrackMetadata[] = [];
    const seenTopTitles = new Set<string>();

    const uniqueCollabTracks: TrackMetadata[] = [];
    const seenCollabTitles = new Set<string>();

    const collaboratorCounts = new Map<string, { count: number; image?: string }>();

    for (const item of rawSongItems) {
      const rawTitle: string = item.trackName ?? '';
      const rawArtist = (item.artistName || '').toLowerCase().trim();

      if (isDominantlyLatin && nonLatinRegex.test(rawTitle)) continue;
      if (BAD_ARTIST_TRACK_RE.test(rawTitle)) continue;

      const normalizedTitle = rawTitle
        .replace(VERSION_SUFFIX_RE, '')
        .toLowerCase()
        .trim();

      // Extraer colaboradores mencionados en el nombre del artista
      const artistParts = (item.artistName || '')
        .split(/\s*(?:feat\.?|ft\.?|featuring|&|\bx\b|\bwith\b|\bcon\b|,)\s*/i)
        .map((p: string) => p.trim())
        .filter((p: string) => p.length >= 2);

      for (const part of artistParts) {
        if (targetArtistName && part.toLowerCase() !== targetArtistName) {
          const current = collaboratorCounts.get(part) || { count: 0 };
          collaboratorCounts.set(part, {
            count: current.count + 1,
            image: current.image || (item.artworkUrl100 ? scaleArtwork(item.artworkUrl100) : undefined),
          });
        }
      }

      // ¿Es pista principal (Lead)?
      const isLead = (item.artistId === artistId) && (!targetArtistName || rawArtist.startsWith(targetArtistName));
      const hasForeignCollection = item.collectionArtistName &&
        targetArtistName &&
        item.collectionArtistName.toLowerCase().trim() !== targetArtistName &&
        !item.collectionArtistName.toLowerCase().includes(targetArtistName) &&
        !rawArtist.startsWith(targetArtistName);

      if (isLead && !hasForeignCollection) {
        if (!seenTopTitles.has(normalizedTitle)) {
          seenTopTitles.add(normalizedTitle);
          uniqueTopTracks.push(itunesResultToTrack(item, uniqueTopTracks.length));
        }
      } else {
        // Pista de colaboración o invitado (ej. Tayc & RnBoi - MAMAN PRIE)
        const isRelated = targetArtistName && (rawArtist.includes(targetArtistName) || rawTitle.toLowerCase().includes(targetArtistName));
        if (isRelated && !seenCollabTitles.has(normalizedTitle)) {
          seenCollabTitles.add(normalizedTitle);
          uniqueCollabTracks.push(itunesResultToTrack(item, uniqueCollabTracks.length));
        }
      }
    }

    const collaborators = Array.from(collaboratorCounts.entries())
      .map(([name, val]) => ({ name, count: val.count, image: val.image }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const result: ArtistTracksResult = {
      topTracks: uniqueTopTracks.slice(0, limit),
      collaborations: uniqueCollabTracks.slice(0, limit),
      collaborators,
    };

    cache.setex(cacheKey, 3600, JSON.stringify(result));
    upsertTracks([...uniqueTopTracks, ...uniqueCollabTracks].map(trackToRow)).catch(() => {});

    return result;
  } catch (error) {
    console.error('[Metadata] Error en getArtistTracksAndCollabs:', error);
    return { topTracks: [], collaborations: [], collaborators: [] };
  }
}

export async function getArtistTopTracks(artistId: number, limit = 25): Promise<TrackMetadata[]> {
  const result = await getArtistTracksAndCollabs(artistId, limit);
  return result.topTracks;
}
