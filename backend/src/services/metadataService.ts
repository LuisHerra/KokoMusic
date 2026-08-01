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
import { searchYtdlp, getVideoByIdYtdlp } from './ytdlpSearchService';

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

/** Convierte un resultado de yt-search al formato interno (fuente YouTube) */
function ytResultToTrack(v: any, index = 0): TrackMetadata {
  let authorName = v.author?.name ?? 'Artista desconocido';
  let trackTitle = v.title ?? 'Sin título';

  // Si el título tiene el formato "Artista - Canción", lo extraemos
  // Ej: "RnBoi - ELLE VOULAIT (Clip Officiel)"
  const separatorIdx = trackTitle.indexOf(' - ');
  if (separatorIdx !== -1) {
    const parsedArtist = trackTitle.substring(0, separatorIdx).trim();
    const parsedTitle = trackTitle.substring(separatorIdx + 3).trim();
    if (parsedArtist && parsedTitle) {
      authorName = parsedArtist;
      trackTitle = parsedTitle;
    }
  }

  // Quitar la palabra "- Topic" del nombre del artista si viene del autor
  authorName = authorName.replace(/ - Topic$/i, '').trim();

  const { cleanTitle, cleanArtist } = cleanTrackNameAndArtist(trackTitle, authorName);

  return {
    id: v.videoId,
    itunesId: 0,        // no tiene iTunesId
    artistId: hashStringToInteger(cleanArtist),
    title: cleanTitle,
    artist: cleanArtist,
    album: 'YouTube',
    cover: v.thumbnail ?? '',
    duration: (v.duration?.seconds ?? 0) * 1000,
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
    artist = title.substring(0, sepIdx).trim();
    title = title.substring(sepIdx + 3).trim();
  }

  title = title
    .replace(/\[(Official|Music|Video|Lyrics|Audio|HD|4K|Visualizer|Clip).*?\]/gi, '')
    .replace(/\((Official|Music|Video|Lyrics|Audio|HD|4K|Visualizer|Paroles|Clip).*?\)/gi, '')
    .replace(/Official\s+Video/gi, '')
    .replace(/Music\s+Video/gi, '')
    .replace(/Clip\s+Officiel/gi, '')
    .replace(/Video\s+Oficial/gi, '')
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
    const res = await fetch(url);
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
 * Filtra la lista de tracks manteniendo solo canciones únicas (huella de titulo+artista).
 */
function deduplicateTracks(tracks: TrackMetadata[]): TrackMetadata[] {
  const seen = new Set<string>();
  const uniqueTracks: TrackMetadata[] = [];

  for (const t of tracks) {
    let normTitle = normalizeTrackTitle(t.title);
    let normArtist = normalizeTrackTitle(t.artist);
    
    // Fallback si la limpieza fue muy agresiva
    if (normTitle.length < 2) normTitle = t.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normArtist.length < 2) normArtist = t.artist.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    const fingerprint = `${normTitle}-${normArtist}`;
    
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
    let res = await fetch(url, { headers: defaultHeaders });
    
    // If rate-limited (429), retry once after a short 350ms backoff
    if (res.status === 429) {
      console.warn(`[Metadata] iTunes API 429 rate limit reached for "${query}". Retrying after 350ms...`);
      await new Promise(resolve => setTimeout(resolve, 350));
      res = await fetch(url, { headers: defaultHeaders });
    }

    if (!res.ok) throw new Error(`iTunes API error: ${res.status}`);

    const data = (await res.json()) as any;
    const results: any[] = data.results ?? [];
    const songs = results.filter((r: any) => r.kind === 'song' && r.trackId);
    const rawTracks = songs.map((item, idx) => itunesResultToTrack(item, idx));
    const tracks = deduplicateTracks(rawTracks);

    // Fallback a Deezer, Supabase DB o YouTube si iTunes no devuelve resultados
    if (tracks.length === 0) {
      console.log(`[Metadata] iTunes sin resultados para "${query}", buscando en Deezer...`);
      const dzTracks = await searchDeezer(query, limit);
      if (dzTracks.length > 0) return dzTracks;

      const dbTracks = await searchTracksFromDB(query, limit);
      if (dbTracks.length > 0) return dbTracks;
      return searchYouTube(query, limit, cacheKey);
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
      return dzTracks;
    }
    // 2nd Fallback: Supabase tracks_meta DB table
    const dbTracks = await searchTracksFromDB(query, limit);
    if (dbTracks.length > 0) {
      cache.setex(cacheKey, 1800, JSON.stringify(dbTracks));
      return dbTracks;
    }
    // 3rd Fallback: YouTube
    return searchYouTube(query, limit, cacheKey);
  }
}

/** Fallback search in Deezer API when iTunes API blocks or yields no results */
export async function searchDeezer(query: string, limit = 10): Promise<TrackMetadata[]> {
  try {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      }
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
      }
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
        const itunesRes = await fetch(itunesUrl);
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

    return tracks;
  } catch (error) {
    console.error('[Metadata] Error en searchLyrics:', error);
    return [];
  }
}

/** Búsqueda de YouTube vía yt-dlp */
async function searchYouTube(query: string, limit: number, cacheKey: string): Promise<TrackMetadata[]> {
  try {
    const videos = await searchYtdlp(query, limit);

    // Priorizar canales oficiales (VEVO, Topic)
    const filteredVideos = videos
      .filter(v => v.videoId && (v.duration?.seconds > 0 || v.duration?.seconds === undefined))
      .sort((a, b) => {
        const aOfficial = /vevo$|- topic$/i.test(a.author?.name ?? '');
        const bOfficial = /vevo$|- topic$/i.test(b.author?.name ?? '');
        if (aOfficial && !bOfficial) return -1;
        if (!aOfficial && bOfficial) return 1;
        return 0;
      })
      .slice(0, limit);

    const rawTracks = filteredVideos.map((v, idx) => ytResultToTrack(v, idx));
    const uniqueTracks = deduplicateTracks(rawTracks);

    // Cross-resolve YouTube metadata with iTunes & Last.fm to populate real genres, official artist names, release dates and album art
    const enrichedTracks = await Promise.all(uniqueTracks.map(t => enrichTrackWithExternalAPIs(t)));
    
    if (enrichedTracks.length > 0) {
      cache.setex(cacheKey, 3600, JSON.stringify(enrichedTracks));
    }
    return enrichedTracks;
  } catch (err) {
    console.error('[Metadata] Error en searchYouTube:', err);
    return [];
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
    // Es un ID de YouTube — usar yt-dlp para obtener metadata
    try {
      const v = await getVideoByIdYtdlp(idStr);
      if (!v) return null;
      
      const authorName = v.author?.name ?? 'Artista desconocido';
      const rawTitle = v.title ?? 'Sin título';
      const { cleanTitle, cleanArtist } = cleanTrackNameAndArtist(rawTitle, authorName);

      let track: TrackMetadata = {
        id: idStr,
        itunesId: 0,
        artistId: hashStringToInteger(cleanArtist),
        title: cleanTitle,
        artist: cleanArtist,
        album: 'YouTube',
        cover: v.thumbnail ?? `https://img.youtube.com/vi/${idStr}/hqdefault.jpg`,
        duration: (v.duration?.seconds ?? 0) * 1000,
        genre: 'Urbano / Pop',
        releaseDate: null,
        popularity: v.views || 0,
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
    const res = await fetch(url);

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

export async function getArtistTopTracks(artistId: number, limit = 25): Promise<TrackMetadata[]> {
  const cacheKey = `artist-tracks:${artistId}`;

  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    // Pedimos más resultados de los necesarios para poder filtrar versiones malas
    const url = `${ITUNES_BASE}/lookup?id=${artistId}&entity=song&limit=${Math.min(limit * 3, 200)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`iTunes artist lookup error: ${res.status}`);

    const data = (await res.json()) as any;
    // El primer resultado es el artista, el resto son canciones
    const uniqueTracks: TrackMetadata[] = [];
    // Clave normalizada: sin sufijos de versión entre paréntesis/corchetes
    const seenNormalizedTitles = new Set<string>();

    for (const item of (data.results ?? [])) {
      if (item.wrapperType !== 'track' || item.kind !== 'song') continue;

      const rawTitle: string = item.trackName ?? '';

      // Ignorar versiones claramente no deseadas incluso si son la primera ocurrencia
      if (BAD_ARTIST_TRACK_RE.test(rawTitle)) continue;

      // Normalizar título: quitar sufijos de versión entre () o [] para deduplicar
      // Ej: "Blinding Lights (Karaoke Version)" → "blinding lights"
      const normalizedTitle = rawTitle
        .replace(VERSION_SUFFIX_RE, '')
        .toLowerCase()
        .trim();

      if (!seenNormalizedTitles.has(normalizedTitle)) {
        seenNormalizedTitles.add(normalizedTitle);
        uniqueTracks.push(itunesResultToTrack(item, uniqueTracks.length));
        if (uniqueTracks.length >= limit) break; // Ya tenemos suficientes
      }
    }

    const tracks = uniqueTracks;


    cache.setex(cacheKey, 3600, JSON.stringify(tracks));

    // UPSERT en Supabase
    upsertTracks(tracks.map(trackToRow)).catch(() => {});

    return tracks;
  } catch (error) {
    console.error('[Metadata] Error en getArtistTopTracks:', error);
    return [];
  }
}
