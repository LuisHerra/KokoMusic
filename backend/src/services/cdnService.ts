/**
 * CDN Service — Cloudflare R2
 *
 * Gestiona el almacenamiento y recuperación de audio en Cloudflare R2.
 *
 * Políticas de subida:
 * ┌──────────────┬───────────────────┬──────────────────────────────────────┐
 * │ Tamaño       │ Bucket ≥50% libre │ Comportamiento                       │
 * ├──────────────┼───────────────────┼──────────────────────────────────────┤
 * │ ≤ MAX_SIZE   │ Sí / No           │ audio/<id>.opus — permanente en R2   │
 * │ > MAX_SIZE   │ Sí (≥50% libre)   │ audio/large/<id>.opus — R2, 2 días* │
 * │ > MAX_SIZE   │ No (<50% libre)   │ Solo local, se borra en 2 días       │
 * └──────────────┴───────────────────┴──────────────────────────────────────┘
 *
 * * La eliminación de audio/large/* a los 2 días la hace Cloudflare R2 vía
 *   Object Lifecycle Rule (sin código, sin Workers — configurado en el dashboard).
 *
 * Monitorización:
 * - Se llevan contadores de requests y storage estimado en data/cdn_usage.json
 * - Se emiten warnings al superar los umbrales configurables
 * - Se expone GET /api/stream/cdn/stats para consulta externa
 */

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs';
import path from 'path';

// ── Configuración ─────────────────────────────────────────────────────────────

/** Tamaño máximo para subir a CDN como archivo permanente (MB) */
const MAX_CDN_SIZE_MB = parseInt(process.env.CDN_MAX_FILE_MB ?? '8', 10);

/** Capacidad total del bucket R2 en MB (10 GB = 10240 MB free tier) */
const BUCKET_CAPACITY_MB = parseInt(process.env.CDN_BUCKET_CAPACITY_MB ?? '10240', 10);

/** Umbral de requests mensuales para emitir advertencia (default 800k de 1M) */
const REQUEST_WARN_THRESHOLD = parseInt(process.env.CDN_REQUEST_WARN ?? '800000', 10);

/** Umbral de storage para advertencia en MB (default 8192 = 8 GB de 10 GB) */
const STORAGE_WARN_MB = parseInt(process.env.CDN_STORAGE_WARN_MB ?? '8192', 10);

/** Prefijo para archivos permanentes (canciones normales) */
const PREFIX_AUDIO = 'audio/';

/**
 * Prefijo para archivos grandes temporales.
 * Una Object Lifecycle Rule de R2 los elimina automáticamente a los 2 días.
 * Ver: tu bucket → Settings → Object Lifecycle Rules → "Delete Large After 2 Days"
 */
const PREFIX_LARGE = 'audio/large/';

// ── Cliente R2 (S3-compatible) ────────────────────────────────────────────────

let r2: S3Client | null = null;

function getR2Client(): S3Client {
  if (!r2) {
    const accountId = process.env.CF_ACCOUNT_ID;
    const accessKey  = process.env.R2_ACCESS_KEY_ID;
    const secretKey  = process.env.R2_SECRET_ACCESS_KEY;

    if (!accountId || !accessKey || !secretKey) {
      throw new Error('[CDN] Faltan variables R2: CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
    }

    r2 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });
  }
  return r2;
}

// ── Estado de uso persistido (data/cdn_usage.json) ────────────────────────────

interface UsageStats {
  requestsThisMonth: number;
  estimatedStorageMB: number;
  lastResetDate: string; // YYYY-MM
}

const USAGE_FILE = path.join(process.cwd(), 'data', 'cdn_usage.json');

function loadUsage(): UsageStats {
  const now   = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  try {
    if (fs.existsSync(USAGE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf-8')) as UsageStats;
      // Resetear contador de requests si es un mes nuevo (el storage no se resetea)
      if (raw.lastResetDate !== month) {
        return { requestsThisMonth: 0, estimatedStorageMB: raw.estimatedStorageMB, lastResetDate: month };
      }
      return raw;
    }
  } catch { /* ignora */ }
  return { requestsThisMonth: 0, estimatedStorageMB: 0, lastResetDate: month };
}

function saveUsage(stats: UsageStats): void {
  try {
    const dir = path.dirname(USAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(stats, null, 2));
  } catch { /* no crítico */ }
}

let usage = loadUsage();

function incrementRequests(count = 1): void {
  usage.requestsThisMonth += count;
  saveUsage(usage);
  if (usage.requestsThisMonth >= REQUEST_WARN_THRESHOLD) {
    console.warn(`[CDN] ⚠️  Requests R2 este mes: ${usage.requestsThisMonth.toLocaleString()} / 1.000.000. Considera activar Bunny.net.`);
  }
}

function incrementStorage(sizeMB: number): void {
  usage.estimatedStorageMB = Math.max(0, usage.estimatedStorageMB + sizeMB);
  saveUsage(usage);
  if (usage.estimatedStorageMB >= STORAGE_WARN_MB) {
    console.warn(`[CDN] ⚠️  Storage R2 estimado: ${usage.estimatedStorageMB.toFixed(1)} MB / ${BUCKET_CAPACITY_MB} MB. Revisa el bucket.`);
  }
}

/** Devuelve estadísticas actuales de uso */
export function getCDNUsageStats(): UsageStats & {
  requestWarnThreshold: number;
  storageWarnMB: number;
  bucketCapacityMB: number;
  freeMB: number;
  freePct: number;
  largeFilesAllowed: boolean;
} {
  const freeMB = Math.max(0, BUCKET_CAPACITY_MB - usage.estimatedStorageMB);
  const freePct = Math.round((freeMB / BUCKET_CAPACITY_MB) * 100);
  return {
    ...usage,
    requestWarnThreshold: REQUEST_WARN_THRESHOLD,
    storageWarnMB: STORAGE_WARN_MB,
    bucketCapacityMB: BUCKET_CAPACITY_MB,
    freeMB,
    freePct,
    largeFilesAllowed: freePct >= 50,
  };
}

// ── Helpers de disponibilidad ─────────────────────────────────────────────────

/** true si R2 está correctamente configurado en el entorno */
export function isCDNEnabled(): boolean {
  return !!(
    process.env.CF_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

/**
 * true si el bucket tiene al menos el 50% de capacidad libre.
 * Cuando hay espacio, se permiten subir archivos grandes (con lifecycle de 2 días).
 */
function hasBucketCapacityForLargeFiles(): boolean {
  const freeMB = BUCKET_CAPACITY_MB - usage.estimatedStorageMB;
  return freeMB >= BUCKET_CAPACITY_MB * 0.5;
}

// ── Claves y URLs ─────────────────────────────────────────────────────────────

const BUCKET    = () => process.env.R2_BUCKET_NAME!;
const CDN_BASE  = () => (process.env.R2_CDN_URL ?? '').replace(/\/$/, '');

/** Clave R2 para track permanente (≤ MAX_CDN_SIZE_MB) */
function permanentKey(trackId: string): string {
  return `${PREFIX_AUDIO}${trackId}.opus`;
}

/** Clave R2 para track grande temporal (lifecycle rule borra a los 2 días) */
function largeKey(trackId: string): string {
  return `${PREFIX_LARGE}${trackId}.opus`;
}

/** URL pública de un track permanente */
function permanentUrl(trackId: string): string {
  return `${CDN_BASE()}/${PREFIX_AUDIO}${trackId}.opus`;
}

/** URL pública de un track grande temporal */
function largeUrl(trackId: string): string {
  return `${CDN_BASE()}/${PREFIX_LARGE}${trackId}.opus`;
}

// ── Operaciones R2 ────────────────────────────────────────────────────────────

/**
 * Comprueba si un track ya existe en R2 (en cualquiera de los dos prefijos).
 * Devuelve la URL CDN si existe, o null si no está.
 * Consume 1 ó 2 Class A requests (HeadObject).
 */
export async function findTrackInCDN(trackId: string): Promise<string | null> {
  if (!isCDNEnabled()) return null;

  // 1. Comprobar prefijo permanente
  try {
    incrementRequests(1);
    await getR2Client().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: permanentKey(trackId) }));
    return permanentUrl(trackId);
  } catch { /* no existe */ }

  // 2. Comprobar prefijo grande (temporal)
  try {
    incrementRequests(1);
    await getR2Client().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: largeKey(trackId) }));
    return largeUrl(trackId);
  } catch { /* no existe */ }

  return null;
}

/**
 * Mantiene compatibilidad con stream.ts — devuelve boolean.
 * Usa findTrackInCDN internamente.
 */
export async function trackExistsInCDN(trackId: string): Promise<boolean> {
  return (await findTrackInCDN(trackId)) !== null;
}

/**
 * Sube un archivo .opus a R2 aplicando la política de tamaño/capacidad:
 *
 * - ≤ MAX_CDN_SIZE_MB  → audio/<id>.opus  (permanente)
 * - > MAX_CDN_SIZE_MB  → audio/large/<id>.opus (temporal, 2 días via lifecycle)
 *                        SOLO si el bucket tiene ≥ 50% de capacidad libre.
 * - > MAX_CDN_SIZE_MB  + bucket < 50% libre → no sube, devuelve null.
 *
 * @param deleteLocalAfterUpload Elimina el archivo local tras subida exitosa
 * @returns URL pública del CDN, o null si no se subió
 */
export async function uploadToCDN(
  trackId: string,
  localPath: string,
  deleteLocalAfterUpload = true,
): Promise<string | null> {
  if (!isCDNEnabled()) return null;

  if (!fs.existsSync(localPath)) {
    console.error(`[CDN] Archivo local no encontrado: ${localPath}`);
    return null;
  }

  const stat   = fs.statSync(localPath);
  const sizeMB = stat.size / (1024 * 1024);

  // Límite estricto absoluto de 30MB para el CDN
  if (sizeMB > 30) {
    console.warn(`[CDN] Límite absoluto de 30MB superado: ${sizeMB.toFixed(1)} MB. Subida cancelada.`);
    return null;
  }

  const isLarge = sizeMB > MAX_CDN_SIZE_MB;

  // Determinar política para archivos grandes
  if (isLarge) {
    console.log(
      `[CDN] Track ${trackId} (${sizeMB.toFixed(1)} MB) supera el límite de ${MAX_CDN_SIZE_MB}MB. NO se subirá al CDN.`
    );
    return null;
  }

  const key      = permanentKey(trackId);
  const publicUrl = permanentUrl(trackId);
  // Archivos grandes: CDN no los cachea mucho (expirarán en 2 días en R2)
  // Archivos normales: 1 año de caché inmutable en el edge
  const cacheControl = isLarge
    ? 'public, max-age=172800'              // 2 días
    : 'public, max-age=31536000, immutable'; // 1 año

  try {
    const fileStream = fs.createReadStream(localPath);

    incrementRequests(1); // PutObject = Class A
    await getR2Client().send(new PutObjectCommand({
      Bucket: BUCKET(),
      Key: key,
      Body: fileStream,
      ContentType: 'audio/ogg; codecs=opus',
      ContentLength: stat.size,
      CacheControl: cacheControl,
      Metadata: {
        trackId,
        uploadedAt: new Date().toISOString(),
        sizeMB: sizeMB.toFixed(2),
        type: isLarge ? 'large-temporary' : 'permanent',
      },
    }));

    incrementStorage(sizeMB);

    const tag = isLarge ? '⏳' : '✅';
    console.log(`[CDN] ${tag} Subido: ${trackId} (${sizeMB.toFixed(1)} MB) → ${publicUrl}`);

    if (deleteLocalAfterUpload && fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      console.log(`[CDN] 🗑️  Local eliminado: ${localPath}`);
    }

    return publicUrl;
  } catch (err) {
    console.error(`[CDN] Error subiendo ${trackId}:`, err);
    return null;
  }
}

/**
 * Genera una Presigned URL temporal (1 hora) para buckets privados.
 * Consume 1 Class B request.
 */
export async function getPresignedUrl(trackId: string, expiresInSeconds = 3600): Promise<string | null> {
  if (!isCDNEnabled()) return null;
  try {
    const command = new GetObjectCommand({ Bucket: BUCKET(), Key: permanentKey(trackId) });
    incrementRequests(1);
    return await getSignedUrl(getR2Client(), command, { expiresIn: expiresInSeconds });
  } catch (err) {
    console.error(`[CDN] Error generando presigned URL para ${trackId}:`, err);
    return null;
  }
}

/**
 * Devuelve la URL pública de un track permanente.
 * No consume requests de R2 — sirve desde el edge.
 */
export function getPublicCDNUrl(trackId: string): string {
  return permanentUrl(trackId);
}

/**
 * Elimina un track de R2 (ambos prefijos, por si acaso).
 */
export async function deleteFromCDN(trackId: string): Promise<boolean> {
  if (!isCDNEnabled()) return false;
  let deleted = false;
  for (const key of [permanentKey(trackId), largeKey(trackId)]) {
    try {
      incrementRequests(1);
      await getR2Client().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: key }));
      console.log(`[CDN] Eliminado de R2: ${key}`);
      deleted = true;
    } catch { /* no existía */ }
  }
  return deleted;
}

// ── Limpieza local al arranque del servidor ───────────────────────────────────

/**
 * Elimina del directorio local los archivos .opus que llevan más de 2 días
 * sin haber sido reclamados.
 *
 * Cubre dos casos:
 * 1. Archivos grandes que NO se subieron a CDN (bucket sin espacio) → se borran a las 48h
 * 2. Archivos normales que sí se subieron → ya fueron borrados en uploadToCDN;
 *    este paso es salvaguarda por si el proceso murió antes de borrarlos.
 *
 * Se llama una vez en el arranque del servidor (stream.ts).
 */
export function cleanupLargeLocalFiles(audioDir: string): void {
  if (!fs.existsSync(audioDir)) return;

  const now       = Date.now();
  const twoDaysMs = 48 * 60 * 60 * 1000;
  let deletedCount = 0;
  let freedMB      = 0;

  try {
    const files = fs.readdirSync(audioDir).filter(f => f.endsWith('.opus'));

    for (const file of files) {
      const filePath = path.join(audioDir, file);
      try {
        const stat   = fs.statSync(filePath);
        const sizeMB = stat.size / (1024 * 1024);
        const ageMs  = now - stat.mtimeMs;

        if (ageMs > twoDaysMs) {
          fs.unlinkSync(filePath);
          deletedCount++;
          freedMB += sizeMB;
          console.log(`[CDN Cleanup] 🗑️  Eliminado ${file} (${sizeMB.toFixed(1)} MB, ${Math.floor(ageMs / 3600000)}h)`);
        }
      } catch (fileErr) {
        console.error(`[CDN Cleanup] Error procesando ${file}:`, fileErr);
      }
    }

    if (deletedCount > 0) {
      console.log(`[CDN Cleanup] Completado: ${deletedCount} archivo(s), ${freedMB.toFixed(1)} MB liberados.`);
    }
  } catch (err) {
    console.error('[CDN Cleanup] Error en limpieza local:', err);
  }
}

// ── Exports adicionales ───────────────────────────────────────────────────────

export { MAX_CDN_SIZE_MB, BUCKET_CAPACITY_MB };
