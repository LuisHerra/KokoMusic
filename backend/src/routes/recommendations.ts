/**
 * recommendations.ts (Route) — KokoMusic Online Recommendation Layer
 *
 * GET /api/recommendations
 *   → Reads from pre-computed cache (stale-while-revalidate)
 *   → Applies smart-reorder (BPM/energy) via inline algorithm
 *   → Applies diversity injection (no long artist/genre streaks)
 *   → Cold-start fallback from external_charts_cache
 *
 * POST /api/recommendations/feedback
 *   → Records user feedback signals (skip, complete, like, add)
 *   → Handles consecutive-skip detection and stale marking
 *
 * POST /api/recommendations/trigger/:event
 *   → Internal-use endpoint for triggering background jobs from the frontend
 *     (app_open, track_completed, artist_followed)
 *
 * DESIGN CONSTRAINTS:
 *   • <200ms response time — no DB joins, no external API calls, no heavy compute.
 *   • All data must arrive pre-enriched from the candidate generator.
 *   • Cache miss / staleness = serve stale immediately + recompute in background.
 */

import { Router, Request, Response } from 'express';
import {
  getCachedPlaylist,
  isCacheFresh,
  recordFeedback,
  isColdStart,
  getCacheStats,
  setCachedPlaylist,
  type FeedbackEvent,
} from '../services/recommendationCache';
import {
  getColdStartCandidates,
  generateCandidates,
  generateDiscoveryCandidates,
  type EnrichedCandidate,
} from '../services/candidateGenerator';
import { getRecentlyShown, recordShown } from '../services/recommendationImpressions';
import {
  triggerUserPipeline,
  onAppOpen,
  onTrackCompleted,
  onArtistFollowed,
} from '../services/backgroundJobRunner';
import { seedInitialProfile, loadTasteProfileStale } from '../services/tasteProfileBuilder';
import { setUserRegion, getUserRegion } from '../services/regionService';
import { addTracksToLikedSongs } from './playlists';
import { getTrendingTracks } from '../services/trendingService';
import { getKokoArtistTracks, genreFamily } from '../services/kokoArtistCatalog';

const router = Router();

// Middleware to capture user region from headers
router.use((req, res, next) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const region = req.headers['x-user-region'] as string | undefined;
  if (region) {
    setUserRegion(userId, region);
  }
  next();
});

// ── Helpers: re-ranking (mirrors smart-reorder logic in playlists.ts) ──────────

/**
 * Greedy nearest-neighbour BPM/energy sort.
 * Operates only on pre-computed bpmEstimate + energyEstimate — no DB calls.
 */
function applySmartReorder(candidates: EnrichedCandidate[]): EnrichedCandidate[] {
  if (candidates.length <= 1) return candidates;

  const unsorted = [...candidates];
  const startIdx = Math.floor(Math.random() * Math.min(5, unsorted.length));
  const sorted: EnrichedCandidate[] = [unsorted.splice(startIdx, 1)[0]];

  while (unsorted.length > 0) {
    const current = sorted[sorted.length - 1];
    let bestIdx = 0;
    let minDist = Infinity;

    for (let i = 0; i < unsorted.length; i++) {
      const c = unsorted[i];
      const bpmDiff = (c.bpmEstimate - current.bpmEstimate) / 75;
      const energyDiff = c.energyEstimate - current.energyEstimate;
      const dist = Math.sqrt(bpmDiff * bpmDiff + energyDiff * energyDiff);
      if (dist < minDist) {
        minDist = dist;
        bestIdx = i;
      }
    }

    sorted.push(unsorted.splice(bestIdx, 1)[0]);
  }

  return sorted;
}

// ── Helpers: diversity injection ──────────────────────────────────────────────

const MAX_ARTIST_STREAK = 2;
const MAX_GENRE_STREAK = 3;

/**
 * Shuffles candidates to prevent long streaks of the same artist or genre.
 * Operates only on in-memory metadata — no DB calls.
 */
function applyDiversityFilter(candidates: EnrichedCandidate[]): EnrichedCandidate[] {
  const result: EnrichedCandidate[] = [];
  const remaining = [...candidates];

  while (remaining.length > 0) {
    const lastFew = result.slice(-Math.max(MAX_ARTIST_STREAK, MAX_GENRE_STREAK));
    const lastArtists = lastFew.map((c) => c.artist);
    const lastGenres = lastFew.map((c) => c.genre);

    // Find the first candidate that doesn't break streak rules
    let chosenIdx = -1;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];

      const artistStreak = lastArtists.slice(-MAX_ARTIST_STREAK).filter((a) => a === c.artist).length;
      const genreStreak = lastGenres.slice(-MAX_GENRE_STREAK).filter((g) => g === c.genre).length;

      if (artistStreak < MAX_ARTIST_STREAK && genreStreak < MAX_GENRE_STREAK) {
        chosenIdx = i;
        break;
      }
    }

    // If no candidate passes rules, take the first one anyway (avoid infinite loop)
    const idx = chosenIdx >= 0 ? chosenIdx : 0;
    result.push(remaining.splice(idx, 1)[0]);
  }

  return result;
}

// ── GET /api/recommendations ──────────────────────────────────────────────────

function mapCandidatesToTracks(candidates: EnrichedCandidate[]) {
  return candidates.map((c) => ({
    id: c.trackId,
    trackId: c.trackId,
    title: c.title,
    artist: c.artist,
    artistId: c.artistId,
    cover: c.cover,
    duration: c.durationMs,
    durationMs: c.durationMs,
    genre: c.genre,
    releaseDate: c.releaseDate,
    popularity: 50,
    preview_url: null,
  }));
}

/**
 * Descarta candidatos ya mostrados a este usuario en las últimas 24h (estilo
 * Spotify) antes de recortar a `limit`, y registra los finalmente elegidos.
 * Si filtrar deja muy pocos candidatos (pool pequeño, ej. cold-start), se
 * ignora el filtro para esa tanda — mejor repetir una canción que no mostrar
 * nada. `avoidRepeats=false` desactiva el filtro por completo (ajuste del
 * usuario en Perfil → Algoritmo).
 */
function applyRepeatFilter<T extends { trackId: string }>(
  impressionsKey: string,
  candidates: T[],
  limit: number,
  avoidRepeats: boolean
): T[] {
  let pool = candidates;
  if (avoidRepeats) {
    // Lo no mostrado va primero; si no llega a `limit`, se rellena con lo
    // mostrado hace MÁS tiempo — nunca se vuelve a la cabeza fija de la lista.
    const shownAt = getRecentlyShown(impressionsKey);
    const unseen = candidates.filter((c) => !shownAt.has(c.trackId));
    const seen = candidates
      .filter((c) => shownAt.has(c.trackId))
      .sort((a, b) => shownAt.get(a.trackId)! - shownAt.get(b.trackId)!);
    pool = [...unseen, ...seen];
  }
  const finalTracks = pool.slice(0, limit);
  recordShown(impressionsKey, finalTracks.map((c) => c.trackId));
  return finalTracks;
}

/**
 * Empujón suave a artistas de Koko: como mucho UNA canción suya por tanda, solo
 * si su género es de la misma familia que los dominantes del usuario, y sujeta
 * al anti-repetición de 24h (así no sale en cada refresco). Sustituye una
 * posición a partir de la 3ª para no desplazar la cabeza del mix.
 */
async function maybeInjectKokoArtistTrack(
  userId: string,
  pool: EnrichedCandidate[],
  selection: EnrichedCandidate[],
  avoidRepeats: boolean
): Promise<EnrichedCandidate[]> {
  if (selection.length === 0) return selection;

  const familyCounts = new Map<string, number>();
  for (const c of pool) {
    const f = genreFamily(c.genre);
    if (f) familyCounts.set(f, (familyCounts.get(f) || 0) + 1);
  }
  const topFamilies = new Set(
    [...familyCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => f)
  );
  if (topFamilies.size === 0) return selection;

  let catalog;
  try {
    catalog = await getKokoArtistTracks();
  } catch {
    return selection;
  }

  const shown = avoidRepeats ? getRecentlyShown(userId) : new Map<string, number>();
  const inSelection = new Set(selection.map((c) => c.trackId));
  const eligible = catalog.filter((t) => {
    const f = genreFamily(t.genre);
    return !!f && topFamilies.has(f) && !inSelection.has(t.id) && !shown.has(t.id) && !!t.cover;
  });
  if (eligible.length === 0) return selection;

  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  recordShown(userId, [pick.id]);

  const result = [...selection];
  const minPos = Math.min(2, result.length - 1);
  const pos = minPos + Math.floor(Math.random() * (result.length - minPos));
  result[pos] = {
    trackId: pick.id,
    title: pick.title,
    artist: pick.artist,
    artistId: pick.artistId,
    cover: pick.cover,
    durationMs: pick.duration,
    genre: pick.genre,
    releaseDate: pick.releaseDate,
    affinityScore: 0,
    isNewFromFollowedArtist: false,
    source: 'taste',
    bpmEstimate: 100,
    energyEstimate: 0.5,
  };
  return result;
}

/**
 * Muestreo ponderado por posición (Efraimidis–Spirakis): el top del ranking
 * sigue siendo lo más probable, pero cada petición saca una selección distinta
 * en vez de siempre los mismos N primeros.
 */
function rankWeightedShuffle<T>(items: T[]): T[] {
  return items
    .map((item, rank) => ({ item, key: Math.pow(Math.random(), 1 + rank * 0.08) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.item);
}

router.get('/', async (req: Request, res: Response) => {
  const start = Date.now();
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const limit = Math.min(parseInt((req.query.limit as string) || '30', 10), 100);
  const mood = req.query.mood as string | undefined;
  const avoidRepeats = req.query.avoidRepeats !== 'false';
  const region = getUserRegion(userId);

  try {
    // ── 1. Cold-start check ────────────────────────────────────────────────────
    if (isColdStart(userId)) {
      console.log(`[Recs] Cold-start path for ${userId} in region ${region}`);
      const coldCandidates = await getColdStartCandidates(limit * 3, region);

      // Trigger pipeline for future visits (non-blocking)
      setImmediate(() => triggerUserPipeline(userId));

      const elapsed = Date.now() - start;
      return res.json({
        tracks: mapCandidatesToTracks(applyRepeatFilter(userId, rankWeightedShuffle(coldCandidates), limit, avoidRepeats)),
        source: 'cold_start',
        cached: false,
        elapsedMs: elapsed,
      });
    }

    // ── 2. Read from cache (stale-while-revalidate) ────────────────────────────
    const cached = getCachedPlaylist(userId);

    if (cached) {
      const fresh = isCacheFresh(cached);

      // If stale, trigger background recompute but still serve stale data
      if (!fresh) {
        console.log(`[Recs] Serving stale cache for ${userId} — triggering background recompute`);
        setImmediate(() => triggerUserPipeline(userId));
      }

      let candidates = cached.candidates;

      // Apply mood filter if requested (lightweight, in-memory only)
      if (mood) {
        const moodLower = mood.toLowerCase();
        const filtered = candidates.filter(
          (c) => c.genre.toLowerCase().includes(moodLower) || c.title.toLowerCase().includes(moodLower)
        );
        candidates = filtered.length >= 5 ? filtered : candidates;
      }

      // ── 3. Selección rotatoria (ponderada por ranking + anti-repetición) ──────
      const selection = applyRepeatFilter(userId, rankWeightedShuffle(candidates), limit, avoidRepeats);

      // ── 4. Orden dentro de la selección: BPM/energía + diversidad ──────────────
      const diverse = applyDiversityFilter(applySmartReorder(selection));
      const withKoko = await maybeInjectKokoArtistTrack(userId, candidates, diverse, avoidRepeats);

      const elapsed = Date.now() - start;
      return res.json({
        tracks: mapCandidatesToTracks(withKoko),
        source: fresh ? 'cache_fresh' : 'cache_stale',
        cached: true,
        stale: !fresh,
        computedAt: new Date(cached.computedAt).toISOString(),
        elapsedMs: elapsed,
      });
    }

    // ── 5. Cache miss: trigger build + return cold start as temporary fallback ──
    console.log(`[Recs] Cache miss for ${userId} — triggering pipeline, serving cold start`);
    setImmediate(() => triggerUserPipeline(userId));

    const coldCandidates = await getColdStartCandidates(limit * 3, region);
    const elapsed = Date.now() - start;
    return res.json({
      tracks: mapCandidatesToTracks(applyRepeatFilter(userId, rankWeightedShuffle(coldCandidates), limit, avoidRepeats)),
      source: 'cache_miss_cold_start',
      cached: false,
      elapsedMs: elapsed,
    });
  } catch (error) {
    console.error('[Recs] Unexpected error:', error);
    res.status(500).json({ error: 'Failed to fetch recommendations' });
  }
});

// ── POST /api/recommendations/feedback ────────────────────────────────────────

router.post('/feedback', (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const { trackId, event } = req.body as { trackId: string; event: FeedbackEvent };

  const validEvents: FeedbackEvent[] = ['skip', 'track_completed', 'liked', 'added_to_playlist'];
  if (!trackId || !validEvents.includes(event)) {
    return res.status(400).json({
      error: `Invalid feedback event. Valid: ${validEvents.join(', ')}`,
    });
  }

  const action = recordFeedback(userId, trackId, event, triggerUserPipeline);

  return res.json({ ok: true, action });
});

// ── POST /api/recommendations/trigger/:event ──────────────────────────────────

router.post('/trigger/:event', (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const { event } = req.params;
  const { trackId } = req.body || {};

  switch (event) {
    case 'app_open':
      onAppOpen(userId);
      break;
    case 'track_completed':
      if (!trackId) return res.status(400).json({ error: 'trackId required for track_completed' });
      onTrackCompleted(userId, trackId);
      break;
    case 'artist_followed':
      onArtistFollowed(userId);
      break;
    default:
      return res.status(400).json({ error: `Unknown event: ${event}` });
  }

  return res.json({ ok: true, triggered: event, userId });
});

// ── POST /api/recommendations/onboarding ──────────────────────────────────────

router.post('/onboarding', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const { genres, artists, trackIds } = req.body as {
    genres?: string[];
    artists?: string[];
    trackIds?: string[];
  };

  if (!genres || !artists) {
    return res.status(400).json({ error: 'genres and artists arrays required' });
  }

  try {
    console.log(`[Recs] Onboarding request for ${userId}`);

    // If initial liked tracks were selected, record them into the user's liked-songs playlist
    if (Array.isArray(trackIds) && trackIds.length > 0) {
      await addTracksToLikedSongs(userId, trackIds).catch((e) =>
        console.error('[Recs] No se pudieron guardar los me gusta del onboarding:', e)
      );
    }

    // 1. Create and persist synthetic prior
    const profile = await seedInitialProfile(userId, genres, artists);

    // 2. Immediately generate candidates from this profile
    const candidates = await generateCandidates(userId, profile);

    // 3. Cache the candidates so the very next GET / hits the personalised feed
    setCachedPlaylist(userId, candidates);

    return res.json({ ok: true, candidatesCount: candidates.length });
  } catch (err) {
    console.error('[Recs] Onboarding error:', err);
    return res.status(500).json({ error: 'Failed to process onboarding' });
  }
});

// ── GET /api/recommendations/trending ─────────────────────────────────────────
// Expone trendingService.getTrendingTracks (ya usado internamente para boostear
// resultados de búsqueda) como endpoint propio — antes no existía ninguna ruta
// HTTP para consumirlo, por lo que el home feed simulaba "tendencias" con una
// búsqueda literal de "top hits" en vez de datos reales de plays + charts.
router.get('/trending', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const region = (req.query.region as string) || getUserRegion(userId);
  const limit = Math.min(parseInt((req.query.limit as string) || '30', 10), 50);
  const avoidRepeats = req.query.avoidRepeats !== 'false';

  try {
    const ranked = (await getTrendingTracks(region)).map((t) => ({ ...t, trackId: String(t.id) }));
    const tracks = applyRepeatFilter(`${userId}:trending`, rankWeightedShuffle(ranked), limit, avoidRepeats);
    res.json({
      tracks: tracks.map((t) => ({
        id: t.id,
        itunesId: t.itunesId,
        artistId: t.artistId,
        title: t.title,
        artist: t.artist,
        album: t.album,
        cover: t.cover,
        duration: t.duration,
        genre: t.genre,
        popularity: t.popularity,
        preview_url: t.preview_url,
      })),
      region,
    });
  } catch (error) {
    console.error('[Recs] Error fetching trending tracks:', error);
    res.status(500).json({ error: 'Failed to fetch trending tracks' });
  }
});

// ── GET /api/recommendations/discover ─────────────────────────────────────────
// Rail "Descubrir": géneros y artistas fuera de la zona de confort del usuario.
// El pool se recalcula como mucho cada 30 min (solo Supabase, sin APIs externas)
// y cada petición saca una muestra distinta con anti-repetición propia.

const DISCOVER_POOL_TTL_MS = 30 * 60 * 1000;
const discoverPools = new Map<string, { candidates: EnrichedCandidate[]; computedAt: number }>();

router.get('/discover', async (req: Request, res: Response) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 50);
  const avoidRepeats = req.query.avoidRepeats !== 'false';

  try {
    let entry = discoverPools.get(userId);
    if (!entry || Date.now() - entry.computedAt > DISCOVER_POOL_TTL_MS) {
      const profile = await loadTasteProfileStale(userId);
      entry = { candidates: await generateDiscoveryCandidates(userId, profile), computedAt: Date.now() };
      discoverPools.set(userId, entry);
    }
    const shuffled = [...entry.candidates].sort(() => Math.random() - 0.5);
    const selection = applyRepeatFilter(`${userId}:discover`, shuffled, limit, avoidRepeats);
    res.json({ tracks: mapCandidatesToTracks(applyDiversityFilter(selection)) });
  } catch (error) {
    console.error('[Recs] Error building discover rail:', error);
    res.status(500).json({ error: 'Failed to build discover recommendations' });
  }
});

// ── GET /api/recommendations/status ───────────────────────────────────────────

router.get('/status', (_req: Request, res: Response) => {
  res.json(getCacheStats());
});

export default router;
