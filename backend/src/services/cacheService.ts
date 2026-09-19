/**
 * Cache Service — In-Memory + snapshot en disco (local dev)
 * Simula la interfaz de Redis sin necesitar el servidor.
 * En producción Oracle Cloud se reemplaza por ioredis con el mismo contrato.
 *
 * ¿Por qué cachear búsquedas?
 * - La Spotify API tiene rate limits; una misma query puede repetirse muchísimo.
 * - Reducimos latencia de ~300ms a <1ms para búsquedas repetidas.
 * - Redis en producción persiste entre reinicios del proceso.
 *
 * ¿Por qué el snapshot en disco?
 * - ts-node-dev respawnea el proceso en cada guardado de archivo, y cualquier
 *   deploy reinicia el proceso — sin esto, toda la caché en memoria (incluidos
 *   los metadatos de tracks que no vienen de iTunes, ver metadataService.ts
 *   cacheTracksById) se perdía y /api/stream/:id volvía a fallar con 404 hasta
 *   que el usuario repitiera la búsqueda.
 */

import fs from 'fs';
import path from 'path';

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const SNAPSHOT_FILE = path.join(__dirname, '../../data/cache_snapshot.json');
const SNAPSHOT_INTERVAL_MS = 30 * 1000;

const store = new Map<string, CacheEntry>();
let dirty = false;

function loadSnapshot(): void {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return;
    const raw = fs.readFileSync(SNAPSHOT_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    const now = Date.now();
    let restored = 0;
    for (const [key, entry] of Object.entries(parsed)) {
      if (entry && entry.expiresAt > now) {
        store.set(key, entry);
        restored++;
      }
    }
    if (restored > 0) {
      console.log(`[Cache] ⚡ Snapshot restaurado: ${restored} entradas vigentes de ${SNAPSHOT_FILE}`);
    }
  } catch (err) {
    console.warn('[Cache] No se pudo restaurar el snapshot de caché:', (err as Error).message);
  }
}

function saveSnapshot(): void {
  if (!dirty) return;
  try {
    fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
    const now = Date.now();
    const obj: Record<string, CacheEntry> = {};
    for (const [key, entry] of store.entries()) {
      if (entry.expiresAt > now) obj[key] = entry;
    }
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(obj));
    dirty = false;
  } catch (err) {
    console.warn('[Cache] No se pudo guardar el snapshot de caché:', (err as Error).message);
  }
}

loadSnapshot();

// Limpieza periódica de entradas expiradas (cada 5 minutos)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Snapshot periódico a disco (solo si hubo cambios desde el último guardado)
setInterval(saveSnapshot, SNAPSHOT_INTERVAL_MS);

// Snapshot final al apagar el proceso (respawn de ts-node-dev, deploy, Ctrl+C)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    saveSnapshot();
    process.exit(0);
  });
}

export const cache = {
  /**
   * Guarda un valor con TTL en segundos (igual que Redis SETEX)
   */
  setex(key: string, ttlSeconds: number, value: string): void {
    store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    dirty = true;
  },

  /**
   * Recupera un valor; retorna null si no existe o expiró
   */
  get(key: string): string | null {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return null;
    }
    return entry.value;
  },

  del(key: string): void {
    if (store.delete(key)) dirty = true;
  },

  size(): number {
    return store.size;
  },
};
