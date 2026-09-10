/**
 * Stream Route — Multi-Source Waterfall Architecture
 *
 * Flujo de streaming:
 *   1. Si es custom track upload → stream local o redirect CDN
 *   2. Si existe localmente en disco → stream local con soporte Range
 *   3. Resolver stream con StreamResolver (L1 Cache → CDN R2 → InnerTube → JioSaavn → Invidious → yt-dlp)
 *   4. Si es CDN R2 → redirect 302
 *   5. Si es InnerTube / JioSaavn / Invidious / yt-dlp → proxy en streaming con backpressure y Range support
 *   6. En background (no-bloqueante): si CDN está habilitado y es track corto, descargar + transcodificar para R2
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import { resolveYoutubeId } from '../services/ytResolverService';
import { getTrackById } from '../services/metadataService';
import { cache } from '../services/cacheService';
import {
  isCDNEnabled,
  findTrackInCDN,
  uploadToCDN,
  getCDNUsageStats,
  cleanupLargeLocalFiles,
  MAX_CDN_SIZE_MB,
  BUCKET_CAPACITY_MB,
} from '../services/cdnService';
import { downloadAndTranscode, getAudioPath, AUDIO_DIR } from '../services/ytdlpService';
import { resolveAudioStream, type ResolvedStream } from '../services/streamResolverService';

const router = Router();

// Limpieza de archivos locales antiguos al arrancar
cleanupLargeLocalFiles(AUDIO_DIR);

const EMBED_THRESHOLD_MIN = parseInt(process.env.EMBED_THRESHOLD_MIN ?? '25', 10);

function stringToSafeIntegerHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash % 4503599627370495);
}

/** Stream de archivo local con soporte Range */
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

/** Proxy hacia URL directa de audio con soporte Range y bypass CORS */
async function proxyAudioStream(req: Request, res: Response, rawUrl: string, defaultContentType = 'audio/webm'): Promise<void> {
  const requestHeaders: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Connection': 'keep-alive',
  };
  if (req.headers.range) {
    requestHeaders['Range'] = req.headers.range;
  }

  try {
    const upstream = await fetch(rawUrl, { headers: requestHeaders });

    if (!upstream.ok && upstream.status !== 206) {
      console.error(`[Stream] Proxy upstream error ${upstream.status} para URL: ${rawUrl.substring(0, 80)}...`);
      if (!res.headersSent) res.status(upstream.status).end();
      return;
    }

    const responseHeaders: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    };

    const ct = upstream.headers.get('content-type');
    if (ct) responseHeaders['Content-Type'] = ct;
    else responseHeaders['Content-Type'] = defaultContentType;

    const cl = upstream.headers.get('content-length');
    if (cl) responseHeaders['Content-Length'] = cl;

    const cr = upstream.headers.get('content-range');
    if (cr) responseHeaders['Content-Range'] = cr;

    res.writeHead(upstream.status === 206 ? 206 : 200, responseHeaders);

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
  } catch (e) {
    console.error('[Stream] Error en proxy de audio:', e);
    if (!res.headersSent) res.status(502).end();
  }
}

/**
 * Descarga y transcodifica en background para almacenar en CDN R2 sin bloquear.
 */
async function downloadAndUploadToCDN(youtubeId: string, keepLocal = false): Promise<void> {
  try {
    await downloadAndTranscode(youtubeId);
    const localPath = getAudioPath(youtubeId);

    if (!fs.existsSync(localPath)) {
      console.warn(`[CDN Background] Archivo no encontrado tras descarga: ${localPath}`);
      return;
    }

    const cdnUrl = await uploadToCDN(youtubeId, localPath, !keepLocal);
    if (cdnUrl) {
      cache.setex(`cdn-url:${youtubeId}`, 86400 * 365, cdnUrl);
      console.log(`[CDN Background] ✅ ${youtubeId} disponible en CDN: ${cdnUrl}`);
    }
  } catch (err) {
    console.error(`[CDN Background] Error procesando ${youtubeId}:`, err);
  }
}

async function resolveYoutubeIdForTrack(itunesId: string): Promise<{
  youtubeId: string | null;
  isDirectYouTube: boolean;
  artist?: string;
  title?: string;
  durationSeconds?: number;
}> {
  let youtubeId: string | null = null;
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
        youtubeId = await resolveYoutubeId(itunesIdNum, track.artist, track.title, durationSeconds);
      }
    }
  }

  return { youtubeId, isDirectYouTube, artist, title, durationSeconds };
}

// ── GET /api/stream/:itunesId ─────────────────────────────────────────────────

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

    // 2. Resolución de IDs y metadatos
    const { youtubeId, isDirectYouTube, artist, title, durationSeconds } = await resolveYoutubeIdForTrack(itunesId);

    if (!youtubeId) {
      return res.status(404).json({ error: 'No se pudo resolver la fuente de audio para este track' });
    }

    // 3. ¿Existe localmente en disco?
    const localPath = getAudioPath(youtubeId);
    if (fs.existsSync(localPath)) {
      console.log(`[Stream] 💾 Local hit: ${youtubeId}`);
      streamLocalFile(req, res, localPath, 'audio/ogg; codecs=opus');
      return;
    }

    // 4. Resolver mediante el waterfall unificado de StreamResolver
    const resolvedStream = await resolveAudioStream(youtubeId, {
      artist,
      title,
      itunesId,
    });

    if (!resolvedStream) {
      return res.status(404).json({
        error: 'No se pudo obtener el stream de audio. Todas las fuentes (InnerTube, JioSaavn, Invidious, yt-dlp) fallaron.',
      });
    }

    // 5. Si es CDN R2, redirigir directamente
    if (resolvedStream.source === 'cdn') {
      return res.redirect(302, resolvedStream.url);
    }

    // 6. Proxy del stream hacia el cliente (InnerTube, JioSaavn, Invidious, etc.)
    await proxyAudioStream(req, res, resolvedStream.url, resolvedStream.mimeType);

  } catch (error) {
    console.error('[Stream] Error en endpoint de stream:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al iniciar el stream' });
    }
  }
});

// ── POST /api/stream/prefetch — Pre-resolución no bloqueante en memoria ───────

router.post('/prefetch', async (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: 'ids debe ser un array' });
  }

  // Pre-calentar la resolución de stream en caché de memoria (sin descargas pesadas de disco)
  setImmediate(async () => {
    for (const id of ids.slice(0, 3)) {
      try {
        const { youtubeId, artist, title } = await resolveYoutubeIdForTrack(String(id));
        if (youtubeId) {
          await resolveAudioStream(youtubeId, { artist, title, itunesId: id });
        }
      } catch {}
    }
  });

  return res.json({ success: true, prefetching: ids.length });
});

// ── GET /api/stream/:itunesId/status ─────────────────────────────────────────

router.get('/:itunesId/status', async (req: Request, res: Response) => {
  const { itunesId } = req.params;

  try {
    const { youtubeId, artist, title } = await resolveYoutubeIdForTrack(itunesId);

    if (!youtubeId) {
      return res.json({
        trackId: itunesId,
        downloaded: false,
        status: 'none',
        message: 'No se pudo resolver el ID de audio',
      });
    }

    const hasCDNCache = !!cache.get(`cdn-url:${youtubeId}`);
    const isDownloading = !!cache.get(`downloading:${youtubeId}`);
    const isLocalAvailable = fs.existsSync(getAudioPath(youtubeId));

    let finalDownloaded = hasCDNCache || isLocalAvailable;

    if (!finalDownloaded && isCDNEnabled()) {
      const cdnUrl = await findTrackInCDN(youtubeId);
      if (cdnUrl) {
        cache.setex(`cdn-url:${youtubeId}`, 86400 * 30, cdnUrl);
        finalDownloaded = true;
      }
    }

    res.json({
      trackId: itunesId,
      youtubeId,
      inCDN: hasCDNCache,
      isLocalAvailable,
      downloading: isDownloading,
      downloaded: finalDownloaded,
      cdnEnabled: isCDNEnabled(),
      embedThresholdMin: EMBED_THRESHOLD_MIN,
      status: finalDownloaded ? (isLocalAvailable ? 'local' : 'cdn') : isDownloading ? 'downloading' : 'ready',
    });
  } catch (err) {
    res.json({
      trackId: itunesId,
      downloaded: false,
      status: 'none',
      error: String(err),
    });
  }
});

// ── POST /api/stream/:itunesId/download ───────────────────────────────────────

router.post('/:itunesId/download', async (req: Request, res: Response) => {
  const { itunesId } = req.params;

  try {
    const { youtubeId, isDirectYouTube, artist, title, durationSeconds } = await resolveYoutubeIdForTrack(itunesId);

    if (!youtubeId) {
      return res.status(404).json({ error: 'No se pudo resolver la canción para descargar' });
    }

    // Resolver URL directa para permitir descarga directa instantánea en la APK
    const resolvedStream = await resolveAudioStream(youtubeId, { artist, title, itunesId });

    const localPath = getAudioPath(youtubeId);
    const isLocal = fs.existsSync(localPath);

    // Lanzar background transcode si aplica
    const downloadingKey = `downloading:${youtubeId}`;
    if (!isLocal && !cache.get(downloadingKey)) {
      cache.setex(downloadingKey, 600, '1');
      downloadAndUploadToCDN(youtubeId, isDirectYouTube).finally(() => {
        cache.del(downloadingKey);
      });
    }

    res.json({
      success: true,
      status: isLocal ? 'downloaded' : 'downloading',
      directUrl: resolvedStream?.url || null,
      source: resolvedStream?.source || 'unknown',
      mimeType: resolvedStream?.mimeType || 'audio/webm',
      durationSeconds,
      message: isLocal ? 'Ya disponible localmente' : 'Descarga directa iniciada',
    });
  } catch (err) {
    console.error('[Stream] Error en descarga:', err);
    res.status(500).json({ error: 'Error al iniciar descarga' });
  }
});

// ── GET /api/stream/cdn/stats ─────────────────────────────────────────────────

router.get('/cdn/stats', (_req: Request, res: Response) => {
  if (!isCDNEnabled()) {
    return res.json({
      enabled: false,
      message: 'CDN no configurado. El sistema funciona con InnerTube y JioSaavn en tiempo real.',
    });
  }
  const stats = getCDNUsageStats();
  const requestPct = Math.round((stats.requestsThisMonth / 1_000_000) * 100);
  const storagePct = Math.round((stats.estimatedStorageMB / BUCKET_CAPACITY_MB) * 100);

  res.json({
    enabled: true,
    requestsThisMonth: stats.requestsThisMonth,
    requestLimit: 1_000_000,
    requestUsagePct: requestPct,
    estimatedStorageMB: Math.round(stats.estimatedStorageMB),
    storageLimit: BUCKET_CAPACITY_MB,
    storageUsagePct: storagePct,
    freeMB: Math.round(stats.freeMB),
    freePct: stats.freePct,
    largeFilesAllowed: stats.largeFilesAllowed,
    maxFileSizeMB: MAX_CDN_SIZE_MB,
    embedThresholdMin: EMBED_THRESHOLD_MIN,
    lastResetDate: stats.lastResetDate,
    warnThresholds: {
      requests: stats.requestWarnThreshold,
      storageMB: stats.storageWarnMB,
    },
  });
});

export default router;
