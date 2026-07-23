import { Router, Request, Response } from 'express';
import { searchTracks, type SearchSource } from '../services/metadataService';
import { getHistoryForUser } from '../services/historyService';
import { boostSearchResults } from '../services/trendingService';

const router = Router();

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

  try {
    let tracks = await searchTracks(q.trim(), Number(limit) || 20, searchSource);

    // Obtener puntuación de historial y canciones previamente escuchadas del usuario
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

    // Aplicar boost de personalización, canciones previamente escuchadas e items en tendencia
    const userRegion = (req.headers['x-user-region'] as string) || 'spain';
    tracks = await boostSearchResults(tracks, artistScores, userRegion, listenedTrackKeys);

    return res.json({ tracks, source: searchSource });
  } catch (err) {
    console.error('[Search] Error:', err);
    return res.status(500).json({ error: 'Error al buscar' });
  }
});

export default router;

