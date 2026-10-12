/**
 * Control de acceso — cuenta registrada vs. invitado.
 *
 * KokoMusic es privada (registro solo con email en access_allowlist), pero
 * existe un modo invitado de "teaser": quien no tiene cuenta puede escuchar
 * únicamente lo que ya está subido al CDN (R2). Nunca puede disparar una
 * resolución nueva contra KokoMusic-lite/YouTube, que es lo que cuesta
 * tráfico de proxy — ese camino solo existe para usuarios con perfil real.
 */

import type { Request } from 'express';
import { supabase } from './supabaseService';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const POSITIVE_TTL_MS = 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;
const known = new Map<string, { ok: boolean; expires: number }>();

/**
 * Id del usuario que hace la petición. El <audio> no puede mandar cabeceras,
 * así que las URLs de stream lo llevan como `?uid=`; el resto de la API usa
 * la cabecera x-user-id de apiFetch.
 */
export function getRequestUserId(req: Request): string {
  return String(req.headers['x-user-id'] || req.query.uid || '').trim();
}

/** true si el id corresponde a un perfil real de koko_profiles. */
export async function isRegisteredUser(userId: string | undefined | null): Promise<boolean> {
  if (!userId || !UUID_RE.test(userId)) return false;
  // Sin Supabase (desarrollo local / Termux) no hay forma de validar: el
  // backend local es del propio dueño, así que cualquier UUID cuenta.
  if (!supabase) return true;

  const hit = known.get(userId);
  if (hit && hit.expires > Date.now()) return hit.ok;

  try {
    const { data, error } = await supabase
      .schema('kokomusic')
      .from('koko_profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    const ok = !!data;
    known.set(userId, { ok, expires: Date.now() + (ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
    return ok;
  } catch (err) {
    // Si Supabase falla, no castigamos a un usuario que ya validamos antes.
    console.warn('[Access] No se pudo validar el usuario:', err instanceof Error ? err.message : err);
    return hit?.ok ?? false;
  }
}

export async function isRegisteredRequest(req: Request): Promise<boolean> {
  return isRegisteredUser(getRequestUserId(req));
}

export const GUEST_FORBIDDEN = {
  error: 'Modo invitado: esta canción todavía no está disponible. Inicia sesión para escucharla.',
  guest: true,
} as const;
