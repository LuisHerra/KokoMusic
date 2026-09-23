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
import { type TasteProfile, getDecade } from './tasteProfileBuilder';
import { readHistory } from './historyService';
import { isLastfmPlaceholderCover } from './lastfmCoverUtils';

// ── Config ────────────────────────────────────────────────────────────────────

const EXPLOIT_RATIO = 0.80;           // 80% from taste-aligned sources
const DISCOVERY_RATIO = 0.20;         // 20% from charts (new discoveries)
const EXCLUDE_RECENT_DAYS = 7;        // skip tracks heard in the last N days
const EXCLUDE_EXCESS_PLAYS_MONTH = 8; // skip tracks with >N plays in last 30 days
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

/** Fetch discovery candidates from the external charts cache. */
async function fetchChartCandidates(
  profile: TasteProfile,
  exclude: Set<string>,
  limit: number
): Promise<EnrichedCandidate[]> {
  if (!supabase) return [];

  const { data: cacheRows, error } = await supabase
    .schema('kokomusic')
    .from('external_charts_cache')
    .select('source, region, payload_json, fetched_at')
    .order('fetched_at', { ascending: false })
    .limit(4);

  if (error || !cacheRows || cacheRows.length === 0) return [];

  const candidates: EnrichedCandidate[] = [];

  for (const row of cacheRows as any[]) {
    const payload = (row.payload_json as any[]) || [];
    for (const item of payload) {
      const trackId = String(item.trackId || item.id || item.track_id || '');
      if (!trackId || exclude.has(trackId)) continue;

      const title = String(item.title || item.trackName || item.name || '');
      const artist = String(item.artist || item.artistName || item.artist_name || '');
      const genre = String(item.genre || 'Otros');
      const releaseDate = item.releaseDate || item.release_date || null;

      // Deezer expone BPM/loudness reales para bastante de su catálogo (ver
      // backgroundJobRunner.fetchDeezerCharts) — se usan cuando están
      // disponibles; si no (bpm=0 es habitual, Deezer no lo tiene para todo),
      // caemos a la heurística por hash como antes.
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
        releaseDate,
        affinityScore: computeAffinity(genre, artist, profile, undefined, releaseDate),
        isNewFromFollowedArtist: false,
        source: 'charts' as const,
        bpmEstimate: realBpm > 0 ? realBpm : estimateBpm(title, artist),
        energyEstimate: realEnergy !== null ? realEnergy : estimateEnergy(title, artist),
      });

      if (candidates.length >= limit * 3) break;
    }
  }

  return candidates
    .filter((c, idx, arr) => arr.findIndex((x) => x.trackId === c.trackId) === idx) // dedup
    .sort(() => Math.random() - 0.5) // shuffle for variety
    .slice(0, limit);
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

  const merged = [
    ...exploitation.slice(0, exploitLimit),
    ...discovery.slice(0, discoverLimit),
  ];

  console.log(
    `[CandidateGen] ${merged.length} candidates generated (${exploitation.length} exploit, ${discovery.length} discover, ${exclude.size} excluded)`
  );

  return merged;
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Pool "Descubrir": música FUERA de la zona de confort del usuario.
 *   - tracks_meta de géneros que no están en su top 5 (ventana aleatoria del catálogo)
 *   - charts de todas las regiones cacheadas
 * Excluye sus top artistas y lo escuchado recientemente, máx. 1 canción por artista.
 * Solo lee Supabase — cero llamadas externas.
 */
export async function generateDiscoveryCandidates(
  userId: string,
  profile: TasteProfile | null,
  poolSize = 120
): Promise<EnrichedCandidate[]> {
  if (!supabase) return [];

  const exclude = buildExcludeSet(userId);
  const topGenres = profile
    ? Object.entries(profile.genreAffinity).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g]) => g)
    : [];
  const topArtists = new Set((profile?.topArtists ?? []).map((a) => a.name.toLowerCase()));

  const toCandidate = (
    trackId: string, title: string, artist: string, artistId: number, cover: string,
    durationMs: number, genre: string, releaseDate: string | null, source: EnrichedCandidate['source'],
  ): EnrichedCandidate => ({
    trackId, title, artist, artistId, cover, durationMs, genre, releaseDate,
    affinityScore: 0,
    isNewFromFollowedArtist: false,
    source,
    bpmEstimate: estimateBpm(title, artist),
    energyEstimate: estimateEnergy(title, artist),
  });

  // Ventana aleatoria del catálogo: PostgREST no tiene ORDER BY random(), así que
  // se usa un offset aleatorio sobre el conteo estimado.
  const catalogQuery = async (): Promise<EnrichedCandidate[]> => {
    const genreList = `(${topGenres.map((g) => `"${g}"`).join(',')})`;
    const excludeTopGenres = (q: any) => (topGenres.length > 0 ? q.not('genre', 'in', genreList) : q);

    const { count } = await excludeTopGenres(
      supabase!.schema('kokomusic').from('tracks_meta')
        .select('itunes_id', { count: 'estimated', head: true })
        .not('cover_url', 'is', null)
    );
    const windowSize = poolSize * 2;
    const offset = count && count > windowSize ? Math.floor(Math.random() * (count - windowSize)) : 0;

    const { data, error } = await excludeTopGenres(
      supabase!.schema('kokomusic').from('tracks_meta')
        .select('itunes_id, title, artist, artist_id, cover_url, duration_ms, genre, release_date')
        .not('cover_url', 'is', null)
        .neq('cover_url', '')
    ).range(offset, offset + windowSize - 1);
    if (error || !data) return [];

    return (data as any[]).map((row) => toCandidate(
      String(row.itunes_id), row.title || '', row.artist || '', Number(row.artist_id) || 0,
      row.cover_url || '', Number(row.duration_ms) || 180_000, row.genre || 'Otros',
      row.release_date || null, 'taste',
    ));
  };

  const chartsQuery = async (): Promise<EnrichedCandidate[]> => {
    const { data, error } = await supabase!.schema('kokomusic').from('external_charts_cache')
      .select('payload_json')
      .order('fetched_at', { ascending: false })
      .limit(12);
    if (error || !data) return [];
    const out: EnrichedCandidate[] = [];
    for (const row of data as any[]) {
      for (const item of (row.payload_json as any[]) || []) {
        const trackId = String(item.trackId || item.id || item.track_id || '');
        if (!trackId) continue;
        const rawCover = String(item.cover || item.coverUrl || item.cover_url || item.image || '');
        out.push(toCandidate(
          trackId,
          String(item.title || item.trackName || item.name || ''),
          String(item.artist || item.artistName || item.artist_name || ''),
          Number(item.artistId || item.artist_id || 0),
          isLastfmPlaceholderCover(rawCover) ? '' : rawCover,
          Number(item.durationMs || item.duration_ms || 180_000),
          String(item.genre || 'Otros'),
          item.releaseDate || item.release_date || null,
          'charts',
        ));
      }
    }
    return out;
  };

  const [catalog, charts] = await Promise.all([catalogQuery(), chartsQuery()]);

  const seenTracks = new Set<string>();
  const seenArtists = new Set<string>();
  const pool: EnrichedCandidate[] = [];
  for (const c of shuffleInPlace([...catalog, ...charts])) {
    const artistKey = c.artist.toLowerCase();
    if (!c.cover || !c.title || seenTracks.has(c.trackId) || exclude.has(c.trackId)) continue;
    if (topArtists.has(artistKey) || seenArtists.has(artistKey)) continue;
    seenTracks.add(c.trackId);
    seenArtists.add(artistKey);
    pool.push(c);
    if (pool.length >= poolSize) break;
  }
  return pool;
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
