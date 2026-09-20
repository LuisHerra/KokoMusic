import { Router, Request, Response } from 'express';
import { searchTracks, getTrackById, searchYouTube, type SearchSource, type TrackMetadata } from '../services/metadataService';
import { getHistoryForUser, type HistoryEntry } from '../services/historyService';
import { boostSearchResults, splitArtistNames, tokenizeQuery } from '../services/trendingService';
import { hashStringToInteger } from '../services/artistService';
import { cache } from '../services/cacheService';
import { getSearchCache, setSearchCache } from '../services/searchCacheService';
import { prewarmTopTracks } from '../services/streamResolverService';

/**
 * ¿El título de este track del historial contiene TODAS las palabras de la
 * query buscada? Comparación por palabra completa (no substring) para evitar
 * falsos positivos con tokens cortos como "de".
 */
function historyTitleMatchesQuery(entryTitle: string, queryTokens: string[]): boolean {
  if (queryTokens.length === 0) return false;
  const titleWords = new Set(
    entryTitle.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  );
  return queryTokens.every(tok => titleWords.has(tok));
}

/**
 * Convierte una entrada del historial en un TrackMetadata listo para
 * insertar en resultados de búsqueda. Si el trackId es un iTunesId numérico,
 * recupera la metadata completa (probablemente ya en caché L1/L2 — este
 * track ya se buscó una vez para poder haberse reproducido). Si es un ID de
 * YouTube (u otro no numérico), construye el track directo desde el propio
 * historial, sin volver a golpear ninguna API externa.
 */
async function historyEntryToTrack(entry: HistoryEntry): Promise<TrackMetadata | null> {
  const numericId = Number(entry.trackId);
  if (!isNaN(numericId) && numericId > 0) {
    const full = await getTrackById(numericId);
    if (full) return full;
  }
  return {
    id: entry.trackId,
    itunesId: 0,
    artistId: hashStringToInteger(entry.artist),
    title: entry.title,
    artist: entry.artist,
    album: 'YouTube',
    cover: entry.cover || '',
    duration: 0,
    genre: entry.genre || 'Urbano / Pop',
    releaseDate: null,
    popularity: entry.playCount,
    preview_url: null,
  };
}

const router = Router();

// L1 TTL constants (in-memory cache)
const L1_TTL: Record<SearchSource, number> = {
  itunes:  6 * 60 * 60,  // 6h
  youtube: 2 * 60 * 60,  // 2h
  lyrics:  4 * 60 * 60,  // 4h
};

interface InferredArtist {
  id: number | string;
  name: string;
  image: string;
  genre: string;
  confidence: number;
}

import { getArtistInfo } from '../services/artistService';

/**
 * Infiere de manera inteligente si la búsqueda corresponde a un artista (ej. "JUL", "rnboi", "Bad Bunny")
 * analizando dominancia léxica en los resultados, separando colaboraciones y cruzando con iTunes musicArtist.
 */
async function inferArtistFromSearch(query: string, tracks: any[]): Promise<InferredArtist | null> {
  if (!query || query.trim().length === 0) return null;

  const cleanQuery = query.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\.\-_]/g, '');

  // 1. Contar frecuencias de artistas en los resultados (incluyendo colaboraciones)
  const artistFrequencies = new Map<string, { artist: string; artistId: number; cover: string; count: number }>();
  for (const t of tracks.slice(0, 20)) {
    if (!t.artist) continue;

    const cleanArtist = t.artist.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\.\-_]/g, '');
    const current = artistFrequencies.get(cleanArtist);
    if (current) {
      current.count++;
    } else {
      artistFrequencies.set(cleanArtist, {
        artist: t.artist,
        artistId: t.artistId || 0,
        cover: t.cover,
        count: 1,
      });
    }

    // Separar colaboradores: "Tayc & RnBoi", "Jul, SCH", "Bizarrap ft. Quevedo", etc.
    const parts = t.artist.split(/(?:\s*,\s*|\s+ft\.?\s+|\s+feat\.?\s+|\s+&\s+|\s+x\s+|\s+with\s+)/i);
    if (parts.length > 1) {
      for (const p of parts) {
        const sub = p.trim();
        if (!sub) continue;
        const cleanSub = sub.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\.\-_]/g, '');
        const exist = artistFrequencies.get(cleanSub);
        if (exist) {
          exist.count++;
        } else {
          artistFrequencies.set(cleanSub, {
            artist: sub,
            artistId: 0,
            cover: t.cover,
            count: 1,
          });
        }
      }
    }
  }

  const sortedArtists = Array.from(artistFrequencies.entries()).sort((a, b) => b[1].count - a[1].count);

  let candidate: { artist: string; artistId: number; cover: string; count: number } | null = null;
  let confidence = 0;

  // A) Coincidencia exacta con la query (ej. query="JUL" -> cleanName="jul")
  for (const [cleanName, info] of sortedArtists) {
    if (cleanName === cleanQuery) {
      candidate = info;
      confidence = 0.95;
      break;
    }
  }

  // B) Si la query está contenida o el artista contiene la query
  if (!candidate && sortedArtists.length > 0) {
    const top = sortedArtists[0][1];
    const topClean = sortedArtists[0][0];
    if (
      (topClean.includes(cleanQuery) || cleanQuery.includes(topClean)) &&
      (top.count >= 2 || tracks.length <= 3)
    ) {
      candidate = top;
      confidence = 0.85;
    } else if (top.count >= Math.max(3, Math.floor(tracks.length * 0.35))) {
      candidate = top;
      confidence = 0.80;
    }
  }

  // C) Verificar con iTunes entity=musicArtist para imagen en HD e ID oficial
  let result: InferredArtist | null = null;
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=musicArtist&limit=4`;
    const itunesRes = await fetch(itunesUrl, { signal: AbortSignal.timeout(2500) });
    if (itunesRes.ok) {
      const itunesData = (await itunesRes.json()) as any;
      const artists = (itunesData.results || []).filter((r: any) => r.wrapperType === 'artist' && r.artistId);
      const exactItunes = artists.find((a: any) =>
        (a.artistName || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\.\-_]/g, '') === cleanQuery
      );
      const chosenItunes = exactItunes || (candidate ? artists.find((a: any) => (a.artistName || '').toLowerCase() === candidate!.artist.toLowerCase()) : null);

      if (chosenItunes) {
        let artistImg = candidate?.cover || '';
        try {
          const songRes = await fetch(`https://itunes.apple.com/lookup?id=${chosenItunes.artistId}&entity=song&limit=1`, { signal: AbortSignal.timeout(2000) });
          if (songRes.ok) {
            const songData = (await songRes.json()) as any;
            const song = songData.results?.find((r: any) => r.wrapperType === 'track' && r.artworkUrl100);
            if (song) artistImg = song.artworkUrl100.replace(/\d+x\d+bb\.jpg$/, '600x600bb.jpg');
          }
        } catch {}

        result = {
          id: chosenItunes.artistId,
          name: chosenItunes.artistName,
          genre: chosenItunes.primaryGenreName || 'Artista',
          image: artistImg,
          confidence: 0.99,
        };
      }
    }
  } catch {}

  if (!result && candidate && confidence >= 0.75) {
    result = {
      id: candidate.artistId || 0,
      name: candidate.artist,
      genre: 'Artista',
      image: candidate.cover,
      confidence,
    };
  }

  // Precalentar en segundo plano el perfil completo del artista
  if (result) {
    const prewarmTarget = result.id && result.id !== 0 ? result.id : result.name;
    getArtistInfo(prewarmTarget).catch((e) => {
      console.warn('[Search] Background prewarm error for artist:', prewarmTarget, e);
    });
  }

  return result;
}

/**
 * Aplica personalización a un set de resultados YA obtenidos (de caché o
 * en vivo, da igual) — nunca se cachea el resultado de esta función, solo
 * los tracks "crudos" que recibe. Antes esto corría únicamente en el
 * camino de caché-miss y su salida SÍ se guardaba en caché, así que el
 * primer usuario en buscar una query "horneaba" su propio historial en el
 * orden (y ahora también en qué tracks aparecen) para TODOS los usuarios
 * que buscaran lo mismo después, hasta que expirase el TTL — un problema
 * de privacidad/corrección real, no solo cosmético, que la inyección de
 * historial (más abajo) habría hecho mucho más visible al meter canciones
 * de un usuario en los resultados de otro.
 */
async function personalizeTracks(
  rawTracks: TrackMetadata[],
  query: string,
  userId: string | undefined,
  searchSource: SearchSource,
  region: string
): Promise<TrackMetadata[]> {
  let tracks = rawTracks;
  let artistScores: Record<string, number> = {};
  let genreScores: Record<string, number> = {};
  let listenedTrackKeys = new Set<string>();
  let history: HistoryEntry[] = [];

  if (userId) {
    try {
      history = await getHistoryForUser(userId);
      if (history && history.length > 0) {
        for (const entry of history) {
          if (entry.artist) {
            const artistNorm = entry.artist.toLowerCase().trim();
            artistScores[artistNorm] = (artistScores[artistNorm] || 0) + (entry.playCount || 1);
            // También sumar cada colaborador por separado — si el usuario
            // escuchó "J Balvin & Bad Bunny", eso cuenta como afinidad con
            // Bad Bunny también, no solo con la colaboración exacta.
            const collaborators = splitArtistNames(entry.artist);
            if (collaborators.length > 1) {
              for (const name of collaborators) {
                artistScores[name] = (artistScores[name] || 0) + (entry.playCount || 1);
              }
            }
          }
          // Género que el usuario escucha regularmente — sube resultados de
          // ese género aunque no reconozca al artista concreto.
          if (entry.genre) {
            const genreNorm = entry.genre.toLowerCase().trim();
            genreScores[genreNorm] = (genreScores[genreNorm] || 0) + (entry.playCount || 1);
          }
          if (entry.title && entry.artist) {
            const cleanTitle = entry.title.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
            const cleanArtist = entry.artist.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
            listenedTrackKeys.add(`${cleanTitle}${cleanArtist}`);
            listenedTrackKeys.add(`${cleanArtist}${cleanTitle}`);
          }
          if (entry.trackId) {
            listenedTrackKeys.add(entry.trackId.toLowerCase());
          }
        }
      }
    } catch (err) {
      console.error('[Search] Error loading user history for boosting:', err);
    }
  }

  // Inyectar canciones que ya escuchaste antes y coinciden con la query,
  // aunque la fuente principal no las haya traído esta vez — caso real:
  // buscar "de lejitos" en iTunes trae 50 canciones de 50 artistas
  // distintos con ese mismo título, ninguna es la que ya escuchaste. Como
  // esta SÍ está en tu historial (con su itunesId o youtubeId ya resuelto),
  // no hace falta adivinar nada — se sabe con certeza que es la que
  // buscás. boostSearchResults ya sube +500 a tracks en listenedTrackKeys,
  // así que solo hace falta meterla en el pool para que gane el orden.
  if (searchSource !== 'lyrics' && history.length > 0) {
    const queryTokens = tokenizeQuery(query);
    const existingIds = new Set(tracks.map(t => String(t.id)));
    const historyMatches = history
      .filter(h => h.title && !existingIds.has(h.trackId) && historyTitleMatchesQuery(h.title, queryTokens))
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 3);

    if (historyMatches.length > 0) {
      tracks = [...tracks];
      for (const h of historyMatches) {
        try {
          const track = await historyEntryToTrack(h);
          if (track && !existingIds.has(String(track.id))) {
            tracks.push(track);
            existingIds.add(String(track.id));
          }
        } catch (err) {
          console.warn('[Search] Error convirtiendo entrada de historial a track:', err);
        }
      }
    }
  }

  // Paso 2: canciones NUEVAS (nunca escuchadas) de un artista que sí sigues
  // habitualmente. La inyección de historial de arriba solo rescata lo que
  // ya escuchaste — esto cubre lo contrario: ninguno de los resultados de
  // iTunes es de un artista de tu artistScores (ni sus colaboradores), así
  // que puede que la canción real esté enterrada entre homónimos de otros
  // artistas (mismo caso que "de lejitos") y ni siquiera la hayas escuchado
  // todavía. Solo aplica a la pestaña iTunes — la de YouTube ya busca en
  // InnerTube directamente.
  const affinityInjectedIds = new Set<string>();

  if (searchSource === 'itunes' && userId && Object.keys(artistScores).length > 0) {
    const matchesKnownArtist = (artist: string): boolean =>
      Boolean(artistScores[artist.toLowerCase().trim()]) ||
      splitArtistNames(artist).some(name => artistScores[name]);

    if (!tracks.some(t => matchesKnownArtist(t.artist))) {
      const suppCacheKey = `supp-affinity:${userId}:${query.toLowerCase().trim()}`;
      const cachedSupp = cache.get(suppCacheKey);
      let suppTracks: TrackMetadata[];

      if (cachedSupp !== null) {
        suppTracks = JSON.parse(cachedSupp);
      } else {
        try {
          const ytTracks = await searchYouTube(query, 15);
          suppTracks = ytTracks.filter(t => matchesKnownArtist(t.artist));
        } catch (err) {
          console.warn('[Search] Error buscando afinidad de artista en YouTube:', err);
          suppTracks = [];
        }
        // TTL corto si no encontró nada (puede ser transitorio), más largo
        // si sí — mismo criterio que otras cachés negativas del proyecto.
        cache.setex(suppCacheKey, suppTracks.length > 0 ? 3600 : 600, JSON.stringify(suppTracks));
      }

      if (suppTracks.length > 0) {
        const existingIds = new Set(tracks.map(t => String(t.id)));
        tracks = [...tracks];
        for (const t of suppTracks) {
          if (!existingIds.has(String(t.id))) {
            tracks.push(t);
            existingIds.add(String(t.id));
            affinityInjectedIds.add(String(t.id));
          }
        }
        console.log(`[Search] Afinidad de artista: "${query}" no traía ningún artista conocido de ${userId}, complementado con ${suppTracks.length} de YouTube.`);
      }
    }
  }

  const boosted = await boostSearchResults(tracks, query, artistScores, region, listenedTrackKeys, genreScores);
  if (affinityInjectedIds.size === 0) return boosted;

  // boostSearchResults pondera sobre todo relevancia textual (hasta 300pts) —
  // con 50 homónimos "De Lejitos" con el mismo título exacto, el boost de
  // artista conocido (+200/+120) no basta para que el candidato inyectado
  // suba a los primeros puestos, así que se antepone explícitamente. No hay
  // solapamiento posible con los inyectados por historial (paso 1): ese
  // bloque corre antes y, si encuentra algo, este paso ni se ejecuta.
  const promoted = boosted.filter(t => affinityInjectedIds.has(String(t.id)));
  const rest = boosted.filter(t => !affinityInjectedIds.has(String(t.id)));
  return [...promoted, ...rest];
}

// GET /api/search?q=bad+bunny&limit=20&source=itunes
router.get('/', async (req: Request, res: Response) => {
  const { q, limit, source } = req.query as { q?: string; limit?: string; source?: string };
  const userId = req.headers['x-user-id'] as string | undefined;

  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: 'Parámetro q requerido' });
  }

  let searchSource: SearchSource = 'itunes';
  if (source === 'youtube') {
    searchSource = 'youtube';
  } else if (source === 'lyrics') {
    searchSource = 'lyrics';
  }

  const normalizedQ = q.trim().toLowerCase();
  const l1Key = `search:${searchSource}:${normalizedQ}`;

  const userRegion = (req.headers['x-user-region'] as string) || 'spain';

  try {
    // ── L1: In-memory cache ──────────────────────────────────────────────────
    // Se cachea siempre el resultado CRUDO (sin personalizar) — nunca el ya
    // personalizado. Antes se guardaba el resultado de boostSearchResults ya
    // reordenado con el historial del PRIMER usuario que buscara esa query,
    // y todo el mundo que buscara lo mismo después heredaba ese orden hasta
    // que expirase el TTL. Con la inyección de historial esto sería aún peor
    // (aparecerían canciones del historial de otro usuario). La
    // personalización corre en cada request, sobre el mismo crudo cacheado.
    const l1Hit = cache.get(l1Key);
    if (l1Hit) {
      console.log(`[Search] L1 hit: "${normalizedQ}" (${searchSource})`);
      const parsed = JSON.parse(l1Hit);
      const rawTracks: TrackMetadata[] = Array.isArray(parsed) ? parsed : parsed.tracks;
      const cachedArtist = Array.isArray(parsed) ? null : parsed.artist;
      const tracks = await personalizeTracks(rawTracks, q.trim(), userId, searchSource, userRegion);
      prewarmTopTracks(tracks);
      return res.json({ tracks, artist: cachedArtist, source: searchSource, cached: true });
    }

    // ── L2: Supabase persistent cache ────────────────────────────────────────
    const l2Hit = await getSearchCache(searchSource, normalizedQ);
    if (l2Hit) {
      console.log(`[Search] L2 hit: "${normalizedQ}" (${searchSource})`);
      const inferredArtist = await inferArtistFromSearch(q.trim(), l2Hit);
      cache.setex(l1Key, L1_TTL[searchSource], JSON.stringify({ tracks: l2Hit, artist: inferredArtist }));
      const tracks = await personalizeTracks(l2Hit, q.trim(), userId, searchSource, userRegion);
      prewarmTopTracks(tracks);
      return res.json({ tracks, artist: inferredArtist, source: searchSource, cached: true });
    }

    // ── L3: Live API (iTunes / YouTube / Lyrics) ─────────────────────────────
    console.log(`[Search] Cache miss — fetching live: "${normalizedQ}" (${searchSource})`);
    const rawTracks = await searchTracks(q.trim(), Number(limit) || 20, searchSource);

    // Inferir si la búsqueda corresponde a un artista — sobre el crudo, no
    // depende del usuario, así que se puede cachear junto a los tracks.
    const inferredArtist = await inferArtistFromSearch(q.trim(), rawTracks);

    // Write-through a L1 + L2 (non-blocking) — solo si hay resultados. Un []
    // vacío suele ser un fallo transitorio (rate-limit, timeout, endpoint
    // caído) más que "esta query no tiene resultados de verdad" — cachearlo
    // igual que un hit real dejaba la búsqueda envenenada durante todo el TTL
    // (6h en Supabase) aunque el problema de fondo ya estuviera resuelto.
    if (rawTracks.length > 0) {
      cache.setex(l1Key, L1_TTL[searchSource], JSON.stringify({ tracks: rawTracks, artist: inferredArtist }));
      setSearchCache(searchSource, normalizedQ, rawTracks).catch(() => {});
    }

    const tracks = await personalizeTracks(rawTracks, q.trim(), userId, searchSource, userRegion);

    // Precalentar en segundo plano el stream de los primeros resultados para
    // que el play sea casi instantáneo en el caso común (no bloquea la respuesta).
    prewarmTopTracks(tracks);

    return res.json({ tracks, artist: inferredArtist, source: searchSource });
  } catch (err) {
    console.error('[Search] Error:', err);
    return res.status(500).json({ error: 'Error al buscar' });
  }
});

// GET /api/search/image-proxy?url=...
// Also alias GET /api/image-proxy in express router
router.get('/image-proxy', async (req: Request, res: Response) => {
  const imageUrl = req.query.url as string | undefined;
  if (!imageUrl) {
    return res.status(400).send('Missing url parameter');
  }
  try {
    const cleanUrl = imageUrl.startsWith('http://') ? imageUrl.replace('http://', 'https://') : imageUrl;
    const response = await fetch(cleanUrl);
    if (!response.ok) {
      return res.status(response.status).send('Failed to fetch image');
    }
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err: any) {
    res.status(500).send('Error proxying image');
  }
});

export default router;
