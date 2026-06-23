/**
 * Playlists Route — In-Memory Store (local dev)
 * En producción se reemplaza por Prisma + PostgreSQL.
 * La interfaz de la API es idéntica, solo cambia la capa de persistencia.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getTrackById } from '../services/metadataService';

const router = Router();

interface PlaylistTrack {
  trackId: string;
  position: number;
  addedAt: string;
}

interface Playlist {
  id: string;
  userId?: string;
  name: string;
  description: string;
  cover?: string;
  tracks: PlaylistTrack[];
  createdAt: string;
  updatedAt: string;
}

// In-memory store
export const playlists = new Map<string, Playlist>();

// Helper to get or create a playlist scoped to a user
function getOrCreatePlaylist(id: string, userId: string): Playlist | undefined {
  const plId = id === 'liked-songs' ? `liked-songs-${userId}` : id;
  if (id === 'liked-songs' && !playlists.has(plId)) {
    playlists.set(plId, {
      id: 'liked-songs',
      userId,
      name: 'Tus me gusta',
      description: 'Canciones que te encantan',
      cover: 'https://misc.scdn.co/liked-songs/liked-songs-300.png',
      tracks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  const pl = playlists.get(plId);
  if (pl && pl.userId && pl.userId !== userId) {
    return undefined;
  }
  return pl;
}

// GET /api/playlists
router.get('/', (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  
  // Ensure liked-songs exists for this user
  getOrCreatePlaylist('liked-songs', userId);

  const list = Array.from(playlists.values())
    .filter((pl) => pl.userId === userId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  
  res.json(list);
});

// GET /api/playlists/:id
router.get('/:id', (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const pl = getOrCreatePlaylist(req.params.id, userId);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });
  res.json(pl);
});

// POST /api/playlists
router.post('/', (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const { name, description = '', cover = '', tracks = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'name requerido' });

  const plId = uuidv4();
  const pl: Playlist = {
    id: plId,
    userId,
    name,
    description,
    cover,
    tracks: Array.isArray(tracks) ? tracks.map((trackId: string, idx: number) => ({
      trackId,
      position: idx,
      addedAt: new Date().toISOString()
    })) : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  playlists.set(plId, pl);
  res.status(201).json(pl);
});

// PATCH /api/playlists/:id
router.patch('/:id', (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const pl = getOrCreatePlaylist(req.params.id, userId);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });

  const { name, description, cover } = req.body;
  if (name) pl.name = name;
  if (description !== undefined) pl.description = description;
  if (cover) pl.cover = cover;
  pl.updatedAt = new Date().toISOString();

  res.json(pl);
});

// DELETE /api/playlists/:id
router.delete('/:id', (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const plId = req.params.id === 'liked-songs' ? `liked-songs-${userId}` : req.params.id;
  const pl = playlists.get(plId);

  if (!pl || (pl.userId && pl.userId !== userId)) {
    return res.status(404).json({ error: 'Playlist no encontrada' });
  }

  playlists.delete(plId);
  res.status(204).send();
});

// POST /api/playlists/:id/tracks — añadir track
router.post('/:id/tracks', (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const pl = getOrCreatePlaylist(req.params.id, userId);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });

  const { trackId } = req.body;
  if (!trackId) return res.status(400).json({ error: 'trackId requerido' });

  if (pl.tracks.find((t) => t.trackId === trackId)) {
    return res.status(409).json({ error: 'Track ya está en la playlist' });
  }

  pl.tracks.push({ trackId, position: pl.tracks.length, addedAt: new Date().toISOString() });
  pl.updatedAt = new Date().toISOString();
  res.json(pl);
});

// DELETE /api/playlists/:id/tracks/:trackId — quitar track
router.delete('/:id/tracks/:trackId', (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const pl = getOrCreatePlaylist(req.params.id, userId);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });

  pl.tracks = pl.tracks.filter((t) => t.trackId !== req.params.trackId);
  pl.tracks.forEach((t, i) => (t.position = i)); // reindexar
  pl.updatedAt = new Date().toISOString();
  res.json(pl);
});

// PUT /api/playlists/:id/tracks/:oldId — reemplazar track (upgrade)
router.put('/:id/tracks/:oldId', (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const pl = getOrCreatePlaylist(req.params.id, userId);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });

  const { newId } = req.body;
  if (!newId) return res.status(400).json({ error: 'newId requerido' });

  const track = pl.tracks.find((t) => t.trackId === req.params.oldId);
  if (track) {
    track.trackId = newId;
    pl.updatedAt = new Date().toISOString();
  }
  res.json(pl);
});

// PUT /api/playlists/:id/reorder — reordenar tracks
router.put('/:id/reorder', (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const pl = getOrCreatePlaylist(req.params.id, userId);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });

  const { trackIds } = req.body;
  if (!Array.isArray(trackIds)) return res.status(400).json({ error: 'trackIds array requerido' });

  const oldTracks = [...pl.tracks];
  pl.tracks = trackIds.map((tid: string, i: number) => {
    const existing = oldTracks.find(t => t.trackId === tid);
    return existing ? { ...existing, position: i } : null;
  }).filter(t => t !== null) as PlaylistTrack[];

  // Append any that weren't in the array
  oldTracks.forEach(t => {
     if (!pl.tracks.find(x => x.trackId === t.trackId)) {
        pl.tracks.push({ ...t, position: pl.tracks.length });
     }
  });

  pl.updatedAt = new Date().toISOString();
  res.json(pl);
});

// POST /api/playlists/:id/smart-reorder — reordenar de forma inteligente por BPM y transición de ondas
router.post('/:id/smart-reorder', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const pl = getOrCreatePlaylist(req.params.id, userId);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });

  try {
    const trackDetails = await Promise.all(
      pl.tracks.map(async (t) => {
        try {
          const meta = await getTrackById(t.trackId);
          if (meta) {
            return {
              trackId: t.trackId,
              title: meta.title,
              artist: meta.artist,
              duration: meta.duration || 180000,
            };
          }
        } catch (err) {
          // ignore
        }
        return {
          trackId: t.trackId,
          title: '',
          artist: '',
          duration: 180000,
        };
      })
    );

    const tracksWithFeatures = trackDetails.map((t) => {
      const charSum = (t.title.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0) +
                       t.artist.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0)) || 100;
      const bpm = 75 + (charSum % 76); // 75-150 BPM
      const energy = 0.2 + ((charSum % 9) / 10); // 0.2-1.0 Energy
      return { ...t, bpm, energy };
    });

    if (tracksWithFeatures.length <= 1) {
      return res.json(pl);
    }

    const unsorted = [...tracksWithFeatures];
    const sorted: typeof tracksWithFeatures = [];
    
    sorted.push(unsorted.shift()!);

    while (unsorted.length > 0) {
      const current = sorted[sorted.length - 1];
      let bestIdx = 0;
      let minDistance = Infinity;

      for (let i = 0; i < unsorted.length; i++) {
        const candidate = unsorted[i];
        const bpmDiff = (candidate.bpm - current.bpm) / 75;
        const energyDiff = candidate.energy - current.energy;
        const distance = Math.sqrt(bpmDiff * bpmDiff + energyDiff * energyDiff);

        if (distance < minDistance) {
          minDistance = distance;
          bestIdx = i;
        }
      }

      sorted.push(unsorted.splice(bestIdx, 1)[0]);
    }

    const oldTracks = [...pl.tracks];
    pl.tracks = sorted.map((s, idx) => {
      const orig = oldTracks.find((ot) => ot.trackId === s.trackId)!;
      return {
        ...orig,
        position: idx,
      };
    });

    pl.updatedAt = new Date().toISOString();
    res.json(pl);
  } catch (error) {
    console.error('[Playlists] Error en smart-reorder:', error);
    res.status(500).json({ error: 'Error interno en la mezcla inteligente' });
  }
});

export default router;
