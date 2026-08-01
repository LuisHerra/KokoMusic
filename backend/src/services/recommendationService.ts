import { cache } from './cacheService';
import { searchTracks, getTrackById, type TrackMetadata } from './metadataService';
import { readHistory, type HistoryEntry } from './historyService';
import { audioExists } from './ytdlpService';
import { trackExistsInCDN } from './cdnService';
import { getTrendingTracks, getTrendingGenres } from './trendingService';
import { getUserRegion } from './regionService';
import { getRegionalTopTracks } from './regionalChartsService';
import { getListenBrainzTopRecordings, getUserCFRecommendations, getUserTopArtists } from './listenBrainzService';
import {
  getEnrichedMeta,
  getTagsForTrack,
  getGenreForTrack,
  getPopularityScore,
  detectLanguageFromTags,
  detectTrackCulture,
  type TrackCulture,
  triggerStartupEnrichment,
} from './metadataEnrichmentService';

// Trigger background enrichment pass once on module load (non-blocking)
triggerStartupEnrichment();

function normalizeStr(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

/** Cleans track titles by removing remix/feat/version noise for strict title deduplication */
function cleanTrackTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/ft\..*?$/i, '')
    .replace(/feat\..*?$/i, '')
    .replace(/remix/i, '')
    .replace(/radio edit/i, '')
    .trim()
    .replace(/[^a-z0-9]/g, '');
}

const LFM_KEY = process.env.LASTFM_KEY || '';
const LFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LastFmSimilarTrack {
  name: string;
  artist: { name: string };
}

// ── Exploration ratio by history depth ───────────────────────────────────────
// Usuarios nuevos (<20 plays) deben descubrir más, no sesgar desde el primer día.
// A medida que acumulan historial real, el peso del perfil propio va subiendo.
// ANTI-LOOP FIX: Minimum discovery floor of 40% to prevent taste-bubble lock-in.

function getExplorationRatio(totalPlays: number): number {
  if (totalPlays < 20)  return 0.75;  // 75% discovery — cold start
  if (totalPlays < 60)  return 0.65;  // 65% discovery — ramp up
  if (totalPlays < 200) return 0.60;  // 60% discovery — established
  return 0.60;                         // 60% discovery — Spotify discovery floor
}

// ── Last.fm helpers ───────────────────────────────────────────────────────────

async function fetchLastFmSimilar(artist: string, track: string, limit = 15): Promise<LastFmSimilarTrack[]> {
  if (!LFM_KEY) return [];
  try {
    const url = `${LFM_BASE}?method=track.getsimilar&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}&api_key=${LFM_KEY}&format=json&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as any;
    const tracks = data?.similartracks?.track;
    if (Array.isArray(tracks)) {
      return tracks.map((t: any) => ({
        name: t.name,
        artist: { name: typeof t.artist === 'string' ? t.artist : t.artist?.name || '' },
      }));
    }
    return [];
  } catch {
    return [];
  }
}

async function fetchLastFmSimilarArtists(artist: string, limit = 5): Promise<string[]> {
  if (!LFM_KEY) return [];
  try {
    const url = `${LFM_BASE}?method=artist.getsimilar&artist=${encodeURIComponent(artist)}&api_key=${LFM_KEY}&format=json&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as any;
    const artists = data?.similarartists?.artist;
    if (Array.isArray(artists)) return artists.map((a: any) => a.name);
    return [];
  } catch {
    return [];
  }
}

/**
 * Fetches the top tags for an artist from Last.fm.
 * Tags are used as genre proxies for adjacent-genre discovery.
 */
async function fetchLastFmArtistTags(artist: string, limit = 3): Promise<string[]> {
  if (!LFM_KEY) return [];
  try {
    const url = `${LFM_BASE}?method=artist.gettoptags&artist=${encodeURIComponent(artist)}&api_key=${LFM_KEY}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json() as any;
    const tags = data?.toptags?.tag;
    if (Array.isArray(tags)) {
      return tags.slice(0, limit).map((t: any) => t.name as string);
    }
    return [];
  } catch {
    return [];
  }
}

// ── Track resolver ────────────────────────────────────────────────────────────

async function resolveSimilarTrack(artist: string, title: string): Promise<TrackMetadata | null> {
  const query = `${artist} ${title}`.trim();
  const cacheKey = `resolve-similar:${query.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  try {
    const itunesResults = await searchTracks(query, 1, 'itunes');
    if (itunesResults?.length > 0) {
      cache.setex(cacheKey, 86400, JSON.stringify(itunesResults[0]));
      return itunesResults[0];
    }
    const ytResults = await searchTracks(query, 1, 'youtube');
    if (ytResults?.length > 0) {
      cache.setex(cacheKey, 86400, JSON.stringify(ytResults[0]));
      return ytResults[0];
    }
  } catch {
    // ignore
  }
  return null;
}

function historyTrackToMetadata(h: HistoryEntry): TrackMetadata {
  // Use enriched metadata if available (populated by metadataEnrichmentService)
  const enriched = getEnrichedMeta(h.trackId);
  return {
    id: h.trackId,
    itunesId: 0,
    artistId: 0,
    title: h.title,
    artist: h.artist,
    album: enriched?.album || 'Historial',
    cover: h.cover || '',
    // Real duration from iTunes if enriched; fallback to 3min estimate
    duration: enriched?.duration || 180000,
    // Real genre from iTunes/Last.fm if enriched; not the useless 'Historial' placeholder
    genre: enriched?.genre || getGenreForTrack(h.trackId) || 'Unknown',
    releaseDate: enriched?.releaseDate || null,
    // Log-scaled Last.fm popularity if available; otherwise use playCount as before
    popularity: enriched?.listeners ? getPopularityScore(h.trackId) : Math.min(h.playCount, 80),
    preview_url: null,
  };
}

// ── Anti-bias scoring helpers ─────────────────────────────────────────────────

/**
 * Applies a 20% artist cap on the candidate pool.
 * No single artist can represent more than 20% of the final slots.
 * Returns a pruned copy of the pool (may be smaller than input).
 */
function applyArtistCap(
  pool: { track: TrackMetadata; source: string; baseScore: number }[],
  maxSlots: number,
  capRatio = 0.20
): { track: TrackMetadata; source: string; baseScore: number }[] {
  const maxPerArtist = Math.max(1, Math.ceil(maxSlots * capRatio));
  const artistCount: Record<string, number> = {};
  const result: typeof pool = [];

  for (const item of pool) {
    const key = item.track.artist.toLowerCase().trim();
    const count = artistCount[key] || 0;
    if (count < maxPerArtist) {
      artistCount[key] = count + 1;
      result.push(item);
    }
  }
  return result;
}

// Helper to auto-seed profile for Koko's profile when empty
async function autoSeedKokoIfNeeded(userId: string): Promise<any> {
  if (!userId) return null;
  try {
    const { supabase } = require('./supabaseService');
    const { seedInitialProfile } = require('./tasteProfileBuilder');
    
    if (supabase) {
      const { data: userProfile } = await supabase
        .schema('kokomusic')
        .from('koko_profiles')
        .select('username, display_name')
        .eq('id', userId)
        .maybeSingle();
      
      if (userProfile) {
        const username = (userProfile.username || '').toLowerCase();
        const displayName = (userProfile.display_name || '').toLowerCase();
        
        if (username.includes('koko') || displayName.includes('koko')) {
          console.log(`[Recs] Auto-seeding Koko's profile for user ${userId}`);
          const genres = ['Urban/Latino', 'Reggaetón', 'Trap', 'Phonk', 'R&B'];
          const artists = [
            'Feid', 'Quevedo', 'Bad Bunny', 'Omay', 'Trueno', 'Morad', 'JCReyes', 
            'SamuraiJay', 'CharliePuth', 'phonk brasileño', 'Keblack', 'RnBoi', 
            'OmarCourtz', 'Danyl', 'GIMS', 'Naza', 'DrYaro', 'Rvssian', 'MykeTowers', 
            'Mauvais Djo', 'Oasis', 'Tayc', 'PLK', 'Ninho', 'Tiakola', 'Santiago', 
            'Alonzo', 'Fred de Palma'
          ];
          return await seedInitialProfile(userId, genres, artists);
        }
      }
    }
  } catch (err) {
    console.error('[Recs] autoSeedKokoIfNeeded error:', err);
  }
  return null;
}

// ── Main exported function ─────────────────────────────────────────────────────

export async function getRecommendations(
  limit = 10,
  userId?: string,
  mood?: string,
  seedTrackId?: string,
  seedTrackIds?: string[],
  excludeTrackIds?: string[],
  earlySkipIds?: string[],
  algoOptions?: {
    explorationRatio?: number;
    maxArtistTracks?: number;
    cultureStrictness?: 'strict' | 'flexible' | 'off';
    popularityWeight?: 'low' | 'balanced' | 'high';
  }
): Promise<TrackMetadata[]> {
  const effectiveSeeds = seedTrackIds && seedTrackIds.length > 0 ? seedTrackIds : (seedTrackId ? [seedTrackId] : []);
  const activeSeedId = effectiveSeeds.length > 0 ? effectiveSeeds[effectiveSeeds.length - 1] : undefined;
  // Ensure seedTrackId resolves activeSeedId so query params `seedTrackIds` trigger seed-based recommendations!
  seedTrackId = activeSeedId || seedTrackId;
  // ── USER ISOLATION: Each user's history is strictly scoped to their own plays.
  const history = readHistory().filter(h => {
    if (!userId) {
      return !h.userId;
    }
    return h.userId === userId;
  });

  // Build exclusion set: tracks played in the last 7 days + current session & active queue IDs
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentlyPlayedIds = new Set<string>(
    history
      .filter(h => h.lastPlayed && new Date(h.lastPlayed).getTime() > sevenDaysAgo)
      .map(h => h.trackId)
  );

  const hardExcludeSet = new Set<string>([
    ...effectiveSeeds,
    ...(excludeTrackIds || []),
    ...Array.from(recentlyPlayedIds)
  ].map(id => id.toLowerCase().trim()));

  // Build early-skip penalty set: tracks the user bailed on in < 10s get a -300 score penalty.
  // Soft downrank (not hard exclude) so the engine can still surface them if there's nothing else.
  const earlySkipSet = new Set<string>((earlySkipIds || []).map(id => id.toLowerCase().trim()));

  // Cache key includes a short hash of earlySkipIds so skipping a song forces a fresh computation
  const skipHash = earlySkipIds && earlySkipIds.length > 0
    ? earlySkipIds.slice().sort().join(',').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) & 0xFFFFFF, 0).toString(16)
    : 'none';
  const cacheKey = `recs:${userId || 'global'}:${mood || 'none'}:${effectiveSeeds.join('_') || 'none'}:${limit}:${skipHash}`;
  if (!excludeTrackIds || excludeTrackIds.length === 0) {
    const cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  const trackPlayCounts = new Map<string, number>();
  const artistPlayCounts = new Map<string, number>();
  // Genre affinity from history: derive what genres the user gravitates toward
  const genrePlayCounts = new Map<string, number>();
  let totalPlays = 0;

  history.forEach(h => {
    const pc = h.playCount || 1;
    trackPlayCounts.set(h.trackId, (trackPlayCounts.get(h.trackId) || 0) + pc);
    if (h.artist) {
      const norm = h.artist.toLowerCase().trim();
      artistPlayCounts.set(norm, (artistPlayCounts.get(norm) || 0) + pc);
    }
    // Build genre taste vector — what genres does this user actually listen to?
    const genre = (h as any).genre;
    if (genre) {
      const gnorm = genre.toLowerCase().trim();
      genrePlayCounts.set(gnorm, (genrePlayCounts.get(gnorm) || 0) + pc);
    }
    totalPlays += pc;
  });

  // Total plays and maximum artist play count used for normalizing affinity bonuses
  const maxGenrePlays = genrePlayCounts.size > 0 ? Math.max(...genrePlayCounts.values()) : 1;
  const maxArtistPlays = artistPlayCounts.size > 0 ? Math.max(...artistPlayCounts.values()) : 1;
  const numUniqueArtists = artistPlayCounts.size;

  // Load taste profile if history is empty / small
  let tasteProfile: any = null;
  if (userId) {
    try {
      const { loadTasteProfileStale } = require('./tasteProfileBuilder');
      tasteProfile = await loadTasteProfileStale(userId);
      if (!tasteProfile && history.length === 0) {
        tasteProfile = await autoSeedKokoIfNeeded(userId);
      }
    } catch (e) {
      console.error('[Recs] Error loading taste profile:', e);
    }
  }

  // Exploitation vs discovery ratio — ramps with user maturity or respects custom user preference
  const explorationRatio = algoOptions?.explorationRatio ?? getExplorationRatio(totalPlays);
  const exploitationSlots = Math.floor(limit * (1 - explorationRatio));
  const discoverySlots    = limit - exploitationSlots;

  const exploitPool = new Map<string, { track: TrackMetadata; source: string; baseScore: number }>();
  const discoverPool = new Map<string, { track: TrackMetadata; source: string; baseScore: number }>();

  // ── 2. CAPA SEMILLA ───────────────────────────────────────────────────────
  // When a seed track is provided, its genre defines the listening context.
  // All subsequent candidate generation and scoring is biased toward that genre.

const KNOWN_FRENCH_ARTISTS = new Set([
  'gims', 'naza', 'dr. yaro', 'dr yaro', 'keblack', 'franglish', 'tayc', 'plk',
  'ninho', 'tiakola', 'alonzo', 'dadju', 'soolking', 'mauvais djo', 'niska',
  'booba', 'damso', 'pnl', 'nekfeu', 'stromae', 'indila', 'aya nakamura', 'sch',
  'jul', 'koba lad', 'zola', 'danyl', 'gambino', 'gradur', 'rk', 'soso maness',
  'gazo', 'kerchak', 'werenoi', 'favé', 'sdm', 'hamza', 'bosh', "heuss l'enfoiré"
]);

const KNOWN_LATIN_ARTISTS = new Set([
  'quevedo', 'feid', 'mora', 'bizarrap', 'bad bunny', 'myke towers', 'trueno',
  'ozuna', 'rauw alejandro', 'dei v', 'saiko', 'omar courtz', 'gonzy', 'maná',
  'mana', 'el bobe', 'rvfv', 'jcreyes', 'omay', 'morad', 'charlie puth', 'samurai jay'
]);

function detectLanguageAndCulture(artist: string, title: string, genre?: string, tags: string[] = []): 'french' | 'latin' | 'other' {
  const normArtist = (artist || '').toLowerCase().trim();
  const normTitle = (title || '').toLowerCase().trim();
  const normGenre = (genre || '').toLowerCase().trim();
  const normTags = tags.map(t => t.toLowerCase().trim()).join(' ');

  const isFrench = Array.from(KNOWN_FRENCH_ARTISTS).some(fa => normArtist.includes(fa));
  if (
    isFrench ||
    normGenre.includes('french') || normGenre.includes('francais') || normGenre.includes('chanson') ||
    normTags.includes('french') || normTags.includes('francais') || normTags.includes('chanson') || normTags.includes('rap fr') ||
    normTitle.includes('parisienne') || normTitle.includes('impofie')
  ) {
    return 'french';
  }

  const isLatin = Array.from(KNOWN_LATIN_ARTISTS).some(la => normArtist.includes(la)) || normArtist.includes('alvaro soler');
  if (
    isLatin ||
    normGenre.includes('reggaeton') || normGenre.includes('urbano') || normGenre.includes('latin') || normGenre.includes('salsa') || normGenre.includes('bachata') ||
    normTags.includes('reggaeton') || normTags.includes('latin') || normTags.includes('spanish')
  ) {
    return 'latin';
  }

  return 'other';
}

  let seedGenre: string | null = null;
  let seedArtistName: string | null = null;
  let seedTags: string[] = [];   // Last.fm genre tags for adjacent-genre search
  let seedCulture: TrackCulture = 'other';

  if (seedTrackId) {
    try {
      const seedTrack = await getTrackById(seedTrackId);
      if (seedTrack) {
        seedGenre = seedTrack.genre || null;
        seedArtistName = seedTrack.artist || null;

        // Fetch Last.fm similar tracks (genre-accurate)
        const similarList = await fetchLastFmSimilar(seedTrack.artist, seedTrack.title, 20);
        if (similarList.length > 0) {
          const resolved = await Promise.all(similarList.map(t => resolveSimilarTrack(t.artist.name, t.name)));
          for (const track of resolved) {
            if (track && track.id !== seedTrackId) {
              exploitPool.set(track.id, { track, source: 'seed_similarity', baseScore: 90 });
            }
          }
        }

        // If track-level similarity yielded 0 tracks (niche artist), fall back to same artist & local catalog match
        if (exploitPool.size === 0 && seedArtistName) {
          try {
            const sameArtist = await searchTracks(`${seedArtistName} hits`, 5, 'itunes');
            for (const t of sameArtist) {
              if (t && t.id !== seedTrackId) {
                exploitPool.set(t.id, { track: t, source: 'same_artist', baseScore: 48 });
              }
            }
          } catch { /* ignore */ }

          // LOCAL DB CATALOG MATCH PASS (for obscure / custom upload tracks)
          try {
            const { supabase } = require('./supabaseService');
            if (supabase) {
              let query = supabase.schema('kokomusic').from('tracks_meta').select('id, title, artist, album, cover, duration_ms, genre').limit(30);
              if (seedGenre) {
                query = query.ilike('genre', `%${seedGenre}%`);
              } else {
                query = query.ilike('artist', `%${seedArtistName}%`);
              }

              const { data: dbRows } = await query;
              if (dbRows && dbRows.length > 0) {
                for (const row of dbRows) {
                  if (row.id !== seedTrackId && !exploitPool.has(row.id)) {
                    exploitPool.set(row.id, {
                      track: {
                        id: row.id,
                        title: row.title,
                        artist: row.artist,
                        album: row.album || '',
                        cover: row.cover || '',
                        duration: row.duration_ms || 180000,
                        genre: row.genre || seedGenre || 'Music',
                        itunesId: parseInt(row.id, 10) || 0,
                        artistId: 0,
                        releaseDate: '',
                        popularity: 60,
                        preview_url: null,
                      },
                      source: 'local_catalog_match',
                      baseScore: 45,
                    });
                  }
                }
              }
            }
          } catch { /* ignore */ }
        }

        // Use enriched tags if available (pre-fetched, cached) — faster + richer than live LFM call
        const enrichedTags = getTagsForTrack(seedTrackId);
        if (enrichedTags.length > 0) {
          seedTags = enrichedTags;
        } else {
          // Fall back to live Last.fm artist tags if not yet enriched
          seedTags = await fetchLastFmArtistTags(seedTrack.artist, 4);
        }

        // Use the unified culture detector (evaluates tags, genre, title, and artist)
        seedCulture = detectTrackCulture(seedTrack.artist, seedTrack.title, seedTrack.genre || '', seedTags);
        const directSeedCulture = seedCulture;

        // ── SESSION & PROFILE CULTURE ANCHOR (Dominance Consensus) ─────────────
        // Analyze culture consensus across all session seeds + recent history.
        // Prevents single-track slips or out-of-context plays from triggering a genre spiral!
        const sessionCultures: TrackCulture[] = [];

        // 1. Active session queue seeds (up to last 10)
        for (const id of effectiveSeeds.slice(-10)) {
          try {
            const t = await getTrackById(id);
            if (t) {
              const tags = getTagsForTrack(id);
              const cult = detectTrackCulture(t.artist, t.title, t.genre || '', tags);
              if (cult !== 'other') sessionCultures.push(cult);
            }
          } catch {}
        }

        // 2. Recent listening history (last 5 played)
        for (const h of history.slice(0, 5)) {
          const tags = getTagsForTrack(h.trackId);
          const cult = detectTrackCulture(h.artist, h.title, (h as any).genre || '', tags);
          if (cult !== 'other') sessionCultures.push(cult);
        }

        // 3. Evaluate Dominance Consensus
        if (sessionCultures.length > 0) {
          const counts = new Map<TrackCulture, number>();
          for (const c of sessionCultures) {
            counts.set(c, (counts.get(c) || 0) + 1);
          }
          let maxCount = 0;
          let dominantCulture: TrackCulture = 'other';
          for (const [cult, count] of counts.entries()) {
            if (count > maxCount) {
              maxCount = count;
              dominantCulture = cult;
            }
          }

          // PRECEDENCE GUARD: Require >= 55% dominance and at least 3 matching tracks.
          // Never override an explicit non-'other' seed track's culture with an opposing session anchor!
          if (dominantCulture !== 'other' && maxCount >= 3 && (maxCount / sessionCultures.length) >= 0.55) {
            if (directSeedCulture === 'other' || directSeedCulture === dominantCulture) {
              seedCulture = dominantCulture;
              console.log(`[Recs] SESSION CULTURE ANCHOR LOCKED: >>> ${seedCulture.toUpperCase()} <<< (${maxCount}/${sessionCultures.length} session consensus)`);
            } else {
              console.log(`[Recs] SEED CULTURE PRECEDENCE: Seed "${seedTrack.artist}" culture (${directSeedCulture.toUpperCase()}) preserved over session anchor (${dominantCulture.toUpperCase()})`);
            }
          }
        }
      }
    } catch {
      // ignore seed errors
    }
  }

  // Fallback: If no session seed culture was derived, check overall history culture dominance
  if (seedCulture === 'other' && history.length >= 3) {
    try {
      const histCultures = history.slice(0, 15).map(h => {
        const tags = getTagsForTrack(h.trackId);
        return detectTrackCulture(h.artist, h.title, (h as any).genre || '', tags);
      }).filter(c => c !== 'other');
      
      if (histCultures.length >= 3) {
        const counts = new Map<TrackCulture, number>();
        for (const c of histCultures) counts.set(c, (counts.get(c) || 0) + 1);
        let topCount = 0;
        let topCult: TrackCulture = 'other';
        for (const [c, count] of counts.entries()) {
          if (count > topCount) { topCount = count; topCult = c; }
        }
        if (topCult !== 'other' && topCount >= 3 && (topCount / histCultures.length) >= 0.55) {
          seedCulture = topCult;
          console.log(`[Recs] PROFILE CULTURE ANCHOR LOCKED: >>> ${seedCulture.toUpperCase()} <<< (${topCount}/${histCultures.length} history consensus)`);
        }
      }
    } catch {}
  }

  console.log(`[Recs] ==================== RECOMMENDATION EVALUATION ====================`);
  console.log(`[Recs] User: ${userId || 'anonymous'} | Mood: ${mood || 'none'} | Limit: ${limit}`);
  if (seedTrackId) {
    console.log(`[Recs] SEED TRACK ACTIVE: "${seedArtistName} - ${seedGenre || 'no-genre'}" (id: ${seedTrackId})`);
    console.log(`[Recs]   • Seed Tags: [${seedTags.join(', ')}]`);
    console.log(`[Recs]   • DETECTED SEED CULTURE: >>> ${seedCulture.toUpperCase()} <<<`);
  } else {
    console.log(`[Recs] NO SEED TRACK (General user taste / discovery mode)`);
  }

  // ── 3. CAPA HISTORIAL Y PERFIL DE GUSTOS (exploitation) ─────────────────────
  // ANTI-LOOP FIX: History tracks are NO LONGER added as exploit candidates.
  // They are only used to derive similar-artist queries.

  try {
    // ── MULTI-CLUSTER TASTE ROTATION ENGINE ─────────────────────────────────
    // We sample from the broad spectrum of top 80+ artists in the user's Spotify history
    // and partition them into 4 Taste Clusters. On each call, we sample a cluster dynamically!
    const allTasteArtists = Array.from(new Set([
      ...artistPlayCounts.keys(),
      ...(tasteProfile?.topArtists || []).map((a: any) => (typeof a === 'string' ? a : a.name).toLowerCase().trim())
    ])).filter(Boolean);

    if (allTasteArtists.length > 0 && !activeSeedId) {
      // Partition artists into 4 Taste Clusters based on genre & style
      const frenchCluster = allTasteArtists.filter(a =>
        /gims|naza|dr\. yaro|franglish|tayc|keblack|soolking|plk|ninho|tiakola|alonzo|dadju|sch|jul|pnl|booba|nekfeu|stromae|indila|aya nakamura|damso|niska/i.test(a)
      );
      const latinCluster = allTasteArtists.filter(a =>
        /quevedo|feid|mora|bizarrap|bad bunny|myke towers|trueno|ozuna|rauw|dei v|jhayco|dystinct|duki|eladio|j balvin|anuel|karol g|saiko|ryan castro|young miko/i.test(a)
      );
      const usHipHopCluster = allTasteArtists.filter(a =>
        /metro boomin|drake|weeknd|travis scott|21 savage|future|kanye|kendrick|j\. cole|carti|uzi|don toliver|frank ocean/i.test(a)
      );
      const globalPopChillCluster = allTasteArtists.filter(a =>
        !frenchCluster.includes(a) && !latinCluster.includes(a) && !usHipHopCluster.includes(a)
      );

      // Dynamic Cluster Selection: Pick 2 clusters at random on each recommendation request
      const clusterPools = [
        { name: 'french', artists: frenchCluster },
        { name: 'latin', artists: latinCluster },
        { name: 'us_hiphop', artists: usHipHopCluster },
        { name: 'global_pop', artists: globalPopChillCluster },
      ].filter(c => c.artists.length > 0);

      if (clusterPools.length > 0) {
        const shuffledClusters = [...clusterPools].sort(() => Math.random() - 0.5);
        const selectedClusters = shuffledClusters.slice(0, 2);

        for (const cluster of selectedClusters) {
          // Pick 2 random artists from this cluster
          const sampledArtists = [...cluster.artists].sort(() => Math.random() - 0.5).slice(0, 2);
          for (const artistName of sampledArtists) {
            // 1. Fetch top hits for the sampled Spotify artist
            try {
              const hits = await searchTracks(`${artistName} top hits`, 3, 'itunes');
              for (const t of hits) {
                if (t && !exploitPool.has(t.id)) {
                  exploitPool.set(t.id, { track: t, source: 'cluster_artist', baseScore: 75 });
                }
              }
            } catch {}

            // 2. Fetch Last.fm similar artists to discover UNDISCOVERED adjacent artists in this cluster!
            try {
              const similar = await fetchLastFmSimilarArtists(artistName, 4);
              if (similar.length > 0) {
                const similarPools = await Promise.all(
                  similar.map(a => searchTracks(`${a} hits`, 3, 'itunes').catch(() => []))
                );
                for (const pool of similarPools) {
                  for (const t of pool) {
                    if (t && !exploitPool.has(t.id)) {
                      exploitPool.set(t.id, { track: t, source: 'cluster_adjacent_discovery', baseScore: 65 });
                    }
                  }
                }
              }
            } catch {}
          }
        }
      }
    }
  } catch (err) {
    console.error('[Recs] Error populating exploitation from multi-cluster rotation:', err);
  }

  // ── 4. CAPA DESCUBRIMIENTO (discovery) ───────────────────────────────────
  // GENRE COHERENCE: When a seed track is present, discovery queries must be
  // anchored to the seed's genre/artist, NOT the user's taste profile.
  // This prevents reggaeton appearing after Coldplay's Yellow.

  // Mood-based keywords
  const moodKeywords: Record<string, string[]> = {
    workout:     ['workout hits 2026', 'gym motivation electro', 'cardio fitness hits'],
    chill:       ['chill vibes lofi', 'relaxing r&b acoustic', 'ambient chill lounge'],
    study:       ['lofi study beats', 'ambient concentration piano', 'binaural study beats'],
    party:       ['reggaeton party hits', 'dance pop club anthems', 'party EDM hits'],
    rock:        ['classic rock hits', 'alternative rock essential', 'grunge metal hits'],
    sad:         ['sad acoustic songs', 'emotional pop ballads', 'melancholic indie'],
    happy:       ['uplifting feel good pop', 'happy summer hits', 'positive vibes pop'],
    latin:       ['reggaeton hits urbano', 'latin pop essential', 'bachata salsa dance'],
    electronic:  ['EDM hits house', 'deep house mix', 'techno club tracks'],
    hiphop:      ['hip hop rap essentials', 'trap vibes playlist', 'lofi hip hop beats'],
    classical:   ['relaxing classical piano', 'orchestral symphony', 'violin chill classical'],
    focus:       ['deep focus concentration', 'ambient drone study', 'focus alpha waves'],
  };

  // Adjacent genre exploration
  let adjacentKeywords: string[] = [];
  if (seedTrackId && seedArtistName) {
    // SEED MODE: Use seed artist's tags for adjacent discovery (genre-coherent)
    adjacentKeywords = seedTags.map(tag => `${tag} hits`);
    if (seedArtistName) adjacentKeywords.push(`${seedArtistName} similar artists hits`);
    if (seedGenre) adjacentKeywords.push(`${seedGenre} hits`, `best ${seedGenre} songs`);
  } else {
    // NO SEED: Use user's top artist tags for discovery
    try {
      let topArtistForTags = [...artistPlayCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 1)
        .map(([a]) => a)[0];

      if (!topArtistForTags && tasteProfile?.topArtists?.length > 0) {
        topArtistForTags = tasteProfile.topArtists[0].name;
      }

      if (topArtistForTags) {
        const tags = await fetchLastFmArtistTags(topArtistForTags, 3);
        adjacentKeywords = tags.map(tag => `${tag} hits new music`);
      }
    } catch {
      // ignore
    }
  }

  const region = userId ? getUserRegion(userId) : 'spain';
  const [trendTracks, trendGenres, regionalChartTracks, lbRecordings] = await Promise.all([
    getTrendingTracks(region).catch(() => []),
    getTrendingGenres(region).catch(() => []),
    getRegionalTopTracks(region).catch(() => []),
    getListenBrainzTopRecordings(15).catch(() => []),
  ]);

  // If seed is French culture, fetch French regional chart tracks specifically
  if (seedCulture === 'french') {
    const frenchCharts = await getRegionalTopTracks('france').catch(() => []);
    for (const track of frenchCharts) {
      const cult = detectTrackCulture(track.artist, track.title, track.genre || '');
      if (cult === 'french' && !exploitPool.has(track.id) && !discoverPool.has(track.id)) {
        discoverPool.set(track.id, { track, source: 'french_chart', baseScore: 85 });
      }
    }
  }

  // 1. Inject regional country top chart tracks — randomly sampled to rotate popular songs on every call
  const sampledRegional = [...regionalChartTracks].sort(() => Math.random() - 0.5).slice(0, 8);
  for (const track of sampledRegional) {
    if (exploitPool.has(track.id) || discoverPool.has(track.id)) continue;
    if (seedCulture !== 'other') {
      const cult = detectTrackCulture(track.artist, track.title, track.genre || '');
      if (cult !== seedCulture) continue; // Block non-matching regional chart tracks under active seed
    }
    if (seedGenre && track.genre && track.genre.toLowerCase() !== seedGenre.toLowerCase()) continue;
    discoverPool.set(track.id, { track, source: 'regional_chart', baseScore: 50 });
  }

  // 2. Inject trending tracks as discovery candidates — randomly sampled to ensure variety
  const sampledTrending = [...trendTracks].sort(() => Math.random() - 0.5).slice(0, 8);
  for (const track of sampledTrending) {
    if (exploitPool.has(track.id) || discoverPool.has(track.id)) continue;
    if (seedCulture !== 'other') {
      const cult = detectTrackCulture(track.artist, track.title, track.genre || '');
      if (cult !== seedCulture) continue; // Block non-matching trending tracks under active seed
    }
    if (seedGenre && track.genre && track.genre.toLowerCase() !== seedGenre.toLowerCase()) continue;
    discoverPool.set(track.id, { track, source: 'trending', baseScore: 40 });
  }

  // 3. Resolve ListenBrainz open collaborative filtering recordings
  if (lbRecordings.length > 0 && !seedTrackId) {
    const chosenLB = lbRecordings.sort(() => Math.random() - 0.5).slice(0, 4);
    const lbPools = await Promise.all(
      chosenLB.map((r) => resolveSimilarTrack(r.artistName, r.trackName).catch(() => null))
    );
    for (const track of lbPools) {
      if (track && !exploitPool.has(track.id) && !discoverPool.has(track.id)) {
        discoverPool.set(track.id, { track, source: 'listenbrainz', baseScore: 50 });
      }
    }
  }

  const activeMood = mood?.toLowerCase();
  const moodWords = (activeMood && moodKeywords[activeMood]) ? moodKeywords[activeMood] : [];

  // Discovery queries pool — clean 1-2 word queries to prevent 0-result iTunes search failures
  let discoveryPool: string[];
  if (seedCulture === 'french') {
    discoveryPool = [
      'rap francais',
      'french rap',
      'french pop',
      'chanson francaise',
      'ninho',
      'gims',
      'tayc',
      'jul',
      'pnl',
      'soolking',
      'aya nakamura',
      'dadju',
      'sdm',
      'tiakola',
      'plk'
    ];
  } else if (seedCulture === 'mexican') {
    discoveryPool = [
      'corridos tumbados',
      'musica mexicana',
      'peso pluma',
      'junior h',
      'natanael cano',
      'fuerza regida',
      'grupo frontera',
      'carin leon',
      'corridos belicos'
    ];
  } else if (seedCulture === 'latin') {
    discoveryPool = [
      'reggaeton',
      'urbano latino',
      'latin pop',
      'pop espanol',
      'quevedo',
      'feid',
      'bad bunny',
      'rauw alejandro',
      'mora',
      'bizarrap',
      'aitana',
      'rosalia'
    ];
  } else if (seedCulture === 'phonk') {
    discoveryPool = [
      'brazilian phonk',
      'montagem funk',
      'phonk',
      'funk paulista',
      'automotivo phonk',
      'funk carioca',
      'drift phonk',
      'taka la dentro',
      'napa'
    ];
  } else if (seedCulture === 'italian') {
    discoveryPool = [
      'rap italiano',
      'trap italia',
      'sfera ebbasta',
      'rondodasosa',
      'lazza',
      'geolier',
      'capo plaza',
      'tedua',
      'marracash',
      'sanremo'
    ];
  } else if (seedCulture === 'german') {
    discoveryPool = [
      'deutschrap',
      'apache 207',
      'luciano',
      'raf camora',
      'capital bra',
      'pashanim'
    ];
  } else if (seedCulture === 'kpop') {
    discoveryPool = [
      'kpop hits',
      'newjeans',
      'bts',
      'stray kids',
      'blackpink',
      'aespa',
      'ive'
    ];
  } else if (seedCulture === 'japanese') {
    discoveryPool = [
      'jpop hits',
      'yoasobi',
      'kenshi yonezu',
      'ado',
      'anime ost'
    ];
  } else if (seedTrackId) {
    // Seed mode: only genre/artist-adjacent queries, no global trending
    discoveryPool = [
      ...moodWords,
      ...adjacentKeywords,
    ];
  } else {
    const trendGenreQueries = trendGenres.slice(0, 3).map(g => `${g} hits`);
    const globalDiscovery = ['trending hits 2026', 'exitos virales', 'top musica', 'exitos del momento'];
    discoveryPool = [
      ...moodWords,
      ...adjacentKeywords,
      ...trendGenreQueries,
      ...globalDiscovery,
    ];
  }

  // Pick 3-4 different queries to get a varied discovery set
  const shuffled = [...discoveryPool].sort(() => Math.random() - 0.5);
  const chosenQueries = shuffled.slice(0, Math.min(4, shuffled.length));

  try {
    const searchResults = await Promise.all(
      chosenQueries.map(q => searchTracks(q, Math.ceil(discoverySlots * 2), 'itunes'))
    );
    for (const results of searchResults) {
      for (const track of results) {
        if (track && !exploitPool.has(track.id) && !discoverPool.has(track.id)) {
          discoverPool.set(track.id, { track, source: 'discovery', baseScore: 35 });
        }
      }
    }
  } catch {
    // ignore
  }

  // ── EMERGENCY CULTURE DISCOVERY PASS ─────────────────────────────────────────
  // If seedCulture is active and we have fewer than 15 culture-matching candidates,
  // forcefully search top culture queries on iTunes to guarantee a rich candidate pool!
  if (seedCulture !== 'other') {
    const currentMatching = [...exploitPool.values(), ...discoverPool.values()].filter(c =>
      detectTrackCulture(c.track.artist, c.track.title, c.track.genre || '') === seedCulture
    ).length;

    if (currentMatching < 15) {
      const emergencyQueries = seedCulture === 'french'
        ? ['rap francais', 'gims', 'ninho', 'tayc', 'jul', 'pnl', 'soolking', 'aya nakamura']
        : seedCulture === 'mexican'
        ? ['corridos tumbados', 'peso pluma', 'junior h', 'natanael cano', 'fuerza regida']
        : seedCulture === 'latin'
        ? ['reggaeton', 'quevedo', 'feid', 'bad bunny', 'rauw alejandro', 'aitana']
        : seedCulture === 'phonk'
        ? ['brazilian phonk', 'montagem funk', 'phonk', 'funk paulista']
        : seedCulture === 'italian'
        ? ['rap italiano', 'trap italia', 'sfera ebbasta', 'lazza', 'geolier', 'capo plaza']
        : seedCulture === 'german'
        ? ['deutschrap', 'apache 207', 'luciano', 'raf camora']
        : seedCulture === 'kpop'
        ? ['kpop hits', 'newjeans', 'bts', 'stray kids']
        : seedCulture === 'japanese'
        ? ['jpop hits', 'yoasobi', 'kenshi yonezu']
        : ['pop hits', 'drake', 'travis scott', 'the weeknd'];

      for (const q of emergencyQueries.slice(0, 4)) {
        try {
          const results = await searchTracks(q, 10, 'itunes');
          for (const track of results) {
            if (track && !exploitPool.has(track.id) && !discoverPool.has(track.id)) {
              discoverPool.set(track.id, { track, source: `${seedCulture}_emergency`, baseScore: 70 });
            }
          }
        } catch {}
      }
    }
  }

  // ── 5. FILTRAR POR DURACIÓN Y APLICAR CAP DE ARTISTA ───────────────────────

  // ── 5b. LISTENBRAINZ USER CF (personalised collaborative filtering) ──────────
  // If the user has a ListenBrainz username linked in their profile, fetch their
  // personal CF recommendations (free, no key, user-scoped — not global).
  // For new users with thin history (< 20 plays), also pull LB top artists to
  // seed the cluster engine with real listening signals.
  try {
    let lbUsername: string | null = null;
    if (userId) {
      try {
        const { supabase } = require('./supabaseService');
        if (supabase) {
          const { data: profRow } = await supabase
            .schema('kokomusic')
            .from('koko_profiles')
            .select('lb_username')
            .eq('id', userId)
            .maybeSingle();
          lbUsername = profRow?.lb_username || null;
        }
      } catch { /* ignore */ }
    }

    if (lbUsername) {
      // Fetch personalised CF recs for this specific LB user
      const cfRecs = await getUserCFRecommendations(lbUsername, 8);
      for (const rec of cfRecs) {
        if (!rec.trackName || !rec.artistName) continue;
        try {
          const results = await searchTracks(`${rec.artistName} ${rec.trackName}`, 1, 'itunes');
          const t = results?.[0];
          if (t && !discoverPool.has(t.id)) {
            discoverPool.set(t.id, { track: t, source: 'listenbrainz_cf', baseScore: 72 });
          }
        } catch { /* ignore individual resolution failures */ }
      }

      // For thin-history users, also pull their LB top artists to warm the cluster engine
      if (totalPlays < 20 && artistPlayCounts.size < 5) {
        const lbArtists = await getUserTopArtists(lbUsername, 'month');
        console.log(`[Recs] ListenBrainz top artists for '${lbUsername}': ${lbArtists.slice(0, 5).join(', ')}`);
        // Enrich discover pool from LB artist affinity
        for (const artistName of lbArtists.slice(0, 6)) {
          try {
            const hits = await searchTracks(`${artistName} hits`, 2, 'itunes');
            for (const t of hits) {
              if (t && !discoverPool.has(t.id)) {
                discoverPool.set(t.id, { track: t, source: 'listenbrainz_artist', baseScore: 60 });
              }
            }
          } catch { /* ignore */ }
        }
      }
    }
  } catch (err) {
    console.error('[Recs] ListenBrainz CF layer error:', err);
  }

  // ── 4c. SUPABASE DB BACKFILL (GUARANTEE NON-EMPTY CANDIDATE POOL) ────────────
  if (discoverPool.size < 10) {
    try {
      const { supabase } = require('./supabaseService');
      if (supabase) {
        let query = supabase.schema('kokomusic').from('tracks_meta').select('id, title, artist, album, cover, duration_ms, genre').limit(50);
        if (seedCulture === 'french') {
          query = query.or('genre.ilike.%rap%,artist.ilike.%ninho%,artist.ilike.%gims%,artist.ilike.%jul%,artist.ilike.%pnl%,artist.ilike.%tayc%');
        } else if (seedCulture === 'latin' || seedCulture === 'mexican') {
          query = query.or('genre.ilike.%reggaeton%,genre.ilike.%latin%,artist.ilike.%bad bunny%,artist.ilike.%quevedo%');
        }
        const { data: dbRows } = await query;
        if (dbRows && dbRows.length > 0) {
          for (const row of dbRows) {
            if (!exploitPool.has(row.id) && !discoverPool.has(row.id)) {
              discoverPool.set(row.id, {
                track: {
                  id: row.id,
                  title: row.title,
                  artist: row.artist,
                  album: row.album || '',
                  cover: row.cover || '',
                  duration: row.duration_ms || 180000,
                  genre: row.genre || 'Music',
                  itunesId: parseInt(row.id, 10) || 0,
                  artistId: 0,
                  releaseDate: '',
                  popularity: 50,
                  preview_url: null,
                },
                source: 'db_fallback',
                baseScore: 35,
              });
            }
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Remove tracks that are too long (>7 min) from both pools
  for (const [id, c] of exploitPool.entries()) {
    if (c.track.duration && c.track.duration > 420000) exploitPool.delete(id);
  }
  for (const [id, c] of discoverPool.entries()) {
    if (c.track.duration && c.track.duration > 420000) discoverPool.delete(id);
  }

  const exploitList = applyArtistCap([...exploitPool.values()], limit, 0.20);
  const discoverList = applyArtistCap([...discoverPool.values()], limit, 0.25);

  // Remove seed from both pools
  const allCandidates = [
    ...exploitList.slice(0, Math.ceil(exploitationSlots * 1.5)),
    ...discoverList.slice(0, Math.ceil(discoverySlots * 1.5)),
  ].filter(c => c.track.id !== seedTrackId);

  // ── 6. EVALUACIÓN DE CACHÉ (LOCAL / CDN) ─────────────────────────────────

  const checkResults = await Promise.all(
    allCandidates.map(async (c) => {
      const isLocal = audioExists(c.track.id);
      let isCDN = false;
      if (!isLocal) {
        try { isCDN = await trackExistsInCDN(c.track.id); } catch { /* ignore */ }
      }
      return { id: c.track.id, isLocal, isCDN };
    })
  );
  const cacheMap = new Map(checkResults.map(r => [r.id, r]));

  // ── 7. SCORING ANTI-SESGO & COOLDOWNS ─────────────────────────────────────

  const seen = new Set<string>(history.map(h => h.trackId));
  const artistLastPlayed = new Map<string, string>();
  history.forEach(h => {
    if (h.artist && h.lastPlayed) {
      const norm = h.artist.toLowerCase().trim();
      const existing = artistLastPlayed.get(norm);
      if (!existing || new Date(h.lastPlayed) > new Date(existing)) {
        artistLastPlayed.set(norm, h.lastPlayed);
      }
    }
  });

  const scoredCandidates = allCandidates.map(c => {
    const track = c.track;
    const playCount    = trackPlayCounts.get(track.id) || 0;
    const artistNorm   = track.artist.toLowerCase().trim();
    const artistPlays  = artistPlayCounts.get(artistNorm) || 0;

    // Sub-linear history score: kept intentionally LOW for individual tracks.
    // We don't want to replay the same songs — history is used to infer TASTE, not create loops.
    // The artist affinity and genre affinity signals below do the real taste-driven work.
    const rawHistoryScore = Math.min(playCount * 0.5, 5);

    // USER ARTIST TASTE SIGNAL — normalized relative to user's overall artist distribution.
    // DIVERSITY GUARD: If user has < 3 distinct artists in history, cap bonus at +45
    // so a single early artist doesn't create a 100% single-artist monopoly loop.
    // When history is rich (3+ artists), scale 0 → +90 based on relative rank (artistPlays / maxArtistPlays).
    let favoriteArtistBonus = 0;
    if (artistPlays > 0) {
      if (numUniqueArtists < 3) {
        favoriteArtistBonus = Math.min(45, Math.round(45 * (artistPlays / maxArtistPlays)));
      } else {
        favoriteArtistBonus = Math.round(90 * (artistPlays / maxArtistPlays));
      }
    }

    // SPOTIFY NOVELTY & TRENDING DISCOVERY BOOSTS:
    // 1. Novelty bonus for new, never-heard tracks
    const noveltyBonus = !seen.has(track.id) ? 150 : 0;

    // 2. Recent release bonus (2025-2026 releases)
    let recentReleaseBonus = 0;
    if (track.releaseDate && (track.releaseDate.includes('2025') || track.releaseDate.includes('2026'))) {
      recentReleaseBonus = 80;
    }

    // 3. GENRE TASTE AFFINITY from history:
    // If the candidate's genre matches a genre the user frequently listens to, reward it.
    // This makes history drive genre-level discovery without causing song-level replays.
    let historyGenreBonus = 0;
    const trackGenreForAffinity = (track.genre || '').toLowerCase().trim();
    if (trackGenreForAffinity && genrePlayCounts.size > 0) {
      const genrePlaysForTrack = genrePlayCounts.get(trackGenreForAffinity) || 0;
      if (genrePlaysForTrack > 0) {
        // Scale 0→+80 based on how dominant this genre is in the user's history
        historyGenreBonus = Math.round(80 * (genrePlaysForTrack / maxGenrePlays));
      }
    }

    // ANTI-LOOP FIX: CDN/local cache is a mild penalty, NOT a bonus.
    const cacheInfo = cacheMap.get(track.id);
    const cacheBonus = cacheInfo?.isLocal ? -15 : cacheInfo?.isCDN ? -8 : +12;

    // GENRE & CULTURE COHERENCE: When a seed is active, enforce genre & language culture matching.
    let genreCoherenceScore = 0;
    if (seedGenre && c.source !== 'seed_similarity') {
      const trackGenreNorm = (track.genre || '').toLowerCase().trim();
      const seedGenreNorm = seedGenre.toLowerCase().trim();
      const tagMatch = seedTags.some(tag => trackGenreNorm.includes(tag.toLowerCase()) || tag.toLowerCase().includes(trackGenreNorm));
      if (trackGenreNorm === seedGenreNorm || tagMatch) {
        genreCoherenceScore = +60;
      } else if (trackGenreNorm && seedGenreNorm && trackGenreNorm !== seedGenreNorm) {
        genreCoherenceScore = -80;
      }
    }

    const candTags = getTagsForTrack(track.id);
    const candCulture = detectTrackCulture(track.artist, track.title, track.genre || '', candTags);
    let cultureCoherenceScore = 0;

    // Culture strictness option (user-defined or auto)
    const strictness = algoOptions?.cultureStrictness ?? 'strict';
    if (seedCulture !== 'other' && strictness !== 'off') {
      if (candCulture === seedCulture) {
        // Strong reward for matching seed language/culture (e.g. Latin under Latin seed)
        cultureCoherenceScore = +250;
      } else if (candCulture !== seedCulture) {
        if (strictness === 'strict') {
          // Softened penalty (-40 instead of -120): matching culture (+250) is strongly favored,
          // but non-matching candidates remain available if matching candidates are sparse.
          cultureCoherenceScore = -40;
        } else {
          cultureCoherenceScore = -20;
        }
      }
    }

    // Overall Listens Metric (Last.fm listener count log-scaled 0-100) — respects custom popularity weight option
    const popWeightFactor = algoOptions?.popularityWeight === 'high' ? 0.6 : algoOptions?.popularityWeight === 'low' ? 0.1 : 0.25;
    const maxPopBonus = algoOptions?.popularityWeight === 'high' ? 50 : algoOptions?.popularityWeight === 'low' ? 10 : 25;
    const organicPop = getPopularityScore(track.id);
    const organicPopularityBonus = Math.min(maxPopBonus, Math.round(organicPop * popWeightFactor));

    // Mild trending track boost (relative tie-breaker, not a dictatorial score override)
    const isTrendingTrack = trendTracks.some(t => t.id === track.id || normalizeStr(`${t.title}-${t.artist}`) === normalizeStr(`${track.title}-${track.artist}`));
    const trendingTrackBonus = isTrendingTrack && (!seedGenre || genreCoherenceScore >= 0) ? 15 : 0;

    // Trending genre boost — suppressed when genre mismatch under seed
    const isTrendingGenre = trendGenres.some(g => g.toLowerCase().trim() === track.genre?.toLowerCase().trim());
    const trendingGenreBonus = isTrendingGenre && (!seedGenre || genreCoherenceScore >= 0) ? 20 : 0;

    // HARD EXCLUSION: If track is already in active queue session, eliminate completely
    if (hardExcludeSet.has(track.id.toLowerCase().trim()) || hardExcludeSet.has(normalizeStr(`${track.title}-${track.artist}`))) {
      return { track, score: -99999, source: c.source };
    }

    // Real-time Track Recency Penalty (Cooldown)
    const historyEntry = history.find(h => h.trackId === track.id);
    let trackRecencyPenalty = 0;
    if (historyEntry && historyEntry.lastPlayed) {
      const elapsedMs = Date.now() - new Date(historyEntry.lastPlayed).getTime();
      const elapsedHours = elapsedMs / (1000 * 60 * 60);
      if (elapsedHours < 2) trackRecencyPenalty = -2000;
      else if (elapsedHours < 12) trackRecencyPenalty = -800;
      else if (elapsedHours < 24) trackRecencyPenalty = -400;
      else if (elapsedHours < 72) trackRecencyPenalty = -150;
      else if (elapsedHours < 168) trackRecencyPenalty = -50;
    }

    // Real-time Artist Recency Penalty (Cooldown)
    const lastArtistPlayed = artistLastPlayed.get(artistNorm);
    let artistRecencyPenalty = 0;
    // DO NOT penalize the active seed artist! User explicitly requested content related to this seed artist.
    const isSeedArtist = seedArtistName && (artistNorm.includes(seedArtistName.toLowerCase().trim()) || seedArtistName.toLowerCase().trim().includes(artistNorm));
    if (lastArtistPlayed && !isSeedArtist) {
      const elapsedMs = Date.now() - new Date(lastArtistPlayed).getTime();
      const elapsedHours = elapsedMs / (1000 * 60 * 60);
      if (elapsedHours < 0.5) artistRecencyPenalty = -500;
      else if (elapsedHours < 2) artistRecencyPenalty = -250;
      else if (elapsedHours < 8) artistRecencyPenalty = -100;
      else if (elapsedHours < 24) artistRecencyPenalty = -50;
    }

    // Early-skip penalty: user bailed on this track in < 10s — downrank it significantly
    const earlySkipPenalty = earlySkipSet.has(c.track.id.toLowerCase().trim()) ? -300 : 0;

    const totalScore = c.baseScore + rawHistoryScore + favoriteArtistBonus + historyGenreBonus + organicPopularityBonus + noveltyBonus + recentReleaseBonus + cacheBonus + genreCoherenceScore + cultureCoherenceScore + trendingTrackBonus + trendingGenreBonus + trackRecencyPenalty + artistRecencyPenalty + earlySkipPenalty;

    // Calibrated jitter: ±15% — enough variety without chaos
    const jitter = 0.85 + Math.random() * 0.30;

    return { track, score: totalScore * jitter, source: c.source };
  });

  // ── 8. SORT, DEDUPLICATE, RETURN (with hard discovery guarantee) ─────────────

  // Filter out hard-excluded tracks (-99999) first
  let validScoredCandidates = scoredCandidates.filter(sc => sc.score > 0);
  if (validScoredCandidates.length < limit) {
    // If strict positive scoring yielded fewer candidates than limit, allow valid candidates above -5000
    validScoredCandidates = scoredCandidates.filter(sc => sc.score > -5000);
  }

  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();

  // Add titles of effective seeds to seenTitles so we NEVER recommend a track with the same title as currently playing track!
  for (const seedId of effectiveSeeds) {
    getTrackById(seedId).then(t => {
      if (t?.title) seenTitles.add(cleanTrackTitle(t.title));
    }).catch(() => {});
  }

  const deduplicated = validScoredCandidates
    .sort((a, b) => b.score - a.score)
    .filter(sc => {
      if (seenIds.has(sc.track.id)) return false;
      const cleanTitle = cleanTrackTitle(sc.track.title);
      // HARD TITLE DEDUPLICATION: Prevent duplicate song titles in the same recommendation batch!
      if (cleanTitle && seenTitles.has(cleanTitle)) return false;
      seenIds.add(sc.track.id);
      if (cleanTitle) seenTitles.add(cleanTitle);
      return true;
    });

  const validCandidates = deduplicated;

  // ANTI-LOOP FIX: Hard-exclude tracks played in the last 7 days from the final output.
  const withoutRecent = validCandidates.filter(sc => !recentlyPlayedIds.has(sc.track.id));
  const recentAsBackfill = validCandidates.filter(sc => recentlyPlayedIds.has(sc.track.id));

  // Guarantee discovery proportion based on explorationRatio
  const discoveryItems = withoutRecent.filter(sc => !seen.has(sc.track.id));
  const nonDiscoveryItems = withoutRecent.filter(sc => seen.has(sc.track.id));

  const minDiscovery = Math.ceil(limit * 0.40);
  const discoverySlice = discoveryItems.slice(0, Math.max(minDiscovery, Math.ceil(limit * explorationRatio)));
  const remainingSlots = limit - discoverySlice.length;
  const nonDiscoverySlice = nonDiscoveryItems.slice(0, remainingSlots);

  // Interleave: 1 discovery per 2 non-discovery for natural feel, with a HARD ARTIST CAP (user configurable)
  const maxPerArtistInOutput = algoOptions?.maxArtistTracks ?? Math.max(2, Math.floor(limit * 0.25));
  const outputArtistCount = new Map<string, number>();

  const canAddTrack = (track: TrackMetadata) => {
    const normArt = track.artist.toLowerCase().trim();
    const count = outputArtistCount.get(normArt) || 0;
    return count < maxPerArtistInOutput;
  };

  const addTrack = (sc: typeof deduplicated[0]) => {
    const normArt = sc.track.artist.toLowerCase().trim();
    outputArtistCount.set(normArt, (outputArtistCount.get(normArt) || 0) + 1);
    interleaved.push(sc);
  };

  const interleaved: typeof deduplicated = [];
  const dIter = discoverySlice[Symbol.iterator]();
  const nIter = nonDiscoverySlice[Symbol.iterator]();
  let dDone = false;
  let nDone = false;
  while (interleaved.length < limit) {
    if (!dDone) {
      const d = dIter.next();
      if (!d.done) {
        if (canAddTrack(d.value.track)) addTrack(d.value);
      } else dDone = true;
    }
    if (interleaved.length >= limit) break;
    if (!nDone) {
      // Add up to 2 non-discovery per 1 discovery
      for (let i = 0; i < 2 && interleaved.length < limit; i++) {
        const n = nIter.next();
        if (!n.done) {
          if (canAddTrack(n.value.track)) addTrack(n.value);
        } else { nDone = true; break; }
      }
    }
    if (dDone && nDone) break;
  }

  // If still short, backfill with recently-played tracks (last resort) ONLY IF NOT in active session/queue
  if (interleaved.length < limit) {
    const sessionAndQueueExclude = new Set<string>([
      ...effectiveSeeds,
      ...(excludeTrackIds || [])
    ].map(id => id.toLowerCase().trim()));

    for (const sc of recentAsBackfill) {
      if (!sessionAndQueueExclude.has(sc.track.id.toLowerCase().trim())) {
        interleaved.push(sc);
      }
      if (interleaved.length >= limit) break;
    }
  }

  let finalRecs = interleaved.map(sc => sc.track).slice(0, limit);

  // Debug log top candidates and final recommendations (ONLY valid candidates with score > 0)
  console.log(`[Recs] --- SCORING HIGHLIGHTS (Top Valid Pool: ${deduplicated.length}) ---`);
  deduplicated.slice(0, 8).forEach((sc, i) => {
    const cult = detectTrackCulture(sc.track.artist, sc.track.title, sc.track.genre || '', getTagsForTrack(sc.track.id));
    console.log(`[Recs] #${i + 1} Score: ${sc.score.toFixed(1).padStart(6)} | Culture: ${cult.toUpperCase().padEnd(7)} | Source: ${sc.source.padEnd(16)} | "${sc.track.artist} - ${sc.track.title}"`);
  });

  // DYNAMIC FALLBACK GUARANTEE: If recommendations are empty, sample randomly from Spotify history
  // + trending, always respecting the full hardExcludeSet and seedCulture to prevent language flips.
  if (finalRecs.length === 0) {
    try {
      // Fallback history is also user-scoped — do NOT pull Koko's history for other users
      const allHistory = readHistory().filter(h => {
        if (!userId) return !h.userId;
        return h.userId === userId;
      });
      // If no user-scoped history, allow untagged entries as a neutral global pool
      const scopedHistory = allHistory.length > 0 ? allHistory : readHistory().filter(h => !h.userId);
      const trendTracks = await getTrendingTracks('spain');
      const candidatePool: TrackMetadata[] = [];

      // Add trending tracks first (genre-diverse, not history-biased)
      candidatePool.push(...trendTracks);

      // Then add history tracks, shuffled to avoid popularity-order bias
      const shuffledHistory = [...scopedHistory].sort(() => Math.random() - 0.5);
      shuffledHistory.forEach(h => {
        if (h.trackId && h.title && h.artist) {
          candidatePool.push({
            id: h.trackId,
            itunesId: 0,
            artistId: 0,
            title: h.title,
            artist: h.artist,
            album: 'Spotify History',
            cover: h.cover || '',
            duration: 180000,
            genre: 'Pop / Urbano',
            releaseDate: null,
            popularity: 50,
            preview_url: null,
          });
        }
      });

      // Multi-pass Fallback Sampling: Guarantee non-empty recommendations
      // Pass 1: Strict culture matching + exclude recently played
      // Pass 2: Relax culture filter if Pass 1 yields insufficient candidates
      // Pass 3: Allow recently played as absolute last resort if pool is still empty
      const sampleFallbackCandidates = (enforceCulture: boolean, excludeRecent: boolean): TrackMetadata[] => {
        const seenFallback = new Set<string>();
        return candidatePool
          .filter(t => {
            if (!t || !t.id) return false;
            const normId = t.id.toLowerCase().trim();
            if (hardExcludeSet.has(normId)) return false;
            if (excludeRecent && recentlyPlayedIds.has(t.id)) return false;
            if (seenFallback.has(normId)) return false;

            if (enforceCulture && seedCulture !== 'other') {
              const fallbackCulture = detectTrackCulture(t.artist, t.title, t.genre || '');
              if (fallbackCulture !== seedCulture && fallbackCulture !== 'other') return false;
            }

            seenFallback.add(normId);
            return true;
          })
          .sort(() => Math.random() - 0.5);
      };

      let freshCandidates = sampleFallbackCandidates(true, true);
      if (freshCandidates.length < limit && seedCulture !== 'other') {
        console.log(`[Recs] Dynamic fallback sampling: Culture filter (${seedCulture}) yielded only ${freshCandidates.length}/${limit} candidates. Fallback broadening search...`);
        const relaxedCultureCandidates = sampleFallbackCandidates(false, true);
        if (relaxedCultureCandidates.length > freshCandidates.length) {
          freshCandidates = relaxedCultureCandidates;
        }
      }

      if (freshCandidates.length < limit) {
        console.log(`[Recs] Dynamic fallback sampling: Fresh pool short (${freshCandidates.length}/${limit}). Backfilling with recent history items.`);
        const relaxedRecentCandidates = sampleFallbackCandidates(false, false);
        if (relaxedRecentCandidates.length > freshCandidates.length) {
          freshCandidates = relaxedRecentCandidates;
        }
      }

      finalRecs = freshCandidates.slice(0, limit);
      console.log(`[Recs] Dynamic fallback sampling: ${finalRecs.length} tracks selected from ${candidatePool.length} candidates`);
    } catch (err) {
      console.error('[Recs] Error in dynamic fallback sampling:', err);
    }
  }

  console.log(`[Recs] --- FINAL SELECTED RECOMMENDATIONS (${finalRecs.length}) ---`);
  finalRecs.forEach((t, i) => {
    const cult = detectTrackCulture(t.artist, t.title, t.genre || '', getTagsForTrack(t.id));
    console.log(`[Recs]   [${i + 1}] "${t.artist} - ${t.title}" | Genre: ${t.genre || 'N/A'} | Culture: ${cult.toUpperCase()}`);
  });
  console.log(`[Recs] ==================================================================\n`);

  // Cache TTL: 60s — fresh enough that new plays update recs quickly without hammering APIs.
  cache.setex(cacheKey, 60, JSON.stringify(finalRecs));
  return finalRecs;
}
