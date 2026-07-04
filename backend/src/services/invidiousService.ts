/**
 * Invidious Service
 * Fallback descentralizado para búsqueda y resolución de YouTube cuando
 * la IP del servidor está bloqueada por YouTube (caso común en Hugging Face Spaces).
 *
 * Mecanismos de resiliencia:
 *  - Circuit breaker por instancia: si una instancia devuelve 401/403/timeout,
 *    se le aplica un cooldown de INSTANCE_COOLDOWN_MS antes de reintentarla.
 *  - Circuit breaker de yt-search: si yt-search falla N veces seguidas,
 *    se salta yt-search durante YT_SEARCH_COOLDOWN_MS y va directo a Invidious.
 */

// ── Invidious desactivado — usando yt-dlp como fuente principal ——————————————
// Invidious era un fallback para servidores cloud con IP bloqueada por YouTube.
// Con yt-dlp funcionando localmente con IP residencial ya no es necesario.
// Las instancias están vacías para que todos los callers reciban [] / null
// inmediatamente y usen sus propios fallbacks (yt-dlp, yt-search, etc.).
const FALLBACK_INSTANCES: string[] = [];

// ── Estado de caché de instancias ──────────────────────────────────────────────
let cachedInstances: string[] = [...FALLBACK_INSTANCES];
let lastFetchedTime = 0;
let isFetchingList = false;

// ── Circuit breaker por instancia ──────────────────────────────────────────────
// Mapa de instanceUri → timestamp hasta el que está en cooldown
const INSTANCE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutos
const instanceCooldowns = new Map<string, number>();

function isInstanceOnCooldown(uri: string): boolean {
  const until = instanceCooldowns.get(uri);
  if (!until) return false;
  if (Date.now() >= until) {
    instanceCooldowns.delete(uri);
    return false;
  }
  return true;
}

function penalizeInstance(uri: string): void {
  instanceCooldowns.set(uri, Date.now() + INSTANCE_COOLDOWN_MS);
  console.warn(`[InvidiousService] Instancia ${uri} en cooldown por ${INSTANCE_COOLDOWN_MS / 60000} min.`);
}

// ── Circuit breaker global de yt-search ────────────────────────────────────────
// yt-search hace scraping directo a youtube.com y falla cuando la IP está bloqueada
const YT_SEARCH_FAIL_THRESHOLD = 2;    // Fallos consecutivos para activar
const YT_SEARCH_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutos de cooldown

let ytSearchFailCount = 0;
let ytSearchDisabledUntil = 0;

/** Indica si yt-search debe saltarse por estar en cooldown. */
export function isYtSearchDisabled(): boolean {
  if (ytSearchDisabledUntil && Date.now() < ytSearchDisabledUntil) return true;
  return false;
}

/** Registra un fallo de yt-search y activa el circuit breaker si es necesario. */
export function recordYtSearchFailure(): void {
  // Si ya está desactivado, solo renovar el timer sin spam en logs
  if (isYtSearchDisabled()) {
    ytSearchDisabledUntil = Date.now() + YT_SEARCH_COOLDOWN_MS;
    return;
  }
  ytSearchFailCount++;
  if (ytSearchFailCount >= YT_SEARCH_FAIL_THRESHOLD) {
    ytSearchDisabledUntil = Date.now() + YT_SEARCH_COOLDOWN_MS;
    console.warn(
      `[InvidiousService] yt-search desactivado por ${YT_SEARCH_COOLDOWN_MS / 60000} min ` +
      `(${ytSearchFailCount} fallos). Usando Invidious directamente.`
    );
  }
}

/** Registra un éxito de yt-search y resetea el circuit breaker. */
export function recordYtSearchSuccess(): void {
  if (ytSearchFailCount > 0) {
    ytSearchFailCount = 0;
    ytSearchDisabledUntil = 0;
  }
}

// ── Actualización de lista dinámica de instancias ─────────────────────────────

/**
 * Actualiza la lista de instancias públicas de Invidious desde la API oficial.
 */
export async function refreshInstancesList(): Promise<void> {
  if (isFetchingList) return;
  isFetchingList = true;
  try {
    console.log('[InvidiousService] Actualizando lista de instancias públicas...');
    const res = await fetch('https://api.invidious.io/instances.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as any;

    const instances: { uri: string; score: number; hasApi: boolean }[] = [];

    const processItem = (domain: string, details: any) => {
      if (details.type === 'https') {
        const uri = details.uri || `https://${domain}`;

        // Filtrar dominios Yggdrasil (.ygg) — son una red overlay y no funcionan desde internet normal
        if (uri.endsWith('.ygg') || domain.endsWith('.ygg')) return;
        // Filtrar dominios .i2p — otra red overlay inaccesible
        if (uri.includes('.i2p') || domain.endsWith('.i2p')) return;
        
        const monitor = details.monitor;
        const uptime = Number(monitor?.uptime ?? 0);
        const lastStatus = monitor?.last_status;
        const isDown = monitor?.down === true;
        
        if (isDown || (lastStatus && lastStatus !== 200)) return;

        const score = monitor ? uptime : 50;
        const hasApi = details.api !== false;

        instances.push({ uri, score, hasApi });
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

    // Ordenar: primero API=true, luego por uptime desc
    const sorted = instances
      .sort((a, b) => {
        if (a.hasApi && !b.hasApi) return -1;
        if (!a.hasApi && b.hasApi) return 1;
        return b.score - a.score;
      })
      .map(inst => inst.uri);

    if (sorted.length > 0) {
      cachedInstances = Array.from(new Set([...sorted, ...FALLBACK_INSTANCES]));
      lastFetchedTime = Date.now();
      console.log(`[InvidiousService] Lista actualizada. Total: ${cachedInstances.length}`);
    }
  } catch (err) {
    console.error('[InvidiousService] Error obteniendo lista de instancias:', err);
  } finally {
    isFetchingList = false;
  }
}

// ── Helpers de fetch con circuit breaker ──────────────────────────────────────

/**
 * Realiza una petición GET a una instancia con timeout.
 * Penaliza la instancia si devuelve 401, 403 o 429 (rate limit) o si da timeout.
 * Devuelve `null` si la petición falla o debe saltarse.
 */
async function fetchFromInstance(
  instance: string,
  path: string,
  timeoutMs = 4000
): Promise<any | null> {
  if (isInstanceOnCooldown(instance)) return null;

  const url = `${instance}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    penalizeInstance(instance);
  }, timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if ([401, 403, 429].includes(res.status)) {
      penalizeInstance(instance);
      return null;
    }

    if (!res.ok) {
      console.warn(`[InvidiousService] ${instance} devolvió HTTP ${res.status}`);
      return null;
    }

    const text = await res.text();
    if (text.trim().startsWith('<')) {
      // HTML en vez de JSON → probablemente Cloudflare
      penalizeInstance(instance);
      return null;
    }

    return JSON.parse(text);
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = (err as Error).message;
    if (!msg.includes('aborted')) {
      // Penalizar también en errores de red (fetch failed, DNS, etc.)
      penalizeInstance(instance);
    }
    return null;
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Busca videos en Invidious como fallback de yt-search.
 */
export async function searchInvidious(query: string, limit = 20): Promise<any[]> {
  if (Date.now() - lastFetchedTime > 4 * 3600 * 1000) {
    refreshInstancesList().catch(() => {});
  }

  const path = `/api/v1/search?q=${encodeURIComponent(query)}&type=video&fields=title,videoId,author,lengthSeconds,videoThumbnails,viewCount`;

  for (const instance of cachedInstances) {
    const data = await fetchFromInstance(instance, path);
    if (!data) continue;

    if (Array.isArray(data)) {
      const videos = data.filter((item: any) => item.type === 'video' && item.videoId);
      if (videos.length > 0) {
        return videos.slice(0, limit).map((v: any) => ({
          videoId: v.videoId,
          title: v.title,
          author: { name: v.author || 'Desconocido' },
          duration: { seconds: v.lengthSeconds || 0 },
          thumbnail: v.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
          views: v.viewCount || 0
        }));
      }
    }
  }

  console.error(`[InvidiousService] Fallaron todas las instancias para: "${query}"`);
  return [];
}

/**
 * Obtiene la URL de audio directa (googlevideo.com) para un video vía Invidious.
 *
 * IMPORTANTE: NO usa local=true para no pedir que Invidious proxyfique el stream.
 * En su lugar, devolvemos la URL de googlevideo.com (CDN de Google) que:
 *   1. No está bloqueada desde cloud providers (es una CDN global, no la web de YouTube)
 *   2. No sobrecarga las instancias de Invidious (ellas solo sirven el metadata)
 *   3. Funciona con range requests para seeking correcto en el frontend
 *
 * Progresión de calidad intentada:
 *   1. opus/webm (mejor calidad, nativo en chromium)
 *   2. mp4a/m4a (AAC, compatibilidad universal)
 *   3. cualquier audio disponible
 */
export async function getInvidiousStreamUrl(videoId: string): Promise<string | null> {
  if (Date.now() - lastFetchedTime > 4 * 3600 * 1000) {
    refreshInstancesList().catch(() => {});
  }

  // Sin local=true → Invidious devuelve URLs directas de googlevideo.com
  for (const instance of cachedInstances) {
    const data = await fetchFromInstance(instance, `/api/v1/videos/${videoId}`, 8000);
    if (!data) continue;

    if (data && Array.isArray(data.adaptiveFormats)) {
      const audioStreams = data.adaptiveFormats.filter((f: any) => f.type?.startsWith('audio/'));
      if (audioStreams.length === 0) continue;

      // Prioridad: opus > aac > cualquier audio
      const opusStream = audioStreams.find((f: any) =>
        f.type?.includes('opus') || f.encoding?.toLowerCase() === 'opus'
      );
      const aacStream = audioStreams.find((f: any) =>
        f.type?.includes('mp4a') || f.encoding?.toLowerCase() === 'aac'
      );
      const selected = opusStream || aacStream || audioStreams[0];

      // Invidious puede devolver la URL con o sin dominio completo
      if (selected?.url) {
        let streamUrl: string = selected.url;
        if (streamUrl.startsWith('/')) streamUrl = `${instance}${streamUrl}`;
        console.log(`[InvidiousService] Stream URL obtenida de ${instance} (${selected.type || 'audio'})`);
        return streamUrl;
      }
    }

    // Fallback: si no hay adaptiveFormats, intentar formatStreams
    if (data && Array.isArray(data.formatStreams)) {
      const audioStream = data.formatStreams.find((f: any) =>
        f.type?.startsWith('audio/') || f.container === 'webm' || f.container === 'm4a'
      );
      if (audioStream?.url) {
        let streamUrl: string = audioStream.url;
        if (streamUrl.startsWith('/')) streamUrl = `${instance}${streamUrl}`;
        console.log(`[InvidiousService] Stream URL (formatStreams) de ${instance}`);
        return streamUrl;
      }
    }
  }

  console.error(`[InvidiousService] Ninguna instancia pudo obtener stream URL para: ${videoId}`);
  return null;
}

/**
 * Obtiene los detalles de un video desde Invidious como fallback.
 */
export async function getInvidiousTrackById(videoId: string): Promise<any | null> {
  if (Date.now() - lastFetchedTime > 4 * 3600 * 1000) {
    refreshInstancesList().catch(() => {});
  }

  for (const instance of cachedInstances) {
    const v = await fetchFromInstance(instance, `/api/v1/videos/${videoId}`);
    if (!v || !v.videoId) continue;

    return {
      videoId: v.videoId,
      title: v.title,
      author: { name: v.author || 'Desconocido' },
      duration: { seconds: v.lengthSeconds || 0 },
      thumbnail: v.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
      views: v.viewCount || 0
    };
  }

  return null;
}

// Invidious desactivado — no se auto-inicia la lista de instancias
