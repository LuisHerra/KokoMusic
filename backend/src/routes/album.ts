import { Router, Request, Response } from 'express';
import { cache } from '../services/cacheService';

const router = Router();

// GET /api/album/:id
router.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const cacheKey = `album:${id}`;
  const cached = cache.get(cacheKey);

  if (cached) {
    return res.json(JSON.parse(cached));
  }

  try {
    const itunesRes = await fetch(`https://itunes.apple.com/lookup?id=${id}&entity=song`);
    if (!itunesRes.ok) throw new Error('iTunes API Error');
    const data = (await itunesRes.json()) as any;
    
    if (!data.results || data.results.length === 0) {
      return res.status(404).json({ error: 'Álbum no encontrado' });
    }

    const collection = data.results.find((r: any) => r.wrapperType === 'collection');
    const tracks = data.results
      .filter((r: any) => r.wrapperType === 'track')
      .map((t: any) => ({
        id: String(t.trackId),
        title: t.trackName,
        artist: t.artistName,
        album: t.collectionName,
        cover: t.artworkUrl100?.replace(/\d+x\d+bb\.jpg$/, '400x400bb.jpg'),
        duration: t.trackTimeMillis,
        trackNumber: t.trackNumber,
        genre: t.primaryGenreName,
      }))
      .sort((a: any, b: any) => a.trackNumber - b.trackNumber);

    if (!collection) {
      return res.status(404).json({ error: 'Álbum no encontrado en iTunes' });
    }

    const albumData = {
      id: String(collection.collectionId),
      title: collection.collectionName,
      artist: collection.artistName,
      cover: collection.artworkUrl100?.replace(/\d+x\d+bb\.jpg$/, '600x600bb.jpg'),
      releaseDate: collection.releaseDate,
      trackCount: collection.trackCount,
      genre: collection.primaryGenreName,
      type: collection.trackCount > 3 ? 'Álbum' : 'Single/EP',
      tracks,
    };

    cache.setex(cacheKey, 86400, JSON.stringify(albumData));
    return res.json(albumData);
  } catch (e) {
    console.error('[Album] Error:', e);
    return res.status(500).json({ error: 'Error al obtener álbum' });
  }
});

export default router;
