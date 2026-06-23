import { Router } from 'express';
// Use dynamic import or require for spotify-url-info as it might need fetch injection
const spotifyUrlInfo = require('spotify-url-info')(fetch);
import { searchTracks } from '../services/metadataService';

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

export default router;
