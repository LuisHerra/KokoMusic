/**
 * YouTube Resolver Service
 *
 * Resuelve el YouTube video ID correcto para un track de iTunes.
 * Busca con query inteligente y prioriza canales oficiales (VEVO, Topic).
 *
 * Estrategia de caché:
 *   L1: memoria (permanente en proceso) → L2: Supabase (permanente) → yt-search / yt-dlp
 *
 * Modos:
 *   PREFER_YTDLP=true  → yt-search → yt-dlp search (sin Invidious, para Termux/local)
 *   Por defecto        → yt-search → Invidious (para servidores en la nube)
 */

import yts from 'yt-search';
import { cache } from './cacheService';
import { getYouTubeResolution, upsertYouTubeResolution } from './supabaseService';
import { isYtSearchDisabled, recordYtSearchFailure, recordYtSearchSuccess } from './ytdlpSearchService';

// ── Normalización de texto para matching exacto ─────────────────────────────
function normalizeText(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Filtros negativos: versiones que NO queremos ───────────────────────────────
const BAD_VERSION_RE = /\b(karaoke|karaoké|instrumental|backing\s*track|piano\s*(?:version|cover)?|acoustic\s*(?:version|cover)?|cover\s*version|(?:^|[\s([])cover(?:[\s)\]]|$)|tribute|homenaje|sped[\s-]up|speed\s*up|slowed|reverb|nightcore|8\s*bit|8-bit|lofi|lo-fi|midi|remix\s+by\s+\w|parody|parodia|sing\s*along|reaction|reacción|am\s*cover|version\s+en\s+español|versión\s+en\s+inglés)\b/i;

// ── Patrones de canales oficiales ─────────────────────────────────────────────
const OFFICIAL_CHANNEL_RE = /vevo$|- topic$|official$|records$|music$/i;

function isOfficialChannel(channelName: string): boolean {
  return OFFICIAL_CHANNEL_RE.test(channelName);
}

// ── Palabras positivas en el título (suman puntos) ────────────────────────────
const POSITIVE_TITLE_RE = /\b(official\s*(audio|video|music\s*video|lyric)?|audio\s*oficial|video\s*oficial|original|videoclip)\b/i;

/**
 * Puntúa un candidato de video considerando concordancia léxica estricta de título y artista.
 */
function scoreVideo(
  video: any,
  targetArtist: string,
  targetTitle: string,
  expectedDurationSec?: number
): number {
  const vTitle: string = video.title ?? '';
  const vChannel: string = video.author?.name ?? '';

  // Descarte inmediato si el título contiene una versión no deseada
  if (BAD_VERSION_RE.test(vTitle)) return -Infinity;

  const normVTitle = normalizeText(vTitle);
  const normVChannel = normalizeText(vChannel);
  const normArtist = normalizeText(targetArtist);
  const normTitle = normalizeText(targetTitle);

  let score = 0;

  // 1. Concordancia de tokens del título (crítico: no emparejar canciones con títulos ajenos)
  const titleWords = normTitle.split(' ').filter(w => w.length > 1);
  if (titleWords.length > 0) {
    const matchedWords = titleWords.filter(w => normVTitle.includes(w));
    const matchRatio = matchedWords.length / titleWords.length;
    score += matchRatio * 20; // Hasta +20 puntos
    if (matchRatio < 0.5) {
      score -= 15; // Penalizar fuertemente si no incluye ni la mitad del título
    }
  }

  // 2. Concordancia de artista en título o canal
  const artistWords = normArtist.split(' ').filter(w => w.length > 1);
  if (artistWords.length > 0) {
    const inTitle = artistWords.some(w => normVTitle.includes(w));
    const inChannel = artistWords.some(w => normVChannel.includes(w));
    if (inTitle || inChannel) {
      score += 15;
    } else {
      score -= 10; // Penalizar si el artista no aparece en ningún sitio
    }
  }

  // 3. Canal oficial / Topic / VEVO
  if (normVChannel.includes(normArtist) || isOfficialChannel(vChannel)) {
    score += 5;
  }

  // 4. Palabras positivas en título (official audio/video)
  if (POSITIVE_TITLE_RE.test(vTitle)) {
    score += 3;
  }

  // 5. Duración cercana a la esperada
  if (expectedDurationSec && video.duration?.seconds) {
    const diff = Math.abs(video.duration.seconds - expectedDurationSec);
    if (diff / expectedDurationSec < 0.15) score += 3;
  }

  return score;
}

/**
 * Resuelve el YouTube ID para un artista + título dados.
 * Prioriza canales VEVO/Topic/Official y filtra versiones karaoke/cover/instrumental.
 * @param expectedDurationSec  Duración en segundos del track de iTunes (opcional, mejora la precisión)
 */
export async function resolveYoutubeId(
  itunesId: number,
  artistName: string,
  trackName: string,
  expectedDurationSec?: number
): Promise<string | null> {
  const cacheKey = `yt-res:${itunesId}`;

  // L1: memoria
  const inMemory = cache.get(cacheKey);
  if (inMemory) return inMemory;

  // L2: Supabase
  const fromDB = await getYouTubeResolution(itunesId);
  if (fromDB) {
    cache.setex(cacheKey, 86400 * 30, fromDB); // recalentar L1 (30 días)
    return fromDB;
  }

  // L3: búsqueda de YouTube
  try {
    // Usamos "official audio" para sesgar los resultados de YouTube hacia contenido oficial
    const query = `${artistName} ${trackName} official audio`;
    let videos: any[] = [];

    if (!isYtSearchDisabled()) {
      try {
        const result = await yts(query);
        videos = result.videos.slice(0, 15); // más candidatos → mejor selección
        recordYtSearchSuccess();
      } catch {
        recordYtSearchFailure();
      }
    }

    if (videos.length === 0) {
      const { searchYtdlp } = await import('./ytdlpSearchService');
      console.log(`[YTResolver] yt-search vacío — buscando via yt-dlp: "${query}"`);
      videos = await searchYtdlp(query, 15);
    }

    if (videos.length === 0) return null;

    // Puntuar todos los candidatos y ordenar de mayor a menor score
    const scored = videos
      .map(v => ({ video: v, score: scoreVideo(v, artistName, trackName, expectedDurationSec) }))
      .filter(s => s.score > -Infinity) // descartar los bloqueados
      .sort((a, b) => b.score - a.score);

    // Elegir el mejor candidato; si todos fueron descartados, usar el primero sin filtrar
    const chosen = scored.length > 0 ? scored[0].video : videos[0];
    const youtubeId = chosen.videoId;

    const reason = scored.length > 0
      ? `score=${scored[0].score}, canal="${chosen.author?.name}"`
      : 'fallback (todos filtrados)';
    console.log(`[YTResolver] "${artistName} - ${trackName}" → ${youtubeId} (${reason})`);

    // Persistir en L1 + L2
    cache.setex(cacheKey, 86400 * 30, youtubeId);
    upsertYouTubeResolution(itunesId, youtubeId).catch(() => {});

    return youtubeId;
  } catch (error) {
    console.error('[YTResolver] Error resolviendo YouTube ID:', error);
    return null;
  }
}

