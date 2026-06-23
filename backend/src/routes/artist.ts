import { Router, Request, Response } from 'express';
import {
  getFollowStatus,
  followArtist,
  unfollowArtist,
  getFollows,
  getNotifications,
  markNotificationsRead,
} from '../services/followService';
import { cache } from '../services/cacheService';

const router = Router();

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

// ── GET /api/artist/:id  (existing route, wrapped here for backwards compat) ──
import { getArtistInfo } from '../services/artistService';
import { cache as cacheAlias } from '../services/cacheService';

router.get('/:id', async (req: Request, res: Response) => {
  const idParam = req.params.id;
  const nameQuery = req.query.name as string | undefined;
  let identifier: number | string = idParam;

  if (idParam === '0' && nameQuery) {
    identifier = nameQuery;
  } else if (!isNaN(Number(idParam))) {
    identifier = Number(idParam);
  }

  const cacheKey = `artist:${identifier}`;
  const cached = cacheAlias.get(cacheKey);
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
