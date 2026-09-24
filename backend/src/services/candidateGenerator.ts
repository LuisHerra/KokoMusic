/**
 * candidateGenerator.ts — KokoMusic Offline Recommendation Layer
 *
 * Produces a ranked list of track candidates, FULLY ENRICHED, so the online
 * layer never needs to do additional DB joins or API calls.
 *
 * KokoMix (generateCandidates) y Descubrir (generateDiscoveryCandidates) —
 * ver cada función para sus fuentes. Las señales vienen de relatedMusicService
 * (historial en Supabase, Last.fm cacheado 7 días, perfiles de otros usuarios).
 * Las llamadas externas (Last.fm, iTunes por artista) están cacheadas y
 * compartidas entre usuarios, así que un pool se calcula en pocos segundos la
 * primera vez y después sale de caché.
 */

import { supabase } from './supabaseService';
import { type TasteProfile, getDecade } from './tasteProfileBuilder';
import { isLastfmPlaceholderCover } from './lastfmCoverUtils';
import type { TrackMetadata } from './metadataService';
import {
  loadUserSignals,
  getRelatedUnknownArtists,
  getNeighborArtists,
  getTracksForArtists,
  interleaveByWeight,
  normArtist,
} from './relatedMusicService';

// ── Config ────────────────────────────────────────────────────────────────────

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
  language?: string | null;
  /** Computed affinity score against current taste profile (0-1). */
  affinityScore: number;
  /** True if track is from a followed artist released in the last 30 days. */
  isNewFromFollowedArtist: boolean;
  source: 'artist' | 'similar' | 'rediscover' | 'friends' | 'taste' | 'follow' | 'charts';
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

/** Compute an affinity score for a track given the user's taste profile. */
function computeAffinity(
  genre: string,
  artistName: string,
  profile: TasteProfile,
  language?: string | null,
  releaseDate?: string | null
): number {
  const genreScore = profile.genreAffinity[genre] || 0;
  const artistEntry = profile.topArtists.find(
    (a) => a.name.toLowerCase() === artistName.toLowerCase()
  );
  const artistScore = artistEntry ? artistEntry.weight : 0;

  let langScore = 0;
  if (language && profile.languageAffinity) {
    langScore = profile.languageAffinity[language.toLowerCase().trim()] || 0;
  }

  let decadeScore = 0;
  if (releaseDate && profile.decadeAffinity) {
    const dec = getDecade(releaseDate);
    if (dec) {
      decadeScore = profile.decadeAffinity[dec] || 0;
    }
  }

  // Si hay señales de idioma o década, integramos en el peso
  if (profile.languageAffinity || profile.decadeAffinity) {
    return Math.min(1, genreScore * 0.50 + artistScore * 0.30 + langScore * 0.10 + decadeScore * 0.10);
  }

  // Blend estándar: 60% género, 40% artista
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
    .select('itunes_id, title, artist, artist_id, cover_url, duration_ms, genre, release_date, language')
    .in('genre', topGenres)
    .not('cover_url', 'is', null)
    .neq('cover_url', '')
    .limit(limit * 3); // over-fetch to allow filtering

  if (error || !data) return [];

  return (data as any[])
    .filter((row) => !exclude.has(String(row.itunes_id)))
    .map((row) => {
      const trackId = String(row.itunes_id);
      const title = (row.title as string) || '';
      const artist = (row.artist as string) || '';
      const genre = (row.genre as string) || 'Otros';
      const releaseDate = (row.release_date as string) || null;
      const language = (row.language as string) || null;
      return {
        trackId,
        title,
        artist,
        artistId: Number(row.artist_id) || 0,
        cover: (row.cover_url as string) || '',
        durationMs: Number(row.duration_ms) || 180_000,
        genre,
        releaseDate,
        language,
        affinityScore: computeAffinity(genre, artist, profile, language, releaseDate),
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
    .select('itunes_id, title, artist, artist_id, cover_url, duration_ms, genre, release_date, language')
    .in('artist_id', artistIds)
    .not('cover_url', 'is', null)
    .neq('cover_url', '')
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
      const genre = (row.genre as string) || 'Otros';
      const language = (row.language as string) || null;
      return {
        trackId,
        title,
        artist,
        artistId: Number(row.artist_id) || 0,
        cover: (row.cover_url as string) || '',
        durationMs: Number(row.duration_ms) || 180_000,
        genre,
        releaseDate,
        language,
        affinityScore: computeAffinity(genre, artist, profile, language, releaseDate),
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

// ── Helpers de construcción ───────────────────────────────────────────────────

function trackToCandidate(t: TrackMetadata, source: EnrichedCandidate['source'], affinity: number): EnrichedCandidate {
  return {
    trackId: t.id,
    title: t.title,
    artist: t.artist,
    artistId: t.artistId,
    cover: t.cover,
    durationMs: t.duration || 180_000,
    genre: t.genre || 'Otros',
    releaseDate: t.releaseDate,
    affinityScore: affinity,
    isNewFromFollowedArtist: false,
    source,
    bpmEstimate: estimateBpm(t.title, t.artist),
    energyEstimate: estimateEnergy(t.title, t.artist),
  };
}

/** Una de cada lista por turno: evita que el primer artista acapare la cabeza. */
function roundRobin<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

function dedupeCandidates(list: EnrichedCandidate[], maxPerArtist = Infinity): EnrichedCandidate[] {
  const seen = new Set<string>();
  const perArtist = new Map<string, number>();
  return list.filter((c) => {
    if (!c.trackId || !c.title || seen.has(c.trackId)) return false;
    const a = normArtist(c.artist);
    if ((perArtist.get(a) ?? 0) >= maxPerArtist) return false;
    seen.add(c.trackId);
    perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
    return true;
  });
}

// ── KokoMix ───────────────────────────────────────────────────────────────────

/**
 * KokoMix = "lo tuyo". Pool del usuario, en este orden de peso:
 *   - artist (40%):     canciones de sus artistas favoritos (primero las que no ha oído)
 *   - similar (25%):    artistas muy parecidos a sus favoritos (Last.fm)
 *   - rediscover (20%): lo que escuchaba mucho y lleva 14+ días sin oír
 *   - follow (15%):     novedades de artistas que sigue
 * El relleno por género solo entra si falta pool, y los charts solo si no hay
 * absolutamente nada — antes eran el grueso y por eso salía mainstream sin sentido.
 */
export async function generateCandidates(
  userId: string,
  profile: TasteProfile
): Promise<EnrichedCandidate[]> {
  console.log(`[CandidateGen] Generating candidates for ${userId}`);
  const signals = await loadUserSignals(userId, profile);
  const exclude = signals.recentTrackIds;
  const top = signals.topArtists.slice(0, 12);

  const [related, followCandidates] = await Promise.all([
    getRelatedUnknownArtists(signals, 5, 10),
    fetchFollowCandidates(userId, profile, exclude, 15),
  ]);
  const tracksByArtist = await getTracksForArtists([...top.map((a) => a.name), ...related.map((r) => r.name)], 3);

  const artistBucket = roundRobin(top.map((a) => {
    const list = (tracksByArtist.get(normArtist(a.name)) ?? []).filter((t) => !exclude.has(t.id));
    list.sort((x, y) => Number(signals.playedTrackIds.has(x.id)) - Number(signals.playedTrackIds.has(y.id)));
    const n = Math.min(5, Math.max(2, Math.round(a.weight * 30)));
    return list.slice(0, n).map((t) => trackToCandidate(t, 'artist', Math.min(1, 0.5 + a.weight)));
  }));

  const similarBucket = roundRobin(related.map((r) =>
    (tracksByArtist.get(normArtist(r.name)) ?? [])
      .filter((t) => !signals.playedTrackIds.has(t.id))
      .slice(0, 2)
      .map((t) => trackToCandidate(t, 'similar', Math.min(1, r.score)))
  ));

  const rediscoverCutoff = Date.now() - 14 * 86400_000;
  const rediscoverBucket = signals.history
    .filter((h) => (h.playCount || 0) >= 2 && h.title && h.cover && h.lastPlayed && new Date(h.lastPlayed).getTime() < rediscoverCutoff)
    .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
    .slice(0, 20)
    .map((h) => trackToCandidate({
      id: h.trackId, itunesId: Number(h.trackId) || 0, artistId: 0, title: h.title, artist: h.artist,
      album: '', cover: h.cover, duration: 180_000, genre: 'Otros', releaseDate: null, popularity: 50, preview_url: null,
    }, 'rediscover', 0.8));

  let merged = dedupeCandidates(interleaveByWeight([
    { items: artistBucket, weight: 8 },
    { items: similarBucket, weight: 5 },
    { items: rediscoverBucket, weight: 4 },
    { items: followCandidates, weight: 3 },
  ]), 5);

  if (merged.length < 40) {
    const filler = await fetchTasteCandidates(profile, exclude, 40 - merged.length);
    merged = dedupeCandidates([...merged, ...filler], 5);
  }
  if (merged.length < 12) {
    merged = dedupeCandidates([...merged, ...(await getColdStartCandidates(30))], 5);
  }

  const counts = merged.reduce<Record<string, number>>((acc, c) => { acc[c.source] = (acc[c.source] || 0) + 1; return acc; }, {});
  console.log(`[CandidateGen] ${merged.length} candidates for ${userId}: ${JSON.stringify(counts)}`);
  return merged.slice(0, MAX_CANDIDATES);
}

// ── Descubrir ─────────────────────────────────────────────────────────────────

/**
 * Descubrir = "nuevo pero relacionado": solo artistas que el usuario NO ha
 * escuchado nunca, elegidos porque...
 *   - similar: se parecen a sus favoritos (Last.fm), o
 *   - friends: los escuchan usuarios de la app con gustos parecidos.
 * Si no hay señal suficiente, cae a sus mismos géneros pero con artistas nuevos
 * (nunca a géneros aleatorios, que era lo que pasaba antes).
 */
export async function generateDiscoveryCandidates(
  userId: string,
  profile: TasteProfile | null,
  poolSize = 80
): Promise<EnrichedCandidate[]> {
  const signals = await loadUserSignals(userId, profile);
  const [related, neighbors] = await Promise.all([
    getRelatedUnknownArtists(signals, 8, 25),
    getNeighborArtists(userId, profile, signals, 12),
  ]);
  const tracksByArtist = await getTracksForArtists([...related, ...neighbors].map((a) => a.name), 2);

  const pick = (artists: { name: string; score: number }[], source: EnrichedCandidate['source']) =>
    roundRobin(artists.map((a) =>
      (tracksByArtist.get(normArtist(a.name)) ?? [])
        .filter((t) => !signals.playedTrackIds.has(t.id) && t.cover)
        .slice(0, 2)
        .map((t) => trackToCandidate(t, source, Math.min(1, a.score)))
    ));

  let pool = dedupeCandidates(interleaveByWeight([
    { items: pick(related, 'similar'), weight: 2 },
    { items: pick(neighbors, 'friends'), weight: 1 },
  ]), 2);

  if (pool.length < 15 && profile) {
    const filler = (await fetchTasteCandidates(profile, signals.playedTrackIds, 60))
      .filter((c) => !signals.knownArtists.has(normArtist(c.artist)));
    pool = dedupeCandidates([...pool, ...filler], 2);
  }

  console.log(`[CandidateGen] Descubrir para ${userId}: ${pool.length} (similar=${related.length} artistas, amigos=${neighbors.length} artistas)`);
  return pool.slice(0, poolSize);
}

/**
 * Cold-start candidate list for users with no taste profile.
 * Reads directly from external_charts_cache and returns enriched candidates.
 */
export async function getColdStartCandidates(limit = 30, _region?: string): Promise<EnrichedCandidate[]> {
  if (!supabase) return [];

  const { data: cacheRows, error } = await supabase
    .schema('kokomusic')
    .from('external_charts_cache')
    .select('payload_json')
    .order('fetched_at', { ascending: false })
    .limit(2);

  if (error || !cacheRows || cacheRows.length === 0) return [];

  const candidates: EnrichedCandidate[] = [];
  const seenIds = new Set<string>();

  for (const row of cacheRows as any[]) {
    const payload = (row.payload_json as any[]) || [];
    for (const item of payload) {
      const trackId = String(item.trackId || item.id || item.track_id || '');
      if (!trackId || seenIds.has(trackId)) continue;
      seenIds.add(trackId);

      const title = String(item.title || item.trackName || item.name || '');
      const artist = String(item.artist || item.artistName || item.artist_name || '');
      const genre = String(item.genre || 'Otros');
      const realBpm = Number(item.bpm) || 0;
      const realEnergy = typeof item.energyFromGain === 'number' ? item.energyFromGain : null;

      const rawCover = String(item.cover || item.coverUrl || item.cover_url || item.image || '');
      candidates.push({
        trackId,
        title,
        artist,
        artistId: Number(item.artistId || item.artist_id || 0),
        cover: isLastfmPlaceholderCover(rawCover) ? '' : rawCover,
        durationMs: Number(item.durationMs || item.duration_ms || 180_000),
        genre,
        releaseDate: item.releaseDate || item.release_date || null,
        affinityScore: 0,
        isNewFromFollowedArtist: false,
        source: 'charts' as const,
        bpmEstimate: realBpm > 0 ? realBpm : estimateBpm(title, artist),
        energyEstimate: realEnergy !== null ? realEnergy : estimateEnergy(title, artist),
      });

      if (candidates.length >= limit) break;
    }
    if (candidates.length >= limit) break;
  }

  return candidates;
}
