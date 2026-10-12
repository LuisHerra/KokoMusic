/**
 * Modo invitado — teaser para quien no tiene cuenta.
 *
 * Un invitado solo puede escuchar lo que ya está subido al CDN (canciones que
 * alguien con cuenta escuchó antes). El backend lo impone en /api/stream
 * (403 si el track no está en R2 y no hay usuario registrado); aquí solo
 * evitamos que el reproductor intente sonar algo que va a fallar.
 */

import { getApiUrl } from './backendResolver';

const GUEST_KEY = 'koko_guest_mode';

export function isGuestMode(): boolean {
  try {
    return localStorage.getItem(GUEST_KEY) === 'true' && !localStorage.getItem('koko_auth_completed');
  } catch {
    return false;
  }
}

export function enterGuestMode(): void {
  localStorage.setItem(GUEST_KEY, 'true');
}

export function exitGuestMode(): void {
  localStorage.removeItem(GUEST_KEY);
}

let playableIds: Set<string> | null = null;
let loading: Promise<Set<string>> | null = null;

/** Ids reproducibles en modo invitado (catálogo del CDN). */
export function loadGuestPlayableIds(force = false): Promise<Set<string>> {
  if (playableIds && !force) return Promise.resolve(playableIds);
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch(`${await getApiUrl()}/tracks/cdn-ids`);
      if (!res.ok) throw new Error(String(res.status));
      const { ids } = (await res.json()) as { ids: string[] };
      playableIds = new Set(ids);
    } catch (err) {
      console.warn('[Guest] No se pudo cargar el catálogo del CDN:', err);
      playableIds ??= new Set();
    } finally {
      loading = null;
    }
    return playableIds!;
  })();
  return loading;
}

/**
 * ¿Puede sonar este track ahora mismo? Fuera del modo invitado siempre sí.
 * Si el catálogo aún no ha cargado dejamos pasar: el backend decide.
 */
export function canPlayTrack(trackId: string): boolean {
  if (!isGuestMode()) return true;
  if (!playableIds) return true;
  return playableIds.has(trackId);
}

export const GUEST_BLOCKED_MESSAGE = 'Modo invitado: solo puedes escuchar canciones del catálogo disponible. Inicia sesión para escuchar cualquier canción.';
