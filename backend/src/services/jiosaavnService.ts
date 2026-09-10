/**
 * JioSaavn Service — KokoMusic
 *
 * Fuente alternativa de audio independiente de YouTube.
 * Catálogo masivo internacional y regional, sin bloqueos de IP en servidores cloud.
 * Entrega enlaces directos de Akamai CDN en formato AAC (96k, 160k, 320k) con latencia <200ms.
 */

import { cache } from './cacheService';
import { desEcbDecrypt } from './desCrypto';

export interface JioSaavnTrackResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  year?: string;
  language?: string;
  label?: string;
  coverUrl?: string;
  hasLyrics?: boolean;
  streamUrl: string;       // Default 320kbps o 160kbps
  streamUrl320: string;
  streamUrl160: string;
  streamUrl96: string;
  source: 'jiosaavn';
}

const DES_KEY_STR = '38346591';

/**
 * Desencripta la media_url cifrada con DES-ECB de JioSaavn.
 */
export function decryptMediaUrl(encryptedUrl: string): string {
  if (!encryptedUrl) return '';
  return desEcbDecrypt(encryptedUrl, DES_KEY_STR);
}

const KARAOKE_COVER_KEYWORDS = [
  'karaoke',
  'instrumental',
  'originally perfomed by',
  'originally performed by',
  'in the style of',
  'tribute to',
  'tribute',
  'piano cover',
  'piano version',
  'piano instrumental',
  'guitar cover',
  'backing track',
  'lullaby',
  '8-bit',
  'string quartet',
  'acoustic cover',
  'orchestral tribute',
  'melody karaoke',
];

function isKaraokeOrCover(text?: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return KARAOKE_COVER_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Limpia y normaliza texto para comparación fuzzy.
 */
function normalizeStr(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Quitar tildes
    .replace(/\b(feat|ft|featuring|remaster|remastered|official|audio|video|lyrics|version|edit)\b/gi, '')
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Comprueba similitud básica entre dos strings normalizados.
 */
function matchScore(target: string, candidate: string): number {
  const normTarget = normalizeStr(target);
  const normCandidate = normalizeStr(candidate);

  if (normTarget === normCandidate) return 1.0;
  if (normCandidate.includes(normTarget) || normTarget.includes(normCandidate)) return 0.85;

  const targetWords = normTarget.split(' ').filter(w => w.length > 1);
  const candidateWords = new Set(normCandidate.split(' ').filter(w => w.length > 1));

  if (targetWords.length === 0) return 0;
  let matches = 0;
  for (const word of targetWords) {
    if (candidateWords.has(word)) matches++;
  }

  return matches / targetWords.length;
}

/**
 * Formatea la URL de portada a alta resolución (500x500).
 */
function enhanceCoverUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return url.replace(/150x150/g, '500x500').replace(/50x50/g, '500x500');
}

/**
 * Busca una canción en JioSaavn y resuelve sus enlaces directos de audio CDN.
 */
export async function searchJioSaavn(artist: string, title: string): Promise<JioSaavnTrackResult | null> {
  const query = `${artist} ${title}`.trim();
  const cacheKey = `jiosaavn:${query.toLowerCase()}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as JioSaavnTrackResult;
    } catch {
      // Ignorar error
    }
  }

  const searchUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&q=${encodeURIComponent(query)}&_format=json&_marker=0&api_version=4&ctx=android&n=10&p=1`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[JioSaavn] HTTP ${res.status} al buscar "${query}"`);
      return null;
    }

    const data = await res.json() as any;
    const results = data?.results || [];

    if (!Array.isArray(results) || results.length === 0) {
      return null;
    }

    const userWantsKaraoke = isKaraokeOrCover(title) || isKaraokeOrCover(artist);

    const INDIAN_REGIONAL_LANGUAGES = new Set([
      'telugu', 'tamil', 'punjabi', 'bhojpuri', 'malayalam',
      'kannada', 'marathi', 'bengali', 'gujarati', 'assamese',
      'haryanvi', 'rajasthani', 'odia', 'urdu', 'hindi'
    ]);

    let bestMatch: any = null;
    let highestScore = 0;

    for (const item of results) {
      const itemTitle = item.title || item.song || '';
      const itemArtist = item.more_info?.singers || item.more_info?.primary_artists || item.primary_artists || item.more_info?.music || '';
      const itemLabel = item.more_info?.label || '';
      const itemLang = (item.language || item.more_info?.language || '').toLowerCase();

      // Descartar karaokes/instrumentales/tributos si el usuario no los pidió explícitamente
      const candidateIsKaraoke = isKaraokeOrCover(itemTitle) || isKaraokeOrCover(itemArtist) || isKaraokeOrCover(itemLabel) || isKaraokeOrCover(itemLang) || itemLang === 'instrumental' || itemLang === 'karaoke';
      if (!userWantsKaraoke && candidateIsKaraoke) {
        continue;
      }

      const titleScore = matchScore(title, itemTitle);
      const artistScore = matchScore(artist, itemArtist);

      // Si la pista de JioSaavn es un tema regional indio y el artista no coincide con alta certeza (ej. OneRepublic vs tema telugu llamado "Run"), descartar
      if (INDIAN_REGIONAL_LANGUAGES.has(itemLang) && artistScore < 0.75) {
        continue;
      }

      // El artista DEBE coincidir con al menos 0.60 (no admitir coincidencias de título con artistas ajenos)
      if (artistScore < 0.60) {
        continue;
      }

      const combinedScore = (titleScore * 0.6) + (artistScore * 0.4);

      if (combinedScore > highestScore && titleScore >= 0.70 && artistScore >= 0.60) {
        highestScore = combinedScore;
        bestMatch = item;
      }
    }

    if (!bestMatch || highestScore < 0.65) {
      return null;
    }

    const encryptedUrl = bestMatch.more_info?.encrypted_media_url || bestMatch.encrypted_media_url;
    if (!encryptedUrl) {
      return null;
    }

    const decryptedUrl = decryptMediaUrl(encryptedUrl);
    if (!decryptedUrl || !decryptedUrl.startsWith('http')) {
      return null;
    }

    // Generar variantes de calidad (320k, 160k, 96k)
    let url320 = decryptedUrl;
    let url160 = decryptedUrl;
    let url96 = decryptedUrl;

    if (decryptedUrl.includes('_96.mp4')) {
      url320 = decryptedUrl.replace('_96.mp4', '_320.mp4');
      url160 = decryptedUrl.replace('_96.mp4', '_160.mp4');
    } else if (decryptedUrl.includes('_160.mp4')) {
      url320 = decryptedUrl.replace('_160.mp4', '_320.mp4');
      url96 = decryptedUrl.replace('_160.mp4', '_96.mp4');
    } else if (decryptedUrl.includes('_320.mp4')) {
      url160 = decryptedUrl.replace('_320.mp4', '_160.mp4');
      url96 = decryptedUrl.replace('_320.mp4', '_96.mp4');
    }

    const result: JioSaavnTrackResult = {
      id: String(bestMatch.id),
      title: bestMatch.title || bestMatch.song || title,
      artist: bestMatch.more_info?.singers || bestMatch.more_info?.primary_artists || artist,
      album: bestMatch.more_info?.album || bestMatch.album || '',
      durationMs: Number(bestMatch.more_info?.duration || bestMatch.duration || 0) * 1000,
      year: bestMatch.year || bestMatch.more_info?.year,
      language: bestMatch.language || bestMatch.more_info?.language,
      label: bestMatch.more_info?.label,
      coverUrl: enhanceCoverUrl(bestMatch.image),
      hasLyrics: bestMatch.more_info?.has_lyrics === 'true',
      streamUrl: url320, // 320k default
      streamUrl320: url320,
      streamUrl160: url160,
      streamUrl96: url96,
      source: 'jiosaavn',
    };

    // Cachear resultado por 4 horas
    cache.setex(cacheKey, 14400, JSON.stringify(result));
    console.log(`[JioSaavn] ✅ Match encontrado para "${artist} - ${title}" → ${result.title} (${result.language || 'unknown'}, score: ${highestScore.toFixed(2)})`);

    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[JioSaavn] Error en búsqueda de "${query}":`, (err as Error).message);
    return null;
  }
}
