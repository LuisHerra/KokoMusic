/**
 * InnerTube Service — KokoMusic
 *
 * Resuelve URLs de streaming directo de Google/YouTube usando la API interna InnerTube.
 * Emula clientes oficiales (ANDROID_MUSIC, ANDROID, IOS) para obtener enlaces directos
 * de googlevideo.com con latencia ultra-baja (<300ms) y sin necesidad de yt-dlp.
 */

import { cache } from './cacheService';

export interface InnerTubeStreamResult {
  url: string;
  mimeType: string;
  bitrate: number;
  durationMs: number;
  contentLength?: number;
  audioQuality?: string;
  clientUsed: string;
}

interface InnerTubeClientConfig {
  name: string;
  clientName: string;
  clientVersion: string;
  userAgent: string;
  clientIdHeader: string;
  androidSdkVersion?: number;
  osName?: string;
  osVersion?: string;
  deviceModel?: string;
}

const CLIENT_CONFIGS: InnerTubeClientConfig[] = [
  {
    name: 'ANDROID_MUSIC',
    clientName: 'ANDROID_MUSIC',
    clientVersion: '6.42.52',
    userAgent: 'com.google.android.apps.youtube.music/6.42.52 (Linux; U; Android 11; Pixel 5)',
    clientIdHeader: '21',
    androidSdkVersion: 30,
    osName: 'Android',
    osVersion: '11',
    deviceModel: 'Pixel 5',
  },
  {
    name: 'ANDROID',
    clientName: 'ANDROID',
    clientVersion: '19.09.37',
    userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11; Pixel 5) gzip',
    clientIdHeader: '3',
    androidSdkVersion: 30,
    osName: 'Android',
    osVersion: '11',
    deviceModel: 'Pixel 5',
  },
  {
    name: 'IOS',
    clientName: 'IOS',
    clientVersion: '19.09.3',
    userAgent: 'com.google.ios.youtube/19.09.3 (iPhone14,2; U; CPU iOS 16_5 like Mac OS X)',
    clientIdHeader: '5',
    osName: 'iOS',
    osVersion: '16.5.0.20F66',
    deviceModel: 'iPhone14,2',
  },
  {
    name: 'TV_EMBEDDED',
    clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    clientVersion: '2.0',
    userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/10.01) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15',
    clientIdHeader: '85',
  },
  {
    name: 'WEB_REMIX',
    clientName: 'WEB_REMIX',
    clientVersion: '1.20240318.01.00',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    clientIdHeader: '67',
  },
];

// Circuit breaker para InnerTube en caso de desafíos globales o cambios de endpoint
let innerTubeDisabledUntil = 0;
const INNERTUBE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos de cooldown si todos fallan

export function isInnerTubeDisabled(): boolean {
  return innerTubeDisabledUntil > 0 && Date.now() < innerTubeDisabledUntil;
}

function disableInnerTubeTemporarily(): void {
  innerTubeDisabledUntil = Date.now() + INNERTUBE_COOLDOWN_MS;
  console.warn(`[InnerTube] ⚠️ Circuit breaker activado por ${INNERTUBE_COOLDOWN_MS / 60000} minutos.`);
}

/**
 * Consulta la API de InnerTube para un cliente específico.
 */
async function fetchInnerTube(videoId: string, client: InnerTubeClientConfig): Promise<any | null> {
  const endpoint = client.name === 'ANDROID_MUSIC'
    ? 'https://music.youtube.com/youtubei/v1/player?prettyPrint=false'
    : 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

  const bodyContext: any = {
    client: {
      clientName: client.clientName,
      clientVersion: client.clientVersion,
      hl: 'en',
      gl: 'US',
    },
  };

  if (client.androidSdkVersion) {
    bodyContext.client.androidSdkVersion = client.androidSdkVersion;
  }
  if (client.osName) {
    bodyContext.client.osName = client.osName;
    bodyContext.client.osVersion = client.osVersion;
    bodyContext.client.deviceModel = client.deviceModel;
  }

  const payload = {
    context: bodyContext,
    videoId,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: 'HTML5_PREF_WANTS',
      },
    },
    contentCheckOk: true,
    racyCheckOk: true,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': client.userAgent,
    'X-YouTube-Client-Name': client.clientIdHeader,
    'X-YouTube-Client-Version': client.clientVersion,
    'Origin': 'https://music.youtube.com',
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn(`[InnerTube] ${client.name} HTTP ${res.status} para ${videoId}`);
      return null;
    }

    const data = await res.json() as any;
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[InnerTube] Error en ${client.name} para ${videoId}:`, (err as Error).message);
    return null;
  }
}

/**
 * Selecciona el mejor formato de audio del listado de adaptiveFormats.
 * Prioridad: Opus (audio/webm) > AAC (audio/mp4) > cualquier audio de alto bitrate.
 */
function pickBestAudioFormat(formats: any[]): any | null {
  if (!Array.isArray(formats) || formats.length === 0) return null;

  const audioFormats = formats.filter(f => {
    const mime = f.mimeType || '';
    return mime.startsWith('audio/') && (f.url || f.signatureCipher === undefined);
  });

  if (audioFormats.length === 0) return null;

  // 1. Opus preferente (mejor calidad por bitrate)
  const opusFormats = audioFormats
    .filter(f => (f.mimeType || '').includes('opus') && f.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  if (opusFormats.length > 0 && opusFormats[0].url) {
    return opusFormats[0];
  }

  // 2. AAC / MP4A preferente
  const aacFormats = audioFormats
    .filter(f => (f.mimeType || '').includes('mp4a') && f.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  if (aacFormats.length > 0 && aacFormats[0].url) {
    return aacFormats[0];
  }

  // 3. Cualquier formato con URL directa disponible ordenado por bitrate
  const anyFormats = audioFormats
    .filter(f => f.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  return anyFormats[0] || null;
}

/**
 * Resuelve la URL directa de streaming para un videoId de YouTube usando InnerTube.
 */
export async function getInnerTubeStreamUrl(videoId: string): Promise<InnerTubeStreamResult | null> {
  if (isInnerTubeDisabled()) {
    return null;
  }

  const cacheKey = `innertube-stream:${videoId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as InnerTubeStreamResult;
    } catch {
      // Ignorar error de parsing
    }
  }

  let lastStatus: string | undefined;

  for (const client of CLIENT_CONFIGS) {
    const data = await fetchInnerTube(videoId, client);
    if (!data) continue;

    const playability = data.playabilityStatus?.status;
    lastStatus = playability;

    if (playability === 'OK') {
      const formats = data.streamingData?.adaptiveFormats || [];
      const bestFormat = pickBestAudioFormat(formats);

      if (bestFormat && bestFormat.url) {
        const result: InnerTubeStreamResult = {
          url: bestFormat.url,
          mimeType: bestFormat.mimeType || 'audio/webm; codecs="opus"',
          bitrate: bestFormat.bitrate || 128000,
          durationMs: Number(bestFormat.approxDurationMs || data.videoDetails?.lengthSeconds * 1000 || 0),
          contentLength: bestFormat.contentLength ? Number(bestFormat.contentLength) : undefined,
          audioQuality: bestFormat.audioQuality || 'AUDIO_QUALITY_MEDIUM',
          clientUsed: client.name,
        };

        // googlevideo.com URLs suelen durar ~6 horas. Cacheamos por 90 minutos de forma segura.
        cache.setex(cacheKey, 5400, JSON.stringify(result));
        console.log(`[InnerTube] ✅ Stream resuelto con éxito usando ${client.name} para: ${videoId} (${result.mimeType}, ${Math.round(result.bitrate / 1000)}k)`);
        return result;
      }
    } else if (playability === 'UNPLAYABLE' || playability === 'LOGIN_REQUIRED') {
      console.warn(`[InnerTube] ${client.name} status: ${playability} para ${videoId} (motivo: ${data.playabilityStatus?.reason || 'desconocido'})`);
    }
  }

  console.warn(`[InnerTube] ❌ Ningún cliente de InnerTube pudo resolver URL para ${videoId} (último status: ${lastStatus})`);
  return null;
}

export interface RadioTrackCandidate {
  id: string;
  title: string;
  artist: string;
  cover: string;
  duration: number;
  youtubeId: string;
  popularity: number;
}

/**
 * Obtiene la lista de canciones de la Radio Oficial de YouTube Music (/next)
 * usando el generador de estaciones RDAMVM para un track.
 * Devuelve hasta 50 tracks recomendados contextuales de máxima calidad.
 */
export async function getInnerTubeRadioTracks(videoId: string): Promise<RadioTrackCandidate[]> {
  if (!videoId) return [];
  const cleanId = videoId.replace(/^yt_/, '');
  const cacheKey = `innertube-radio:${cleanId}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  try {
    const res = await fetch('https://music.youtube.com/youtubei/v1/next', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'X-YouTube-Client-Name': '67',
        'X-YouTube-Client-Version': '1.20240318.01.00',
        'Origin': 'https://music.youtube.com',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240318.01.00',
            hl: 'en',
            gl: 'US',
          }
        },
        videoId: cleanId,
        playlistId: 'RDAMVM' + cleanId,
      })
    });

    if (!res.ok) return [];
    const data = (await res.json()) as any;
    const queue = (data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents || []) as any[];

    const candidates: RadioTrackCandidate[] = [];
    for (const item of queue) {
      const panel = item.playlistPanelVideoRenderer;
      if (!panel || !panel.videoId) continue;

      const title = panel.title?.runs?.[0]?.text;
      const artist = panel.shortBylineText?.runs?.[0]?.text || panel.longBylineText?.runs?.[0]?.text || 'Various Artists';
      const thumbs = panel.thumbnail?.thumbnails || [];
      const cover = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : `https://img.youtube.com/vi/${panel.videoId}/hqdefault.jpg`;
      const durationStr = panel.lengthText?.runs?.[0]?.text; // e.g. "3:45"
      let durationMs = 210000;
      if (durationStr) {
        const parts = durationStr.split(':').map(Number);
        if (parts.length === 2) durationMs = (parts[0] * 60 + parts[1]) * 1000;
        else if (parts.length === 3) durationMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
      }

      if (title && panel.videoId !== cleanId) {
        candidates.push({
          id: `yt_${panel.videoId}`,
          title: title.replace(/\s*\((Official Video|Video Oficial|Official Audio|Audio Oficial|Lyrics|Letra)\)/gi, '').trim(),
          artist,
          cover,
          duration: durationMs,
          youtubeId: panel.videoId,
          popularity: 80,
        });
      }
    }

    if (candidates.length > 0) {
      cache.setex(cacheKey, 7200, JSON.stringify(candidates));
      console.log(`[InnerTube] 📻 Radio generada con éxito para ${cleanId}: ${candidates.length} canciones encontradas`);
    }
    return candidates;
  } catch (err) {
    console.error('[InnerTube] Error fetching radio tracks for', cleanId, ':', (err as Error).message);
    return [];
  }
}

