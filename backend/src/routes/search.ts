import { Router, Request, Response } from 'express';
import { searchTracks, type SearchSource } from '../services/metadataService';
import { getHistoryForUser } from '../services/historyService';

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

    // Si tenemos userId, personalizar la ordenación favoreciendo artistas escuchados frecuentemente
    if (userId && tracks.length > 0) {
      try {
        const history = await getHistoryForUser(userId);
        if (history && history.length > 0) {
          // Contabilizar reproducciones por artista
          const artistScores: Record<string, number> = {};
          for (const entry of history) {
            if (entry.artist) {
              const artistNorm = entry.artist.toLowerCase().trim();
              artistScores[artistNorm] = (artistScores[artistNorm] || 0) + (entry.playCount || 1);
            }
          }

          // Ordenar resultados priorizando artistas con historial de reproducción
          // Usamos una ordenación estable (relativa al peso) para no arruinar la relevancia original por completo
          tracks = [...tracks].sort((a, b) => {
            const aArtist = a.artist.toLowerCase().trim();
            const bArtist = b.artist.toLowerCase().trim();
            const aScore = artistScores[aArtist] || 0;
            const bScore = artistScores[bArtist] || 0;

            if (aScore !== bScore) {
              return bScore - aScore; // A mayor score en historial, más arriba
            }
            return 0; // Mantener orden de relevancia de iTunes/YouTube
          });
        }
      } catch (err) {
        console.error('[Search] Error applying user history boost:', err);
      }
    }

    return res.json({ tracks, source: searchSource });
  } catch (err) {
    console.error('[Search] Error:', err);
    return res.status(500).json({ error: 'Error al buscar' });
  }
});

export default router;

