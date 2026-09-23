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
import { normalizeRegionName } from './regionService';
import { isLastfmPlaceholderCover } from './lastfmCoverUtils';

// ── In-Memory Cache (Regionalized) ───────────────────────────────────────────
const cachedTrendingTracksByRegion = new Map<string, TrackMetadata[]>();
const cachedTrendingGenresByRegion = new Map<string, string[]>();
const lastFetchedTimeByRegion = new Map<string, number>();

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
export async function updateTrendingData(region = 'spain'): Promise<void> {
  const normRegion = normalizeRegionName(region);

  if (!supabase) {
    cachedTrendingTracksByRegion.set(normRegion, []);
    cachedTrendingGenresByRegion.set(normRegion, DEFAULT_TRENDING_GENRES);
    lastFetchedTimeByRegion.set(normRegion, Date.now());
    return;
  }

  try {
    console.log(`[Trending] Updating trending tracks and genres for region: ${normRegion}...`);
    const now = Date.now();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Fetch play events from last 14 days
    const { data: plays, error: playsErr } = await supabase
      .schema('kokomusic')
      .from('play_events')
      .select('track_id, title, artist, cover, played_at')
      .gte('played_at', fourteenDaysAgo);

    // 2. Fetch external charts cache for this specific region OR global charts
    const { data: charts, error: chartsErr } = await supabase
      .schema('kokomusic')
      .from('external_charts_cache')
      .select('payload_json, source, region')
      .or(`region.eq.global,region.eq.${normRegion}`)
      .order('fetched_at', { ascending: false });

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

    // --- Compute genres + artistId from tracks_meta for active local plays ---
    const localTrackIds = Array.from(playCounts.keys());
    const localItunesIds = localTrackIds.map(Number).filter(n => !isNaN(n) && n > 0);
    const trackGenres = new Map<string, string>();
    const trackArtistIds = new Map<string, number>();

    if (localItunesIds.length > 0) {
      const { data: metas } = await supabase
        .schema('kokomusic')
        .from('tracks_meta')
        .select('itunes_id, genre, artist_id')
        .in('itunes_id', localItunesIds);

      if (metas) {
        for (const m of metas) {
          if (m.genre) {
            trackGenres.set(String(m.itunes_id), m.genre);
          }
          if (m.artist_id) {
            trackArtistIds.set(String(m.itunes_id), Number(m.artist_id));
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
        artistId: trackArtistIds.get(trackId) || 0,
        title: meta.title,
        artist: meta.artist,
        album: 'Trending Local',
        cover: isLastfmPlaceholderCover(meta.cover) ? '' : meta.cover,
        duration: 180_000,
        genre: genre,
        releaseDate: null,
        popularity: count * 100,
        preview_url: null
      };

      const key = normalizeStr(`${meta.title}-${meta.artist}`);
      candidates.set(key, {
        track,
        // Logarítmico: con ~25 usuarios, unos pocos clics en la propia sección de
        // tendencias bastaban para fijar una canción arriba para siempre.
        score: Math.round(20 * Math.log2(1 + count)),
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
            const rawCover = String(item.cover || item.coverUrl || item.cover_url || item.image || '');
            const track: TrackMetadata = {
              id: trackId,
              itunesId: isNaN(itunesId) ? 0 : itunesId,
              artistId: Number(item.artistId || item.artist_id || 0),
              title,
              artist,
              album: item.albumName || item.collectionName || 'Charts',
              cover: isLastfmPlaceholderCover(rawCover) ? '' : rawCover,
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

    cachedTrendingTracksByRegion.set(normRegion, sortedCandidates.map(c => c.track).slice(0, 60));

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
    cachedTrendingGenresByRegion.set(normRegion, finalGenresList.slice(0, 8));

    lastFetchedTimeByRegion.set(normRegion, Date.now());
    console.log(`[Trending] Finished update for ${normRegion}. Loaded ${cachedTrendingTracksByRegion.get(normRegion)?.length} tracks & ${cachedTrendingGenresByRegion.get(normRegion)?.length} genres.`);
  } catch (err) {
    console.error(`[Trending] Error updating trending data for ${normRegion}:`, err);
    if (!cachedTrendingTracksByRegion.has(normRegion)) {
      cachedTrendingTracksByRegion.set(normRegion, []);
    }
    if (!cachedTrendingGenresByRegion.has(normRegion)) {
      cachedTrendingGenresByRegion.set(normRegion, DEFAULT_TRENDING_GENRES);
    }
    lastFetchedTimeByRegion.set(normRegion, Date.now());
  }
}

/**
 * Returns the current trending tracks list.
 */
export async function getTrendingTracks(region = 'spain'): Promise<TrackMetadata[]> {
  const normRegion = normalizeRegionName(region);
  const lastFetched = lastFetchedTimeByRegion.get(normRegion) || 0;
  if (Date.now() - lastFetched > CACHE_TTL || !cachedTrendingTracksByRegion.has(normRegion)) {
    await updateTrendingData(normRegion);
  }
  return cachedTrendingTracksByRegion.get(normRegion) || [];
}

/**
 * Returns the current trending genres list.
 */
export async function getTrendingGenres(region = 'spain'): Promise<string[]> {
  const normRegion = normalizeRegionName(region);
  const lastFetched = lastFetchedTimeByRegion.get(normRegion) || 0;
  if (Date.now() - lastFetched > CACHE_TTL || !cachedTrendingGenresByRegion.has(normRegion)) {
    await updateTrendingData(normRegion);
  }
  return cachedTrendingGenresByRegion.get(normRegion) || DEFAULT_TRENDING_GENRES;
}

// ── Relevancia textual respecto a la query ───────────────────────────────────
// Antes el score de un resultado dependía casi por completo de la posición que
// le había dado iTunes (`100 - index`) — nunca se comprobaba si el título o el
// artista realmente contenían las palabras buscadas. Cuando iTunes devolvía su
// propio orden "raro" (p. ej. "de lejitos remix" trayendo canciones sin
// relación en primera posición y el resultado real enterrado en el puesto 26),
// nada lo corregía, porque ningún boost de personalización/trending es lo
// bastante grande para remontar esa base. Ahora la relevancia textual es el
// factor dominante y el orden de iTunes pasa a ser solo un desempate menor.
export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

// Algunos catálogos de iTunes indexan vídeos de reacción, lyric videos o
// ediciones "speed up" como si fueran canciones normales — con el título
// literalmente conteniendo la query completa (mejor relevancia textual que la
// canción real), pero no son lo que el usuario busca. Penalizamos ese patrón
// para que la versión oficial/canónica siga ganando.
const LOW_QUALITY_RESULT_RE = /\b(reacciona(ndo)?|reacci[oó]n|reaction|lyrics?|letra\s*(y\s*)?video|speed\s*up|sped\s*up|nightcore|karaoke)\b/i;

function isLowQualityResult(track: TrackMetadata): boolean {
  return LOW_QUALITY_RESULT_RE.test(track.title) || LOW_QUALITY_RESULT_RE.test(track.artist);
}

/**
 * Divide un string de artista en colaboradores individuales — "Jay Wheeler,
 * Brytiago & DJ Nelson" → ["jay wheeler", "brytiago", "dj nelson"].
 * Se usa para el boost de "artista relacionado": si el usuario escucha mucho
 * a Brytiago, una canción donde Brytiago aparece como colaborador (aunque el
 * artista principal listado sea otro) también es relevante para él.
 */
export function splitArtistNames(artist: string): string[] {
  return artist
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bx\b|\band\b|\bcon\b/i)
    .map(n => n.toLowerCase().trim())
    .filter(n => n.length > 0);
}

function queryRelevanceScore(track: TrackMetadata, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0;
  const titleNorm = normalizeStr(track.title);
  const artistNorm = normalizeStr(track.artist);

  let matched = 0;
  for (const tok of queryTokens) {
    if (titleNorm.includes(tok) || artistNorm.includes(tok)) matched++;
  }
  const ratio = matched / queryTokens.length;

  // Bonus si el título coincide (casi) exactamente con la query completa —
  // para que "de lejitos" encuentre el track "De Lejitos" por encima de
  // versiones/remixes/colaboraciones con título distinto.
  const fullQueryNorm = normalizeStr(queryTokens.join(''));
  const exactBonus = titleNorm === fullQueryNorm ? 0.5 : titleNorm.startsWith(fullQueryNorm) ? 0.2 : 0;

  // Bonus si el ARTISTA aparece literalmente en la query (patrón típico de
  // búsqueda "artista + canción", p. ej. "bad bunny monaco"). Sin esto, un
  // cover/piano-version de un canal random puede empatar en ratio con la
  // canción oficial (todas las palabras sueltas aparecen en su título) y
  // ganar por delante del track real, cuyo match se reparte entre título y
  // artista. Coincidir el nombre completo del artista es una señal mucho más
  // fuerte de intención que sumar palabras sueltas.
  const artistBonus = artistNorm.length >= 4 && fullQueryNorm.includes(artistNorm) ? 0.6 : 0;

  return ratio + exactBonus + artistBonus; // rango aproximado 0 – 2.1
}

/**
 * Boosts search results by prioritizing trending tracks and genres.
 *
 * @param results Initial search results from iTunes/YouTube
 * @param query Texto de búsqueda original — la relevancia textual es ahora el
 *   factor dominante del ranking (ver queryRelevanceScore)
 * @param userHistoryScores Map of normalized artist name to playcount for user-specific boosting
 * @param region Optional region parameter for localized trending boost
 * @param genreScores Map of normalized genre to play count — boost para géneros
 *   que el usuario escucha regularmente (aunque no conozca aún ese artista)
 */
export async function boostSearchResults(
  results: TrackMetadata[],
  query: string,
  userHistoryScores?: Record<string, number>,
  region = 'spain',
  listenedTrackKeys?: Set<string>,
  genreScores?: Record<string, number>
): Promise<TrackMetadata[]> {
  if (results.length === 0) return results;

  const normRegion = normalizeRegionName(region);
  const trendTracks = await getTrendingTracks(normRegion);
  const trendGenres = await getTrendingGenres(normRegion);
  const queryTokens = tokenizeQuery(query);

  // Create fast-lookup sets for exact matching
  const trendTrackKeys = new Set(
    trendTracks.map(t => normalizeStr(`${t.title}-${t.artist}`))
  );
  const trendGenreNorms = new Set(
    trendGenres.map(g => g.toLowerCase().trim())
  );

  const scored = results.map((track, index) => {
    // El orden que trajo iTunes ahora es solo un desempate menor (máx. ~10pts),
    // no la base del score — ver comentario de queryRelevanceScore arriba.
    let score = (100 - index) * 0.1;

    // 0. Relevancia textual: ¿el título/artista realmente contienen lo buscado?
    // Este es el factor dominante — hasta 300 puntos, muy por encima de
    // cualquier boost de personalización o tendencia.
    score += queryRelevanceScore(track, queryTokens) * 200;

    // 0.5. Penalización a vídeos de reacción / lyrics / speed-up que solo
    // "ganan" por contener literalmente las palabras buscadas en el título.
    if (isLowQualityResult(track)) {
      score -= 180;
    }

    const trackKey = normalizeStr(`${track.title}-${track.artist}`);
    const artistNorm = track.artist.toLowerCase().trim();
    const genreNorm = track.genre ? track.genre.toLowerCase().trim() : '';

    // 1. PREVIOUSLY LISTENED / TASTE PROFILE PRIORITY:
    // If the track is already in the user's history or taste profile, give it top priority!
    if (listenedTrackKeys && (listenedTrackKeys.has(trackKey) || listenedTrackKeys.has(track.id.toLowerCase()))) {
      score += 500; // Super high priority: puts previously heard songs first!
    }

    // 2. Personalization: User followed/listened artist boost.
    // Comprueba tanto el string completo (coincidencia exacta, boost fuerte)
    // como cada colaborador por separado (boost más moderado) — si el usuario
    // escucha mucho a "Brytiago" y sale un tema de "DJ Nelson feat. Brytiago"
    // que nunca ha escuchado bajo ese artista exacto, sigue siendo relevante.
    if (userHistoryScores) {
      if (userHistoryScores[artistNorm]) {
        score += Math.min(userHistoryScores[artistNorm] * 10, 200); // Max +200 points
      } else {
        const collaborators = splitArtistNames(track.artist);
        if (collaborators.length > 1) {
          let bestCollabScore = 0;
          for (const name of collaborators) {
            if (userHistoryScores[name]) bestCollabScore = Math.max(bestCollabScore, userHistoryScores[name]);
          }
          if (bestCollabScore > 0) {
            score += Math.min(bestCollabScore * 6, 120); // Max +120 — señal algo más débil que el match exacto
          }
        }
      }
    }

    // 3. Personalization: género que el usuario escucha regularmente — sube
    // tracks de géneros afines aunque no conozca ese artista en concreto.
    if (genreScores && genreNorm && genreScores[genreNorm]) {
      score += Math.min(genreScores[genreNorm] * 4, 80); // Max +80 points
    }

    // 4. Trending Track Boost: If track is currently trending globally or locally
    if (trendTrackKeys.has(trackKey) || (track.itunesId > 0 && trendTracks.some(t => t.itunesId === track.itunesId))) {
      score += 150; // Significant boost
    }

    // 5. Trending Genre Boost: If track belongs to a trending genre
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
