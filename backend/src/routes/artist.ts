import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import {
  getFollowStatus,
  followArtist,
  unfollowArtist,
  getFollows,
  getNotifications,
  markNotificationsRead,
} from '../services/followService';
import { cache } from '../services/cacheService';
import { getArtistInfo, hashStringToInteger } from '../services/artistService';
import { supabase, upsertTracks } from '../services/supabaseService';
import { compressAudio } from '../services/audioCompressionService';
import { uploadToCDN, deleteFromCDN, uploadImageToCDN } from '../services/cdnService';

const router = Router();

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.resolve('data/uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `artist_${uuidv4()}${path.extname(file.originalname)}`);
  },
});
const uploadTrack = multer({ storage: uploadStorage });

/** Devuelve el artist_id ya asignado a este usuario, o null si no es artista. */
async function getUserArtistId(userId: string): Promise<number | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .schema('kokomusic')
    .from('koko_profiles')
    .select('artist_id')
    .eq('id', userId)
    .maybeSingle();
  return (data as any)?.artist_id ?? null;
}

// ── GET /api/artist/notifications  (no :id, must come before /:id) ────────────
router.get('/notifications', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || req.query.userId) as string;
  try {
    const notifications = await getNotifications(userId, 30);
    return res.json({ notifications });
  } catch (err) {
    console.error('[Artist] Error getting notifications:', err);
    return res.status(500).json({ error: 'Error getting notifications' });
  }
});

// ── POST /api/artist/notifications/read ───────────────────────────────────────
router.post('/notifications/read', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || req.query.userId) as string;
  try {
    await markNotificationsRead(userId);
    return res.json({ success: true });
  } catch (err) {
    console.error('[Artist] Error marking notifications read:', err);
    return res.status(500).json({ error: 'Error marking read' });
  }
});

// ── GET /api/artist/follows  — list all followed artists ──────────────────────
router.get('/follows', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || req.query.userId) as string;
  if (!userId) return res.status(400).json({ error: 'x-user-id header or userId query param required' });

  try {
    const follows = await getFollows(userId);
    return res.json({ follows });
  } catch (err) {
    console.error('[Artist] Error getting follows:', err);
    return res.status(500).json({ error: 'Error getting follows' });
  }
});

// ── GET /api/artist/:id/follow-status ─────────────────────────────────────────
router.get('/:id/follow-status', async (req: Request, res: Response) => {
  const artistId = Number(req.params.id);
  if (isNaN(artistId)) return res.status(400).json({ error: 'artistId must be a number' });

  const userId = (req.headers['x-user-id'] || req.query.userId) as string;
  if (!userId) return res.status(400).json({ error: 'x-user-id header or userId query param required' });

  try {
    const following = await getFollowStatus(userId, artistId);
    return res.json({ following });
  } catch (err) {
    console.error('[Artist] Error getting follow status:', err);
    return res.status(500).json({ error: 'Error getting follow status' });
  }
});

// ── POST /api/artist/:id/follow — toggle follow/unfollow ──────────────────────
router.post('/:id/follow', async (req: Request, res: Response) => {
  const artistId = Number(req.params.id);
  if (isNaN(artistId)) return res.status(400).json({ error: 'artistId must be a number' });

  const userId = (req.headers['x-user-id'] || req.query.userId || req.body.userId) as string;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const { artistName, artistImage, lastReleaseDate, action } = req.body as {
    artistName: string;
    artistImage?: string;
    lastReleaseDate?: string;
    action?: 'follow' | 'unfollow';
  };

  if (!artistName) return res.status(400).json({ error: 'artistName required' });

  try {
    let following: boolean;

    if (action === 'follow') {
      await followArtist(userId, artistId, artistName, artistImage, lastReleaseDate);
      following = true;
    } else if (action === 'unfollow') {
      await unfollowArtist(userId, artistId);
      following = false;
    } else {
      // Toggle
      const current = await getFollowStatus(userId, artistId);
      if (current) {
        await unfollowArtist(userId, artistId);
        following = false;
      } else {
        await followArtist(userId, artistId, artistName, artistImage, lastReleaseDate);
        following = true;
      }
    }

    // Invalidate any relevant cache
    cache.del(`artist-follow:${artistId}`);

    return res.json({ following });
  } catch (err) {
    console.error('[Artist] Error toggling follow:', err);
    return res.status(500).json({ error: 'Error toggling follow' });
  }
});

// ── GET /api/artist/lookup?q=... ──────────────────────────────────────────────
router.get('/lookup', async (req: Request, res: Response) => {
  const q = (req.query.q as string) || '';
  if (!q.trim()) {
    return res.status(400).json({ error: 'Falta el parámetro de búsqueda "q"' });
  }

  const queryClean = q.trim();
  const cacheKey = `artist:lookup:${queryClean.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ artist: JSON.parse(cached), source: 'cache' });
  }

  try {
    const artist = await getArtistInfo(queryClean);
    if (!artist) {
      return res.status(404).json({ error: 'Artista no encontrado', query: queryClean });
    }
    cache.setex(cacheKey, 3600 * 2, JSON.stringify(artist));
    return res.json({ artist, source: 'lookup' });
  } catch (err) {
    console.error('[Artist Route /lookup] Error:', err);
    return res.status(500).json({ error: 'Error al resolver artista' });
  }
});

// ── GET /api/artist/avatar?name=... ──────────────────────────────────────────
router.get('/avatar', async (req: Request, res: Response) => {
  const name = (req.query.name as string || '').trim();
  if (!name) return res.status(400).json({ error: 'Falta el parámetro name' });

  const cacheKey = `artist-avatar:${name.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(JSON.parse(cached));

  try {
    // 1. Deezer
    const dzRes = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`);
    if (dzRes.ok) {
      const dzData = (await dzRes.json()) as any;
      const match = dzData.data?.[0];
      const image = match?.picture_medium || match?.picture_small || match?.picture;
      if (image) {
        const payload = { image };
        cache.setex(cacheKey, 86400 * 7, JSON.stringify(payload));
        return res.json(payload);
      }
    }

    // 2. iTunes fallback
    const itunesRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=song&limit=1`);
    if (itunesRes.ok) {
      const itunesData = (await itunesRes.json()) as any;
      const track = itunesData.results?.[0];
      if (track?.artworkUrl100) {
        const image = track.artworkUrl100.replace(/\d+x\d+bb\.jpg$/, '300x300bb.jpg');
        const payload = { image };
        cache.setex(cacheKey, 86400 * 7, JSON.stringify(payload));
        return res.json(payload);
      }
    }

    return res.json({ image: null });
  } catch (err) {
    return res.json({ image: null });
  }
});

// ── POST /api/artist/tracks/upload — sube una canción propia al catálogo ──────
router.post('/tracks/upload', uploadTrack.fields([{ name: 'audio', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || req.body.userId) as string;
  if (!userId) return res.status(400).json({ error: 'x-user-id header requerido' });

  const artistId = await getUserArtistId(userId);
  if (!artistId) return res.status(403).json({ error: 'Solo los artistas pueden subir canciones' });

  const files = req.files as { audio?: Express.Multer.File[]; cover?: Express.Multer.File[] } | undefined;
  const audioFile = files?.audio?.[0];
  if (!audioFile) return res.status(400).json({ error: 'Falta el archivo de audio' });

  const { title, album, genre, durationMs } = req.body as { title?: string; album?: string; genre?: string; durationMs?: string };
  if (!title?.trim()) {
    fs.unlink(audioFile.path, () => {});
    return res.status(400).json({ error: 'El título es obligatorio' });
  }

  try {
    const { data: profile } = await supabase!
      .schema('kokomusic')
      .from('koko_profiles')
      .select('avatar_url, display_name, username')
      .eq('id', userId)
      .maybeSingle();
    const artistName: string = (profile as any)?.display_name || (profile as any)?.username || 'Artista Koko';

    const compressedPath = await compressAudio(audioFile.path);
    const trackId = hashStringToInteger(`koko-track:${userId}:${title}:${Date.now()}`);

    const cdnUrl = await uploadToCDN(String(trackId), compressedPath, true);
    if (!cdnUrl) {
      return res.status(413).json({ error: 'El archivo supera el límite de tamaño permitido o el almacenamiento está lleno' });
    }

    const coverFile = files?.cover?.[0];
    const uploadedCover = coverFile ? await uploadImageToCDN(coverFile.path, 'covers') : null;
    const coverUrl: string | null = uploadedCover ?? ((profile as any)?.avatar_url ?? null);

    await upsertTracks([{
      itunes_id: trackId,
      title: title.trim(),
      artist: artistName,
      artist_id: artistId,
      album: album?.trim() || null,
      cover_url: coverUrl,
      duration_ms: durationMs ? Number(durationMs) : null,
      genre: genre?.trim() || 'Otros',
      release_date: new Date().toISOString().slice(0, 10),
    }]);

    return res.json({ success: true, itunesId: trackId });
  } catch (err) {
    console.error('[Artist] Error subiendo track:', err);
    return res.status(500).json({ error: 'Error al subir la canción' });
  }
});

// ── GET /api/artist/tracks/mine — canciones subidas por el artista logueado ───
router.get('/tracks/mine', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || req.query.userId) as string;
  if (!userId) return res.status(400).json({ error: 'x-user-id header requerido' });

  const artistId = await getUserArtistId(userId);
  if (!artistId) return res.json({ tracks: [] });

  try {
    const { data, error } = await supabase!
      .schema('kokomusic')
      .from('tracks_meta')
      .select('itunes_id, title, artist, album, cover_url, genre, duration_ms, release_date')
      .eq('artist_id', artistId)
      .order('release_date', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ tracks: data ?? [] });
  } catch (err) {
    console.error('[Artist] Error listando tracks propios:', err);
    return res.status(500).json({ error: 'Error al listar canciones' });
  }
});

// ── DELETE /api/artist/tracks/:itunesId ────────────────────────────────────────
router.delete('/tracks/:itunesId', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || req.query.userId) as string;
  if (!userId) return res.status(400).json({ error: 'x-user-id header requerido' });

  const itunesId = Number(req.params.itunesId);
  if (isNaN(itunesId)) return res.status(400).json({ error: 'itunesId inválido' });

  const artistId = await getUserArtistId(userId);
  if (!artistId) return res.status(403).json({ error: 'No eres artista' });

  try {
    const { data: track } = await supabase!
      .schema('kokomusic')
      .from('tracks_meta')
      .select('artist_id')
      .eq('itunes_id', itunesId)
      .maybeSingle();

    if (!track) return res.status(404).json({ error: 'Canción no encontrada' });
    if ((track as any).artist_id !== artistId) return res.status(403).json({ error: 'Esta canción no es tuya' });

    await supabase!.schema('kokomusic').from('tracks_meta').delete().eq('itunes_id', itunesId);
    await deleteFromCDN(String(itunesId));

    return res.json({ success: true });
  } catch (err) {
    console.error('[Artist] Error borrando track:', err);
    return res.status(500).json({ error: 'Error al borrar la canción' });
  }
});

// ── GET /api/artist/:id  (existing route, wrapped here for backwards compat) ──
router.get('/:id', async (req: Request, res: Response) => {
  const idParam = req.params.id;
  const nameQuery = req.query.name as string | undefined;
  let identifier: number | string = idParam;

  if (idParam === '0' && nameQuery) {
    identifier = nameQuery;
  } else if (!isNaN(Number(idParam))) {
    identifier = Number(idParam);
  }

  const cacheKey = `artist-v3:${identifier}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[Artist Route] Retornando ${identifier} desde caché L1`);
    return res.json({ artist: JSON.parse(cached), source: 'cache' });
  }

  console.log(`[Artist Route] Fetcheando ${identifier} por primera vez`);
  try {
    const artist = await getArtistInfo(identifier);
    if (!artist) {
      return res.status(404).json({ error: 'Artista no encontrado' });
    }
    return res.json({ artist, source: 'itunes' });
  } catch (err) {
    console.error('[Artist] Error:', err);
    return res.status(500).json({ error: 'Error al obtener información del artista' });
  }
});

export default router;
