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
import { isLastfmPlaceholderCover, lookupItunesCoverAndGenre } from './lastfmCoverUtils';

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
  /** BPM real de Deezer (0 = no disponible para ese track; muchos tracks no lo tienen). */
  bpm?: number;
  /** Energía 0-1 derivada del loudness real (gain) de Deezer — proxy real, no heurística. */
  energyFromGain?: number;
}

/** Caché en memoria (24h) de enriquecimiento por-track para no repetir llamadas en cada ciclo. */
const trackEnrichCache = new Map<string, { bpm: number; gain: number | null; genre: string; releaseDate: string | null; ts: number }>();
const ENRICH_CACHE_TTL = 24 * 60 * 60 * 1000;

/**
 * Enriquece un track de Deezer con datos REALES que el endpoint de chart no
 * incluye: BPM, loudness (gain) y fecha de lanzamiento vienen de /track/{id};
 * el género real (Deezer sí lo tiene, a nivel de álbum) viene de /album/{id}.
 * Se cachea 24h por track para no repetir estas llamadas en cada refresco.
 */
async function enrichDeezerTrack(trackId: string, albumId: number): Promise<{ bpm: number; gain: number | null; genre: string; releaseDate: string | null }> {
  const cached = trackEnrichCache.get(trackId);
  if (cached && Date.now() - cached.ts < ENRICH_CACHE_TTL) return cached;

  let bpm = 0;
  let gain: number | null = null;
  let releaseDate: string | null = null;
  let genre = 'Otros';

  try {
    const [trackRes, albumRes] = await Promise.all([
      fetch(`https://api.deezer.com/track/${trackId}`).catch(() => null),
      albumId ? fetch(`https://api.deezer.com/album/${albumId}`).catch(() => null) : Promise.resolve(null),
    ]);

    if (trackRes?.ok) {
      const t = (await trackRes.json()) as any;
      bpm = Number(t?.bpm) || 0;
      gain = typeof t?.gain === 'number' ? t.gain : null;
      releaseDate = t?.release_date || null;
    }
    if (albumRes?.ok) {
      const a = (await albumRes.json()) as any;
      const firstGenre = a?.genres?.data?.[0]?.name;
      if (firstGenre) genre = firstGenre;
    }
  } catch (err) {
    console.error(`[Charts] Deezer track enrich error for ${trackId}:`, err);
  }

  const result = { bpm, gain, genre, releaseDate };
  trackEnrichCache.set(trackId, { ...result, ts: Date.now() });
  return result;
}

/** Enriquece una lista de tracks con concurrencia limitada (no saturar la API pública de Deezer). */
async function enrichDeezerTracksBatched<T extends { trackId: string; albumId: number }>(
  items: T[],
  concurrency = 5
): Promise<Map<string, { bpm: number; gain: number | null; genre: string; releaseDate: string | null }>> {
  const results = new Map<string, { bpm: number; gain: number | null; genre: string; releaseDate: string | null }>();
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const item = items[idx++];
      results.set(item.trackId, await enrichDeezerTrack(item.trackId, item.albumId));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function fetchDeezerCharts(): Promise<ChartTrackNormalised[]> {
  try {
    const res = await fetch('https://api.deezer.com/chart/0/tracks?limit=50');
    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const tracks = data?.data || [];

    const enrichMap = await enrichDeezerTracksBatched(
      tracks.map((t: any) => ({ trackId: String(t.id), albumId: t.album?.id || 0 }))
    );

    return tracks.map((t: any, idx: number) => {
      const enrich = enrichMap.get(String(t.id));
      // gain típico entre ~-15dB (silencioso) y ~0dB (muy comprimido/energético) — normalizamos a 0-1.
      const energyFromGain = enrich && enrich.gain !== null
        ? Math.max(0, Math.min(1, (enrich.gain + 15) / 15))
        : undefined;
      return {
        trackId: String(t.id),
        title: t.title || '',
        artist: t.artist?.name || '',
        artistId: t.artist?.id || 0,
        cover: t.album?.cover_medium || t.album?.cover || '',
        durationMs: (t.duration || 0) * 1000,
        genre: enrich?.genre || 'Otros',
        releaseDate: enrich?.releaseDate || null,
        dzRank: idx + 1,
        nbFan: t.artist?.nb_fan || 0,
        bpm: enrich?.bpm || 0,
        energyFromGain,
      };
    });
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
    const rawTracks: any[] = Array.isArray(data?.tracks?.track) ? data.tracks.track : [];

    // Concurrencia limitada — hasta 50 lookups a iTunes por región, no todos a la vez.
    const results: ChartTrackNormalised[] = new Array(rawTracks.length);
    let idx = 0;
    async function worker() {
      while (idx < rawTracks.length) {
        const i = idx++;
        const t = rawTracks[i];
        const artist = t.artist?.name || '';
        const title = t.name || '';
        const rawCover = t.image?.find((im: any) => im.size === 'extralarge')?.['#text'] || '';
        let cover = isLastfmPlaceholderCover(rawCover) ? '' : rawCover;
        let genre = 'Otros';
        if (!cover && artist && title) {
          const itunes = await lookupItunesCoverAndGenre(artist, title);
          if (itunes.cover) cover = itunes.cover;
          genre = itunes.genre;
        }
        results[i] = {
          trackId: `lfm:${encodeURIComponent(t.artist?.mbid || artist || '')}_${encodeURIComponent(title)}`,
          title,
          artist,
          artistId: 0,
          cover,
          durationMs: 0,
          genre,
          releaseDate: null,
          lfmListeners: Number(t.listeners) || 0,
        };
      }
    }
    await Promise.all(Array.from({ length: Math.min(8, rawTracks.length) }, worker));
    return results;
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

export async function runChartsPrefetch(): Promise<void> {
  console.log('[Charts] Starting multi-region charts pre-fetch job...');

  const [deezerTracks, lfmTracksUS, lfmTracksES, lfmTracksMX, lfmTracksUK] = await Promise.all([
    fetchDeezerCharts(),
    fetchLastFmGeoTopTracks('united states'),
    fetchLastFmGeoTopTracks('spain'),
    fetchLastFmGeoTopTracks('mexico'),
    fetchLastFmGeoTopTracks('united kingdom'),
  ]);

  await Promise.all([
    upsertChartsCache('deezer', 'global', deezerTracks),
    upsertChartsCache('lastfm', 'united states', lfmTracksUS),
    upsertChartsCache('lastfm', 'spain', lfmTracksES),
    upsertChartsCache('lastfm', 'mexico', lfmTracksMX),
    upsertChartsCache('lastfm', 'united kingdom', lfmTracksUK),
  ]);

  console.log('[Charts] Pre-fetch complete for all regions');
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
