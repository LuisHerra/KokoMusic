/**
 * tasteProfileBuilder.ts — KokoMusic Offline Recommendation Layer
 *
 * Builds a normalised taste profile for a user by combining:
 *   - Local user_history.json (fast, always available)
 *   - Supabase play_events (authoritative cross-device source)
 *   - kokomusic.tracks_meta (genre / duration enrichment)
 *
 * DESIGN CONSTRAINTS (non-negotiable):
 *   • This module NEVER runs inside a request/response cycle.
 *   • No iTunes / Deezer / Last.fm calls here — metadata only from local DB.
 *   • Output is a compact JSON blob persisted to kokomusic.taste_profiles.
 */

import { supabase } from './supabaseService';
import { readHistory, type HistoryEntry } from './historyService';
import { getLikedTracks } from '../routes/playlists';

// ── Config ────────────────────────────────────────────────────────────────────

/** Half-life for time-decay: after λ days a play weights half as much. */
const DECAY_LAMBDA_DAYS = Number(process.env.TASTE_DECAY_LAMBDA_DAYS ?? 14);

/** Minimum engagement ratio to include a play (avoids click-and-skip noise). */
const MIN_ENGAGEMENT_RATIO = 0.15;

/** No single artist can exceed this fraction of total weighted plays. */
const ARTIST_CAP_RATIO = 0.30;

/** Minimum duration_ms to use for engagement denominator when track has no meta. */
const DEFAULT_DURATION_MS = 180_000;

/**
 * Un "me gusta" explícito es una señal más fuerte que una escucha completa
 * (que ya de por sí cuenta como peso 1 tras el ratio de engagement) — se
 * pondera más para que el perfil de gustos reaccione a los likes del usuario
 * aunque todavía no haya escuchado mucho ese género/artista.
 */
const LIKE_WEIGHT_MULTIPLIER = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TasteProfile {
  userId: string;
  /** Genre → normalised weight (sum = 1). */
  genreAffinity: Record<string, number>;
  /** Top artists sorted by weight descending. */
  topArtists: { artistId: number; name: string; weight: number }[];
  /** Language → normalised weight (sum = 1). */
  languageAffinity?: Record<string, number>;
  /** Decade ('2020s', '2010s', '2000s', '90s', '80s', 'older') → normalised weight. */
  decadeAffinity?: Record<string, number>;
  /** ISO hour-of-day (0-23) → relative listening frequency. */
  hourlyDistribution: number[];
  /** Day-of-week (0=Sun … 6=Sat) → relative listening frequency. */
  dowDistribution: number[];
  /** Total engagement-weighted play count used to build the profile. */
  totalWeight: number;
  computedAt: string;
}

export interface EnrichedPlay {
  trackId: string;
  artist: string;
  artistId: number;
  genre: string;
  durationMs: number;
  timestamp: string; // ISO
  secondsListened: number;
  language?: string | null;
  releaseDate?: string | null;
  /** True para entradas sintéticas venidas de "me gusta" — reciben LIKE_WEIGHT_MULTIPLIER. */
  isLikedSignal?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Exponential time-decay weight: 2^(-Δt/λ). Returns a value in (0, 1]. */
export function timeDecayWeight(playTimestamp: string, nowMs = Date.now()): number {
  const deltaMs = nowMs - new Date(playTimestamp).getTime();
  const deltaDays = deltaMs / (1000 * 60 * 60 * 24);
  return Math.pow(2, -deltaDays / DECAY_LAMBDA_DAYS);
}

/** Engagement ratio = secondsListened / (durationMs / 1000). */
export function engagementRatio(secondsListened: number, durationMs: number): number {
  const durationSec = durationMs / 1000;
  if (durationSec <= 0) return 0;
  return Math.min(1, secondsListened / durationSec);
}

/** Normalise a weight map so all values sum to 1. */
function normalise(map: Record<string, number>): Record<string, number> {
  const total = Object.values(map).reduce((s, v) => s + v, 0);
  if (total === 0) return map;
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v / total]));
}

/** Extracts decade bucket from release date (YYYY-MM-DD or YYYY). */
export function getDecade(releaseDate?: string | null): string | null {
  if (!releaseDate) return null;
  const year = parseInt(releaseDate.substring(0, 4), 10);
  if (isNaN(year) || year < 1900 || year > 2100) return null;
  if (year >= 2020) return '2020s';
  if (year >= 2010) return '2010s';
  if (year >= 2000) return '2000s';
  if (year >= 1990) return '90s';
  if (year >= 1980) return '80s';
  if (year >= 1970) return '70s';
  return 'classic';
}

// ── Core builder ──────────────────────────────────────────────────────────────

/**
 * Fetches enriched play events for a user from Supabase play_events
 * joined with tracks_meta for genre + duration data.
 * Falls back to local JSON cache when Supabase is unavailable.
 */
async function fetchEnrichedPlays(userId: string): Promise<EnrichedPlay[]> {
  const enriched: EnrichedPlay[] = [];

  if (supabase) {
    try {
      // Pull up to 5000 events; join tracks_meta for genre + duration
      const { data: events, error } = await supabase
        .schema('kokomusic')
        .from('play_events')
        .select('track_id, artist, played_at, seconds_listened')
        .eq('user_id', userId)
        .order('played_at', { ascending: false })
        .limit(5000);

      if (!error && events && events.length > 0) {
        // Batch-fetch track meta for all unique track IDs
        const trackIds = [...new Set(events.map((e: any) => e.track_id as string))];
        const numericIds = trackIds
          .map(Number)
          .filter((n) => !isNaN(n) && n > 0);

        const metaMap: Record<string, { genre: string; durationMs: number; artistId: number; language?: string | null; releaseDate?: string | null }> = {};

        if (numericIds.length > 0) {
          const { data: metas } = await supabase
            .schema('kokomusic')
            .from('tracks_meta')
            .select('itunes_id, genre, duration_ms, artist_id, language, release_date')
            .in('itunes_id', numericIds);

          for (const m of (metas || [])) {
            metaMap[String((m as any).itunes_id)] = {
              genre: (m as any).genre || 'Otros',
              durationMs: (m as any).duration_ms || DEFAULT_DURATION_MS,
              artistId: (m as any).artist_id || 0,
              language: (m as any).language || null,
              releaseDate: (m as any).release_date || null,
            };
          }
        }

        for (const e of events) {
          const tid = e.track_id as string;
          const meta = metaMap[tid] || {
            genre: 'Otros',
            durationMs: DEFAULT_DURATION_MS,
            artistId: 0,
          };
          enriched.push({
            trackId: tid,
            artist: (e.artist as string) || '',
            artistId: meta.artistId,
            genre: meta.genre,
            durationMs: meta.durationMs,
            timestamp: e.played_at as string,
            secondsListened: (e.seconds_listened as number) || 0,
            language: meta.language,
            releaseDate: meta.releaseDate,
          });
        }

        return enriched;
      }
    } catch (err) {
      console.error('[TasteProfile] Supabase fetch error, falling back to local JSON:', err);
    }
  }

  // Fallback: local JSON cache
  const history: HistoryEntry[] = readHistory().filter((h) => h.userId === userId);
  for (const h of history) {
    const plays = h.plays?.length ? h.plays : [h.lastPlayed];
    for (const p of plays) {
      const session = h.minutesBySession?.find((s) => {
        return Math.abs(new Date(s.date).getTime() - new Date(p).getTime()) < 3_600_000;
      });
      enriched.push({
        trackId: h.trackId,
        artist: h.artist,
        artistId: 0, // unknown from local cache
        genre: 'Otros',
        durationMs: DEFAULT_DURATION_MS,
        timestamp: p,
        secondsListened: session?.seconds || 0,
      });
    }
  }
  return enriched;
}

/**
 * Resuelve género/artista/idioma/fecha para los tracks que el usuario ha
 * marcado con "me gusta" (Liked Songs) — señal explícita que hasta ahora no
 * alimentaba el perfil de gustos, solo las escuchas implícitas de play_events.
 * `secondsListened` se fija a la duración completa para que pase el filtro
 * de engagement mínimo de la misma forma que una escucha completa.
 */
async function fetchLikedSignals(userId: string): Promise<EnrichedPlay[]> {
  if (!supabase) return [];

  const liked = getLikedTracks(userId);
  if (liked.length === 0) return [];

  const numericIds = liked
    .map((l) => Number(l.trackId))
    .filter((n) => !isNaN(n) && n > 0);
  if (numericIds.length === 0) return [];

  const { data: metas } = await supabase
    .schema('kokomusic')
    .from('tracks_meta')
    .select('itunes_id, artist, genre, duration_ms, artist_id, language, release_date')
    .in('itunes_id', numericIds);

  if (!metas || metas.length === 0) return [];

  const metaMap = new Map<string, any>(metas.map((m: any) => [String(m.itunes_id), m]));

  const enriched: EnrichedPlay[] = [];
  for (const { trackId, likedAt } of liked) {
    const meta = metaMap.get(trackId);
    if (!meta) continue;
    const durationMs = meta.duration_ms || DEFAULT_DURATION_MS;
    enriched.push({
      trackId,
      artist: meta.artist || '',
      artistId: meta.artist_id || 0,
      genre: meta.genre || 'Otros',
      durationMs,
      timestamp: likedAt,
      secondsListened: durationMs / 1000, // engagement completo — es un "me gusta", no una escucha parcial
      language: meta.language || null,
      releaseDate: meta.release_date || null,
      isLikedSignal: true,
    });
  }
  return enriched;
}

/**
 * Apply 30% artist cap: redistributes excess weight proportionally to other artists.
 */
export function applyArtistCap(
  rawArtistWeights: Record<string, number>,
  capRatio = ARTIST_CAP_RATIO
): Record<string, number> {
  if (Object.keys(rawArtistWeights).length === 0) return rawArtistWeights;
  const total = Object.values(rawArtistWeights).reduce((s, v) => s + v, 0);
  if (total === 0) return rawArtistWeights;

  const maxWeightAbs = total * capRatio;
  const capped = { ...rawArtistWeights };

  // Iteratively cap and redistribute excess (converges in ≤ artists.length passes)
  for (let pass = 0; pass < Object.keys(capped).length + 1; pass++) {
    const overCapped = Object.entries(capped).filter(([, w]) => w > maxWeightAbs);
    if (overCapped.length === 0) break;

    let excessPool = 0;
    for (const [artist, w] of overCapped) {
      excessPool += w - maxWeightAbs;
      capped[artist] = maxWeightAbs;
    }

    // Distribute excess proportionally among uncapped artists
    const uncapped = Object.entries(capped).filter(([, w]) => w < maxWeightAbs);
    const uncappedTotal = uncapped.reduce((s, [, w]) => s + w, 0);

    if (uncappedTotal <= 0 || excessPool < 0.0001) break;

    for (const [artist, w] of uncapped) {
      capped[artist] = w + excessPool * (w / uncappedTotal);
    }
  }

  return capped;
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Builds and persists a TasteProfile for the given userId.
 * Designed to run as a background job — never call from a request path.
 */
export async function buildAndPersistTasteProfile(userId: string): Promise<TasteProfile | null> {
  console.log(`[TasteProfile] Building profile for user: ${userId}`);
  const nowMs = Date.now();

  const [playHistory, likedSignals] = await Promise.all([
    fetchEnrichedPlays(userId),
    fetchLikedSignals(userId),
  ]);
  // Los "me gusta" se combinan con las escuchas reales — misma canción puede
  // aportar peso por ambas vías (escuchada Y marcada), lo cual es deseable.
  const plays = [...playHistory, ...likedSignals];
  const existing = await loadTasteProfileStale(userId);

  if (plays.length === 0 && !existing) {
    console.log(`[TasteProfile] No play history for ${userId}. Skipping.`);
    return null;
  }

  // ── Accumulators ────────────────────────────────────────────────────────────
  const genreWeights: Record<string, number> = {};
  const artistRawWeights: Record<string, { weight: number; artistId: number }> = {};
  const languageWeights: Record<string, number> = {};
  const decadeWeights: Record<string, number> = {};
  const hourlyFreq = new Array<number>(24).fill(0);
  const dowFreq = new Array<number>(7).fill(0);
  let totalWeight = 0;

  for (const play of plays) {
    // 1. Engagement gate (discard click-and-skips)
    const er = engagementRatio(play.secondsListened, play.durationMs);
    if (er < MIN_ENGAGEMENT_RATIO && play.secondsListened < 10) continue;

    // 2. Time-decay weight
    const decay = timeDecayWeight(play.timestamp, nowMs);
    // 3. Combined weight = engagement ratio × decay (cap engagement at 1),
    // boosted for explicit "me gusta" signals (más fuerte que una escucha).
    let weight = Math.min(1, er > 0 ? er : 0.5) * decay;
    if (play.isLikedSignal) weight *= LIKE_WEIGHT_MULTIPLIER;

    if (weight <= 0) continue;
    totalWeight += weight;

    // Genre
    const genre = play.genre || 'Otros';
    genreWeights[genre] = (genreWeights[genre] || 0) + weight;

    // Language (if known)
    if (play.language) {
      const lang = play.language.toLowerCase().trim();
      languageWeights[lang] = (languageWeights[lang] || 0) + weight;
    }

    // Decade (if release date known)
    const decade = getDecade(play.releaseDate);
    if (decade) {
      decadeWeights[decade] = (decadeWeights[decade] || 0) + weight;
    }

    // Artist
    const artistKey = play.artist || 'Unknown';
    if (!artistRawWeights[artistKey]) {
      artistRawWeights[artistKey] = { weight: 0, artistId: play.artistId };
    }
    artistRawWeights[artistKey].weight += weight;

    // Hourly + DoW distribution
    try {
      const d = new Date(play.timestamp);
      hourlyFreq[d.getUTCHours()] += weight;
      dowFreq[d.getUTCDay()] += weight;
    } catch {
      // ignore malformed dates
    }
  }

  // ── Bayesian Prior (Onboarding/Seeded Blend) ────────────────────────────────
  // If real history is thin (< 50 plays) but an existing profile (like an onboarding seed)
  // has a high weight, we blend the existing profile as a prior so the user doesn't
  // lose their onboarding tastes after listening to just 1 track.
  const PRIOR_WEIGHT = 50;
  if (existing && existing.totalWeight >= PRIOR_WEIGHT && totalWeight < PRIOR_WEIGHT) {
    const syntheticWeight = PRIOR_WEIGHT - totalWeight;
    console.log(`[TasteProfile] Blending prior for ${userId} (Real weight: ${totalWeight.toFixed(1)}, Prior weight: ${syntheticWeight.toFixed(1)})`);

    for (const [g, w] of Object.entries(existing.genreAffinity)) {
      genreWeights[g] = (genreWeights[g] || 0) + (w * syntheticWeight);
    }
    if (existing.languageAffinity) {
      for (const [l, w] of Object.entries(existing.languageAffinity)) {
        languageWeights[l] = (languageWeights[l] || 0) + (w * syntheticWeight);
      }
    }
    if (existing.decadeAffinity) {
      for (const [d, w] of Object.entries(existing.decadeAffinity)) {
        decadeWeights[d] = (decadeWeights[d] || 0) + (w * syntheticWeight);
      }
    }
    for (const a of existing.topArtists) {
      if (!artistRawWeights[a.name]) {
        artistRawWeights[a.name] = { weight: 0, artistId: a.artistId };
      }
      artistRawWeights[a.name].weight += (a.weight * syntheticWeight);
    }
    for (let i = 0; i < 24; i++) {
      hourlyFreq[i] += (existing.hourlyDistribution[i] || 0) * syntheticWeight;
    }
    for (let i = 0; i < 7; i++) {
      dowFreq[i] += (existing.dowDistribution[i] || 0) * syntheticWeight;
    }
    totalWeight += syntheticWeight;
  }

  // ── Normalise + cap ─────────────────────────────────────────────────────────
  const genreAffinity = normalise(genreWeights);
  const languageAffinity = Object.keys(languageWeights).length > 0 ? normalise(languageWeights) : undefined;
  const decadeAffinity = Object.keys(decadeWeights).length > 0 ? normalise(decadeWeights) : undefined;

  const rawArtistOnly: Record<string, number> = {};
  for (const [name, { weight }] of Object.entries(artistRawWeights)) {
    rawArtistOnly[name] = weight;
  }
  const cappedArtistWeights = applyArtistCap(rawArtistOnly);
  const normArtistWeights = normalise(cappedArtistWeights);

  const topArtists = Object.entries(normArtistWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, weight]) => ({
      artistId: artistRawWeights[name]?.artistId || 0,
      name,
      weight,
    }));

  // Normalise distributions
  const totalHourly = hourlyFreq.reduce((s, v) => s + v, 0) || 1;
  const totalDow = dowFreq.reduce((s, v) => s + v, 0) || 1;

  const profile: TasteProfile = {
    userId,
    genreAffinity,
    topArtists,
    languageAffinity,
    decadeAffinity,
    hourlyDistribution: hourlyFreq.map((v) => v / totalHourly),
    dowDistribution: dowFreq.map((v) => v / totalDow),
    totalWeight,
    computedAt: new Date().toISOString(),
  };

  // ── Persist to Supabase ──────────────────────────────────────────────────────
  if (supabase) {
    const { error } = await supabase
      .schema('kokomusic')
      .from('taste_profiles')
      .upsert(
        {
          user_id: userId,
          profile_json: profile,
          computed_at: profile.computedAt,
        },
        { onConflict: 'user_id' }
      );
    if (error) {
      console.error('[TasteProfile] Error persisting to Supabase:', error.message);
    } else {
      console.log(`[TasteProfile] Profile persisted for ${userId} (${totalWeight.toFixed(2)} total weight, ${Object.keys(genreAffinity).length} genres, ${topArtists.length} artists)`);
    }
  }

  return profile;
}

/**
 * Loads the latest taste profile for a user from Supabase.
 * Returns null if not found or older than maxAgeMs.
 */
export async function loadTasteProfile(
  userId: string,
  maxAgeMs = 6 * 60 * 60 * 1000 // 6h
): Promise<TasteProfile | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .schema('kokomusic')
      .from('taste_profiles')
      .select('profile_json, computed_at')
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;
    const row = data as { profile_json: any; computed_at: string };
    const age = Date.now() - new Date(row.computed_at).getTime();
    if (age > maxAgeMs) return null; // too stale — caller decides whether to use it anyway
    return row.profile_json as TasteProfile;
  } catch {
    return null;
  }
}

/**
 * Like loadTasteProfile but ALWAYS returns data (even if stale).
 * Used for stale-while-revalidate pattern.
 */
export async function loadTasteProfileStale(userId: string): Promise<TasteProfile | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .schema('kokomusic')
      .from('taste_profiles')
      .select('profile_json, computed_at')
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;
    return (data as any).profile_json as TasteProfile;
  } catch {
    return null;
  }
}

/**
 * Creates and persists a synthetic profile for user onboarding.
 * Acts as a Bayesian prior (weight=50) that prevents cold-start loops.
 */
export async function seedInitialProfile(
  userId: string,
  genres: string[],
  artists: string[]
): Promise<TasteProfile> {
  const genreAffinity: Record<string, number> = {};
  if (genres.length > 0) {
    const gw = 1 / genres.length;
    for (const g of genres) genreAffinity[g] = gw;
  }

  const topArtists = artists.map((name) => ({
    artistId: 0,
    name,
    weight: 1 / artists.length,
  }));

  const profile: TasteProfile = {
    userId,
    genreAffinity,
    topArtists,
    hourlyDistribution: new Array(24).fill(1 / 24),
    dowDistribution: new Array(7).fill(1 / 7),
    totalWeight: 50, // Strong synthetic prior
    computedAt: new Date().toISOString(),
  };

  if (supabase) {
    await supabase
      .schema('kokomusic')
      .from('taste_profiles')
      .upsert(
        {
          user_id: userId,
          profile_json: profile,
          computed_at: profile.computedAt,
        },
        { onConflict: 'user_id' }
      );
  }

  console.log(`[TasteProfile] Seeded onboarding profile for ${userId} (${genres.length} genres, ${artists.length} artists)`);
  return profile;
}
