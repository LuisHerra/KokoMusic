/**
 * KokoMusic — Sincronización de reproducción entre dispositivos ("Spotify Connect").
 * Todo por polling directo a Postgres (Supabase), sin Redis ni Realtime:
 * cada dispositivo escribe su estado cada pocos segundos y lee el de los
 * demás. Ver backend/data/migrations/add_playback_state.sql para el porqué.
 */

import { Router } from 'express';
import { supabase } from '../services/supabaseService';

const router = Router();

/** Ventana de "dispositivo activo" — más allá de esto, se considera desconectado. */
const STALE_AFTER_MS = 30_000;

function err(res: any, msg: string, code = 500) {
  return res.status(code).json({ error: msg });
}

function requireSupabase(res: any): boolean {
  if (!supabase) { err(res, 'Supabase no configurado', 503); return false; }
  return true;
}

function getUserId(req: any): string {
  return (req.headers['x-user-id'] || req.query.userId || req.body?.userId || '') as string;
}

/** PUT /api/playback/state — heartbeat: este dispositivo publica su estado actual. */
router.put('/state', async (req, res) => {
  if (!requireSupabase(res)) return;
  const userId = getUserId(req);
  if (!userId) return err(res, 'x-user-id header requerido', 400);

  const {
    deviceId, deviceName, trackId, title, artist, cover,
    positionS, durationS, isPlaying,
  } = req.body as {
    deviceId?: string; deviceName?: string; trackId?: string | null;
    title?: string | null; artist?: string | null; cover?: string | null;
    positionS?: number; durationS?: number; isPlaying?: boolean;
  };
  if (!deviceId) return err(res, 'deviceId requerido', 400);

  try {
    const { data: existing } = await supabase!
      .schema('kokomusic')
      .from('playback_state')
      .select('device_id')
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .maybeSingle();

    const fields = {
      device_name: deviceName ?? null,
      track_id: trackId ?? null,
      title: title ?? null,
      artist: artist ?? null,
      cover: cover ?? null,
      position_s: positionS ?? 0,
      duration_s: durationS ?? 0,
      is_playing: !!isPlaying,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      // No tocamos is_active aquí — solo cambia vía /activate, para que un
      // heartbeat normal nunca le quite el control a otro dispositivo.
      const { error } = await supabase!
        .schema('kokomusic')
        .from('playback_state')
        .update(fields)
        .eq('user_id', userId)
        .eq('device_id', deviceId);
      if (error) return err(res, error.message);
    } else {
      // Primer dispositivo de la cuenta = activo por defecto (sin fricción
      // para quien solo usa un dispositivo). Los siguientes entran inactivos.
      const { count } = await supabase!
        .schema('kokomusic')
        .from('playback_state')
        .select('device_id', { count: 'exact', head: true })
        .eq('user_id', userId);

      const { error } = await supabase!
        .schema('kokomusic')
        .from('playback_state')
        .insert({ user_id: userId, device_id: deviceId, is_active: !count, ...fields });
      if (error) return err(res, error.message);
    }

    return res.json({ success: true });
  } catch (e: any) {
    console.error('[Playback] Error guardando estado:', e);
    return err(res, 'Error al guardar el estado de reproducción');
  }
});

/** GET /api/playback/state?deviceId=xxx — mi fila + la de mis otros dispositivos activos. */
router.get('/state', async (req, res) => {
  if (!requireSupabase(res)) return;
  const userId = getUserId(req);
  if (!userId) return err(res, 'x-user-id header requerido', 400);
  const deviceId = req.query.deviceId as string | undefined;

  try {
    const { data, error } = await supabase!
      .schema('kokomusic')
      .from('playback_state')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) return err(res, error.message);

    const staleCutoff = Date.now() - STALE_AFTER_MS;
    const fresh = (data ?? []).filter((row: any) => new Date(row.updated_at).getTime() >= staleCutoff);

    const mine = deviceId ? fresh.find((row: any) => row.device_id === deviceId) ?? null : null;
    const others = fresh.filter((row: any) => row.device_id !== deviceId && row.track_id);

    return res.json({ mine, others });
  } catch (e: any) {
    console.error('[Playback] Error leyendo estado:', e);
    return err(res, 'Error al leer el estado de reproducción');
  }
});

/** POST /api/playback/activate — este dispositivo toma el control de la reproducción. */
router.post('/activate', async (req, res) => {
  if (!requireSupabase(res)) return;
  const userId = getUserId(req);
  if (!userId) return err(res, 'x-user-id header requerido', 400);
  const { deviceId } = req.body as { deviceId?: string };
  if (!deviceId) return err(res, 'deviceId requerido', 400);

  try {
    const { error: deactivateErr } = await supabase!
      .schema('kokomusic')
      .from('playback_state')
      .update({ is_active: false })
      .eq('user_id', userId)
      .neq('device_id', deviceId);
    if (deactivateErr) return err(res, deactivateErr.message);

    // Upsert: si este dispositivo aún no había mandado ningún heartbeat (p.ej.
    // recién abierto, nada reproduciéndose aquí todavía), igualmente queda
    // marcado como activo — el siguiente PUT /state rellenará el resto.
    const { error: activateErr } = await supabase!
      .schema('kokomusic')
      .from('playback_state')
      .upsert(
        { user_id: userId, device_id: deviceId, is_active: true, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,device_id', ignoreDuplicates: false }
      );
    if (activateErr) return err(res, activateErr.message);

    return res.json({ success: true });
  } catch (e: any) {
    console.error('[Playback] Error activando dispositivo:', e);
    return err(res, 'Error al activar el dispositivo');
  }
});

export default router;
