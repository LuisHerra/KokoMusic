import { Router, Request, Response } from 'express';
import { searchTracks, type SearchSource } from '../services/metadataService';
import { getHistoryForUser } from '../services/historyService';
import { boostSearchResults, splitArtistNames } from '../services/trendingService';
import { cache } from '../services/cacheService';
import { getSearchCache, setSearchCache } from '../services/searchCacheService';
import { prewarmTopTracks } from '../services/streamResolverService';

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

  try {
    // ── L1: In-memory cache ──────────────────────────────────────────────────
    const l1Hit = cache.get(l1Key);
    if (l1Hit) {
      console.log(`[Search] L1 hit: "${normalizedQ}" (${searchSource})`);
      const parsed = JSON.parse(l1Hit);
      if (Array.isArray(parsed)) {
        return res.json({ tracks: parsed, source: searchSource, cached: true });
      }
      return res.json({ tracks: parsed.tracks, artist: parsed.artist, source: searchSource, cached: true });
    }

    // ── L2: Supabase persistent cache ────────────────────────────────────────
    const l2Hit = await getSearchCache(searchSource, normalizedQ);
    if (l2Hit) {
      console.log(`[Search] L2 hit: "${normalizedQ}" (${searchSource})`);
      const inferredArtist = await inferArtistFromSearch(q.trim(), l2Hit);
      const payload = { tracks: l2Hit, artist: inferredArtist };
      cache.setex(l1Key, L1_TTL[searchSource], JSON.stringify(payload));
      return res.json({ tracks: l2Hit, artist: inferredArtist, source: searchSource, cached: true });
    }

    // ── L3: Live API (iTunes / YouTube / Lyrics) ─────────────────────────────
    console.log(`[Search] Cache miss — fetching live: "${normalizedQ}" (${searchSource})`);
    let tracks = await searchTracks(q.trim(), Number(limit) || 20, searchSource);

    // Personalisation boost — user history + trending
    let artistScores: Record<string, number> = {};
    let genreScores: Record<string, number> = {};
    let listenedTrackKeys = new Set<string>();

    if (userId && tracks.length > 0) {
      try {
        const history = await getHistoryForUser(userId);
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

    const userRegion = (req.headers['x-user-region'] as string) || 'spain';
    tracks = await boostSearchResults(tracks, q.trim(), artistScores, userRegion, listenedTrackKeys, genreScores);

    // Inferir si la búsqueda corresponde a un artista
    const inferredArtist = await inferArtistFromSearch(q.trim(), tracks);

    // Write-through to L1 + L2 (non-blocking)
    const payload = { tracks, artist: inferredArtist };
    cache.setex(l1Key, L1_TTL[searchSource], JSON.stringify(payload));
    setSearchCache(searchSource, normalizedQ, tracks).catch(() => {});

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
