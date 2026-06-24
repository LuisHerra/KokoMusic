/**
 * Invidious Service
 * Fallback descentralizado para búsqueda y resolución de YouTube cuando
 * la IP del servidor está bloqueada por YouTube (caso común en Hugging Face Spaces).
 * Obtiene instancias activas de https://api.invidious.io/instances.json
 * y realiza búsquedas / extracción de stream proxy.
 */

import fs from 'fs';

// Instancias estables de fallback en caso de que falle la carga dinámica
const FALLBACK_INSTANCES = [
  'https://inv.tux.pizza',
  'https://yewtu.be',
  'https://invidious.projectsegfau.lt',
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.no-logs.com',
  'https://invidious.privacydev.net'
];

let cachedInstances: string[] = [...FALLBACK_INSTANCES];
let lastFetchedTime = 0;
let isFetchingList = false;

/**
 * Actualiza la lista de instancias públicas de Invidious desde la API oficial.
 */
async function refreshInstancesList(): Promise<void> {
  if (isFetchingList) return;
  isFetchingList = true;
  try {
    console.log('[InvidiousService] Actualizando lista de instancias públicas...');
    const res = await fetch('https://api.invidious.io/instances.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as any;

    const instances: { uri: string; score: number }[] = [];

    const processItem = (domain: string, details: any) => {
      if (details.type === 'https' && details.api !== false) {
        const uri = details.uri || `https://${domain}`;
        const score = Number(details.health?.score ?? 0);
        instances.push({ uri, score });
      }
    };

    if (Array.isArray(data)) {
      for (const item of data) {
        if (Array.isArray(item) && item.length >= 2) {
          processItem(item[0], item[1]);
        }
      }
    } else if (data && typeof data === 'object') {
      for (const [domain, details] of Object.entries(data)) {
        processItem(domain, details);
      }
    }

    // Filtrar instancias con salud aceptable (>= 75) y ordenar de mayor a menor
    const sorted = instances
      .filter(inst => inst.score >= 75)
      .sort((a, b) => b.score - a.score)
      .map(inst => inst.uri);

    if (sorted.length > 0) {
      // Unir ordenadamente con los fallbacks para no perder los de confianza
      cachedInstances = Array.from(new Set([...sorted, ...FALLBACK_INSTANCES]));
      lastFetchedTime = Date.now();
      console.log(`[InvidiousService] Lista de instancias actualizada. Total: ${cachedInstances.length}`);
    }
  } catch (err) {
    console.error('[InvidiousService] Error obteniendo lista de instancias de api.invidious.io:', err);
    // Conservamos los fallbacks actuales
  } finally {
    isFetchingList = false;
  }
}

/**
 * Busca videos en Invidious como fallback de yt-search.
 */
export async function searchInvidious(query: string, limit = 20): Promise<any[]> {
  if (Date.now() - lastFetchedTime > 4 * 3600 * 1000) { // refrescar cada 4 horas
    refreshInstancesList().catch(() => {});
  }

  const instancesToTry = [...cachedInstances];
  for (const instance of instancesToTry) {
    try {
      const searchUrl = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&fields=title,videoId,author,lengthSeconds,videoThumbnails,viewCount`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout por instancia

      const res = await fetch(searchUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) continue;

      const data = await res.json() as any;
      if (Array.isArray(data)) {
        const videos = data.filter((item: any) => item.type === 'video' && item.videoId);
        if (videos.length > 0) {
          return videos.slice(0, limit).map((v: any) => ({
            videoId: v.videoId,
            title: v.title,
            author: {
              name: v.author || 'Desconocido'
            },
            duration: {
              seconds: v.lengthSeconds || 0
            },
            thumbnail: v.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
            views: v.viewCount || 0
          }));
        }
      }
    } catch (err) {
      console.warn(`[InvidiousService] Falló búsqueda en ${instance}:`, (err as Error).message);
    }
  }

  console.error(`[InvidiousService] Fallaron todas las instancias para la búsqueda: "${query}"`);
  return [];
}

/**
 * Obtiene el stream URL proxied (local=true) de un video de YouTube vía Invidious.
 */
export async function getInvidiousStreamUrl(videoId: string): Promise<string | null> {
  if (Date.now() - lastFetchedTime > 4 * 3600 * 1000) {
    refreshInstancesList().catch(() => {});
  }

  const instancesToTry = [...cachedInstances];
  for (const instance of instancesToTry) {
    try {
      const videoUrl = `${instance}/api/v1/videos/${videoId}?local=true`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);

      const res = await fetch(videoUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) continue;

      const data = await res.json() as any;
      if (data && Array.isArray(data.adaptiveFormats)) {
        // Filtrar solo streams de audio
        const audioStreams = data.adaptiveFormats.filter((f: any) => f.type && f.type.startsWith('audio/'));
        if (audioStreams.length === 0) continue;

        // Preferir opus (webm), luego m4a
        const opusStream = audioStreams.find((f: any) => f.type.includes('codecs="opus"'));
        const selectedStream = opusStream || audioStreams[0];

        if (selectedStream.url) {
          let streamUrl = selectedStream.url;
          if (streamUrl.startsWith('/')) {
            streamUrl = `${instance}${streamUrl}`;
          }
          return streamUrl;
        }
      }
    } catch (err) {
      console.warn(`[InvidiousService] Falló extracción de stream en ${instance}:`, (err as Error).message);
    }
  }

  return null;
}

/**
 * Obtiene los detalles de un video desde Invidious como fallback.
 */
export async function getInvidiousTrackById(videoId: string): Promise<any | null> {
  if (Date.now() - lastFetchedTime > 4 * 3600 * 1000) {
    refreshInstancesList().catch(() => {});
  }

  const instancesToTry = [...cachedInstances];
  for (const instance of instancesToTry) {
    try {
      const videoUrl = `${instance}/api/v1/videos/${videoId}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(videoUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) continue;

      const v = await res.json() as any;
      if (v && v.videoId) {
        return {
          videoId: v.videoId,
          title: v.title,
          author: {
            name: v.author || 'Desconocido'
          },
          duration: {
            seconds: v.lengthSeconds || 0
          },
          thumbnail: v.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
          views: v.viewCount || 0
        };
      }
    } catch (err) {
      console.warn(`[InvidiousService] Falló getTrackById en ${instance}:`, (err as Error).message);
    }
  }

  return null;
}
