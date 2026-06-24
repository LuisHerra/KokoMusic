/**
 * yt-dlp Service
 * Descarga audio de YouTube usando yt-dlp (Python) como subprocess.
 * FFmpeg transcodifica a Opus con loudnorm (normalización EBU R128, igual que Spotify).
 *
 * ¿Por qué Opus?
 * - Mejor calidad/bitrate que MP3 (especialmente notable a bajos bitrates)
 * - Soporte nativo en todos los navegadores modernos vía MediaSource Extensions
 * - Menor tamaño de archivo → más rápido para servir y cachear
 *
 * Calidad vs Tamaño (canción ~3.5 min):
 *   128k → ~2.9 MB  |  3,500 canciones/10 GB  (original, sobredimensionado)
 *    96k → ~2.2 MB  |  4,700 canciones/10 GB  ← recomendado (casi transparente)
 *    80k → ~1.8 MB  |  5,800 canciones/10 GB  ← agresivo pero bueno
 *    64k → ~1.4 MB  |  7,500 canciones/10 GB  ← Spotify Mobile quality
 *
 * Configurable mediante AUDIO_BITRATE en .env (default: 96k)
 * Configurable mediante AUDIO_VBR en .env (default: true — usa VBR para máxima eficiencia)
 *
 * VBR (Variable Bit Rate) en Opus:
 *   Con -vbr on, el codificador asigna más bits a fragmentos complejos (crescendos,
 *   secciones con muchos instrumentos) y menos a silencios o pasajes simples.
 *   Resultado: misma calidad percibida con ~10-15% menos tamaño que CBR equivalente.
 *
 * Compression Level (-compression_level):
 *   Opus admite 0-10. Higher = mejor ratio pero más CPU en encode.
 *   No afecta la calidad de reproducción, solo el tamaño final del archivo.
 *   Usamos 10 (máximo) ya que la codificación ocurre en background sin urgencia.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

export const AUDIO_DIR = process.env.AUDIO_DIR ?? path.join(process.cwd(), 'audio_cache');

// ── Parámetros de codificación configurables via .env ─────────────────────────

/**
 * Bitrate objetivo para Opus (en kbps).
 * Con VBR activo, este es el bitrate "target" — el real fluctúa según la complejidad.
 * Recomendación: 96k (máxima relación calidad/espacio), 64k para agresivo.
 * Default: 96k
 */
const AUDIO_BITRATE = process.env.AUDIO_BITRATE ?? '96k';

/**
 * Variable Bit Rate. true = Opus asigna bits dinámicamente según complejidad.
 * Ahorra ~10-15% de espacio adicional sobre el bitrate CBR equivalente.
 * Default: true (recomendado)
 */
const AUDIO_VBR = process.env.AUDIO_VBR !== 'false'; // Default true

/**
 * Nivel de compresión del encoder Opus (0-10).
 * Afecta la CPU en encode, NO la calidad de reproducción.
 * 10 = máxima compresión, recomendado en background jobs.
 * Default: 10
 */
const AUDIO_COMPRESSION_LEVEL = parseInt(process.env.AUDIO_COMPRESSION_LEVEL ?? '10', 10);

/**
 * Frecuencia de muestreo de salida en Hz.
 * 48000 Hz = estándar Opus nativo (los navegadores lo reproducen nativamente)
 * 44100 Hz = CD quality (mayor compatibilidad con DACs externos, ligeramente mayor tamaño)
 * Default: 48000
 */
const AUDIO_SAMPLE_RATE = process.env.AUDIO_SAMPLE_RATE ?? '48000';

// Aseguramos que existe el directorio de caché
if (!fs.existsSync(AUDIO_DIR)) {
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  console.log('[Audio] Directorio de caché creado en:', AUDIO_DIR);
}

console.log(`[Audio] Configuración de codificación: ${AUDIO_BITRATE} ${AUDIO_VBR ? 'VBR' : 'CBR'}, ` +
  `compression=${AUDIO_COMPRESSION_LEVEL}, sampleRate=${AUDIO_SAMPLE_RATE}Hz`);

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getAudioPath(trackId: string): string {
  return path.join(AUDIO_DIR, `${trackId}.opus`);
}

export function audioExists(trackId: string): boolean {
  return fs.existsSync(getAudioPath(trackId));
}

/**
 * Calcula el tamaño estimado en MB para el bitrate y duración dados.
 * Útil para logging y decidir si un archivo cabe en el CDN.
 */
export function estimateFileSizeMB(durationSeconds: number, bitrateKbps: number = parseInt(AUDIO_BITRATE, 10)): number {
  // Fórmula: (bitrate_kbps * duracion_seg) / 8 / 1024
  return (bitrateKbps * durationSeconds) / 8 / 1024;
}

// ── Constantes exportadas para uso en cdnService ─────────────────────────────

export { AUDIO_DIR as AUDIO_CACHE_DIR };

/**
 * Descarga + transcodifica una canción con la configuración de calidad óptima.
 * @param trackId  ID del video de YouTube — usado para descarga y nombre de archivo
 */
export async function downloadAndTranscode(trackId: string): Promise<void> {
  const outputPath = getAudioPath(trackId);
  const tempBase = path.join(AUDIO_DIR, `tmp_${trackId}`);

  console.log(`[yt-dlp] Descargando: ${trackId} (target: ${AUDIO_BITRATE} ${AUDIO_VBR ? 'VBR' : 'CBR'})`);

  // 1. Descarga del audio con yt-dlp (formato opus nativo de YouTube para evitar re-encode inicial)
  //    --audio-quality 0 = mejor calidad disponible antes de nuestro re-encode controlado
  const ytUrl = `https://www.youtube.com/watch?v=${trackId}`;
  const outputTemplate = `"${tempBase}.%(ext)s"`;

  let ytdlpCmd = [
    'yt-dlp',
    `"${ytUrl}"`,
    '--extract-audio',
    '--audio-format', 'opus',
    '--audio-quality', '0',
    '--output', outputTemplate,
    '--no-playlist',
    '--quiet',
    '--no-warnings',
  ].join(' ');

  // En Windows, intentar también la ruta de WinGet como fallback
  if (process.platform === 'win32') {
    const wingetBin = `"%LOCALAPPDATA%\\Microsoft\\WinGet\\Links\\yt-dlp.exe"`;
    const fallbackCmd = ytdlpCmd.replace(/^yt-dlp/, wingetBin);
    ytdlpCmd = `${ytdlpCmd} || ${fallbackCmd}`;
  }

  let tempFile = `${tempBase}.opus`;

  try {
    await execAsync(ytdlpCmd);
  } catch (ytdlpError) {
    console.warn(`[yt-dlp] Error descargando con yt-dlp: ${(ytdlpError as Error).message}. Intentando fallback con Invidious...`);
    try {
      const { getInvidiousStreamUrl } = await import('./invidiousService');
      const invidiousUrl = await getInvidiousStreamUrl(trackId);
      if (!invidiousUrl) {
        throw new Error(`Invidious no pudo resolver el stream URL para ${trackId}`);
      }

      console.log(`[yt-dlp Fallback] Descargando stream de Invidious: ${invidiousUrl}`);
      const res = await fetch(invidiousUrl);
      if (!res.ok) {
        throw new Error(`Invidious stream HTTP error: ${res.statusText}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      tempFile = `${tempBase}.downloaded`;
      fs.writeFileSync(tempFile, Buffer.from(arrayBuffer));
      console.log(`[yt-dlp Fallback] Descargado archivo temporal de ${arrayBuffer.byteLength} bytes.`);
    } catch (fallbackError) {
      console.error('[yt-dlp Fallback] Falló la descarga alternativa de Invidious:', fallbackError);
      throw new Error(`Tanto yt-dlp como el fallback de Invidious fallaron: ${(fallbackError as Error).message}`);
    }
  }

  // 2. Transcodificación con FFmpeg con pipeline de calidad optimizado:
  //    - libopus: codec de alta eficiencia (mejor que AAC/MP3 a ≤128k)
  //    - -b:a: bitrate objetivo (VBR target, no CBR hard limit)
  //    - -vbr: on = Variable Bit Rate (mejor eficiencia que CBR)
  //    - -compression_level: CPU para encoder (10 = max compresión, misma calidad)
  //    - -ar: sample rate (48kHz = nativo Opus, ninguna degradación)
  //    - -ac 2: stereo (mono ahorraría más pero degradaría experiencia)
  //    - -af loudnorm: normalización EBU R128 (igual que Spotify, -14 LUFS)
  const ffmpegCmd = [
    'ffmpeg',
    '-i', `"${tempFile}"`,
    '-c:a', 'libopus',
    '-b:a', AUDIO_BITRATE,
    '-vbr', AUDIO_VBR ? 'on' : 'off',
    '-compression_level', String(AUDIO_COMPRESSION_LEVEL),
    '-ar', AUDIO_SAMPLE_RATE,
    '-ac', '2',
    '-af', 'loudnorm=I=-14:LRA=11:TP=-1.5',
    '-y',
    `"${outputPath}"`,
  ].join(' ');

  await execAsync(ffmpegCmd);

  // 3. Logging del tamaño real para monitorizar compresión real vs estimada
  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`[yt-dlp] ✅ Audio listo: ${outputPath} (${sizeMB} MB @ ${AUDIO_BITRATE} ${AUDIO_VBR ? 'VBR' : 'CBR'})`);
  }

  // 4. Limpieza del archivo temporal
  if (fs.existsSync(tempFile)) {
    fs.unlinkSync(tempFile);
  }
}
