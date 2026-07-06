/**
 * trendingService.ts — KokoMusic Trending & Chart Scoring Layer
 *
 * Computes trending tracks and genres based on:
 *   1. Recent global/region charts in kokomusic.external_charts_cache (Deezer/Last.fm).
 *   2. Real-time play statistics from kokomusic.play_events across all users (last 14 days).
 *
 * Integrates into:
 *   - Search: Boosting results matching trending tracks or genres.
 *   - Recommendations: Injecting trending candidates and boosting trend-aligned tracks.
 */

import { supabase } from './supabaseService';
import type { TrackMetadata } from './metadataService';

// ── In-Memory Cache ───────────────────────────────────────────────────────────
let cachedTrendingTracks: TrackMetadata[] = [];
let cachedTrendingGenres: string[] = [];
let lastFetchedTime = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

const DEFAULT_TRENDING_GENRES = [
  'Urbano/Latino',
  'Reggaetón',
  'Trap',
  'Phonk',
  'R&B',
  'Pop',
  'Hip-Hop',
  'Electronic'
];

// Helper to normalize strings for comparison
function normalizeStr(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

/**
 * Recalculates trending tracks and genres from DB (play_events + external_charts_cache).
 */
export async function updateTrendingData(): Promise<void> {
  if (!supabase) {
    cachedTrendingTracks = [];
    cachedTrendingGenres = DEFAULT_TRENDING_GENRES;
    lastFetchedTime = Date.now();
    return;
  }

  try {
    console.log('[Trending] Updating trending tracks and genres...');
    const now = Date.now();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Fetch play events from last 14 days
    const { data: plays, error: playsErr } = await supabase
      .schema('kokomusic')
      .from('play_events')
      .select('track_id, title, artist, cover, played_at')
      .gte('played_at', fourteenDaysAgo);

    // 2. Fetch external charts cache
    const { data: charts, error: chartsErr } = await supabase
      .schema('kokomusic')
      .from('external_charts_cache')
      .select('payload_json, source')
      .order('fetched_at', { ascending: false })
      .limit(4);

    // --- Compute play stats ---
    const playCounts = new Map<string, number>();
    const playMetadata = new Map<string, { title: string; artist: string; cover: string }>();

    if (!playsErr && plays) {
      for (const p of plays) {
        const idStr = String(p.track_id);
        playCounts.set(idStr, (playCounts.get(idStr) || 0) + 1);
        if (!playMetadata.has(idStr)) {
          playMetadata.set(idStr, {
            title: p.title || '',
            artist: p.artist || '',
            cover: p.cover || ''
          });
        }
      }
    }

    // --- Compute genres from tracks_meta for active local plays ---
    const localTrackIds = Array.from(playCounts.keys());
    const localItunesIds = localTrackIds.map(Number).filter(n => !isNaN(n) && n > 0);
    const trackGenres = new Map<string, string>();

    if (localItunesIds.length > 0) {
      const { data: metas } = await supabase
        .schema('kokomusic')
        .from('tracks_meta')
        .select('itunes_id, genre')
        .in('itunes_id', localItunesIds);

      if (metas) {
        for (const m of metas) {
          if (m.genre) {
            trackGenres.set(String(m.itunes_id), m.genre);
          }
        }
      }
    }

    // --- Aggregate candidates with scores ---
    // Candidates are keyed by trackId or normalized title-artist (for cross-source deduplication)
    const candidates = new Map<string, {
      track: TrackMetadata;
      score: number;
    }>();

    // A. Add local play events to candidates (highest weight)
    for (const [trackId, count] of playCounts.entries()) {
      const meta = playMetadata.get(trackId)!;
      const genre = trackGenres.get(trackId) || 'Urbano/Latino';
      const itunesId = Number(trackId);

      const track: TrackMetadata = {
        id: trackId,
        itunesId: isNaN(itunesId) ? 0 : itunesId,
        artistId: 0,
        title: meta.title,
        artist: meta.artist,
        album: 'Trending Local',
        cover: meta.cover,
        duration: 180_000,
        genre: genre,
        releaseDate: null,
        popularity: count * 100,
        preview_url: null
      };

      const key = normalizeStr(`${meta.title}-${meta.artist}`);
      candidates.set(key, {
        track,
        score: count * 50 // 50 points per play
      });
    }

    // B. Add external charts to candidates (moderated weight)
    const genreCounts = new Map<string, number>();
    if (!chartsErr && charts) {
      for (const chartRow of charts) {
        const payload = (chartRow.payload_json as any[]) || [];
        payload.forEach((item, index) => {
          const trackId = String(item.trackId || item.id || item.track_id || '');
          const title = String(item.title || item.trackName || item.name || '');
          const artist = String(item.artist || item.artistName || item.artist_name || '');
          const genre = String(item.genre || 'Otros');

          if (genre && genre !== 'Otros' && genre !== 'Desconocido') {
            genreCounts.set(genre, (genreCounts.get(genre) || 0) + (50 - index));
          }

          const key = normalizeStr(`${title}-${artist}`);
          const positionScore = Math.max(1, 50 - index); // Rank 1 = 50 pts, Rank 50 = 1 pt
          const existing = candidates.get(key);

          if (existing) {
            existing.score += positionScore * 2;
          } else if (trackId) {
            const itunesId = Number(trackId);
            const track: TrackMetadata = {
              id: trackId,
              itunesId: isNaN(itunesId) ? 0 : itunesId,
              artistId: Number(item.artistId || item.artist_id || 0),
              title,
              artist,
              album: item.albumName || item.collectionName || 'Charts',
              cover: String(item.cover || item.coverUrl || item.cover_url || item.image || ''),
              duration: Number(item.durationMs || item.duration_ms || item.duration || 180_000),
              genre,
              releaseDate: item.releaseDate || item.release_date || null,
              popularity: positionScore,
              preview_url: item.previewUrl || item.preview_url || null
            };
            candidates.set(key, { track, score: positionScore });
          }
        });
      }
    }

    // Sort candidates by score descending
    const sortedCandidates = Array.from(candidates.values())
      .sort((a, b) => b.score - a.score);

    cachedTrendingTracks = sortedCandidates.map(c => c.track).slice(0, 30);

    // --- Compute Trending Genres ---
    // Combine genres from play events and charts
    for (const [trackId, count] of playCounts.entries()) {
      const genre = trackGenres.get(trackId);
      if (genre && genre !== 'Otros' && genre !== 'Desconocido') {
        genreCounts.set(genre, (genreCounts.get(genre) || 0) + (count * 40));
      }
    }

    const sortedGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([g]) => g);

    // Merge with defaults to ensure we have enough diversity
    const finalGenresList = Array.from(new Set([...sortedGenres, ...DEFAULT_TRENDING_GENRES]));
    cachedTrendingGenres = finalGenresList.slice(0, 8);

    lastFetchedTime = Date.now();
    console.log(`[Trending] Finished update. Loaded ${cachedTrendingTracks.length} tracks & ${cachedTrendingGenres.length} genres.`);
  } catch (err) {
    console.error('[Trending] Error updating trending data:', err);
    if (cachedTrendingTracks.length === 0) {
      cachedTrendingTracks = [];
    }
    if (cachedTrendingGenres.length === 0) {
      cachedTrendingGenres = DEFAULT_TRENDING_GENRES;
    }
    lastFetchedTime = Date.now();
  }
}

/**
 * Returns the current trending tracks list.
 */
export async function getTrendingTracks(): Promise<TrackMetadata[]> {
  if (Date.now() - lastFetchedTime > CACHE_TTL || cachedTrendingTracks.length === 0) {
    await updateTrendingData();
  }
  return cachedTrendingTracks;
}

/**
 * Returns the current trending genres list.
 */
export async function getTrendingGenres(): Promise<string[]> {
  if (Date.now() - lastFetchedTime > CACHE_TTL || cachedTrendingGenres.length === 0) {
    await updateTrendingData();
  }
  return cachedTrendingGenres;
}

/**
 * Boosts search results by prioritizing trending tracks and genres.
 *
 * @param results Initial search results from iTunes/YouTube
 * @param userHistoryScores Map of normalized artist name to playcount for user-specific boosting
 */
export async function boostSearchResults(
  results: TrackMetadata[],
  userHistoryScores?: Record<string, number>
): Promise<TrackMetadata[]> {
  if (results.length === 0) return results;

  const trendTracks = await getTrendingTracks();
  const trendGenres = await getTrendingGenres();

  // Create fast-lookup sets for exact matching
  const trendTrackKeys = new Set(
    trendTracks.map(t => normalizeStr(`${t.title}-${t.artist}`))
  );
  const trendGenreNorms = new Set(
    trendGenres.map(g => g.toLowerCase().trim())
  );

  const scored = results.map((track, index) => {
    // Initial rank score (descending from 1000)
    let score = 1000 - index;

    const trackKey = normalizeStr(`${track.title}-${track.artist}`);
    const artistNorm = track.artist.toLowerCase().trim();
    const genreNorm = track.genre ? track.genre.toLowerCase().trim() : '';

    // 1. Personalization: User followed/listened artist boost (highest priority if matching)
    if (userHistoryScores && userHistoryScores[artistNorm]) {
      score += Math.min(userHistoryScores[artistNorm] * 10, 200); // Max +200 points
    }

    // 2. Trending Track Boost: If track is currently trending globally or locally
    if (trendTrackKeys.has(trackKey) || (track.itunesId > 0 && trendTracks.some(t => t.itunesId === track.itunesId))) {
      score += 150; // Significant boost
    }

    // 3. Trending Genre Boost: If track belongs to a trending genre
    if (genreNorm && trendGenreNorms.has(genreNorm)) {
      score += 35; // Moderate boost
    }

    return { track, score };
  });

  // Sort by final score descending
  return scored
    .sort((a, b) => b.score - a.score)
    .map(s => s.track);
}
