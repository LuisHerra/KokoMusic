/**
 * Stream Route — KokoMusic (InnerTube via KokoMusic-lite)
 *
 * Flujo de streaming:
 *   1. Si es custom track upload → stream local o redirect
 *   2. Resolver videoId de YouTube (cache L1/L2 o búsqueda)
 *   3. Resolver stream con KokoMusic-lite (InnerTube)
 *   4. Redirigir 302 a la URL directa del stream (o proxy si req.query.proxy=true)
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import { resolveYoutubeIdWithAlternates, promoteYoutubeCandidate } from '../services/ytResolverService';
import { getTrackById } from '../services/metadataService';
import { cache } from '../services/cacheService';
import {
  resolveAudioStream,
  purgeStreamCache,
  type ResolvedStream,
} from '../services/streamResolverService';
import { diagnoseLiteStream } from '../services/kokoLiteService';
import { metrics } from '../services/metricsService';
import { findTrackInCDN, isCDNEnabled, getCDNUsageStats } from '../services/cdnService';
import { cacheStreamInBackground } from '../services/cdnAutoCacheService';
import { getStreamRelayUrl } from '../services/kokoLiteService';

const router = Router();

function stringToSafeIntegerHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash % 4503599627370495);
}

/** Stream de archivo local con soporte Range (para custom tracks) */
function streamLocalFile(req: Request, res: Response, filePath: string, contentType = 'audio/mpeg'): void {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

/** Proxy de fallback hacia URL directa de audio (activable con ?proxy=true) */
async function proxyAudioStream(req: Request, res: Response, rawUrl: string, defaultContentType = 'audio/mp4'): Promise<boolean> {
  const requestHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Connection': 'keep-alive',
  };
  // Googlevideo throttla brutalmente las descargas sin cabecera Range (anti-scraping).
  // Si el cliente no pidió un rango, forzamos uno abierto hacia el upstream para
  // recibir el stream a velocidad normal.
  requestHeaders['Range'] = req.headers.range || 'bytes=0-';

  try {
    const upstream = await fetch(rawUrl, { headers: requestHeaders });

    if (!upstream.ok && upstream.status !== 206) {
      metrics.recordStreamProxy('error');
      console.error(`[Stream] Proxy upstream error ${upstream.status} para URL: ${rawUrl.substring(0, 80)}...`);
      return false;
    }

    // Googlevideo a veces responde 200 con un cuerpo HTML/JSON de error (captcha,
    // rate-limit, URL caducada) en vez del binario de audio. Si lo reenviamos tal
    // cual, el <audio> del cliente recibe "bytes" que no son audio y lanza
    // MEDIA_ELEMENT_ERROR (Format error) tras descargarlos — detectarlo aquí y
    // tratarlo como fallo permite reintentar con una URL fresca ANTES de que el
    // cliente llegue a ver ningún byte.
    const ct = upstream.headers.get('content-type');
    if (ct && !ct.startsWith('audio/') && !ct.startsWith('video/') && !ct.includes('octet-stream')) {
      metrics.recordStreamProxy('error');
      console.error(`[Stream] Proxy upstream devolvió content-type no-audio "${ct}" para URL: ${rawUrl.substring(0, 80)}...`);
      return false;
    }

    const responseHeaders: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    };

    if (ct) responseHeaders['Content-Type'] = ct;
    else responseHeaders['Content-Type'] = defaultContentType;

    const cl = upstream.headers.get('content-length');
    if (cl) responseHeaders['Content-Length'] = cl;

    const clientWantedRange = Boolean(req.headers.range);
    const cr = upstream.headers.get('content-range');
    if (cr && clientWantedRange) responseHeaders['Content-Range'] = cr;

    res.writeHead(upstream.status === 206 && clientWantedRange ? 206 : 200, responseHeaders);

    if (upstream.body) {
      const reader = upstream.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) { res.end(); break; }
          if (!res.write(value)) {
            await new Promise(resolve => res.once('drain', resolve));
          }
        }
      };
      pump().catch(() => { if (!res.writableEnded) res.end(); });
    } else {
      res.end();
    }
    metrics.recordStreamProxy('ok');
    return true;
  } catch (e) {
    metrics.recordStreamProxy('error');
    console.error('[Stream] Error en proxy de audio:', e);
    return false;
  }
}

async function resolveYoutubeIdForTrack(itunesId: string): Promise<{
  youtubeId: string | null;
  /** Candidatos de respaldo si `youtubeId` no resuelve — ver PROMOTE_CANDIDATE_ON_FALLBACK. */
  alternates: string[];
  /** itunesId numérico necesario para promover un candidato alternativo — null si no aplica (custom/directo). */
  resolvableItunesId: number | null;
  isDirectYouTube: boolean;
  artist?: string;
  title?: string;
  durationSeconds?: number;
}> {
  let youtubeId: string | null = null;
  let alternates: string[] = [];
  let resolvableItunesId: number | null = null;
  let isDirectYouTube = false;
  let artist: string | undefined;
  let title: string | undefined;
  let durationSeconds = 0;

  if (itunesId.startsWith('custom_')) {
    const { getCustomTrackById } = await import('../services/customTracksService');
    const customTrack = getCustomTrackById(itunesId);
    if (customTrack && customTrack.sourceType === 'youtube_alias') {
      youtubeId = customTrack.youtubeId || null;
      durationSeconds = Math.round((customTrack.duration || 0) / 1000);
      artist = customTrack.artist;
      title = customTrack.title;
    }
  } else {
    const cleanYtId = itunesId.startsWith('yt_') ? itunesId.slice(3) : itunesId;
    const isLegacyYoutubeId = /^[a-zA-Z0-9_-]{11}$/.test(cleanYtId) && isNaN(Number(cleanYtId));
    if (isLegacyYoutubeId) {
      isDirectYouTube = true;
      const cachedRes = cache.get(`yt-res:${cleanYtId}`) as string | undefined;
      if (cachedRes) {
        youtubeId = cachedRes;
      } else {
        const hashedId = stringToSafeIntegerHash(cleanYtId);
        const { getYouTubeResolution } = await import('../services/supabaseService');
        const overridden = await getYouTubeResolution(hashedId);
        youtubeId = overridden || cleanYtId;
        cache.setex(`yt-res:${cleanYtId}`, 86400 * 30, youtubeId);
      }
      const trackMeta = await getTrackById(itunesId);
      if (trackMeta) {
        artist = trackMeta.artist;
        title = trackMeta.title;
        durationSeconds = Math.round((trackMeta.duration || 0) / 1000);
      }
    } else {
      const itunesIdNum = Number(itunesId);
      const track = await getTrackById(itunesIdNum);
      if (track) {
        artist = track.artist;
        title = track.title;
        durationSeconds = Math.round((track.duration || 0) / 1000);
        const resolution = await resolveYoutubeIdWithAlternates(itunesIdNum, track.artist, track.title, durationSeconds);
        youtubeId = resolution?.primary ?? null;
        alternates = resolution?.alternates ?? [];
        resolvableItunesId = itunesIdNum;
      }
    }
  }

  return { youtubeId, alternates, resolvableItunesId, isDirectYouTube, artist, title, durationSeconds };
}

/**
 * Tras agotar el videoId principal, prueba los candidatos alternativos
 * guardados (otros vídeos del mismo tema) antes de rendirse. Si uno
 * resuelve, lo promueve a principal para que las próximas peticiones vayan
 * directas a él. Acotado a los candidatos guardados (máx. 3) para no volar
 * la latencia — cada intento ya falla rápido gracias a la caché negativa de
 * kokoLiteClient si ya se había probado antes.
 */
async function resolveWithAlternates(
  primaryYoutubeId: string,
  alternates: string[],
  resolvableItunesId: number | null,
  hints: { artist?: string; title?: string; itunesId: string; quality?: string }
): Promise<{ youtubeId: string; resolvedStream: ResolvedStream } | null> {
  let resolvedStream = await resolveAudioStream(primaryYoutubeId, hints);
  if (resolvedStream?.url) return { youtubeId: primaryYoutubeId, resolvedStream };

  const remaining = [...alternates];
  while (remaining.length > 0) {
    const candidate = remaining.shift()!;
    console.warn(`[Stream] Video principal ${primaryYoutubeId} no resolvió — probando candidato alternativo ${candidate}`);
    resolvedStream = await resolveAudioStream(candidate, hints);
    if (resolvedStream?.url) {
      if (resolvableItunesId !== null) {
        promoteYoutubeCandidate(resolvableItunesId, candidate, remaining).catch(() => {});
      }
      return { youtubeId: candidate, resolvedStream };
    }
  }

  return null;
}

// ── GET /api/stream/:itunesId — Stream o Redirect 302 ──────────────────────────

router.get('/:itunesId', async (req: Request, res: Response) => {
  const { itunesId } = req.params;

  if (!itunesId) {
    return res.status(400).json({ error: 'itunesId requerido' });
  }

  try {
    // 1. Manejo de tracks custom subidos
    if (itunesId.startsWith('custom_')) {
      const { getCustomTrackById } = await import('../services/customTracksService');
      const customTrack = getCustomTrackById(itunesId);
      if (!customTrack) {
        return res.status(404).json({ error: 'Track custom no encontrado' });
      }

      if (customTrack.sourceType !== 'youtube_alias') {
        if (customTrack.audioUrl) {
          return res.redirect(302, customTrack.audioUrl);
        }
        const audioPath = customTrack.audioPath;
        if (!audioPath || !fs.existsSync(audioPath)) {
          return res.status(404).json({ error: 'Archivo de audio local no encontrado' });
        }
        const contentType = audioPath.endsWith('.opus') ? 'audio/ogg; codecs=opus' : 'audio/mpeg';
        streamLocalFile(req, res, audioPath, contentType);
        return;
      }
    }

    // El cliente pide bytes reales (no un redirect) cuando necesita leerlos con
    // fetch() para guardarlos en IndexedDB offline — ver lib/offlineAudio.ts.
    // Es la única razón real para seguir proxyando en vez de redirigir.
    const forceStream = req.query.forceStream === 'true';

    // 2. Comprobar si ya lo tenemos cacheado en R2 — si es así, ni tocamos
    // KokoMusic-lite ni googlevideo. Evita por completo el problema de IP.
    const cdnUrl = await findTrackInCDN(itunesId);
    if (cdnUrl) {
      if (!forceStream) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.redirect(302, cdnUrl);
      }
      const proxiedFromCdn = await proxyAudioStream(req, res, cdnUrl, 'audio/ogg; codecs=opus');
      if (!proxiedFromCdn && !res.headersSent) {
        res.status(502).json({ error: 'Stream temporalmente no disponible' });
      }
      return;
    }

    // 3. Resolución de IDs y metadatos
    const { youtubeId: primaryYoutubeId, alternates, resolvableItunesId, artist, title } = await resolveYoutubeIdForTrack(itunesId);

    if (!primaryYoutubeId) {
      return res.status(404).json({ error: 'No se pudo resolver la fuente de audio para este track' });
    }

    // 4. Resolver mediante KokoMusic-lite (con bitrate adaptativo/elástico).
    // Si el video principal no resuelve (bloqueado, retirado...), prueba los
    // candidatos alternativos guardados (otros vídeos del mismo tema) antes
    // de rendirse — así una canción que le gusta al usuario sigue sonando
    // aunque su video "elegido" original ya no sirva.
    const quality = (req.query.quality as string) || (req.query.bitrate as string) || undefined;
    const resolved = await resolveWithAlternates(primaryYoutubeId, alternates, resolvableItunesId, {
      artist,
      title,
      itunesId,
      quality,
    });

    if (!resolved) {
      return res.status(404).json({
        error: 'No se pudo obtener el stream de audio desde KokoMusic-lite.',
      });
    }

    const youtubeId = resolved.youtubeId;
    let resolvedStream = resolved.resolvedStream;

    // La URL cruda de KokoMusic-lite viene firmada con la IP exacta del proxy
    // residencial que la pidió (`ip=` dentro de la propia URL) — confirmado
    // con un test aislado: 403 desde cualquier otra IP, 206 desde esa misma.
    // Ni el navegador/APK del usuario final ni nuestro propio backend
    // comparten esa IP, así que ya no podemos usar resolvedStream.url
    // directamente en ningún lado (ni redirect ni proxy ni caché a R2) —
    // todo pasa por este endpoint de KokoMusic-lite, que reenvía los bytes
    // él mismo a través de su proxy activo.
    const relayUrl = getStreamRelayUrl(youtubeId);

    // La primera vez que resolvemos un track con éxito, lo cacheamos en R2 en
    // segundo plano — las próximas reproducciones lo encontrarán en el paso 2
    // de arriba y nunca volverán a depender de Google ni de proxies.
    cacheStreamInBackground(itunesId, relayUrl);

    // 5. Camino principal (reproducción normal en <audio>): 302 al endpoint
    // de KokoMusic-lite (no a la URL cruda de googlevideo). Funciona igual de
    // bien en móvil/APK que un 302 directo — el reproductor nativo sigue la
    // redirección igual — pero mantiene la descarga en la misma IP que la
    // resolvió.
    if (!forceStream) {
      res.setHeader('Cache-Control', 'public, max-age=1800');
      return res.redirect(302, relayUrl);
    }

    // 6. Proxy del stream (solo para forceStream=true — descarga offline).
    let proxied = await proxyAudioStream(req, res, relayUrl, resolvedStream.mimeType);

    // KokoMusic-lite ya reintenta internamente con resolución fresca si su
    // primer intento de reenvío falla (proxy rotado, URL cacheada vieja) —
    // aun así, un par de reintentos más aquí cubre fallos transitorios de
    // red entre nuestro backend y KokoMusic-lite (el cliente igualmente
    // tiene su propio fallback a YouTube Embed si todo esto falla).
    let attempts = 1;
    while (!proxied && !res.headersSent && attempts < 3) {
      attempts++;
      console.warn(`[Stream] Reenvío falló para ${youtubeId}, reintentando (intento ${attempts}/3)...`);
      proxied = await proxyAudioStream(req, res, relayUrl, resolvedStream.mimeType);
    }

    if (!proxied && !res.headersSent) {
      res.status(502).json({ error: 'Stream temporalmente no disponible' });
    }

  } catch (error) {
    console.error('[Stream] Error en endpoint de stream:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al iniciar el stream' });
    }
  }
});

// ── GET /api/stream/:itunesId/resolve — JSON directo para clientes/apps ────────

router.get('/:itunesId/resolve', async (req: Request, res: Response) => {
  const { itunesId } = req.params;

  try {
    const { youtubeId, artist, title, durationSeconds } = await resolveYoutubeIdForTrack(itunesId);

    if (!youtubeId) {
      return res.status(404).json({ error: 'No se pudo resolver el ID de audio para este track' });
    }

    const resolvedStream = await resolveAudioStream(youtubeId, { artist, title, itunesId });
    if (!resolvedStream) {
      return res.status(404).json({ error: 'No se pudo resolver el stream de audio' });
    }

    return res.json({
      trackId: itunesId,
      youtubeId,
      durationSeconds,
      ...resolvedStream,
    });
  } catch (err: any) {
    console.error('[Stream] Error en /resolve:', err);
    return res.status(500).json({ error: 'Error resolviendo stream' });
  }
});

// ── POST /api/stream/:itunesId/purge-cache — Invalida caché local y de Lite ─────

router.post('/:itunesId/purge-cache', async (req: Request, res: Response) => {
  const { itunesId } = req.params;

  try {
    const { youtubeId } = await resolveYoutubeIdForTrack(itunesId);
    if (youtubeId) {
      await purgeStreamCache(youtubeId);
    }
    return res.json({ success: true, itunesId, youtubeId });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Error purgando cache' });
  }
});

// Alias DELETE /api/stream/:itunesId/cache
router.delete('/:itunesId/cache', async (req: Request, res: Response) => {
  const { itunesId } = req.params;

  try {
    const { youtubeId } = await resolveYoutubeIdForTrack(itunesId);
    if (youtubeId) {
      await purgeStreamCache(youtubeId);
    }
    return res.json({ success: true, itunesId, youtubeId });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Error purgando cache' });
  }
});

// ── GET /api/stream/:itunesId/diagnose — Diagnóstico de clientes InnerTube ─────

router.get('/:itunesId/diagnose', async (req: Request, res: Response) => {
  const { itunesId } = req.params;

  try {
    const { youtubeId } = await resolveYoutubeIdForTrack(itunesId);
    if (!youtubeId) {
      return res.status(404).json({ error: 'No se pudo resolver el ID del track' });
    }

    const diagnosis = await diagnoseLiteStream(youtubeId);
    return res.json({ trackId: itunesId, youtubeId, ...diagnosis });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Error diagnosticando stream' });
  }
});

// ── POST /api/stream/prefetch — Pre-resolución con delay 250ms ─────────────────

router.post('/prefetch', async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: 'ids debe ser un array' });
  }

  // Pre-calentar la resolución en memoria con delay entre peticiones (250ms)
  setImmediate(async () => {
    for (const id of ids.slice(0, 5)) {
      try {
        const { youtubeId, artist, title } = await resolveYoutubeIdForTrack(String(id));
        if (youtubeId) {
          await resolveAudioStream(youtubeId, { artist, title, itunesId: id });
        }
      } catch {}
      // Espaciado para respetar los límites de InnerTube
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  });

  return res.json({ success: true, prefetching: Math.min(ids.length, 5) });
});

// ── GET /api/stream/:itunesId/status ─────────────────────────────────────────

router.get('/:itunesId/status', async (req: Request, res: Response) => {
  const { itunesId } = req.params;

  try {
    const { youtubeId } = await resolveYoutubeIdForTrack(itunesId);

    if (!youtubeId) {
      return res.json({
        trackId: itunesId,
        downloaded: false,
        cached: false,
        status: 'none',
        message: 'No se pudo resolver el ID de audio',
      });
    }

    const isCached = !!cache.get(`resolved-stream:${youtubeId}`);

    res.json({
      trackId: itunesId,
      youtubeId,
      inCDN: false,
      downloaded: false,
      cached: isCached,
      cdnEnabled: false,
      status: isCached ? 'ready' : 'ready',
    });
  } catch (err) {
    res.json({
      trackId: itunesId,
      downloaded: false,
      cached: false,
      status: 'none',
      error: String(err),
    });
  }
});

// ── POST /api/stream/:itunesId/download ───────────────────────────────────────

router.post('/:itunesId/download', async (req: Request, res: Response) => {
  const { itunesId } = req.params;

  try {
    const { youtubeId, artist, title, durationSeconds } = await resolveYoutubeIdForTrack(itunesId);

    if (!youtubeId) {
      return res.status(404).json({ error: 'No se pudo resolver la canción para descargar' });
    }

    const resolvedStream = await resolveAudioStream(youtubeId, { artist, title, itunesId });

    res.json({
      success: true,
      status: 'ready',
      directUrl: resolvedStream?.url || null,
      source: resolvedStream?.source || 'innertube',
      mimeType: resolvedStream?.mimeType || 'audio/mp4',
      durationSeconds,
      message: 'Stream resuelto para descarga directa',
    });
  } catch (err) {
    console.error('[Stream] Error en descarga:', err);
    res.status(500).json({ error: 'Error al resolver URL de descarga' });
  }
});

// ── GET /api/stream/cdn/stats ─────────────────────────────────────────────────

router.get('/cdn/stats', (_req: Request, res: Response) => {
  if (!isCDNEnabled()) {
    return res.json({
      enabled: false,
      message: 'CDN desactivado (faltan credenciales R2 en el entorno).',
    });
  }
  res.json({ enabled: true, ...getCDNUsageStats() });
});

export default router;
