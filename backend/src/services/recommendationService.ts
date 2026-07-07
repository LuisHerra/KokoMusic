import { cache } from './cacheService';
import { searchTracks, getTrackById, type TrackMetadata } from './metadataService';
import { readHistory, type HistoryEntry } from './historyService';
import { audioExists } from './ytdlpService';
import { trackExistsInCDN } from './cdnService';
import { getTrendingTracks, getTrendingGenres } from './trendingService';

function normalizeStr(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
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
  if (totalPlays < 20)  return 0.65;  // 65% discovery — cold start
  if (totalPlays < 60)  return 0.50;  // 50% discovery — ramp up
  if (totalPlays < 200) return 0.45;  // 45% discovery — established
  return 0.40;                         // 40% discovery — veteran (hard floor)
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
  return {
    id: h.trackId,
    itunesId: 0,
    artistId: 0,
    title: h.title,
    artist: h.artist,
    album: 'Historial',
    cover: h.cover || '',
    duration: 180000,
    genre: 'Historial',
    releaseDate: null,
    popularity: h.playCount,
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
  seedTrackId?: string
): Promise<TrackMetadata[]> {
  const cacheKey = `recs:${userId || 'global'}:${mood || 'none'}:${seedTrackId || 'none'}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // ── 1. HISTORIAL + PLAY COUNTS ────────────────────────────────────────────

  const history = readHistory().filter(h => !userId || h.userId === userId);
  const trackPlayCounts = new Map<string, number>();
  const artistPlayCounts = new Map<string, number>();
  let totalPlays = 0;

  history.forEach(h => {
    const pc = h.playCount || 1;
    trackPlayCounts.set(h.trackId, (trackPlayCounts.get(h.trackId) || 0) + pc);
    if (h.artist) {
      const norm = h.artist.toLowerCase().trim();
      artistPlayCounts.set(norm, (artistPlayCounts.get(norm) || 0) + pc);
    }
    totalPlays += pc;
  });

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

  // Exploitation vs discovery ratio — ramps with user maturity
  const explorationRatio = getExplorationRatio(totalPlays);
  const exploitationSlots = Math.floor(limit * (1 - explorationRatio));
  const discoverySlots    = limit - exploitationSlots;

  const exploitPool = new Map<string, { track: TrackMetadata; source: string; baseScore: number }>();
  const discoverPool = new Map<string, { track: TrackMetadata; source: string; baseScore: number }>();

  // ── 2. CAPA SEMILLA ───────────────────────────────────────────────────────
  // When a seed track is provided, its genre defines the listening context.
  // All subsequent candidate generation and scoring is biased toward that genre.

  let seedGenre: string | null = null;
  let seedArtistName: string | null = null;
  let seedTags: string[] = [];   // Last.fm genre tags for adjacent-genre search

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

        // Fetch artist tags for genre-aware discovery queries
        seedTags = await fetchLastFmArtistTags(seedTrack.artist, 4);
      }
    } catch {
      // ignore seed errors
    }
  }

  // ── 3. CAPA HISTORIAL Y PERFIL DE GUSTOS (exploitation) ─────────────────────
  // ANTI-LOOP FIX: History tracks are NO LONGER added as exploit candidates.
  // They are only used to build the seenTrackIds exclusion set (below) and to
  // derive similar-artist queries. Adding them directly caused over-listened
  // songs to dominate the recommendation pool via their accumulated playCount score.

  // Build exclusion set: tracks played in the last 7 days are hard-excluded from candidates.
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentlyPlayedIds = new Set<string>(
    history
      .filter(h => h.lastPlayed && new Date(h.lastPlayed).getTime() > sevenDaysAgo)
      .map(h => h.trackId)
  );

  try {
    // GENRE COHERENCE: When a seed is active, skip the taste-profile artist pool entirely.
    // The seed's Last.fm similar tracks already cover exploitation — mixing the user's
    // reggaeton artists into a Coldplay session is exactly the bug we're fixing.
    if (!seedTrackId && history.length > 0) {

      // Artistas similares a los tops del usuario
      const topArtists = [...artistPlayCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([a]) => a);

      if (topArtists.length > 0) {
        // Elegir un artista distinto en cada llamada para variedad
        const randomArtist = topArtists[Math.floor(Math.random() * topArtists.length)];
        const similarArtists = await fetchLastFmSimilarArtists(randomArtist, 5);
        if (similarArtists.length > 0) {
          const pools = await Promise.all(
            similarArtists.map(a => searchTracks(`${a} top hits`, 3, 'itunes'))
          );
          for (const pool of pools) {
            for (const track of pool) {
              if (track && !exploitPool.has(track.id)) {
                exploitPool.set(track.id, { track, source: 'artist_similarity', baseScore: 55 });
              }
            }
          }
        }
      }
    } else if (!seedTrackId && tasteProfile) {
      // Si no hay historial pero sí hay perfil inicial (onboarding / Koko pre-seeded)
      const topArtists = (tasteProfile.topArtists || []).map((a: any) => a.name);

      if (topArtists.length > 0) {
        // 1. Buscar temas populares de los artistas seleccionados
        const shuffledArtists = [...topArtists].sort(() => Math.random() - 0.5);
        const chosenArtists = shuffledArtists.slice(0, 4);

        const pools = await Promise.all(
          chosenArtists.map(a => searchTracks(`${a} top hits`, 3, 'itunes').catch(() => []))
        );

        for (const pool of pools) {
          for (const track of pool) {
            if (track && !exploitPool.has(track.id)) {
              exploitPool.set(track.id, { track, source: 'seeded_artist', baseScore: 85 });
            }
          }
        }

        // 2. Traer artistas similares al artista principal del perfil
        const randomArtist = topArtists[0];
        const similarArtists = await fetchLastFmSimilarArtists(randomArtist, 5);
        if (similarArtists.length > 0) {
          const similarPools = await Promise.all(
            similarArtists.map(a => searchTracks(`${a} top hits`, 3, 'itunes').catch(() => []))
          );
          for (const pool of similarPools) {
            for (const track of pool) {
              if (track && !exploitPool.has(track.id)) {
                exploitPool.set(track.id, { track, source: 'artist_similarity', baseScore: 65 });
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[Recs] Error populating exploitation from history/profile:', err);
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

  const trendTracks = await getTrendingTracks();
  const trendGenres = await getTrendingGenres();

  // Inject trending tracks as discovery candidates only when genre-compatible
  for (const track of trendTracks) {
    if (exploitPool.has(track.id) || discoverPool.has(track.id)) continue;
    // When seed is active: only inject trending if genre matches seed
    if (seedGenre && track.genre && track.genre.toLowerCase() !== seedGenre.toLowerCase()) continue;
    discoverPool.set(track.id, { track, source: 'trending', baseScore: 40 });
  }

  const activeMood = mood?.toLowerCase();
  const moodWords = (activeMood && moodKeywords[activeMood]) ? moodKeywords[activeMood] : [];

  // Discovery queries pool — seed mode uses genre-coherent queries only
  let discoveryPool: string[];
  if (seedTrackId) {
    // Seed mode: only genre/artist-adjacent queries, no global trending
    discoveryPool = [
      ...moodWords,
      ...adjacentKeywords,
    ];
  } else {
    const trendGenreQueries = trendGenres.slice(0, 3).map(g => `${g} hits`);
    const globalDiscovery = ['trending hits 2025', 'new music releases', 'viral songs 2025', 'top charts global'];
    discoveryPool = [
      ...moodWords,
      ...adjacentKeywords,
      ...trendGenreQueries,
      ...globalDiscovery,
    ];
  }

  // Pick 2-3 different queries to get a varied discovery set
  const shuffled = [...discoveryPool].sort(() => Math.random() - 0.5);
  const chosenQueries = shuffled.slice(0, Math.min(3, shuffled.length));

  try {
    const searchResults = await Promise.all(
      chosenQueries.map(q => searchTracks(q, Math.ceil(discoverySlots * 2), 'itunes'))
    );
    for (const results of searchResults) {
      for (const track of results) {
        if (track && !exploitPool.has(track.id) && !discoverPool.has(track.id)) {
          discoverPool.set(track.id, { track, source: 'discovery', baseScore: 30 });
        }
      }
    }
  } catch {
    // ignore
  }

  // ── 5. APLICAR CAP DE ARTISTA ANTES DE SCORING ───────────────────────────

  const exploitList = applyArtistCap([...exploitPool.values()], limit, 0.20);
  const discoverList = applyArtistCap([...discoverPool.values()], limit, 0.25); // discovery puede ser más repetitivo por chartsigma

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

    // Sub-linear history score (capped) to prevent infinite loop of over-listened tracks
    const rawHistoryScore = Math.min(playCount * 2, 15) + Math.min(artistPlays * 1.5, 15);

    // ANTI-LOOP FIX: Novelty bonus is significantly higher to decisively beat history scores.
    const noveltyBonus = !seen.has(track.id) ? 80 : 0;

    // ANTI-LOOP FIX: CDN/local cache is now a mild penalty, NOT a bonus.
    const cacheInfo = cacheMap.get(track.id);
    const cacheBonus = cacheInfo?.isLocal ? -15 : cacheInfo?.isCDN ? -8 : +12;

    // GENRE COHERENCE: When a seed is active, enforce genre matching.
    // This is the most critical fix — it prevents reggaeton after Coldplay.
    // seed_similarity tracks are already genre-accurate (from Last.fm), so they skip this.
    let genreCoherenceScore = 0;
    if (seedGenre && c.source !== 'seed_similarity') {
      const trackGenreNorm = (track.genre || '').toLowerCase().trim();
      const seedGenreNorm = seedGenre.toLowerCase().trim();
      // Check against seed tags too for adjacent genres (e.g., 'britpop' matches 'rock')
      const tagMatch = seedTags.some(tag => trackGenreNorm.includes(tag.toLowerCase()) || tag.toLowerCase().includes(trackGenreNorm));
      if (trackGenreNorm === seedGenreNorm || tagMatch) {
        genreCoherenceScore = +60; // Strong boost for genre match
      } else if (trackGenreNorm && seedGenreNorm && trackGenreNorm !== seedGenreNorm) {
        genreCoherenceScore = -80; // Strong penalty for genre mismatch
      }
    }

    // Trending track boost (global / local trends)
    const isTrendingTrack = trendTracks.some(t => t.id === track.id || normalizeStr(`${t.title}-${t.artist}`) === normalizeStr(`${track.title}-${track.artist}`));
    // When seed is active, only apply trending boost if genre matches
    const trendingTrackBonus = isTrendingTrack && (!seedGenre || genreCoherenceScore >= 0) ? 30 : 0;

    // Trending genre boost — suppressed when genre mismatch under seed
    const isTrendingGenre = trendGenres.some(g => g.toLowerCase().trim() === track.genre?.toLowerCase().trim());
    const trendingGenreBonus = isTrendingGenre && (!seedGenre || genreCoherenceScore >= 0) ? 15 : 0;

    // Real-time Track Recency Penalty (Cooldown)
    const historyEntry = history.find(h => h.trackId === track.id);
    let trackRecencyPenalty = 0;
    if (historyEntry && historyEntry.lastPlayed) {
      const elapsedMs = Date.now() - new Date(historyEntry.lastPlayed).getTime();
      const elapsedHours = elapsedMs / (1000 * 60 * 60);
      if (elapsedHours < 2) trackRecencyPenalty = -1000;      // Played in last 2h -> exclude completely
      else if (elapsedHours < 12) trackRecencyPenalty = -400; // Played in last 12h -> heavy cooldown
      else if (elapsedHours < 24) trackRecencyPenalty = -200; // Played in last 24h -> medium cooldown
      else if (elapsedHours < 72) trackRecencyPenalty = -80;  // Played in last 3 days -> minor cooldown
      else if (elapsedHours < 168) trackRecencyPenalty = -40; // Played in last 7 days -> tiny cooldown
    }

    // Real-time Artist Recency Penalty (Cooldown)
    const lastArtistPlayed = artistLastPlayed.get(artistNorm);
    let artistRecencyPenalty = 0;
    if (lastArtistPlayed) {
      const elapsedMs = Date.now() - new Date(lastArtistPlayed).getTime();
      const elapsedHours = elapsedMs / (1000 * 60 * 60);
      if (elapsedHours < 0.5) artistRecencyPenalty = -250; // Played in last 30 mins -> major artist penalty
      else if (elapsedHours < 2) artistRecencyPenalty = -120;
      else if (elapsedHours < 8) artistRecencyPenalty = -60;
      else if (elapsedHours < 24) artistRecencyPenalty = -30;
    }

    const totalScore = c.baseScore + rawHistoryScore + noveltyBonus + cacheBonus + genreCoherenceScore + trendingTrackBonus + trendingGenreBonus + trackRecencyPenalty + artistRecencyPenalty;

    // Calibrated jitter: ±15% — enough variety without chaos
    const jitter = 0.85 + Math.random() * 0.30;

    return { track, score: totalScore * jitter, source: c.source };
  });

  // ── 8. SORT, DEDUPLICATE, RETURN (with hard discovery guarantee) ─────────────

  const seenIds = new Set<string>();
  const deduplicated = scoredCandidates
    .sort((a, b) => b.score - a.score)
    .filter(sc => {
      if (seenIds.has(sc.track.id)) return false;
      seenIds.add(sc.track.id);
      return true;
    });

  // ANTI-LOOP FIX: Hard-exclude tracks played in the last 7 days from the final output.
  const withoutRecent = deduplicated.filter(sc => !recentlyPlayedIds.has(sc.track.id));
  const recentAsBackfill = deduplicated.filter(sc => recentlyPlayedIds.has(sc.track.id));

  // Guarantee at least 40% of results are genuine discoveries (never heard before).
  const discoveryItems = withoutRecent.filter(sc => !seen.has(sc.track.id));
  const nonDiscoveryItems = withoutRecent.filter(sc => seen.has(sc.track.id));

  const minDiscovery = Math.ceil(limit * 0.40);
  const discoverySlice = discoveryItems.slice(0, Math.max(minDiscovery, Math.ceil(limit * explorationRatio)));
  const remainingSlots = limit - discoverySlice.length;
  const nonDiscoverySlice = nonDiscoveryItems.slice(0, remainingSlots);

  // Interleave: 1 discovery per 2 non-discovery for natural feel
  const interleaved: typeof deduplicated = [];
  const dIter = discoverySlice[Symbol.iterator]();
  const nIter = nonDiscoverySlice[Symbol.iterator]();
  let dDone = false;
  let nDone = false;
  while (interleaved.length < limit) {
    if (!dDone) {
      const d = dIter.next();
      if (!d.done) interleaved.push(d.value); else dDone = true;
    }
    if (interleaved.length >= limit) break;
    if (!nDone) {
      // Add up to 2 non-discovery per 1 discovery
      for (let i = 0; i < 2 && interleaved.length < limit; i++) {
        const n = nIter.next();
        if (!n.done) { interleaved.push(n.value); } else { nDone = true; break; }
      }
    }
    if (dDone && nDone) break;
  }

  // If still short, backfill with recently-played tracks (last resort)
  if (interleaved.length < limit) {
    for (const sc of recentAsBackfill) {
      interleaved.push(sc);
      if (interleaved.length >= limit) break;
    }
  }

  const finalRecs = interleaved.map(sc => sc.track).slice(0, limit);

  // ANTI-LOOP FIX: Cache TTL reduced to 3 minutes so fresh plays invalidate recs faster.
  cache.setex(cacheKey, 180, JSON.stringify(finalRecs));
  return finalRecs;
}
