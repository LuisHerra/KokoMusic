import { cache } from './cacheService';
import { searchTracks, getTrackById, type TrackMetadata } from './metadataService';
import { readHistory, type HistoryEntry } from './historyService';
import { audioExists } from './ytdlpService';
import { trackExistsInCDN } from './cdnService';

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

function getExplorationRatio(totalPlays: number): number {
  if (totalPlays < 20)  return 0.60;  // 60% discovery — cold start
  if (totalPlays < 60)  return 0.40;  // 40% discovery — ramp up
  if (totalPlays < 200) return 0.30;  // 30% discovery — established
  return 0.20;                         // 20% discovery — veteran
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

  if (seedTrackId) {
    try {
      const seedTrack = await getTrackById(seedTrackId);
      if (seedTrack) {
        const similarList = await fetchLastFmSimilar(seedTrack.artist, seedTrack.title, 15);
        if (similarList.length > 0) {
          const resolved = await Promise.all(similarList.map(t => resolveSimilarTrack(t.artist.name, t.name)));
          for (const track of resolved) {
            if (track && track.id !== seedTrackId) {
              exploitPool.set(track.id, { track, source: 'seed_similarity', baseScore: 90 });
            }
          }
        }
      }
    } catch {
      // ignore seed errors
    }
  }

  // ── 3. CAPA HISTORIAL Y PERFIL DE GUSTOS (exploitation) ─────────────────────

  try {
    if (history.length > 0) {
      // Añadir tops del historial pero solo si tenemos suficientes plays
      // Para usuarios nuevos (pocos plays) reducimos el peso del historial.
      const topHistory = [...history]
        .sort((a, b) => (b.playCount || 1) - (a.playCount || 1))
        .slice(0, Math.min(8, Math.ceil(exploitationSlots * 1.5)));

      for (const h of topHistory) {
        const track = historyTrackToMetadata(h);
        if (!exploitPool.has(track.id)) {
          exploitPool.set(track.id, { track, source: 'user_history', baseScore: 70 });
        }
      }

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
    } else if (tasteProfile) {
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

  // Adjacent genre exploration — pull tags from user's top artist to broaden search
  let adjacentKeywords: string[] = [];
  try {
    let topArtistForTags = [...artistPlayCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 1)
      .map(([a]) => a)[0];

    if (!topArtistForTags && tasteProfile && tasteProfile.topArtists && tasteProfile.topArtists.length > 0) {
      topArtistForTags = tasteProfile.topArtists[0].name;
    }

    if (topArtistForTags) {
      const tags = await fetchLastFmArtistTags(topArtistForTags, 3);
      adjacentKeywords = tags.map(tag => `${tag} hits new music`);
    }
  } catch {
    // ignore
  }

  const activeMood = mood?.toLowerCase();
  const moodWords = (activeMood && moodKeywords[activeMood]) ? moodKeywords[activeMood] : [];

  // Discovery queries pool (rotating for variety)
  const globalDiscovery = ['trending hits 2025', 'new music releases', 'viral songs 2025', 'top charts global'];
  const discoveryPool = [
    ...moodWords,
    ...adjacentKeywords,
    ...globalDiscovery,
  ];

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

  // ── 7. SCORING ANTI-SESGO ─────────────────────────────────────────────────

  const seen = new Set<string>(history.map(h => h.trackId));

  const scoredCandidates = allCandidates.map(c => {
    const track = c.track;
    const playCount    = trackPlayCounts.get(track.id) || 0;
    const artistNorm   = track.artist.toLowerCase().trim();
    const artistPlays  = artistPlayCounts.get(artistNorm) || 0;

    // History score — capped per-artist to max 60 pts
    // (avoids infinite amplification of over-listened artists)
    const rawHistoryScore = playCount * 15 + Math.min(artistPlays * 3, 45);

    // Novelty bonus: tracks never heard before get +20
    const noveltyBonus = (!seen.has(track.id) && c.source !== 'user_history') ? 20 : 0;

    // Cache bonus — greatly reduced to avoid local bias (was 150/100)
    const cacheInfo = cacheMap.get(track.id);
    const cacheBonus = cacheInfo?.isLocal ? 25 : cacheInfo?.isCDN ? 15 : 0;

    const totalScore = c.baseScore + rawHistoryScore + noveltyBonus + cacheBonus;

    // Calibrated jitter: ±15% (was ±43%) — enough variety without chaos
    const jitter = 0.85 + Math.random() * 0.30;

    return { track, score: totalScore * jitter, source: c.source };
  });

  // ── 8. SORT, DEDUPLICATE, RETURN ──────────────────────────────────────────

  const seenIds = new Set<string>();
  const finalRecs = scoredCandidates
    .sort((a, b) => b.score - a.score)
    .filter(sc => {
      if (seenIds.has(sc.track.id)) return false;
      seenIds.add(sc.track.id);
      return true;
    })
    .map(sc => sc.track)
    .slice(0, limit);

  // Cache 10 minutes
  cache.setex(cacheKey, 600, JSON.stringify(finalRecs));
  return finalRecs;
}
