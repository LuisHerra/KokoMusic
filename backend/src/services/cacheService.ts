/**
 * Cache Service — In-Memory (local dev)
 * Simula la interfaz de Redis sin necesitar el servidor.
 * En producción Oracle Cloud se reemplaza por ioredis con el mismo contrato.
 *
 * ¿Por qué cachear búsquedas?
 * - La Spotify API tiene rate limits; una misma query puede repetirse muchísimo.
 * - Reducimos latencia de ~300ms a <1ms para búsquedas repetidas.
 * - Redis en producción persiste entre reinicios del proceso.
 */

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

// Limpieza periódica de entradas expiradas (cada 5 minutos)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

export const cache = {
  /**
   * Guarda un valor con TTL en segundos (igual que Redis SETEX)
   */
  setex(key: string, ttlSeconds: number, value: string): void {
    store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
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
    store.delete(key);
  },

  size(): number {
    return store.size;
  },
};
