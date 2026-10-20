import { Router } from 'express';
// Use dynamic import or require for spotify-url-info as it might need fetch injection
const spotifyUrlInfo = require('spotify-url-info')(fetch);
import { searchTracks } from '../services/metadataService';
import { cache } from '../services/cacheService';
import { supabase } from '../services/supabaseService';
import { hydrateLocalHistoryFromCloud } from '../services/historyService';
import { triggerUserPipeline } from '../services/backgroundJobRunner';

const router = Router();

/**
 * Normaliza un enlace de Spotify a `https://open.spotify.com/{playlist|album}/{id}`.
 * Acepta enlaces con /intl-es/, parámetros (?si=...), URIs `spotify:playlist:...`
 * y enlaces cortos de la app (spotify.link / spotify.app.link), que se siguen
 * con una sola petición para obtener la URL real.
 */
async function normalizeSpotifyUrl(raw: string): Promise<{ type: 'playlist' | 'album'; url: string } | null> {
  let input = String(raw).trim();

  const uri = input.match(/^spotify:(playlist|album):([A-Za-z0-9]+)$/);
  if (uri) return { type: uri[1] as 'playlist' | 'album', url: `https://open.spotify.com/${uri[1]}/${uri[2]}` };

  if (/^https?:\/\/(spotify\.link|spotify\.app\.link)\//i.test(input)) {
    try {
      const r = await fetch(input, { redirect: 'follow', signal: AbortSignal.timeout(6000) });
      input = r.url;
    } catch {
      return null;
    }
  }

  const m = input.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album)\/([A-Za-z0-9]+)/i);
  if (!m) return null;
  const type = m[1].toLowerCase() as 'playlist' | 'album';
  return { type, url: `https://open.spotify.com/${type}/${m[2]}` };
}

// Parse Spotify URL and extract raw tracks (una sola petición a Spotify)
router.post('/parse', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Falta la URL' });

  try {
    const target = await normalizeSpotifyUrl(url);
    if (!target) {
      return res.status(400).json({ error: 'Pega un enlace de una playlist o un álbum de Spotify' });
    }

    const { preview, tracks: spTracks } = await spotifyUrlInfo.getDetails(target.url);

    // Quitar duplicados (misma canción repetida en la playlist) para no
    // resolverla dos veces.
    const seen = new Set<string>();
    const tracks = (spTracks as any[])
      .filter((t) => t?.name && t?.artist)
      .map((t) => ({
        title: t.name,
        artist: t.artist,
        duration: t.duration || 0,
        originalId: t.uri,
      }))
      .filter((t) => {
        const key = `${normalize(t.artist)}|${normalize(t.title)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    res.json({
      name: preview?.title || (target.type === 'album' ? 'Álbum importado' : 'Playlist importada'),
      cover: preview?.image || '',
      type: target.type,
      tracks,
    });
  } catch (error: any) {
    console.error('[Import Parse] Error:', error?.message || error);
    res.status(502).json({ error: 'No se pudo leer el enlace. Comprueba que la playlist es pública.' });
  }
});

// Resolve a single raw track into a playable KokoMusic track
router.post('/resolve', async (req, res) => {
  const { track } = req.body;
  if (!track || !track.title || !track.artist) {
    return res.status(400).json({ error: 'Track inválido' });
  }

  try {
    let query = `${track.artist} ${track.title}`;
    let results = await searchTracks(query, 5, 'youtube');
    
    if (!results || results.length === 0) {
      const cleanTitle = track.title.replace(/[\(\[].*?[\)\]]/g, '').trim();
      query = `${track.artist} ${cleanTitle}`;
      results = await searchTracks(query, 5, 'youtube');
    }

    if (!results || results.length === 0) {
      const cleanTitle = track.title.replace(/[\(\[].*?[\)\]]/g, '').trim();
      const firstArtist = track.artist.split(/[,&]|feat\.?/i)[0].trim();
      query = `${firstArtist} ${cleanTitle}`;
      results = await searchTracks(query, 5, 'youtube');
    }

    if (!results || results.length === 0) {
      const cleanTitle = track.title.replace(/[\(\[].*?[\)\]]/g, '').trim();
      query = cleanTitle;
      results = await searchTracks(query, 5, 'youtube');
    }

    if (results && results.length > 0) {
      const top = results[0];
      // Basic check for "exact" match
      const t1 = top.title.toLowerCase();
      const t2 = track.title.toLowerCase();
      const a1 = top.artist.toLowerCase();
      const a2 = track.artist.toLowerCase();
      
      const titleMatch = t1.includes(t2) || t2.includes(t1);
      const artistMatch = a1.includes(a2) || a2.includes(a1);
      
      const exactMatch = titleMatch && artistMatch;
      
      return res.json({ exactMatch, results });
    }
    
    res.status(404).json({ error: 'No encontrado' });
  } catch (error: any) {
    console.error('[Import Resolve] Error:', error);
    res.status(500).json({ error: 'Error al resolver track' });
  }
});

// ── Helpers para comparación de títulos ──────────────────────────────────────

/** Normaliza un string para comparación: minúsculas, sin paréntesis/corchetes, sin feat/ft, sin puntuación */
function normalize(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\(\[].*?[\)\]]/g, '')        // quitar (remix), [feat. X], etc.
    .replace(/\b(feat\.?|ft\.?|featuring)\b.*/gi, '') // quitar feat y todo lo posterior
    .replace(/[''`´]/g, "'")                // normalizar apóstrofes
    .replace(/[^\w\s']/g, '')               // quitar puntuación excepto apóstrofe
    .replace(/\s+/g, ' ')                   // colapsar espacios
    .trim();
}

/** Calcula similitud entre dos strings normalizados (0..1) */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  
  // Jaccard con bigramas
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();
  for (let i = 0; i < na.length - 1; i++) bigramsA.add(na.slice(i, i + 2));
  for (let i = 0; i < nb.length - 1; i++) bigramsB.add(nb.slice(i, i + 2));
  
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  
  let intersection = 0;
  for (const bg of bigramsA) { if (bigramsB.has(bg)) intersection++; }
  return intersection / (bigramsA.size + bigramsB.size - intersection);
}

// ── Resolución por lotes para la importación desde Spotify ───────────────────

type RawImportTrack = { title: string; artist: string; duration?: number };
type ImportCandidate = { id: string; title: string; artist: string; album?: string; cover?: string; score: number };
type ImportResolution =
  | { status: 'matched'; id: string; candidates: ImportCandidate[] }
  | { status: 'ambiguous'; candidates: ImportCandidate[] }
  | { status: 'notfound' };

const RESOLVE_BATCH_MAX = 20;
const RESOLVE_CACHE_TTL = 7 * 24 * 3600;  // misma canción de Spotify → mismo resultado durante una semana
const MATCH_THRESHOLD = 0.75;
const AMBIGUOUS_MIN = 0.35;
const BATCH_SPACING_MS = 250;            // pausa entre búsquedas reales (no cacheadas) para no provocar 429

/** Puntúa un resultado frente a la canción de Spotify (título, artista y duración). */
function scoreCandidate(track: RawImportTrack, r: { title: string; artist: string; duration?: number }): number {
  const titleSim = similarity(track.title, r.title);
  // Spotify une colaboradores con ", " / " & " — basta con que coincida uno.
  const artists = [track.artist, ...track.artist.split(/,|&/).map((a) => a.trim()).filter(Boolean)];
  const artistSim = Math.max(...artists.map((a) => similarity(a, r.artist)));
  let score = titleSim * 0.6 + artistSim * 0.4;

  if (track.duration && r.duration) {
    const diffSec = Math.abs(track.duration - r.duration) / 1000;
    if (diffSec <= 3) score += 0.05;
    else if (diffSec > 20) score -= 0.15;  // probablemente versión en directo, remix o vídeo con intro
  }
  return Math.max(0, Math.min(1, score));
}

function rankResults(track: RawImportTrack, results: any[]): ImportCandidate[] {
  return results
    .filter((r) => r?.id)
    .map((r) => ({
      id: String(r.id),
      title: r.title,
      artist: r.artist,
      album: r.album,
      cover: r.cover,
      score: scoreCandidate(track, r),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/**
 * Resuelve una canción de Spotify con el mínimo de peticiones salientes:
 *   1. Caché (7 días).
 *   2. Una búsqueda en iTunes (1 petición; da IDs de catálogo y duración fiable).
 *   3. Solo si no hay coincidencia clara, una búsqueda en YouTube con el título limpio.
 * Antes se iba directo a YouTube (scraping + hasta 5 consultas de enriquecimiento
 * a iTunes por canción) y con hasta 4 reintentos.
 * Devuelve también si hizo peticiones reales, para espaciar solo esas.
 */
async function resolveImportTrack(track: RawImportTrack): Promise<{ result: ImportResolution; usedNetwork: boolean }> {
  const cacheKey = `import-resolve:${normalize(track.artist)}|${normalize(track.title)}`;
  const cached = cache.get(cacheKey);
  if (cached) return { result: JSON.parse(cached), usedNetwork: false };

  const cleanTitle = track.title.replace(/[\(\[].*?[\)\]]/g, '').replace(/\s+-\s+.*$/, '').trim() || track.title;
  const firstArtist = track.artist.split(/,|&/)[0].trim();

  let ranked = rankResults(track, await searchTracks(`${firstArtist} ${cleanTitle}`, 5, 'itunes'));

  if (!ranked.length || ranked[0].score < MATCH_THRESHOLD) {
    const yt = rankResults(track, await searchTracks(`${firstArtist} ${cleanTitle}`, 5, 'youtube'));
    ranked = [...ranked, ...yt].sort((a, b) => b.score - a.score).slice(0, 5);
  }

  let result: ImportResolution;
  if (ranked.length && ranked[0].score >= MATCH_THRESHOLD) {
    result = { status: 'matched', id: ranked[0].id, candidates: ranked };
  } else if (ranked.length && ranked[0].score >= AMBIGUOUS_MIN) {
    result = { status: 'ambiguous', candidates: ranked };
  } else {
    result = { status: 'notfound' };
  }

  // Los "no encontrado" se cachean menos tiempo por si era un fallo puntual.
  cache.setex(cacheKey, result.status === 'notfound' ? 3600 : RESOLVE_CACHE_TTL, JSON.stringify(result));
  return { result, usedNetwork: true };
}

// POST /api/import/resolve-batch  { tracks: RawImportTrack[] }  (máx. 20 por llamada)
// Secuencial a propósito: el cliente manda lotes pequeños y el servidor espacia
// las búsquedas reales, así una playlist grande nunca dispara ráfagas.
router.post('/resolve-batch', async (req, res) => {
  const tracks: RawImportTrack[] = Array.isArray(req.body?.tracks) ? req.body.tracks : [];
  if (!tracks.length) return res.status(400).json({ error: 'Faltan canciones' });
  if (tracks.length > RESOLVE_BATCH_MAX) {
    return res.status(400).json({ error: `Máximo ${RESOLVE_BATCH_MAX} canciones por lote` });
  }

  const results: ImportResolution[] = [];
  for (const t of tracks) {
    if (!t?.title || !t?.artist) { results.push({ status: 'notfound' }); continue; }
    try {
      const { result, usedNetwork } = await resolveImportTrack(t);
      results.push(result);
      if (usedNetwork) await new Promise((r) => setTimeout(r, BATCH_SPACING_MS));
    } catch (err: any) {
      console.warn(`[Import Batch] Error resolviendo "${t.artist} - ${t.title}":`, err?.message || err);
      results.push({ status: 'notfound' });
    }
  }

  res.json({ results });
});

// Endpoint para "upgradear" de YouTube a iTunes en segundo plano
// Devuelve: { id } si match confiable, { ambiguous: true, candidates } si necesita confirmación del usuario, o 404
router.post('/upgrade', async (req, res) => {
  const { track } = req.body;
  if (!track || !track.title || !track.artist) return res.status(400).json({ error: 'Track inválido' });
  
  try {
    const query = `${track.artist} ${track.title}`;
    const results = await searchTracks(query, 5, 'itunes');
    
    if (!results || results.length === 0) {
      return res.status(404).json({ error: 'No encontrado en iTunes' });
    }

    // Puntuar y ordenar todos los resultados
    const scored = results.map(r => {
      const titleSim = similarity(track.title, r.title);
      const artistSim = similarity(track.artist, r.artist);
      const score = titleSim * 0.6 + artistSim * 0.4;
      return { ...r, score };
    }).sort((a, b) => b.score - a.score);

    const best = scored[0];
    const CONFIDENT_THRESHOLD = 0.65;
    const AMBIGUOUS_THRESHOLD = 0.35;

    if (best.score >= CONFIDENT_THRESHOLD) {
      // Match confiable → upgrade automático
      console.log(`[Upgrade] ✓ "${track.artist} - ${track.title}" → "${best.artist} - ${best.title}" (score: ${best.score.toFixed(2)})`);
      return res.json({ id: best.id });
    }

    if (best.score >= AMBIGUOUS_THRESHOLD) {
      // Ambiguo → devolver candidatos para que el usuario elija
      console.log(`[Upgrade] ? "${track.artist} - ${track.title}" ambiguo (best score: ${best.score.toFixed(2)})`);
      return res.json({
        ambiguous: true,
        candidates: scored.slice(0, 5).map(c => ({
          id: c.id,
          title: c.title,
          artist: c.artist,
          album: c.album,
          cover: c.cover,
          score: Math.round(c.score * 100),
        }))
      });
    }

    console.log(`[Upgrade] ✗ No hay match para "${track.artist} - ${track.title}" (best score: ${best.score.toFixed(2)})`);
    return res.status(404).json({ error: 'No hay coincidencia en iTunes' });
  } catch (err) {
    return res.status(500).json({ error: 'Error upgrading' });
  }
});

// Endpoint para buscar videos de YouTube (usado por el modal de cambiar fuente)
router.post('/search-youtube', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query requerido' });
  
  try {
    const results = await searchTracks(query, 8, 'youtube');
    return res.json({ results: results || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Error buscando en YouTube' });
  }
});

// Endpoint para importar el historial de reproducciones de Spotify (Extended Streaming History)
router.post('/spotify-history', async (req, res) => {
  const userId = (req.headers['x-user-id'] || 'default') as string;
  const { history } = req.body;

  if (!Array.isArray(history)) {
    return res.status(400).json({ error: 'La historia debe ser un array de reproducciones' });
  }

  if (!supabase) {
    return res.status(503).json({ error: 'Servicio de base de datos no disponible' });
  }

  try {
    console.log(`[Import Spotify] Recibidas ${history.length} filas para el usuario ${userId}`);

    // 1. Filtrar y mapear los campos soportando ambos formatos de Spotify
    const validPlays = history
      .map((item: any) => {
        const title = item.master_metadata_track_name || item.trackName || item.track_name;
        const artist = item.master_metadata_album_artist_name || item.artistName || item.artist_name;
        const msPlayed = item.ms_played || item.msPlayed || 0;
        const playedAt = item.ts || item.endTime;

        if (!title || !artist || !playedAt) return null;

        return {
          title: String(title),
          artist: String(artist),
          msPlayed: Number(msPlayed),
          playedAt: new Date(playedAt).toISOString(),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null && p.msPlayed >= 10000); // Filtrar saltadas (< 10s)

    if (validPlays.length === 0) {
      return res.json({ success: true, totalPlaysImported: 0, message: 'No se encontraron reproducciones válidas de más de 10s' });
    }

    // 2. Agrupar por track (artist + title) en memoria
    const trackGroups = new Map<string, {
      artist: string;
      title: string;
      count: number;
      lastPlayed: string;
      plays: string[];
      sessions: { date: string; seconds: number }[];
    }>();

    for (const p of validPlays) {
      const key = `${p.artist.toLowerCase()}::${p.title.toLowerCase()}`;
      let group = trackGroups.get(key);
      if (!group) {
        group = {
          artist: p.artist,
          title: p.title,
          count: 0,
          lastPlayed: p.playedAt,
          plays: [],
          sessions: [],
        };
        trackGroups.set(key, group);
      }

      group.count++;
      if (new Date(p.playedAt) > new Date(group.lastPlayed)) {
        group.lastPlayed = p.playedAt;
      }
      group.plays.push(p.playedAt);
      group.sessions.push({ date: p.playedAt, seconds: Math.round(p.msPlayed / 1000) });
    }

    console.log(`[Import Spotify] Agrupados en ${trackGroups.size} tracks únicos`);

    // 3. Batch-select tracks_meta para resolver los tracks
    // Para no exceder límites, traemos todos los tracks de tracks_meta
    const { data: dbTracks, error: dbError } = await supabase
      .schema('kokomusic')
      .from('tracks_meta')
      .select('itunes_id, title, artist, genre, cover_url');

    if (dbError) {
      throw new Error(`Error al leer tracks_meta: ${dbError.message}`);
    }

    // Indexar tracks de DB para búsqueda rápida en O(1)
    const dbTrackMap = new Map<string, any>();
    for (const t of (dbTracks || [])) {
      const key = `${t.artist.toLowerCase()}::${t.title.toLowerCase()}`;
      dbTrackMap.set(key, t);
    }

    // Función auxiliar para normalizar cadenas para búsquedas parciales aproximadas
    const cleanStr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 4. Resolver tracks y combinar con el historial existente del usuario en kokomusic.user_history
    const { data: existingRows, error: existingError } = await supabase
      .schema('kokomusic')
      .from('user_history')
      .select('track_id, play_count, plays, session_data, last_played')
      .eq('user_id', userId);

    if (existingError) {
      throw new Error(`Error al leer historial existente: ${existingError.message}`);
    }

    const existingMap = new Map<string, any>();
    for (const r of (existingRows || [])) {
      existingMap.set(r.track_id, r);
    }

    const toUpsert: any[] = [];
    let resolvedCount = 0;

    for (const group of trackGroups.values()) {
      const dbKey = `${group.artist.toLowerCase()}::${group.title.toLowerCase()}`;
      let resolvedTrack = dbTrackMap.get(dbKey);

      // Si no hay match exacto, intentar match por limpieza de caracteres
      if (!resolvedTrack) {
        const cleanArtist = cleanStr(group.artist);
        const cleanTitle = cleanStr(group.title);
        resolvedTrack = dbTracks.find((t: any) => 
          cleanStr(t.artist) === cleanArtist && cleanStr(t.title) === cleanTitle
        );
      }

      let trackId: string;
      let cover = '';
      if (resolvedTrack) {
        trackId = String(resolvedTrack.itunes_id);
        cover = resolvedTrack.cover_url || '';
        resolvedCount++;
      } else {
        // ID alternativo basado en codificación para no perder la historia
        trackId = `spotify:${Buffer.from(`${group.artist} - ${group.title}`).toString('base64url')}`;
      }

      // Limitar arrays a los últimos 50 elementos para que quepa en JSON y no sobrecargue la base de datos
      const importedPlays = group.plays.sort().slice(-50);
      const importedSessions = group.sessions.sort((a, b) => a.date.localeCompare(b.date)).slice(-50);

      const existing = existingMap.get(trackId);
      let finalCount = group.count;
      let finalPlays = importedPlays;
      let finalSessions = importedSessions;
      let finalLast = group.lastPlayed;

      if (existing) {
        finalCount += (existing.play_count || 0);
        // Combinar y ordenar
        finalPlays = [...new Set([...(existing.plays || []), ...importedPlays])].sort().slice(-100);
        
        const combinedSessions = [...(existing.session_data || []), ...importedSessions];
        // Desduplicar sesiones por fecha aproximada (mismo segundo)
        const seenDates = new Set<string>();
        finalSessions = combinedSessions
          .filter(s => {
            const d = new Date(s.date).toISOString();
            if (seenDates.has(d)) return false;
            seenDates.add(d);
            return true;
          })
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-100);

        const existingLast = existing.last_played ? new Date(existing.last_played).getTime() : 0;
        const importedLast = new Date(group.lastPlayed).getTime();
        finalLast = importedLast > existingLast ? group.lastPlayed : existing.last_played;
      }

      toUpsert.push({
        user_id: userId,
        track_id: trackId,
        title: group.title,
        artist: group.artist,
        cover,
        play_count: finalCount,
        last_played: finalLast,
        plays: finalPlays,
        session_data: finalSessions,
      });
    }

    console.log(`[Import Spotify] Subiendo ${toUpsert.length} filas a user_history. Resueltos: ${resolvedCount}/${trackGroups.size}`);

    // 5. Guardar en lotes de 200 en Supabase
    const batchSize = 200;
    for (let i = 0; i < toUpsert.length; i += batchSize) {
      const batch = toUpsert.slice(i, i + batchSize);
      const { error: upsertError } = await supabase
        .schema('kokomusic')
        .from('user_history')
        .upsert(batch, { onConflict: 'user_id,track_id' });

      if (upsertError) {
        throw new Error(`Error en lote de upsert: ${upsertError.message}`);
      }
    }

    // 6. Sincronizar cache local y disparar re-cálculo
    await hydrateLocalHistoryFromCloud();
    triggerUserPipeline(userId);

    res.json({
      success: true,
      totalPlaysImported: validPlays.length,
      uniqueTracksImported: trackGroups.size,
      tracksResolved: resolvedCount,
    });
  } catch (err: any) {
    console.error('[Import Spotify] Error crítico:', err);
    res.status(500).json({ error: `Error al procesar el archivo: ${err.message}` });
  }
});

export default router;

