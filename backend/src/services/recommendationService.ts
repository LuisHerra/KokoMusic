import { cache } from './cacheService';
import { searchTracks, getTrackById, type TrackMetadata } from './metadataService';
import { readHistory, type HistoryEntry } from './historyService';
import { audioExists } from './ytdlpService';
import { trackExistsInCDN } from './cdnService';
import { getTrendingTracks, getTrendingGenres } from './trendingService';
import { getUserRegion } from './regionService';
import { getRegionalTopTracks } from './regionalChartsService';
import { getListenBrainzTopRecordings } from './listenBrainzService';

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
  seedTrackId?: string,
  seedTrackIds?: string[],
  excludeTrackIds?: string[]
): Promise<TrackMetadata[]> {
  const effectiveSeeds = seedTrackIds && seedTrackIds.length > 0 ? seedTrackIds : (seedTrackId ? [seedTrackId] : []);
  const activeSeedId = effectiveSeeds.length > 0 ? effectiveSeeds[effectiveSeeds.length - 1] : undefined;
  const hardExcludeSet = new Set<string>([
    ...effectiveSeeds,
    ...(excludeTrackIds || [])
  ].map(id => id.toLowerCase().trim()));

  const cacheKey = `recs:${userId || 'global'}:${mood || 'none'}:${effectiveSeeds.join('_') || 'none'}:${(excludeTrackIds || []).join('_') || 'none'}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // ── 1. HISTORIAL + PLAY COUNTS ────────────────────────────────────────────

  const history = readHistory().filter(h => !userId || h.userId === userId || h.userId === 'koko' || !h.userId);
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

  if (
    KNOWN_FRENCH_ARTISTS.has(normArtist) ||
    normGenre.includes('french') || normGenre.includes('francais') || normGenre.includes('chanson') ||
    normTags.includes('french') || normTags.includes('francais') || normTags.includes('chanson') || normTags.includes('rap fr') ||
    normTitle.includes('parisienne') || normTitle.includes('impofie')
  ) {
    return 'french';
  }

  if (
    KNOWN_LATIN_ARTISTS.has(normArtist) ||
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
  let seedCulture: 'french' | 'latin' | 'other' = 'other';

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
        seedCulture = detectLanguageAndCulture(seedTrack.artist, seedTrack.title, seedTrack.genre, seedTags);
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
      if (!exploitPool.has(track.id) && !discoverPool.has(track.id)) {
        discoverPool.set(track.id, { track, source: 'french_chart', baseScore: 85 });
      }
    }
  }

  // 1. Inject regional country top chart tracks (iTunes RSS + Last.fm Geo)
  for (const track of regionalChartTracks) {
    if (exploitPool.has(track.id) || discoverPool.has(track.id)) continue;
    if (seedGenre && track.genre && track.genre.toLowerCase() !== seedGenre.toLowerCase()) continue;
    discoverPool.set(track.id, { track, source: 'regional_chart', baseScore: 60 });
  }

  // 2. Inject trending tracks as discovery candidates
  for (const track of trendTracks) {
    if (exploitPool.has(track.id) || discoverPool.has(track.id)) continue;
    if (seedGenre && track.genre && track.genre.toLowerCase() !== seedGenre.toLowerCase()) continue;
    discoverPool.set(track.id, { track, source: 'trending', baseScore: 45 });
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

  // Discovery queries pool — seed mode uses genre-coherent queries only
  let discoveryPool: string[];
  if (seedCulture === 'french') {
    discoveryPool = [
      'rap francais 2026',
      'french pop hits',
      'chanson francaise',
      'french urban vibes',
      'ninho gims tayc hits'
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
          discoverPool.set(track.id, { track, source: 'discovery', baseScore: 35 });
        }
      }
    }
  } catch {
    // ignore
  }

  // ── 5. FILTRAR POR DURACIÓN Y APLICAR CAP DE ARTISTA ───────────────────────
  // Exclude tracks longer than 7 minutes (420,000 ms)
  for (const [id, c] of exploitPool.entries()) {
    if (c.track.duration && c.track.duration > 420000) {
      exploitPool.delete(id);
    }
  }
  for (const [id, c] of discoverPool.entries()) {
    if (c.track.duration && c.track.duration > 420000) {
      discoverPool.delete(id);
    }
  }

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

    // Sub-linear history score (heavily capped to prevent taste-bubble bias)
    const rawHistoryScore = Math.min(playCount * 0.5, 5) + Math.min(artistPlays * 0.5, 5);

    // SPOTIFY NOVELTY & TRENDING DISCOVERY BOOSTS:
    // 1. Novelty bonus for new, never-heard tracks
    const noveltyBonus = !seen.has(track.id) ? 150 : 0;

    // 2. Recent release bonus (2025-2026 releases)
    let recentReleaseBonus = 0;
    if (track.releaseDate && (track.releaseDate.includes('2025') || track.releaseDate.includes('2026'))) {
      recentReleaseBonus = 80;
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

    const candCulture = detectLanguageAndCulture(track.artist, track.title, track.genre);
    let cultureCoherenceScore = 0;
    if (seedCulture !== 'other') {
      if (candCulture === seedCulture) {
        cultureCoherenceScore = +150;
      } else if (candCulture !== 'other' && candCulture !== seedCulture) {
        cultureCoherenceScore = -300;
      }
    }

    // Mild trending track boost (relative tie-breaker, not a dictatorial score override)
    const isTrendingTrack = trendTracks.some(t => t.id === track.id || normalizeStr(`${t.title}-${t.artist}`) === normalizeStr(`${track.title}-${track.artist}`));
    const trendingTrackBonus = isTrendingTrack && (!seedGenre || genreCoherenceScore >= 0) ? 25 : 0;

    // Trending genre boost — suppressed when genre mismatch under seed
    const isTrendingGenre = trendGenres.some(g => g.toLowerCase().trim() === track.genre?.toLowerCase().trim());
    const trendingGenreBonus = isTrendingGenre && (!seedGenre || genreCoherenceScore >= 0) ? 35 : 0;

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
    if (lastArtistPlayed) {
      const elapsedMs = Date.now() - new Date(lastArtistPlayed).getTime();
      const elapsedHours = elapsedMs / (1000 * 60 * 60);
      if (elapsedHours < 0.5) artistRecencyPenalty = -500;
      else if (elapsedHours < 2) artistRecencyPenalty = -250;
      else if (elapsedHours < 8) artistRecencyPenalty = -100;
      else if (elapsedHours < 24) artistRecencyPenalty = -50;
    }

    const totalScore = c.baseScore + rawHistoryScore + noveltyBonus + recentReleaseBonus + cacheBonus + genreCoherenceScore + cultureCoherenceScore + trendingTrackBonus + trendingGenreBonus + trackRecencyPenalty + artistRecencyPenalty;

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

  let finalRecs = interleaved.map(sc => sc.track).slice(0, limit);

  // DYNAMIC FALLBACK GUARANTEE: If recommendations are empty or short, sample dynamically from the 300+ Spotify history tracks & regional trends!
  if (finalRecs.length === 0) {
    try {
      const allHistory = readHistory();
      const trendTracks = await getTrendingTracks('spain');
      const candidatePool: TrackMetadata[] = [];

      allHistory.forEach(h => {
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
            popularity: 80,
            preview_url: null,
          });
        }
      });

      candidatePool.push(...trendTracks);

      // Filter out hard excluded tracks and shuffle
      const freshCandidates = candidatePool
        .filter(t => t && t.id && !hardExcludeSet.has(t.id.toLowerCase().trim()))
        .sort(() => Math.random() - 0.5);

      finalRecs = freshCandidates.slice(0, limit);
    } catch (err) {
      console.error('[Recs] Error in dynamic fallback sampling:', err);
    }
  }

  // ANTI-LOOP FIX: Cache TTL reduced to 3 minutes so fresh plays invalidate recs faster.
  cache.setex(cacheKey, 180, JSON.stringify(finalRecs));
  return finalRecs;
}
