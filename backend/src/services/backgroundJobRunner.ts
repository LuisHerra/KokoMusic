/**
 * backgroundJobRunner.ts — KokoMusic Offline Background Jobs
 *
 * Manages all offline recommendation jobs:
 *   1. Taste profile builder (per-user, triggered by events)
 *   2. External charts pre-fetcher (global cron, 6-12h cadence)
 *   3. Candidate generator (per-user, triggered after taste profile refresh)
 *
 * DESIGN CONSTRAINTS:
 *   • No job may perform work inside an HTTP request/response cycle.
 *   • All Deezer / Last.fm calls happen ONLY inside the charts pre-fetcher job.
 *   • The candidate generator reads ONLY from DB tables — no external calls.
 *   • Triggers are: app_open, track_completed (≥90%), artist_followed.
 */

import { buildAndPersistTasteProfile, loadTasteProfileStale } from './tasteProfileBuilder';
import { generateCandidates } from './candidateGenerator';
import { setCachedPlaylist, scheduleBackgroundRecompute } from './recommendationCache';
import { supabase } from './supabaseService';

// ── Config ────────────────────────────────────────────────────────────────────

/** Charts refresh cadence in milliseconds (default: 6h, configurable via env). */
const CHARTS_REFRESH_MS = Number(process.env.CHARTS_REFRESH_MS ?? 6 * 60 * 60 * 1000);
/** Max age of charts cache before the pre-fetcher is considered overdue (24h). */
const CHARTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const LFM_KEY = process.env.LASTFM_KEY || '';
const LFM_GEO_REGION = process.env.LASTFM_REGION || 'united states';

// ── Job lock helpers (prevent concurrent runs of the same job) ────────────────

const jobLocks = new Map<string, boolean>();

function withLock(key: string, fn: () => Promise<void>): void {
  if (jobLocks.get(key)) {
    console.log(`[JobRunner] Job "${key}" already in-flight, skipping`);
    return;
  }
  jobLocks.set(key, true);
  fn()
    .catch((err) => console.error(`[JobRunner] Job "${key}" error:`, err))
    .finally(() => jobLocks.set(key, false));
}

// ── Taste profile + candidate pipeline ────────────────────────────────────────

/**
 * Full offline pipeline for a user:
 *   1. Build taste profile
 *   2. Generate candidates
 *   3. Update recommendation cache
 */
export async function runUserProfilePipeline(userId: string): Promise<void> {
  withLock(`profile:${userId}`, async () => {
    console.log(`[JobRunner] Starting user profile pipeline for ${userId}`);

    // Step 1: Build (or refresh) taste profile
    const profile = await buildAndPersistTasteProfile(userId);

    if (!profile) {
      console.log(`[JobRunner] No profile built for ${userId} (insufficient history)`);
      return;
    }

    // Step 2: Generate enriched candidates
    const candidates = await generateCandidates(userId, profile);

    if (candidates.length > 0) {
      // Step 3: Update cache
      setCachedPlaylist(userId, candidates);
      console.log(`[JobRunner] Cache updated for ${userId}: ${candidates.length} candidates`);
    }
  });
}

/**
 * Trigger the background recompute pipeline for a user.
 * Can be called from any event handler — won't block the caller.
 */
export function triggerUserPipeline(userId: string): void {
  scheduleBackgroundRecompute(userId, () => runUserProfilePipeline(userId));
}

// ── Event triggers ─────────────────────────────────────────────────────────────

/**
 * Called on app_open event.
 * Only triggers pipeline if profile is missing or stale.
 */
export function onAppOpen(userId: string): void {
  console.log(`[JobRunner] Event: app_open for ${userId}`);
  setImmediate(() => {
    loadTasteProfileStale(userId)
      .then((existing) => {
        if (!existing) {
          triggerUserPipeline(userId);
        } else {
          const ageMs = Date.now() - new Date(existing.computedAt).getTime();
          if (ageMs > 6 * 60 * 60 * 1000) {
            triggerUserPipeline(userId);
          }
        }
      })
      .catch(() => triggerUserPipeline(userId));
  });
}

/**
 * Called when a track is completed (≥90% of duration_ms listened).
 * Always triggers a taste profile rebuild.
 */
export function onTrackCompleted(userId: string, _trackId: string): void {
  console.log(`[JobRunner] Event: track_completed for ${userId}`);
  setImmediate(() => triggerUserPipeline(userId));
}

/**
 * Called when the user follows a new artist.
 * Triggers a candidates refresh (uses existing profile, regenerates candidates).
 */
export function onArtistFollowed(userId: string): void {
  console.log(`[JobRunner] Event: artist_followed for ${userId}`);
  setImmediate(async () => {
    withLock(`candidates:${userId}`, async () => {
      const profile = await loadTasteProfileStale(userId);
      if (!profile) {
        // No profile yet — build the full pipeline
        await runUserProfilePipeline(userId);
        return;
      }
      const candidates = await generateCandidates(userId, profile);
      if (candidates.length > 0) {
        setCachedPlaylist(userId, candidates);
        console.log(`[JobRunner] Candidate cache refreshed post-follow for ${userId}`);
      }
    });
  });
}

// ── External charts pre-fetcher ────────────────────────────────────────────────

interface ChartTrackNormalised {
  trackId: string;
  title: string;
  artist: string;
  artistId: number;
  cover: string;
  durationMs: number;
  genre: string;
  releaseDate: string | null;
  dzRank?: number;
  nbFan?: number;
  lfmListeners?: number;
}

async function fetchDeezerCharts(): Promise<ChartTrackNormalised[]> {
  try {
    const res = await fetch('https://api.deezer.com/chart/0/tracks?limit=50');
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const tracks = data?.data || [];
    return tracks.map((t: any, idx: number) => ({
      trackId: String(t.id),
      title: t.title || '',
      artist: t.artist?.name || '',
      artistId: t.artist?.id || 0,
      cover: t.album?.cover_medium || t.album?.cover || '',
      durationMs: (t.duration || 0) * 1000,
      genre: 'Otros', // Deezer chart doesn't include genre inline
      releaseDate: null,
      dzRank: idx + 1,
      nbFan: t.artist?.nb_fan || 0,
    }));
  } catch (err) {
    console.error('[Charts] Deezer fetch error:', err);
    return [];
  }
}

async function fetchLastFmGeoTopTracks(region = LFM_GEO_REGION): Promise<ChartTrackNormalised[]> {
  if (!LFM_KEY) return [];
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=geo.gettoptracks&country=${encodeURIComponent(region)}&api_key=${LFM_KEY}&format=json&limit=50`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const tracks = data?.tracks?.track || [];
    return (Array.isArray(tracks) ? tracks : []).map((t: any) => ({
      trackId: `lfm:${encodeURIComponent(t.artist?.mbid || t.artist?.name || '')}_${encodeURIComponent(t.name || '')}`,
      title: t.name || '',
      artist: t.artist?.name || '',
      artistId: 0,
      cover: t.image?.find((i: any) => i.size === 'extralarge')?.['#text'] || '',
      durationMs: 0,
      genre: 'Otros',
      releaseDate: null,
      lfmListeners: Number(t.listeners) || 0,
    }));
  } catch (err) {
    console.error('[Charts] Last.fm geo.gettoptracks error:', err);
    return [];
  }
}

async function upsertChartsCache(
  source: string,
  region: string,
  payload: ChartTrackNormalised[]
): Promise<void> {
  if (!supabase || payload.length === 0) return;
  const { error } = await supabase
    .schema('kokomusic')
    .from('external_charts_cache')
    .upsert(
      {
        source,
        region,
        payload_json: payload,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'source,region' }
    );
  if (error) {
    console.error(`[Charts] Error upserting cache [${source}/${region}]:`, error.message);
  } else {
    console.log(`[Charts] Cache updated: ${source}/${region} — ${payload.length} tracks`);
  }
}

/** Returns true if the charts cache is overdue (>24h old or missing). */
async function isChartsCacheOverdue(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data } = await supabase
      .schema('kokomusic')
      .from('external_charts_cache')
      .select('fetched_at')
      .order('fetched_at', { ascending: false })
      .limit(1);

    if (!data || data.length === 0) return true;
    const lastFetchedMs = new Date((data[0] as any).fetched_at).getTime();
    return Date.now() - lastFetchedMs > CHARTS_MAX_AGE_MS;
  } catch {
    return true;
  }
}

/**
 * Main charts pre-fetch job.
 * Fetches Deezer global charts and Last.fm geo top tracks and writes to DB.
 * NEVER called from an HTTP request path.
 */
async function runChartsPrefetch(): Promise<void> {
  console.log('[Charts] Starting charts pre-fetch job...');

  const [deezerTracks, lfmTracks] = await Promise.all([
    fetchDeezerCharts(),
    fetchLastFmGeoTopTracks(),
  ]);

  await Promise.all([
    upsertChartsCache('deezer', 'global', deezerTracks),
    upsertChartsCache('lastfm', LFM_GEO_REGION, lfmTracks),
  ]);

  console.log('[Charts] Pre-fetch complete');
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let chartsInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the background job scheduler.
 * - Runs charts pre-fetch immediately if overdue, then every CHARTS_REFRESH_MS.
 * Call once on server startup.
 */
export function startBackgroundJobs(): void {
  if (chartsInterval) return; // already running

  console.log(`[JobRunner] Starting background jobs (charts refresh: ${CHARTS_REFRESH_MS / 3600000}h)`);

  // Run charts check after 5s startup delay (avoids boot noise)
  setTimeout(async () => {
    const overdue = await isChartsCacheOverdue();
    if (overdue) {
      withLock('charts', runChartsPrefetch);
    } else {
      console.log('[Charts] Cache is fresh, skipping initial pre-fetch');
    }
  }, 5_000);

  // Recurring charts refresh
  chartsInterval = setInterval(() => {
    withLock('charts', runChartsPrefetch);
  }, CHARTS_REFRESH_MS);

  console.log('[JobRunner] Background scheduler active');
}

export function stopBackgroundJobs(): void {
  if (chartsInterval) {
    clearInterval(chartsInterval);
    chartsInterval = null;
  }
}
