import { Router, Request, Response } from 'express';
import { searchTracks, type SearchSource } from '../services/metadataService';
import { cache } from '../services/cacheService';

const router = Router();

// GET /api/search?q=bad+bunny&limit=20&source=itunes
router.get('/', async (req: Request, res: Response) => {
  const { q, limit, source } = req.query as { q?: string; limit?: string; source?: string };

  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: 'Parámetro q requerido' });
  }

  const searchSource: SearchSource = source === 'youtube' ? 'youtube' : 'itunes';

  try {
    const tracks = await searchTracks(q.trim(), Number(limit) || 20, searchSource);
    return res.json({ tracks, source: searchSource });
  } catch (err) {
    console.error('[Search] Error:', err);
    return res.status(500).json({ error: 'Error al buscar' });
  }
});

export default router;
