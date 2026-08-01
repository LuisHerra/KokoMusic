import { Router, Request, Response } from 'express';
import { searchTracks, type SearchSource } from '../services/metadataService';
import { getHistoryForUser } from '../services/historyService';
import { boostSearchResults } from '../services/trendingService';
import { cache } from '../services/cacheService';
import { getSearchCache, setSearchCache } from '../services/searchCacheService';

const router = Router();

// L1 TTL constants (in-memory cache)
const L1_TTL: Record<SearchSource, number> = {
  itunes:  6 * 60 * 60,  // 6h
  youtube: 2 * 60 * 60,  // 2h
  lyrics:  4 * 60 * 60,  // 4h
};

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
      return res.json({ tracks: JSON.parse(l1Hit), source: searchSource, cached: true });
    }

    // ── L2: Supabase persistent cache ────────────────────────────────────────
    const l2Hit = await getSearchCache(searchSource, normalizedQ);
    if (l2Hit) {
      console.log(`[Search] L2 hit: "${normalizedQ}" (${searchSource})`);
      // Warm L1 from L2 result
      cache.setex(l1Key, L1_TTL[searchSource], JSON.stringify(l2Hit));
      return res.json({ tracks: l2Hit, source: searchSource, cached: true });
    }

    // ── L3: Live API (iTunes / YouTube / Lyrics) ─────────────────────────────
    console.log(`[Search] Cache miss — fetching live: "${normalizedQ}" (${searchSource})`);
    let tracks = await searchTracks(q.trim(), Number(limit) || 20, searchSource);

    // Personalisation boost — user history + trending
    let artistScores: Record<string, number> = {};
    let listenedTrackKeys = new Set<string>();

    if (userId && tracks.length > 0) {
      try {
        const history = await getHistoryForUser(userId);
        if (history && history.length > 0) {
          for (const entry of history) {
            if (entry.artist) {
              const artistNorm = entry.artist.toLowerCase().trim();
              artistScores[artistNorm] = (artistScores[artistNorm] || 0) + (entry.playCount || 1);
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
    tracks = await boostSearchResults(tracks, artistScores, userRegion, listenedTrackKeys);

    // Write-through to L1 + L2 (non-blocking)
    cache.setex(l1Key, L1_TTL[searchSource], JSON.stringify(tracks));
    setSearchCache(searchSource, normalizedQ, tracks).catch(() => {});

    return res.json({ tracks, source: searchSource });
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
