/**
 * KokoMusic — Sincronización de reproducción entre dispositivos ("Spotify Connect").
 * Todo por polling directo a Postgres (Supabase), sin Redis ni Realtime:
 * cada dispositivo escribe su estado cada pocos segundos y lee el de los
 * demás. Ver backend/data/migrations/add_playback_state.sql y
 * add_playback_remote_control.sql para el porqué.
 *
 * Control remoto: el dispositivo conectado ("mando") escribe un comando en la
 * fila del principal (POST /command) y el principal lo recoge en su siguiente
 * GET /state y lo ejecuta — es el único que suena.
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { supabase } from '../services/supabaseService';

const router = Router();

// Nunca cachear estas respuestas — un dato de "reproduciendo ahora" cacheado
// aunque sea unos segundos hace parecer que el sync está roto (se ve la
// canción de hace un rato en vez de la actual).
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

/** Ventana de "dispositivo activo" — más allá de esto, se considera desconectado. */
const STALE_AFTER_MS = 30_000;
/** La cola se publica recortada: con 100 temas hay de sobra para pintar "A continuación". */
const MAX_QUEUE_ITEMS = 100;

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
    positionS, durationS, isPlaying, track, queue, queueIndex, controllingDeviceId,
  } = req.body as {
    deviceId?: string; deviceName?: string; trackId?: string | null;
    title?: string | null; artist?: string | null; cover?: string | null;
    positionS?: number; durationS?: number; isPlaying?: boolean;
    track?: unknown; queue?: unknown[]; queueIndex?: number; controllingDeviceId?: string | null;
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
      track: track ?? null,
      queue: Array.isArray(queue) ? queue.slice(0, MAX_QUEUE_ITEMS) : null,
      queue_index: queueIndex ?? 0,
      controlling_device_id: controllingDeviceId ?? null,
      updated_at: new Date().toISOString(),
    };

    // Nunca tocamos command/command_id aquí — los escribe solo el mando vía
    // POST /command, y un heartbeat del principal no debe pisarlos.
    if (existing) {
      const { error } = await supabase!
        .schema('kokomusic')
        .from('playback_state')
        .update(fields)
        .eq('user_id', userId)
        .eq('device_id', deviceId);
      if (error) return err(res, error.message);
    } else {
      const { error } = await supabase!
        .schema('kokomusic')
        .from('playback_state')
        .insert({ user_id: userId, device_id: deviceId, ...fields });
      if (error) return err(res, error.message);
    }

    return res.json({ success: true });
  } catch (e: any) {
    console.error('[Playback] Error guardando estado:', e);
    return err(res, 'Error al guardar el estado de reproducción');
  }
});

/**
 * GET /api/playback/state?deviceId=xxx — mi fila (con el último comando que me
 * hayan mandado) + la de mis otros dispositivos activos. serverNow permite al
 * cliente calcular antigüedades sin depender de que su reloj coincida con el
 * del servidor.
 */
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

    const now = Date.now();
    const fresh = (data ?? []).filter((row: any) => new Date(row.updated_at).getTime() >= now - STALE_AFTER_MS);

    const mine = deviceId ? fresh.find((row: any) => row.device_id === deviceId) ?? null : null;
    // Un mando no tiene canción propia pero sí debe aparecer (el principal
    // enseña "X está conectado a este dispositivo").
    const others = fresh.filter((row: any) => row.device_id !== deviceId && (row.track_id || row.controlling_device_id));

    return res.json({ mine, others, serverNow: new Date(now).toISOString() });
  } catch (e: any) {
    console.error('[Playback] Error leyendo estado:', e);
    return err(res, 'Error al leer el estado de reproducción');
  }
});

/** POST /api/playback/command — el mando envía una orden al dispositivo principal. */
router.post('/command', async (req, res) => {
  if (!requireSupabase(res)) return;
  const userId = getUserId(req);
  if (!userId) return err(res, 'x-user-id header requerido', 400);
  const { targetDeviceId, command } = req.body as { targetDeviceId?: string; command?: { type?: string } };
  if (!targetDeviceId || !command?.type) return err(res, 'targetDeviceId y command requeridos', 400);

  try {
    // Filtrar por user_id garantiza que solo puedes mandar órdenes a tus
    // propios dispositivos.
    const { data, error } = await supabase!
      .schema('kokomusic')
      .from('playback_state')
      .update({ command, command_id: randomUUID(), command_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('device_id', targetDeviceId)
      .select('device_id');

    if (error) return err(res, error.message);
    if (!data || data.length === 0) return err(res, 'Dispositivo no encontrado', 404);
    return res.json({ success: true });
  } catch (e: any) {
    console.error('[Playback] Error enviando comando:', e);
    return err(res, 'Error al enviar el comando');
  }
});

export default router;
