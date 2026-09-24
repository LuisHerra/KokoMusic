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
import http from 'http';
import https from 'https';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { cache } from './cacheService';
import { getYouTubeResolutionFull, upsertYouTubeResolution } from './supabaseService';
import { isYtSearchDisabled, recordYtSearchFailure, recordYtSearchSuccess } from './ytdlpSearchService';

/**
 * yt-search (vía su dependencia `dasu`) usa el http/https clásico de Node,
 * no fetch/undici — así que necesita un mecanismo de proxy distinto al de
 * kokomusic-lite (que sí usa undici y su setGlobalDispatcher). Aquí se
 * parchea el agente GLOBAL de http/https, que es donde dasu (y cualquier
 * otra librería que use el http/https clásico) obtiene su conexión por
 * defecto cuando no especifica un agente propio.
 *
 * Mismo motivo que en kokomusic-lite: YouTube penaliza las IPs de
 * datacenter, y yt-search scrapea resultados de búsqueda de YouTube
 * directamente — sujeto al mismo tipo de bloqueo.
 */
// Pool de proxies: PROXY_URLS (separados por comas) o, si no, PROXY_URL.
// Cada búsqueda rota al siguiente (round-robin) para repartir carga entre
// proxies en vez de saturar uno solo; keepAlive reutiliza el túnel en vez de
// abrir uno nuevo por petición.
const ytProxyPool = (process.env.PROXY_URLS || process.env.PROXY_URL || '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean)
  .map((url) => ({
    http: new HttpProxyAgent(url, { keepAlive: true }),
    https: new HttpsProxyAgent(url, { keepAlive: true }),
  }));
let ytProxyCursor = 0;

/** Apunta el agente global al siguiente proxy del pool. Llamar justo antes de cada yts(). */
export function rotateYtProxy(): void {
  if (ytProxyPool.length === 0) return;
  const next = ytProxyPool[ytProxyCursor++ % ytProxyPool.length];
  http.globalAgent = next.http;
  https.globalAgent = next.https;
}

if (ytProxyPool.length > 0) {
  rotateYtProxy();
  console.log(`[YTResolver] yt-search enrutado por un pool de ${ytProxyPool.length} proxy(s) en round-robin.`);
}

export interface YoutubeResolution {
  primary: string;
  /** Candidatos de respaldo (otros vídeos del mismo tema) — ya puntuados por scoreVideo, descartados solo por no ser el #1. */
  alternates: string[];
}

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
  const vChannel: string = (typeof video.author === 'string' ? video.author : video.author?.name) ?? '';

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
  const vSec = video.duration?.seconds ?? video.durationSeconds;
  if (expectedDurationSec && vSec) {
    const diff = Math.abs(vSec - expectedDurationSec);
    if (diff / expectedDurationSec < 0.15) score += 3;
  }

  return score;
}

const MAX_ALTERNATES = 3;

/**
 * Busca vídeos de YouTube para un query dado: yt-search primero (scraping
 * directo de la página de resultados, corre desde la IP residencial de este
 * backend — sin el bloqueo que sufre el endpoint /youtubei/v1/search de
 * InnerTube en KokoMusic-lite, confirmado con un 403 incluso adjuntando
 * PoToken), cayendo a KokoMusic-lite solo si yt-search no devuelve nada.
 * Reutilizada tanto por la resolución de un track concreto como por la
 * búsqueda general "YouTube" de la app — antes esta última iba directa a
 * KokoMusic-lite y por eso fallaba siempre, mientras que resolver un track
 * puntual (vía perfil de artista) sí funcionaba al pasar primero por aquí.
 */
const YTS_TIMEOUT_MS = 8000;
const YTS_HEDGE_AFTER_MS = 3500;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

/** Resuelve con el primer array no vacío; [] si todos terminan vacíos. */
function firstNonEmpty<T>(promises: Promise<T[]>[]): Promise<T[]> {
  return new Promise((resolve) => {
    let pending = promises.length;
    for (const p of promises) {
      p.then((r) => {
        if (r.length > 0) resolve(r);
        else if (--pending === 0) resolve([]);
      }, () => { if (--pending === 0) resolve([]); });
    }
  });
}

export async function searchYoutubeVideos(query: string, limit = 15): Promise<any[]> {
  const { searchLite } = await import('./kokoLiteService');

  // yt-search no tiene timeout propio: con el proxy lento una búsqueda podía
  // tardar 40 s+. Se acota, y si a los 3,5 s no ha respondido se lanza en
  // paralelo KokoMusic-lite y gana el primero que traiga resultados.
  const viaYts: Promise<any[]> = isYtSearchDisabled()
    ? Promise.resolve([])
    : (async () => {
        try {
          rotateYtProxy();
          const result = await withTimeout(yts(query), YTS_TIMEOUT_MS);
          recordYtSearchSuccess();
          return result.videos.slice(0, limit);
        } catch {
          recordYtSearchFailure();
          return [];
        }
      })();

  const early = await Promise.race([viaYts, new Promise<null>((r) => setTimeout(() => r(null), YTS_HEDGE_AFTER_MS))]);
  if (early && early.length > 0) return early;

  if (early !== null) {
    console.log(`[YTResolver] yt-search vacío — buscando via KokoMusic-lite: "${query}"`);
    return searchLite(query);
  }

  console.log(`[YTResolver] yt-search lento — lanzando KokoMusic-lite en paralelo: "${query}"`);
  return firstNonEmpty([viaYts, searchLite(query).catch(() => [])]);
}

/**
 * Resuelve el YouTube ID para un artista + título dados, junto con hasta
 * MAX_ALTERNATES candidatos alternativos (otros vídeos del mismo tema ya
 * puntuados por scoreVideo — audio oficial, lyric video, reupload...).
 * Antes solo se guardaba el ganador y el resto de candidatos se tiraban; si
 * ese único video moría (bloqueado, retirado), no había plan B guardado.
 *
 * Prioriza canales VEVO/Topic/Official y filtra versiones karaoke/cover/instrumental.
 * @param expectedDurationSec  Duración en segundos del track de iTunes (opcional, mejora la precisión)
 */
export async function resolveYoutubeIdWithAlternates(
  itunesId: number,
  artistName: string,
  trackName: string,
  expectedDurationSec?: number
): Promise<YoutubeResolution | null> {
  const cacheKey = `yt-res-full:${itunesId}`;

  // L1: memoria
  const inMemory = cache.get(cacheKey);
  if (inMemory) {
    try { return JSON.parse(inMemory) as YoutubeResolution; } catch {}
  }

  // L2: Supabase
  const fromDB = await getYouTubeResolutionFull(itunesId);
  if (fromDB) {
    const resolution: YoutubeResolution = { primary: fromDB.youtube_id, alternates: fromDB.alt_youtube_ids || [] };
    cache.setex(cacheKey, 86400 * 30, JSON.stringify(resolution)); // recalentar L1 (30 días)
    return resolution;
  }

  // L3: búsqueda de YouTube
  try {
    // Usamos "official audio" para sesgar los resultados de YouTube hacia contenido oficial
    const query = `${artistName} ${trackName} official audio`;
    const videos = await searchYoutubeVideos(query, 15);

    if (videos.length === 0) return null;

    // Puntuar todos los candidatos y ordenar de mayor a menor score
    const scored = videos
      .map(v => ({ video: v, score: scoreVideo(v, artistName, trackName, expectedDurationSec) }))
      .filter(s => s.score > -Infinity) // descartar los bloqueados
      .sort((a, b) => b.score - a.score);

    // Elegir el mejor candidato; si todos fueron descartados, usar el primero sin filtrar
    const chosen = scored.length > 0 ? scored[0].video : videos[0];
    const youtubeId = chosen.id || chosen.videoId;
    const authorName = typeof chosen.author === 'string' ? chosen.author : chosen.author?.name;

    const reason = scored.length > 0
      ? `score=${scored[0].score}, canal="${authorName}"`
      : 'fallback (todos filtrados)';

    // Candidatos de respaldo: siguientes mejores puntuados, sin duplicar el elegido
    const alternates = scored
      .slice(1)
      .map(s => s.video.id || s.video.videoId)
      .filter((id: string | undefined): id is string => !!id && id !== youtubeId)
      .slice(0, MAX_ALTERNATES);

    console.log(`[YTResolver] "${artistName} - ${trackName}" → ${youtubeId} (${reason}), ${alternates.length} alternativas de respaldo`);

    const resolution: YoutubeResolution = { primary: youtubeId, alternates };

    // Persistir en L1 + L2
    cache.setex(cacheKey, 86400 * 30, JSON.stringify(resolution));
    cache.setex(`yt-res:${itunesId}`, 86400 * 30, youtubeId); // compat con lectores del string plano
    upsertYouTubeResolution(itunesId, youtubeId, alternates).catch(() => {});

    return resolution;
  } catch (error) {
    console.error('[YTResolver] Error resolviendo YouTube ID:', error);
    return null;
  }
}

/**
 * Resuelve el YouTube ID para un artista + título dados.
 * Wrapper de compatibilidad sobre resolveYoutubeIdWithAlternates para
 * callers que solo necesitan el ID principal (sin gestión de fallback).
 */
export async function resolveYoutubeId(
  itunesId: number,
  artistName: string,
  trackName: string,
  expectedDurationSec?: number
): Promise<string | null> {
  const cacheKey = `yt-res:${itunesId}`;

  // L1: memoria (atajo — evita construir/parsear el objeto completo en el camino caliente)
  const inMemory = cache.get(cacheKey);
  if (inMemory) return inMemory;

  const resolution = await resolveYoutubeIdWithAlternates(itunesId, artistName, trackName, expectedDurationSec);
  return resolution?.primary ?? null;
}

/**
 * Promueve un candidato alternativo a principal tras confirmar que resuelve
 * y reproduce correctamente, mientras el anterior falló. Así las próximas
 * peticiones de este track van directas al que sí funciona.
 */
export async function promoteYoutubeCandidate(
  itunesId: number,
  workingYoutubeId: string,
  remainingAlternates: string[]
): Promise<void> {
  cache.setex(`yt-res:${itunesId}`, 86400 * 30, workingYoutubeId);
  cache.setex(
    `yt-res-full:${itunesId}`,
    86400 * 30,
    JSON.stringify({ primary: workingYoutubeId, alternates: remainingAlternates } as YoutubeResolution)
  );
  await upsertYouTubeResolution(itunesId, workingYoutubeId, remainingAlternates).catch(() => {});
  console.log(`[YTResolver] Candidato promovido a principal para itunesId=${itunesId}: ${workingYoutubeId}`);
}

