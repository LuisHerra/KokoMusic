/**
 * recommendationImpressions.ts
 *
 * Recuerda qué tracks se le mostraron ya a cada usuario como recomendación
 * (no reproducción, solo "aparecio en el rail") para no repetir la misma
 * canción varias veces en la misma sesión/24h, al estilo Spotify.
 *
 * In-memory, igual que recommendationCache.ts — no necesita sobrevivir a un
 * restart del servidor (una ventana de 24h que se resetea de vez en cuando
 * no es un problema real), y evita el roundtrip a Supabase que rompería el
 * presupuesto de <200ms de esta ruta.
 */

const WINDOW_MS = 24 * 60 * 60 * 1000; // 24h — cubre también "misma sesión"

// userId -> (trackId -> timestamp del último show)
const shownStore = new Map<string, Map<string, number>>();

/** trackId → timestamp del último show, para lo mostrado a este usuario en las últimas 24h. */
export function getRecentlyShown(userId: string): Map<string, number> {
  const userMap = shownStore.get(userId);
  if (!userMap) return new Map();

  const now = Date.now();
  const result = new Map<string, number>();
  for (const [trackId, ts] of userMap) {
    if (now - ts < WINDOW_MS) {
      result.set(trackId, ts);
    } else {
      userMap.delete(trackId); // limpieza perezosa de entradas caducadas
    }
  }
  if (userMap.size === 0) shownStore.delete(userId);
  return result;
}

/** Marca estos trackIds como "mostrados ahora" para este usuario. */
export function recordShown(userId: string, trackIds: string[]): void {
  if (!userId || trackIds.length === 0) return;
  let userMap = shownStore.get(userId);
  if (!userMap) {
    userMap = new Map();
    shownStore.set(userId, userMap);
  }
  const now = Date.now();
  for (const id of trackIds) userMap.set(id, now);
}
