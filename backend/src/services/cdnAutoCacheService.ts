/**
 * CDN Auto-Cache Service
 *
 * La primera vez que un track se reproduce con éxito vía KokoMusic-lite,
 * descarga esos bytes en segundo plano, los transcodea a Opus (mismo pipeline
 * de calidad que ytdlpService.ts) y los sube a R2 con cdnService.uploadToCDN.
 *
 * A partir de ahí, stream.ts encuentra el track en `findTrackInCDN` y lo sirve
 * directamente desde R2 — sin volver a tocar KokoMusic-lite ni depender de que
 * googlevideo acepte la IP de quien pida el audio.
 *
 * Corre siempre en background (fire-and-forget): nunca debe bloquear ni
 * afectar la respuesta que ya recibió el cliente.
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { uploadToCDN, isCDNEnabled, createAudioUploadUrl, recordExternalAudioUpload } from './cdnService';
import { liteSupports, requestLiteCdnCache } from './kokoLiteClient';

const execAsync = promisify(exec);

const AUDIO_DIR = process.env.AUDIO_DIR ?? path.join(process.cwd(), 'audio_cache');
const AUDIO_BITRATE = process.env.AUDIO_BITRATE ?? '96k';
const AUDIO_VBR = process.env.AUDIO_VBR !== 'false';
const AUDIO_COMPRESSION_LEVEL = parseInt(process.env.AUDIO_COMPRESSION_LEVEL ?? '10', 10);
const AUDIO_SAMPLE_RATE = process.env.AUDIO_SAMPLE_RATE ?? '48000';

if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

// Evita disparar la misma subida en paralelo si dos requests piden el mismo
// track casi a la vez mientras aún no está cacheado.
const inFlight = new Set<string>();

/**
 * Límite global de auto-cacheos simultáneos (ffmpeg + descarga + subida a R2
 * a la vez, cada uno consume CPU/disco/red del servidor). Si varios tracks
 * nuevos se piden a la vez y ya se llegó al límite, los siguientes simplemente
 * no se cachean esta vez — no se encolan ni bloquean nada, se reintentará la
 * próxima vez que alguien reproduzca ese track.
 */
const MAX_CONCURRENT_AUTOCACHE = parseInt(process.env.CDN_AUTOCACHE_MAX_CONCURRENT ?? '2', 10);

async function downloadToFile(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Range': 'bytes=0-',
    },
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Descarga falló con status ${res.status}`);
  }
  if (!res.body) throw new Error('Respuesta sin cuerpo');

  const fileStream = fs.createWriteStream(destPath);
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    await new Promise<void>((resolve, reject) => {
      fileStream.write(value, (err) => (err ? reject(err) : resolve()));
    });
  }
  await new Promise<void>((resolve, reject) => {
    fileStream.end((err: any) => (err ? reject(err) : resolve()));
  });
}

/**
 * Intenta que KokoMusic-lite haga el cacheo él mismo (ver cdnCacheJob.ts en
 * lite). Ahorra ancho de banda de salida: antes el audio salía de lite hacia
 * aquí (~3-4 MB sin comprimir) y luego de aquí a R2 (~2,5 MB en Opus); ahora
 * solo sale una vez, ya comprimido, de lite a R2.
 * Devuelve el resultado si el asunto queda resuelto (subido, o descartado por
 * tamaño o por estar lite ocupado) y null si hay que hacerlo aquí como antes.
 */
async function cacheViaLite(trackId: string, youtubeId: string): Promise<CacheOutcome | null> {
  if (!(await liteSupports('cdn-cache'))) return null;
  const upload = await createAudioUploadUrl(trackId);
  if (!upload) return null;

  const result = await requestLiteCdnCache(youtubeId, upload);
  if (!result) return null;
  if (result.ok && result.bytes) {
    recordExternalAudioUpload(trackId, result.bytes);
    return 'cached';
  }
  // Demasiado grande u ocupado: hacerlo aquí no cambiaría nada, se reintentará
  // más tarde. Otros fallos → plan B local.
  if (result.reason === 'too_large' || result.reason === 'busy') {
    console.log(`[CDN AutoCache] KokoMusic-lite no cacheó ${trackId} (${result.reason}).`);
    return result.reason;
  }
  console.warn(`[CDN AutoCache] KokoMusic-lite falló cacheando ${trackId} (${result.reason}) — se intenta aquí.`);
  return null;
}

export type CacheOutcome = 'cached' | 'busy' | 'too_large' | 'failed' | 'in_progress' | 'disabled';

/**
 * Comprueba si se puede empezar a cachear `trackId` y, si sí, lo reserva.
 * `reserveSlots`: huecos que se dejan libres para las reproducciones en vivo
 * (la precarga de playlists usa 1, para no quitarle sitio a quien escucha).
 */
function tryStart(trackId: string, reserveSlots = 0): CacheOutcome | null {
  if (!isCDNEnabled()) return 'disabled';
  if (inFlight.has(trackId)) return 'in_progress';
  if (inFlight.size >= MAX_CONCURRENT_AUTOCACHE - reserveSlots) return 'busy';
  inFlight.add(trackId);
  return null;
}

/**
 * Sube el track a R2 en segundo plano: primero delegando en KokoMusic-lite
 * (si se conoce `youtubeId` y lite lo soporta) y, si no, descargando,
 * transcodeando a Opus y subiendo desde aquí. No lanza — cualquier error se
 * loguea y se descarta, ya que esto nunca debe afectar al usuario que ya
 * está escuchando el track.
 */
export function cacheStreamInBackground(trackId: string, sourceUrl: string, youtubeId?: string): void {
  const blocked = tryStart(trackId);
  if (blocked) {
    if (blocked === 'busy') console.log(`[CDN AutoCache] Límite de ${MAX_CONCURRENT_AUTOCACHE} auto-cacheos simultáneos alcanzado — se omite ${trackId} por ahora.`);
    return;
  }
  void runCache(trackId, sourceUrl, youtubeId);
}

/**
 * Igual que cacheStreamInBackground pero esperando el resultado. Lo usa la
 * precarga de playlists ("preparar canciones sin escucharlas"), que va de una
 * en una y deja siempre un hueco libre para la reproducción en vivo.
 */
export async function cacheTrackNow(trackId: string, sourceUrl: string, youtubeId?: string): Promise<CacheOutcome> {
  const blocked = tryStart(trackId, 1);
  if (blocked) return blocked;
  return runCache(trackId, sourceUrl, youtubeId);
}

async function runCache(trackId: string, sourceUrl: string, youtubeId?: string): Promise<CacheOutcome> {
  const rawPath = path.join(AUDIO_DIR, `tmp_${trackId}_raw`);
  const opusPath = path.join(AUDIO_DIR, `${trackId}.opus`);

  try {
    if (youtubeId) {
      const viaLite = await cacheViaLite(trackId, youtubeId);
      if (viaLite) return viaLite;
    }

    await downloadToFile(sourceUrl, rawPath);

    const ffmpegCmd = [
      'ffmpeg',
      '-i', `"${rawPath}"`,
      '-c:a', 'libopus',
      '-b:a', AUDIO_BITRATE,
      '-vbr', AUDIO_VBR ? 'on' : 'off',
      '-compression_level', String(AUDIO_COMPRESSION_LEVEL),
      '-ar', AUDIO_SAMPLE_RATE,
      '-ac', '2',
      '-y',
      `"${opusPath}"`,
    ].join(' ');
    await execAsync(ffmpegCmd);

    const url = await uploadToCDN(trackId, opusPath, true);
    if (url) {
      console.log(`[CDN AutoCache] ✅ ${trackId} cacheado permanentemente en R2 — futuras reproducciones no dependerán de Google.`);
      return 'cached';
    }
    // uploadToCDN solo devuelve null sin lanzar por tamaño o R2 desactivado.
    return 'too_large';
  } catch (err: any) {
    console.warn(`[CDN AutoCache] No se pudo cachear ${trackId} en background:`, err.message || err);
    return 'failed';
  } finally {
    for (const p of [rawPath, opusPath]) {
      if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch {} }
    }
    inFlight.delete(trackId);
  }
}
