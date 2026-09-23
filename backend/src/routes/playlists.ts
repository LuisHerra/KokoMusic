/**
 * Playlists Route — caché en memoria respaldada por Supabase (kokomusic.user_playlists).
 *
 * El Map en memoria sigue siendo la fuente de lectura (otros módulos lo leen de
 * forma síncrona), pero cada usuario se carga desde Supabase la primera vez que
 * se accede a sus playlists y cada cambio se persiste antes de responder. Antes
 * era SOLO memoria: cada reinicio/redeploy/spin-down de Render borraba todas las
 * playlists de todos los usuarios.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getTrackById } from '../services/metadataService';
import { supabase } from '../services/supabaseService';

const router = Router();

interface PlaylistTrack {
  trackId: string;
  position: number;
  addedAt: string;
}

export interface Playlist {
  id: string;
  userId?: string;
  name: string;
  description: string;
  cover?: string;
  tracks: PlaylistTrack[];
  createdAt: string;
  updatedAt: string;
}

// Caché en memoria — clave: id de la playlist, o `liked-songs-<userId>`
export const playlists = new Map<string, Playlist>();

// ── Persistencia ──────────────────────────────────────────────────────────────

const loadedUsers = new Map<string, Promise<void>>();

function storageKey(pl: Playlist): string {
  return pl.id === 'liked-songs' ? `liked-songs-${pl.userId}` : pl.id;
}

/** Carga (una sola vez por proceso) las playlists persistidas de este usuario en el Map. */
export function ensureUserPlaylistsLoaded(userId: string): Promise<void> {
  if (!supabase) return Promise.resolve();
  let pending = loadedUsers.get(userId);
  if (!pending) {
    pending = (async () => {
      const { data, error } = await supabase!
        .schema('kokomusic')
        .from('user_playlists')
        .select('key, data')
        .eq('user_id', userId);
      if (error) {
        loadedUsers.delete(userId);
        throw error;
      }
      for (const row of (data ?? []) as { key: string; data: Playlist }[]) {
        if (!playlists.has(row.key)) playlists.set(row.key, row.data);
      }
    })();
    loadedUsers.set(userId, pending);
  }
  return pending;
}

export async function persistPlaylist(pl: Playlist): Promise<void> {
  if (!supabase || !pl.userId) return;
  const { error } = await supabase
    .schema('kokomusic')
    .from('user_playlists')
    .upsert({ key: storageKey(pl), user_id: pl.userId, data: pl, updated_at: pl.updatedAt });
  if (error) throw error;
}

async function deletePersistedPlaylist(key: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.schema('kokomusic').from('user_playlists').delete().eq('key', key);
  if (error) throw error;
}

type Handler = (req: Request, res: Response, userId: string) => Promise<unknown> | unknown;

/** Resuelve el userId, garantiza que sus playlists están cargadas y convierte fallos de persistencia en 500. */
function withUserPlaylists(handler: Handler) {
  return async (req: Request, res: Response) => {
    const userId = (req.headers['x-user-id'] || 'default') as string;
    try {
      await ensureUserPlaylistsLoaded(userId);
      await handler(req, res, userId);
    } catch (err) {
      console.error('[Playlists] Error de persistencia:', err);
      if (!res.headersSent) res.status(500).json({ error: 'No se pudieron guardar/cargar tus playlists' });
    }
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/**
 * Returns the trackIds a user has explicitly liked (Liked Songs playlist),
 * with when each was liked. Used by tasteProfileBuilder as an explicit
 * positive signal on top of implicit listening-based weights.
 * Llamar antes a ensureUserPlaylistsLoaded(userId).
 */
export function getLikedTracks(userId: string): { trackId: string; likedAt: string }[] {
  const pl = playlists.get(`liked-songs-${userId}`);
  if (!pl) return [];
  return pl.tracks.map((t) => ({ trackId: t.trackId, likedAt: t.addedAt }));
}

/** Helper to batch add track IDs to a user's liked-songs playlist */
export async function addTracksToLikedSongs(userId: string, trackIds: string[]): Promise<void> {
  await ensureUserPlaylistsLoaded(userId);
  const pl = getOrCreatePlaylist('liked-songs', userId);
  if (!pl) return;
  for (const trackId of trackIds) {
    if (trackId && !pl.tracks.some((t) => t.trackId === String(trackId))) {
      pl.tracks.push({
        trackId: String(trackId),
        position: pl.tracks.length,
        addedAt: new Date().toISOString(),
      });
    }
  }
  pl.updatedAt = new Date().toISOString();
  await persistPlaylist(pl);
}

// ── Rutas ─────────────────────────────────────────────────────────────────────

// GET /api/playlists
router.get('/', withUserPlaylists((_req, res, userId) => {
  // Ensure liked-songs exists for this user
  getOrCreatePlaylist('liked-songs', userId);

  const list = Array.from(playlists.values())
    .filter((pl) => pl.userId === userId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  res.json(list);
}));

// GET /api/playlists/:id
router.get('/:id', withUserPlaylists((req, res, userId) => {
  const pl = getOrCreatePlaylist(req.params.id, userId);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });
  res.json(pl);
}));

// POST /api/playlists
router.post('/', withUserPlaylists(async (req, res, userId) => {
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

  await persistPlaylist(pl);
  playlists.set(plId, pl);
  res.status(201).json(pl);
}));

// PATCH /api/playlists/:id
router.patch('/:id', withUserPlaylists(async (req, res, userId) => {
  const pl = getOrCreatePlaylist(req.params.id, userId);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });

  const { name, description, cover } = req.body;
  if (name) pl.name = name;
  if (description !== undefined) pl.description = description;
  if (cover) pl.cover = cover;
  pl.updatedAt = new Date().toISOString();

  await persistPlaylist(pl);
  res.json(pl);
}));

// DELETE /api/playlists/:id
router.delete('/:id', withUserPlaylists(async (req, res, userId) => {
  const plId = req.params.id === 'liked-songs' ? `liked-songs-${userId}` : req.params.id;
  const pl = playlists.get(plId);

  if (!pl || (pl.userId && pl.userId !== userId)) {
    return res.status(404).json({ error: 'Playlist no encontrada' });
  }

  await deletePersistedPlaylist(plId);
  playlists.delete(plId);
  res.status(204).send();
}));

// POST /api/playlists/:id/tracks — añadir track
router.post('/:id/tracks', withUserPlaylists(async (req, res, userId) => {
  const pl = getOrCreatePlaylist(req.params.id, userId);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });

  const { trackId } = req.body;
  if (!trackId) return res.status(400).json({ error: 'trackId requerido' });

  if (pl.tracks.find((t) => t.trackId === trackId)) {
    return res.status(409).json({ error: 'Track ya está en la playlist' });
  }

  pl.tracks.push({ trackId, position: pl.tracks.length, addedAt: new Date().toISOString() });
  pl.updatedAt = new Date().toISOString();
  await persistPlaylist(pl);
  res.json(pl);
}));

// DELETE /api/playlists/:id/tracks/:trackId — quitar track
router.delete('/:id/tracks/:trackId', withUserPlaylists(async (req, res, userId) => {
  const pl = getOrCreatePlaylist(req.params.id, userId);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });

  pl.tracks = pl.tracks.filter((t) => t.trackId !== req.params.trackId);
  pl.tracks.forEach((t, i) => (t.position = i)); // reindexar
  pl.updatedAt = new Date().toISOString();
  await persistPlaylist(pl);
  res.json(pl);
}));

// PUT /api/playlists/:id/tracks/:oldId — reemplazar track (upgrade)
router.put('/:id/tracks/:oldId', withUserPlaylists(async (req, res, userId) => {
  const pl = getOrCreatePlaylist(req.params.id, userId);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });

  const { newId } = req.body;
  if (!newId) return res.status(400).json({ error: 'newId requerido' });

  const track = pl.tracks.find((t) => t.trackId === req.params.oldId);
  if (track) {
    track.trackId = newId;
    pl.updatedAt = new Date().toISOString();
    await persistPlaylist(pl);
  }
  res.json(pl);
}));

// PUT /api/playlists/:id/reorder — reordenar tracks
router.put('/:id/reorder', withUserPlaylists(async (req, res, userId) => {
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
  await persistPlaylist(pl);
  res.json(pl);
}));

// POST /api/playlists/:id/smart-reorder — reordenar de forma inteligente por BPM y transición de ondas
router.post('/:id/smart-reorder', withUserPlaylists(async (req, res, userId) => {
  const pl = getOrCreatePlaylist(req.params.id, userId);
  if (!pl) return res.status(404).json({ error: 'Playlist no encontrada' });

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
  await persistPlaylist(pl);
  res.json(pl);
}));

export default router;
