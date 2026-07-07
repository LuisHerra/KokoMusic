/**
 * candidateGenerator.ts — KokoMusic Offline Recommendation Layer
 *
 * Produces a ranked list of track candidates, FULLY ENRICHED, so the online
 * layer never needs to do additional DB joins or API calls.
 *
 * Sources (priority order):
 *   1. Followed-artist tracks (kokomusic.follows + tracks_meta)
 *   2. Genre-matched tracks from tracks_meta (exploitation)
 *   3. Chart tracks from external_charts_cache (discovery)
 *
 * Applies 80/20 exploitation/discovery split.
 * Excludes tracks heard in the last 7 days or excessively replayed.
 *
 * DESIGN CONSTRAINTS:
 *   • NEVER calls iTunes / Deezer / Last.fm directly.
 *   • NEVER runs inside a request/response cycle.
 *   • All candidates must arrive with full feature vectors attached.
 */

import { supabase } from './supabaseService';
import type { TasteProfile } from './tasteProfileBuilder';
import { readHistory } from './historyService';
import { getTrendingTracks } from './trendingService';


// ── Config ────────────────────────────────────────────────────────────────────

const EXPLOIT_RATIO = 0.65;           // 65% from taste-aligned sources
const DISCOVERY_RATIO = 0.35;         // 35% from charts (new discoveries)
const EXCLUDE_RECENT_DAYS = 3;        // skip tracks heard in the last N days (was 7)
const EXCLUDE_EXCESS_PLAYS_MONTH = 10; // skip tracks with >N plays in last 30 days (was 8)
const MAX_CANDIDATES = 100;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EnrichedCandidate {
  trackId: string;
  title: string;
  artist: string;
  artistId: number;
  cover: string;
  durationMs: number;
  genre: string;
  releaseDate: string | null;
  /** Computed affinity score against current taste profile (0-1). */
  affinityScore: number;
  /** True if track is from a followed artist released in the last 30 days. */
  isNewFromFollowedArtist: boolean;
  /** Source: 'taste' | 'follow' | 'charts' */
  source: 'taste' | 'follow' | 'charts';
  /** BPM estimate (heuristic from metadata hash if real BPM unavailable). */
  bpmEstimate: number;
  /** Energy estimate 0-1 (heuristic). */
  energyEstimate: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Deterministic BPM heuristic — mirrors smart-reorder in playlists.ts. */
function estimateBpm(title: string, artist: string): number {
  const charSum =
    title.split('').reduce((s, c) => s + c.charCodeAt(0), 0) +
    artist.split('').reduce((s, c) => s + c.charCodeAt(0), 0) || 100;
  return 75 + (charSum % 76); // 75-150 BPM
}

/** Deterministic energy heuristic. */
function estimateEnergy(title: string, artist: string): number {
  const charSum =
    title.split('').reduce((s, c) => s + c.charCodeAt(0), 0) +
    artist.split('').reduce((s, c) => s + c.charCodeAt(0), 0) || 100;
  return 0.2 + ((charSum % 9) / 10); // 0.2-1.0
}

/**
 * Returns a Set of trackIds that should be excluded:
 *   - Played within the last EXCLUDE_RECENT_DAYS
 *   - Played more than EXCLUDE_EXCESS_PLAYS_MONTH times in the last 30 days
 */
function buildExcludeSet(userId: string): Set<string> {
  const excluded = new Set<string>();
  const history = readHistory().filter((h) => h.userId === userId);
  const nowMs = Date.now();
  const sevenDaysMs = EXCLUDE_RECENT_DAYS * 24 * 60 * 60 * 1000;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  for (const h of history) {
    const plays = h.plays || [h.lastPlayed];
    const recentPlays = plays.filter(
      (p) => nowMs - new Date(p).getTime() < sevenDaysMs
    );
    if (recentPlays.length > 0) {
      excluded.add(h.trackId);
      continue;
    }
    const monthPlays = plays.filter(
      (p) => nowMs - new Date(p).getTime() < thirtyDaysMs
    );
    if (monthPlays.length > EXCLUDE_EXCESS_PLAYS_MONTH) {
      excluded.add(h.trackId);
    }
  }
  return excluded;
}

/** Compute an affinity score for a track given the user's taste profile. */
function computeAffinity(
  genre: string,
  artistName: string,
  profile: TasteProfile
): number {
  const genreScore = profile.genreAffinity[genre] || 0;
  const artistEntry = profile.topArtists.find(
    (a) => a.name.toLowerCase() === artistName.toLowerCase()
  );
  const artistScore = artistEntry ? artistEntry.weight : 0;
  // Blend: 60% genre, 40% artist familiarity
  return Math.min(1, genreScore * 0.6 + artistScore * 0.4);
}

/** Fetch candidates from tracks_meta matching the user's top genres. */
async function fetchTasteCandidates(
  profile: TasteProfile,
  exclude: Set<string>,
  limit: number
): Promise<EnrichedCandidate[]> {
  if (!supabase) return [];

  const topGenres = Object.entries(profile.genreAffinity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => g)
    .filter((g) => g !== 'Otros');

  if (topGenres.length === 0) return [];

  const { data, error } = await supabase
    .schema('kokomusic')
    .from('tracks_meta')
    .select('itunes_id, title, artist, artist_id, cover_url, duration_ms, genre, release_date')
    .in('genre', topGenres)
    .limit(limit * 3); // over-fetch to allow filtering

  if (error || !data) return [];

  return (data as any[])
    .filter((row) => !exclude.has(String(row.itunes_id)))
    .map((row) => {
      const trackId = String(row.itunes_id);
      const title = (row.title as string) || '';
      const artist = (row.artist as string) || '';
      return {
        trackId,
        title,
        artist,
        artistId: Number(row.artist_id) || 0,
        cover: (row.cover_url as string) || '',
        durationMs: Number(row.duration_ms) || 180_000,
        genre: (row.genre as string) || 'Otros',
        releaseDate: (row.release_date as string) || null,
        affinityScore: computeAffinity(row.genre, artist, profile),
        isNewFromFollowedArtist: false,
        source: 'taste' as const,
        bpmEstimate: estimateBpm(title, artist),
        energyEstimate: estimateEnergy(title, artist),
      };
    })
    .sort((a, b) => b.affinityScore - a.affinityScore)
    .slice(0, limit);
}

/** Fetch candidates from followed artists (recent tracks in tracks_meta). */
async function fetchFollowCandidates(
  userId: string,
  profile: TasteProfile,
  exclude: Set<string>,
  limit: number
): Promise<EnrichedCandidate[]> {
  if (!supabase) return [];

  const { data: follows, error: fErr } = await supabase
    .schema('kokomusic')
    .from('follows')
    .select('artist_id, artist_name')
    .eq('user_id', userId);

  if (fErr || !follows || follows.length === 0) return [];

  const artistIds = (follows as any[]).map((f) => Number(f.artist_id));

  const { data, error } = await supabase
    .schema('kokomusic')
    .from('tracks_meta')
    .select('itunes_id, title, artist, artist_id, cover_url, duration_ms, genre, release_date')
    .in('artist_id', artistIds)
    .order('release_date', { ascending: false })
    .limit(limit * 4);

  if (error || !data) return [];

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  return (data as any[])
    .filter((row) => !exclude.has(String(row.itunes_id)))
    .map((row) => {
      const trackId = String(row.itunes_id);
      const title = (row.title as string) || '';
      const artist = (row.artist as string) || '';
      const releaseDate = (row.release_date as string) || null;
      const isNew = !!releaseDate && releaseDate >= thirtyDaysAgo;
      return {
        trackId,
        title,
        artist,
        artistId: Number(row.artist_id) || 0,
        cover: (row.cover_url as string) || '',
        durationMs: Number(row.duration_ms) || 180_000,
        genre: (row.genre as string) || 'Otros',
        releaseDate,
        affinityScore: computeAffinity(row.genre, artist, profile),
        isNewFromFollowedArtist: isNew,
        source: 'follow' as const,
        bpmEstimate: estimateBpm(title, artist),
        energyEstimate: estimateEnergy(title, artist),
      };
    })
    .sort((a, b) => {
      if (a.isNewFromFollowedArtist !== b.isNewFromFollowedArtist) {
        return a.isNewFromFollowedArtist ? -1 : 1;
      }
      return b.affinityScore - a.affinityScore;
    })
    .slice(0, limit);
}

/** Fetch discovery candidates from trending tracks (local + global). */
async function fetchChartCandidates(
  profile: TasteProfile,
  exclude: Set<string>,
  limit: number
): Promise<EnrichedCandidate[]> {
  try {
    const trendTracks = await getTrendingTracks();
    if (!trendTracks || trendTracks.length === 0) return [];

    const candidates: EnrichedCandidate[] = [];

    for (const item of trendTracks) {
      const trackId = item.id;
      if (!trackId || exclude.has(trackId)) continue;

      candidates.push({
        trackId,
        title: item.title,
        artist: item.artist,
        artistId: item.artistId || 0,
        cover: item.cover || '',
        durationMs: item.duration || 180_000,
        genre: item.genre || 'Otros',
        releaseDate: item.releaseDate || null,
        affinityScore: computeAffinity(item.genre, item.artist, profile),
        isNewFromFollowedArtist: false,
        source: 'charts' as const,
        bpmEstimate: estimateBpm(item.title, item.artist),
        energyEstimate: estimateEnergy(item.title, item.artist),
      });

      if (candidates.length >= limit * 3) break;
    }

    return candidates
      .filter((c, idx, arr) => arr.findIndex((x) => x.trackId === c.trackId) === idx) // dedup
      .sort(() => Math.random() - 0.5) // shuffle for variety
      .slice(0, limit);
  } catch (err) {
    console.error('[CandidateGen] Error fetching chart candidates from trendingService:', err);
    return [];
  }
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Generates a fully-enriched list of recommendation candidates for a user.
 * Combines exploitation (taste + follows) and discovery (charts) at 80/20.
 * Never calls external APIs — only reads from DB caches.
 *
 * @param userId
 * @param profile — pre-computed TasteProfile for the user
 * @returns Array of EnrichedCandidate, sorted by affinity descending
 */
// Helper to cap artist and genre representation in candidate pools
function applyDiversityCap(
  candidates: EnrichedCandidate[],
  maxSlots: number,
  maxArtistRatio = 0.15, // max 15% per artist
  maxGenreRatio = 0.25   // max 25% per genre
): EnrichedCandidate[] {
  const maxPerArtist = Math.max(1, Math.ceil(maxSlots * maxArtistRatio));
  const maxPerGenre = Math.max(2, Math.ceil(maxSlots * maxGenreRatio));

  const artistCount: Record<string, number> = {};
  const genreCount: Record<string, number> = {};
  const result: EnrichedCandidate[] = [];

  for (const c of candidates) {
    const artistKey = c.artist.toLowerCase().trim();
    const genreKey = c.genre.toLowerCase().trim();

    const aCount = artistCount[artistKey] || 0;
    const gCount = genreCount[genreKey] || 0;

    if (aCount < maxPerArtist && gCount < maxPerGenre) {
      artistCount[artistKey] = aCount + 1;
      genreCount[genreKey] = gCount + 1;
      result.push(c);
    }
  }
  return result;
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Generates a fully-enriched list of recommendation candidates for a user.
 * Combines exploitation (taste + follows) and discovery (charts) at 80/20.
 * Never calls external APIs — only reads from DB caches.
 *
 * @param userId
 * @param profile — pre-computed TasteProfile for the user
 * @returns Array of EnrichedCandidate, sorted by affinity descending
 */
export async function generateCandidates(
  userId: string,
  profile: TasteProfile
): Promise<EnrichedCandidate[]> {
  console.log(`[CandidateGen] Generating candidates for ${userId}`);

  const exclude = buildExcludeSet(userId);

  const exploitLimit = Math.ceil(MAX_CANDIDATES * EXPLOIT_RATIO);
  const discoverLimit = Math.floor(MAX_CANDIDATES * DISCOVERY_RATIO);

  const [followCandidates, tasteCandidates, chartCandidates] = await Promise.all([
    fetchFollowCandidates(userId, profile, exclude, Math.ceil(exploitLimit * 0.4)),
    fetchTasteCandidates(profile, exclude, Math.ceil(exploitLimit * 0.6)),
    fetchChartCandidates(profile, exclude, discoverLimit),
  ]);

  // Merge exploitation bucket (follows first, then taste-matched)
  const seenIds = new Set<string>();
  const exploitation: EnrichedCandidate[] = [];
  for (const c of [...followCandidates, ...tasteCandidates]) {
    if (!seenIds.has(c.trackId)) {
      seenIds.add(c.trackId);
      exploitation.push(c);
    }
  }

  // Merge discovery bucket
  const discovery: EnrichedCandidate[] = [];
  for (const c of chartCandidates) {
    if (!seenIds.has(c.trackId)) {
      seenIds.add(c.trackId);
      discovery.push(c);
    }
  }

  // ── Apply Artist Recency Cooldowns ──────────────────────────────────────────
  const history = readHistory().filter((h) => h.userId === userId);
  const artistLastPlayed = new Map<string, number>();
  for (const h of history) {
    if (h.artist && h.lastPlayed) {
      const norm = h.artist.toLowerCase().trim();
      const lastPlayedMs = new Date(h.lastPlayed).getTime();
      const existing = artistLastPlayed.get(norm) || 0;
      if (lastPlayedMs > existing) {
        artistLastPlayed.set(norm, lastPlayedMs);
      }
    }
  }

  const nowMs = Date.now();
  const applyCooldown = (c: EnrichedCandidate) => {
    const artistNorm = c.artist.toLowerCase().trim();
    const lastPlayedMs = artistLastPlayed.get(artistNorm);
    if (lastPlayedMs) {
      const elapsedHours = (nowMs - lastPlayedMs) / (1000 * 60 * 60);
      let penalty = 0;
      if (elapsedHours < 2) penalty = 0.8;      // Played in last 2h -> major penalty (affinity score decreases by 0.8)
      else if (elapsedHours < 12) penalty = 0.4; // Played in last 12h -> medium penalty (affinity score decreases by 0.4)
      else if (elapsedHours < 48) penalty = 0.15; // Played in last 2 days -> minor penalty
      
      c.affinityScore = Math.max(0, c.affinityScore - penalty);
    }
  };

  exploitation.forEach(applyCooldown);
  discovery.forEach(applyCooldown);

  // Sort again based on updated affinity scores
  exploitation.sort((a, b) => {
    if (a.isNewFromFollowedArtist !== b.isNewFromFollowedArtist) {
      return a.isNewFromFollowedArtist ? -1 : 1;
    }
    return b.affinityScore - a.affinityScore;
  });
  discovery.sort((a, b) => b.affinityScore - a.affinityScore);

  const merged = [
    ...exploitation.slice(0, exploitLimit),
    ...discovery.slice(0, discoverLimit),
  ];

  // Apply diversity capping to the final recommendations candidate pool
  const cappedCandidates = applyDiversityCap(merged, MAX_CANDIDATES, 0.15, 0.25);

  // If diversity capping makes the pool too small, backfill from original merged list
  let finalCandidates = cappedCandidates;
  if (finalCandidates.length < 50) {
    const backfillSeenIds = new Set(finalCandidates.map(c => c.trackId));
    for (const c of merged) {
      if (!backfillSeenIds.has(c.trackId)) {
        finalCandidates.push(c);
        if (finalCandidates.length >= 70) break;
      }
    }
  }

  console.log(
    `[CandidateGen] ${finalCandidates.length} candidates generated (${exploitation.length} exploit, ${discovery.length} discover, ${exclude.size} excluded)`
  );

  return finalCandidates;
}

/**
 * Cold-start candidate list for users with no taste profile.
 * Reads from trending tracks (local + global) and returns enriched candidates.
 */
export async function getColdStartCandidates(limit = 30): Promise<EnrichedCandidate[]> {
  try {
    const trendTracks = await getTrendingTracks();
    if (!trendTracks || trendTracks.length === 0) return [];

    const candidates: EnrichedCandidate[] = [];
    const seenIds = new Set<string>();

    for (const item of trendTracks) {
      const trackId = item.id;
      if (!trackId || seenIds.has(trackId)) continue;
      seenIds.add(trackId);

      candidates.push({
        trackId,
        title: item.title,
        artist: item.artist,
        artistId: item.artistId || 0,
        cover: item.cover || '',
        durationMs: item.duration || 180_000,
        genre: item.genre || 'Otros',
        releaseDate: item.releaseDate || null,
        affinityScore: 0,
        isNewFromFollowedArtist: false,
        source: 'charts' as const,
        bpmEstimate: estimateBpm(item.title, item.artist),
        energyEstimate: estimateEnergy(item.title, item.artist),
      });

      if (candidates.length >= limit) break;
    }

    return candidates;
  } catch (err) {
    console.error('[CandidateGen] Error getting cold start candidates:', err);
    return [];
  }
}
