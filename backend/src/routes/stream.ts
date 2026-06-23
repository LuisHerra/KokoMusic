/**
 * Stream Route — CDN-first
 *
 * Flujo para tracks de YouTube:
 *   1. Resolver youtubeId (iTunes → Supabase → yt-search)
 *   2. ¿Existe en CDN (R2)? → 302 redirect directo (sin proxy, sin latencia)
 *   3. ¿Es un video largo de YouTube directo? → embed mode (frontend renderiza iframe)
 *   4. Si no está en CDN  → yt-dlp extrae URL de Google y hace proxy en tiempo real
 *      → En background: descarga + transcode + guarda local para futuras escuchas
 *
 * Para tracks custom subidos por el usuario:
 *   - sourceType='upload'        → stream desde disco local
 *   - sourceType='youtube_alias' → trata como YouTube normal
 *
 * Políticas CDN:
 *   - Archivos > CDN_MAX_FILE_MB (default 30 MB) → solo local permanente (videos YT buscados)
 *   - R2 deshabilitado (sin vars de entorno) → funciona igual que antes (solo proxy/local)
 *
 * Modo embed:
 *   - Videos de YouTube directo con duración > EMBED_THRESHOLD_MIN minutos
 *   → GET /api/stream/:id retorna { embedMode: true, youtubeId } en lugar de audio
 *   → El frontend muestra un iframe de YouTube embebido (reproducción con pantalla apagada OK)
 */

import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import https from 'https';
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

const router = Router();

// ── Limpieza diaria al arrancar ───────────────────────────────────────────────
// Elimina archivos grandes (>MAX_CDN_SIZE_MB) con más de 48h de antigüedad
cleanupLargeLocalFiles(AUDIO_DIR);

// ── Configuración embed mode ──────────────────────────────────────────────────

/**
 * Duración mínima (en minutos) para activar el modo embed en videos de YouTube directos.
 * Por encima de este umbral, el track se reproduce vía iframe en lugar de audio descargado.
 * Valor configurable vía variable de entorno EMBED_THRESHOLD_MIN (default 25 min).
 */
const EMBED_THRESHOLD_MIN = parseInt(process.env.EMBED_THRESHOLD_MIN ?? '25', 10);

// ── Helpers ───────────────────────────────────────────────────────────────────

function stringToSafeIntegerHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return Math.abs(hash % 4503599627370495);
}

/** Extrae la URL de streaming directa de YouTube via yt-dlp */
function getYTStreamUrl(youtubeId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Cadena de formatos con fallback: webm opus > m4a > cualquier audio > mejor disponible
    // Nota: NO añadir comillas extra al selector — exec() en Node no usa shell expansion
    const formatSelector = `bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best`;
    const ytUrl = `"https://www.youtube.com/watch?v=${youtubeId}"`;
    const baseArgs = `--get-url --no-playlist -f ${formatSelector}`;

    let cmd = `yt-dlp ${baseArgs} ${ytUrl}`;

    if (process.platform === 'win32') {
      const wingetPath = `"%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\yt-dlp.exe"`;
      cmd = `yt-dlp ${baseArgs} ${ytUrl} || ${wingetPath} ${baseArgs} ${ytUrl}`;
    }

    exec(cmd, (error, stdout, stderr) => {
      if (error && !stdout) {
        console.error('[yt-dlp] Error extrayendo URL:', stderr);
        return reject(error);
      }
      const lines = stdout.trim().split('\n').filter(l => l.trim().length > 0);
      const url = lines[lines.length - 1].trim();
      if (!url) {
        return reject(new Error('yt-dlp no devolvió ninguna URL de stream'));
      }
      resolve(url);
    });
  });
}

/** Stream de archivo local con soporte Range (para custom uploads y cache local) */
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

/** Proxy HTTPS hacia la URL de Google/YouTube (fallback sin CDN) */
function proxyYouTubeStream(req: Request, res: Response, rawUrl: string): void {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  if (req.headers.range) {
    headers['Range'] = req.headers.range;
  }

  const proxyReq = https.request(rawUrl, { method: 'GET', headers }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, {
      'Content-Type': 'audio/webm',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=86400',
      ...(proxyRes.headers['content-length'] && { 'Content-Length': proxyRes.headers['content-length'] }),
      ...(proxyRes.headers['content-range'] && { 'Content-Range': proxyRes.headers['content-range'] }),
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    console.error('[Stream] Error en proxy YouTube:', e);
    if (!res.headersSent) res.status(500).end();
  });

  proxyReq.end();
}

/**
 * Descarga, transcodifica y sube a R2 en background.
 * Para videos de YouTube buscados directamente (itunesId=0), el archivo local
 * se conserva permanentemente (deleteLocal=false) para evitar re-descargas.
 * No bloquea la respuesta al cliente.
 */
async function downloadAndUploadToCDN(youtubeId: string, keepLocal = false): Promise<void> {
  try {
    await downloadAndTranscode(youtubeId);
    const localPath = getAudioPath(youtubeId);

    if (!fs.existsSync(localPath)) {
      console.warn(`[CDN Background] Archivo no encontrado tras descarga: ${localPath}`);
      return;
    }

    // deleteLocalAfterUpload = false si keepLocal=true (videos YT directos: guardar siempre)
    const cdnUrl = await uploadToCDN(youtubeId, localPath, !keepLocal);
    if (cdnUrl) {
      cache.setex(`cdn-url:${youtubeId}`, 86400 * 365, cdnUrl);
      console.log(`[CDN Background] ✅ ${youtubeId} disponible en CDN: ${cdnUrl}`);
    } else {
      // Sin CDN o archivo grande: si keepLocal, el archivo local ya sirve directamente
      if (keepLocal) {
        console.log(`[CDN Background] 💾 ${youtubeId} guardado localmente (sin CDN o archivo grande)`);
      } else {
        console.log(`[CDN Background] ℹ️  ${youtubeId} grande o sin CDN — quedará en local hasta mañana`);
      }
    }
  } catch (err) {
    console.error(`[CDN Background] Error procesando ${youtubeId}:`, err);
  }
}

// ── GET /api/stream/:itunesId ─────────────────────────────────────────────────

router.get('/:itunesId', async (req: Request, res: Response) => {
  const { itunesId } = req.params;

  if (!itunesId) {
    return res.status(400).json({ error: 'itunesId requerido' });
  }

  try {
    let youtubeId: string;
    /** true si el track es un video de YouTube buscado directamente (itunesId === 0) */
    let isDirectYouTube = false;
    /** Duración del video en segundos (si se conoce) */
    let durationSeconds = 0;

    // ── Tracks custom (subidos por el usuario) ────────────────────────────────
    if (itunesId.startsWith('custom_')) {
      const { getCustomTrackById } = await import('../services/customTracksService');
      const customTrack = getCustomTrackById(itunesId);
      if (!customTrack) {
        return res.status(404).json({ error: 'Track custom no encontrado' });
      }

      if (customTrack.sourceType === 'youtube_alias') {
        youtubeId = customTrack.youtubeId!;
        durationSeconds = Math.round((customTrack.duration || 0) / 1000);
        // Continúa al flujo normal de YouTube abajo
      } else {
        // Upload directo → stream desde disco o redirigir a CDN
        if (customTrack.audioUrl) {
          console.log(`[Stream] Redirigiendo a CDN para track custom: ${customTrack.audioUrl}`);
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
    } else {
      // ── Tracks de YouTube / iTunes ──────────────────────────────────────────
      const isLegacyYoutubeId = /^[a-zA-Z0-9_-]{11}$/.test(itunesId) && isNaN(Number(itunesId));

      if (isLegacyYoutubeId) {
        // ID de YouTube directo (desde búsqueda YouTube o legacy)
        isDirectYouTube = true;
        const cachedRes = cache.get(`yt-res:${itunesId}`);
        if (cachedRes) {
          youtubeId = cachedRes;
        } else {
          const hashedId = stringToSafeIntegerHash(itunesId);
          const { getYouTubeResolution } = await import('../services/supabaseService');
          const overridden = await getYouTubeResolution(hashedId);
          youtubeId = overridden || itunesId;
          cache.setex(`yt-res:${itunesId}`, 86400 * 30, youtubeId);
        }

        // Obtener duración del video para decidir si usar embed mode
        const trackMeta = await getTrackById(itunesId);
        if (trackMeta?.duration) {
          durationSeconds = Math.round(trackMeta.duration / 1000);
        }

        console.log(`[Stream] YouTube directo: ${itunesId} → ${youtubeId} (${Math.round(durationSeconds / 60)}min)`);
      } else {
        // iTunes ID → YouTube
        const itunesIdNum = Number(itunesId);
        const track = await getTrackById(itunesIdNum);
        if (!track) {
          return res.status(404).json({ error: 'Track no encontrado en iTunes' });
        }
        durationSeconds = Math.round(track.duration / 1000);
        console.log(`[Stream] Resolviendo YouTube ID para: "${track.artist} - ${track.title}"`);
        const resolved = await resolveYoutubeId(itunesIdNum, track.artist, track.title);
        if (!resolved) {
          return res.status(404).json({ error: 'No se encontró audio en YouTube para este track' });
        }
        youtubeId = resolved;
      }
    }

    // ── Modo Embed desactivado para asegurar un único player de audio gestionado por KokoMusic ──

    // ── Flujo CDN-first ───────────────────────────────────────────────────────

    // 1. ¿Existe localmente? (para YouTube directos: guardamos siempre en local)
    const localPath = getAudioPath(youtubeId);
    if (isDirectYouTube && fs.existsSync(localPath)) {
      console.log(`[Stream] 💾 Local hit (YouTube directo): ${youtubeId}`);
      streamLocalFile(req, res, localPath, 'audio/ogg; codecs=opus');
      return;
    }

    // 2. Comprobar si ya está en CDN (caché de URL local primero — evita HeadObject)
    const cachedCDNUrl = cache.get(`cdn-url:${youtubeId}`);
    if (cachedCDNUrl) {
      console.log(`[Stream] 🚀 CDN hit (caché local): ${youtubeId}`);
      return res.redirect(302, cachedCDNUrl as string);
    }

    if (isCDNEnabled()) {
      const cdnUrl = await findTrackInCDN(youtubeId);
      if (cdnUrl) {
        cache.setex(`cdn-url:${youtubeId}`, 86400 * 30, cdnUrl);
        console.log(`[Stream] 🚀 CDN hit (R2): ${youtubeId} → ${cdnUrl}`);
        return res.redirect(302, cdnUrl);
      }
    }

    // 3. No está en ningún caché — obtener URL de stream desde yt-dlp y hacer proxy
    const streamUrlCacheKey = `stream-url:${youtubeId}`;
    let rawUrl = cache.get(streamUrlCacheKey) as string | undefined;

    if (!rawUrl) {
      console.log(`[Stream] Extrayendo URL de YouTube para: ${youtubeId}`);
      rawUrl = await getYTStreamUrl(youtubeId);
      cache.setex(streamUrlCacheKey, 1800, rawUrl); // 30 min
    }

    proxyYouTubeStream(req, res, rawUrl);

    // 4. En background: descargar + transcodificar + cachear (solo si autoDownload !== 'false')
    const autoDownload = req.query.autoDownload !== 'false';
    const downloadingKey = `downloading:${youtubeId}`;
    if (autoDownload && !cache.get(downloadingKey)) {
      const isTooLargeForServer = durationSeconds > 480; // > 8 minutos, aprox > 8MB
      if (!isTooLargeForServer) {
        cache.setex(downloadingKey, 600, '1'); // lock 10 min

        if (isDirectYouTube) {
          // Videos de YouTube buscados directamente: guardar localmente de forma permanente
          // para evitar re-descargas futuras (alta probabilidad de re-escucha)
          console.log(`[Stream] 📥 Background: descargando ${youtubeId} (YT directo → local permanente)...`);
          downloadAndUploadToCDN(youtubeId, true).finally(() => {
            cache.del(downloadingKey);
          });
        } else if (isCDNEnabled()) {
          // Tracks iTunes: subir a CDN y eliminar local
          console.log(`[Stream] 📥 Background: descargando ${youtubeId} para CDN...`);
          downloadAndUploadToCDN(youtubeId, false).finally(() => {
            cache.del(downloadingKey);
          });
        }
      } else {
        console.log(`[Stream] ℹ️ Background skip: track ${youtubeId} es demasiado largo (${Math.round(durationSeconds / 60)} min, > 8MB) para guardarse en CDN.`);
      }
    }

  } catch (error) {
    console.error('[Stream] Error al iniciar stream:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error al iniciar el stream' });
    }
  }
});

async function resolveYoutubeIdForTrack(itunesId: string): Promise<{ youtubeId: string | null; isDirectYouTube: boolean }> {
  let youtubeId: string | null = null;
  let isDirectYouTube = false;

  if (itunesId.startsWith('custom_')) {
    const { getCustomTrackById } = await import('../services/customTracksService');
    const customTrack = getCustomTrackById(itunesId);
    if (customTrack && customTrack.sourceType === 'youtube_alias') {
      youtubeId = customTrack.youtubeId || null;
    }
  } else {
    const isLegacyYoutubeId = /^[a-zA-Z0-9_-]{11}$/.test(itunesId) && isNaN(Number(itunesId));
    if (isLegacyYoutubeId) {
      isDirectYouTube = true;
      const cachedRes = cache.get(`yt-res:${itunesId}`) as string | undefined;
      if (cachedRes) {
        youtubeId = cachedRes;
      } else {
        const hashedId = stringToSafeIntegerHash(itunesId);
        const { getYouTubeResolution } = await import('../services/supabaseService');
        const overridden = await getYouTubeResolution(hashedId);
        youtubeId = overridden || itunesId;
        cache.setex(`yt-res:${itunesId}`, 86400 * 30, youtubeId);
      }
    } else {
      const itunesIdNum = Number(itunesId);
      const track = await getTrackById(itunesIdNum);
      if (track) {
        youtubeId = await resolveYoutubeId(itunesIdNum, track.artist, track.title);
      }
    }
  }
  return { youtubeId, isDirectYouTube };
}

// ── GET /api/stream/:itunesId/status ─────────────────────────────────────────

router.get('/:itunesId/status', async (req: Request, res: Response) => {
  const { itunesId } = req.params;

  try {
    const { youtubeId, isDirectYouTube } = await resolveYoutubeIdForTrack(itunesId);

    if (!youtubeId) {
      return res.json({
        trackId: itunesId,
        downloaded: false,
        status: 'none',
        message: 'No se pudo resolver el ID de YouTube'
      });
    }

    const hasCDNCache = !!cache.get(`cdn-url:${youtubeId}`);
    const isDownloading = !!cache.get(`downloading:${youtubeId}`);
    const isLocalAvailable = fs.existsSync(getAudioPath(youtubeId));

    let finalDownloaded = hasCDNCache || isLocalAvailable;

    // Si no está en cache de memoria pero CDN está activo, chequear CDN
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
      error: String(err)
    });
  }
});

// ── POST /api/stream/:itunesId/download ───────────────────────────────────────

router.post('/:itunesId/download', async (req: Request, res: Response) => {
  const { itunesId } = req.params;

  try {
    const { youtubeId, isDirectYouTube } = await resolveYoutubeIdForTrack(itunesId);

    // Verificar si el archivo es > 8MB (estimado por duración > 8 min / 480 s)
    let durationSeconds = 0;
    const isLegacyYoutubeId = /^[a-zA-Z0-9_-]{11}$/.test(itunesId) && isNaN(Number(itunesId));
    if (isLegacyYoutubeId) {
      const trackMeta = await getTrackById(itunesId);
      if (trackMeta?.duration) {
        durationSeconds = Math.round(trackMeta.duration / 1000);
      }
    } else if (!itunesId.startsWith('custom_')) {
      const itunesIdNum = Number(itunesId);
      const track = await getTrackById(itunesIdNum);
      if (track) {
        durationSeconds = Math.round(track.duration / 1000);
      }
    }

    if (durationSeconds > 480) {
      return res.status(400).json({
        error: 'FILE_TOO_LARGE_FOR_CDN',
        message: 'El archivo supera los 8MB y debe ser descargado localmente en tu dispositivo.'
      });
    }

    if (!youtubeId) {
      return res.status(404).json({ error: 'No se pudo resolver la canción en YouTube' });
    }

    const localPath = getAudioPath(youtubeId);
    if (fs.existsSync(localPath)) {
      return res.json({ success: true, status: 'downloaded', message: 'Ya descargado localmente' });
    }

    if (isCDNEnabled()) {
      const cdnUrl = await findTrackInCDN(youtubeId);
      if (cdnUrl) {
        cache.setex(`cdn-url:${youtubeId}`, 86400 * 30, cdnUrl);
        return res.json({ success: true, status: 'downloaded', message: 'Ya disponible en CDN' });
      }
    }

    const downloadingKey = `downloading:${youtubeId}`;
    if (!cache.get(downloadingKey)) {
      cache.setex(downloadingKey, 600, '1'); // lock 10 min
      console.log(`[Stream] 📥 Descarga manual solicitada para ${youtubeId} (keepLocal: ${isDirectYouTube})`);
      downloadAndUploadToCDN(youtubeId, isDirectYouTube).finally(() => {
        cache.del(downloadingKey);
      });
    }

    res.json({ success: true, status: 'downloading', message: 'Descarga iniciada' });
  } catch (err) {
    console.error('[Stream] Error al iniciar descarga manual:', err);
    res.status(500).json({ error: 'Error al iniciar descarga manual' });
  }
});

// ── GET /api/stream/cdn/stats — Estadísticas de uso de R2 ────────────────────

router.get('/cdn/stats', (_req: Request, res: Response) => {
  if (!isCDNEnabled()) {
    return res.json({ enabled: false, message: 'CDN no configurado. Rellena CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY en .env' });
  }
  const stats = getCDNUsageStats();
  const requestPct = Math.round((stats.requestsThisMonth / 1_000_000) * 100);
  const storagePct = Math.round((stats.estimatedStorageMB / BUCKET_CAPACITY_MB) * 100);

  res.json({
    enabled: true,
    // Requests
    requestsThisMonth: stats.requestsThisMonth,
    requestLimit: 1_000_000,
    requestUsagePct: requestPct,
    // Storage
    estimatedStorageMB: Math.round(stats.estimatedStorageMB),
    storageLimit: BUCKET_CAPACITY_MB,
    storageUsagePct: storagePct,
    freeMB: Math.round(stats.freeMB),
    freePct: stats.freePct,
    // Políticas
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
