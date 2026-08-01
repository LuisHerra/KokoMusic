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

// ── Filtros negativos: versiones que NO queremos ───────────────────────────────
// Coincide si alguna de estas palabras aparece en el título del video.
const BAD_VERSION_RE = /\b(karaoke|karaoké|instrumental|backing\s*track|piano\s*(?:version|cover)?|acoustic\s*(?:version|cover)?|cover\s*version|(?:^|[\s([])cover(?:[\s)\]]|$)|tribute|homenaje|sped[\s-]up|speed\s*up|slowed|reverb|nightcore|8\s*bit|8-bit|lofi|lo-fi|midi|remix\s+by\s+\w|parody|parodia|letra\s+animada|lyric\s*video|lyrics|letras?|sing\s*along|reaction|reacción|am\s*cover|version\s+en\s+español|versión\s+en\s+inglés)\b/i;


// ── Patrones de canales oficiales ─────────────────────────────────────────────
const OFFICIAL_CHANNEL_RE = /vevo$|- topic$|official$|records$|music$/i;

function isOfficialChannel(channelName: string): boolean {
  return OFFICIAL_CHANNEL_RE.test(channelName);
}

// ── Palabras positivas en el título (suman puntos) ────────────────────────────
const POSITIVE_TITLE_RE = /\b(official\s*(audio|video|music\s*video|lyric)?|audio\s*oficial|video\s*oficial|original)\b/i;

/**
 * Puntúa un candidato de video:
 * Mayor puntaje = mejor match para el track buscado.
 *
 * Puntos positivos:
 *  +3  canal VEVO / Topic / Official
 *  +2  "official audio/video" en título
 *  +1  duración razonable (2-7 min) para una canción
 *
 * Penalizaciones:
 *  -∞  cualquier palabra de BAD_VERSION_RE → excluido directamente
 */
function scoreVideo(video: any, expectedDurationSec?: number): number {
  const title: string = video.title ?? '';
  const channel: string = video.author?.name ?? '';

  // Descarte inmediato si el título contiene una versión no deseada
  if (BAD_VERSION_RE.test(title)) return -Infinity;

  let score = 0;

  if (isOfficialChannel(channel)) score += 3;
  if (POSITIVE_TITLE_RE.test(title)) score += 2;

  // Premio por duración cercana a la esperada (±20%)
  if (expectedDurationSec && video.duration?.seconds) {
    const diff = Math.abs(video.duration.seconds - expectedDurationSec);
    if (diff / expectedDurationSec < 0.2) score += 1;
  } else if (video.duration?.seconds) {
    const d = video.duration.seconds;
    if (d >= 90 && d <= 480) score += 1; // 1.5-8 min → probable canción
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
      .map(v => ({ video: v, score: scoreVideo(v, expectedDurationSec) }))
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

