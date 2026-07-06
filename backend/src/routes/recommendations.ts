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
import { getColdStartCandidates, generateCandidates, type EnrichedCandidate } from '../services/candidateGenerator';
import {
  triggerUserPipeline,
  onAppOpen,
  onTrackCompleted,
  onArtistFollowed,
} from '../services/backgroundJobRunner';
import { seedInitialProfile } from '../services/tasteProfileBuilder';

const router = Router();

// ── Helpers: re-ranking (mirrors smart-reorder logic in playlists.ts) ──────────

/**
 * Greedy nearest-neighbour BPM/energy sort.
 * Operates only on pre-computed bpmEstimate + energyEstimate — no DB calls.
 */
function applySmartReorder(candidates: EnrichedCandidate[]): EnrichedCandidate[] {
  if (candidates.length <= 1) return candidates;

  const unsorted = [...candidates];
  const sorted: EnrichedCandidate[] = [unsorted.shift()!];

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

router.get('/', async (req: Request, res: Response) => {
  const start = Date.now();
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const limit = Math.min(parseInt((req.query.limit as string) || '30', 10), 100);
  const mood = req.query.mood as string | undefined;

  try {
    // ── 1. Cold-start check ────────────────────────────────────────────────────
    if (isColdStart(userId)) {
      console.log(`[Recs] Cold-start path for ${userId}`);
      const coldCandidates = await getColdStartCandidates(limit);

      // Trigger pipeline for future visits (non-blocking)
      setImmediate(() => triggerUserPipeline(userId));

      const elapsed = Date.now() - start;
      return res.json({
        tracks: mapCandidatesToTracks(coldCandidates.slice(0, limit)),
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

      // ── 3. Re-ranking: BPM/energy coherence ───────────────────────────────────
      const reranked = applySmartReorder(candidates);

      // ── 4. Diversity filter ───────────────────────────────────────────────────
      const diverse = applyDiversityFilter(reranked);

      const elapsed = Date.now() - start;
      return res.json({
        tracks: mapCandidatesToTracks(diverse.slice(0, limit)),
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

    const coldCandidates = await getColdStartCandidates(limit);
    const elapsed = Date.now() - start;
    return res.json({
      tracks: mapCandidatesToTracks(coldCandidates.slice(0, limit)),
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
  const { genres, artists } = req.body as { genres?: string[]; artists?: string[] };

  if (!genres || !artists) {
    return res.status(400).json({ error: 'genres and artists arrays required' });
  }

  try {
    console.log(`[Recs] Onboarding request for ${userId}`);
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

// ── GET /api/recommendations/status ───────────────────────────────────────────

router.get('/status', (_req: Request, res: Response) => {
  res.json(getCacheStats());
});

export default router;
