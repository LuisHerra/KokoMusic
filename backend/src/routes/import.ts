import { Router } from 'express';
// Use dynamic import or require for spotify-url-info as it might need fetch injection
const spotifyUrlInfo = require('spotify-url-info')(fetch);
import { searchTracks } from '../services/metadataService';
import { supabase } from '../services/supabaseService';
import { hydrateLocalHistoryFromCloud } from '../services/historyService';
import { triggerUserPipeline } from '../services/backgroundJobRunner';

const router = Router();

// Parse Spotify URL and extract raw tracks
router.post('/parse', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Falta la URL' });

  try {
    let name = 'Playlist Importada';
    let cover = '';
    let tracks: any[] = [];

    if (url.includes('spotify.com')) {
      const data = await spotifyUrlInfo.getData(url);
      if (data && data.type === 'playlist') {
        name = data.name || name;
        cover = data.coverArt?.sources?.[0]?.url || cover;
        const spTracks = await spotifyUrlInfo.getTracks(url);
        tracks = spTracks.map((t: any) => ({
          title: t.name,
          artist: t.artist,
          duration: t.duration || 0,
          originalId: t.uri || t.id
        }));
      } else {
        return res.status(400).json({ error: 'Solo playlists de Spotify' });
      }
    } else {
      return res.status(400).json({ error: 'URL no soportada' });
    }

    res.json({ name, cover, tracks });
  } catch (error: any) {
    console.error('[Import Parse] Error:', error);
    res.status(500).json({ error: 'Error al parsear la playlist' });
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
      .select('itunes_id, title, artist, genre');

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

