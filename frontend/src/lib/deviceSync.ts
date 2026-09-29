/**
 * Sincronización entre dispositivos de la misma cuenta (tipo Spotify Connect),
 * por polling contra Postgres vía backend — sin Redis ni Supabase Realtime.
 *
 * Modelo: UNA sola sesión de reproducción compartida. Si este dispositivo se
 * conecta a otro, pasa a ser "mando":
 *   - Su reproductor refleja canción, cola, progreso y play/pausa del
 *     "principal" (applyMirror, en cada sondeo).
 *   - Todo lo que se pulse aquí (play/pausa, saltar, elegir otra canción, cola,
 *     buscar en la barra) se reenvía al principal como comando — ver
 *     sendRemoteCommandIfConnected en playerStore — y el principal lo ejecuta
 *     en su siguiente sondeo (applyCommand).
 *   - Solo suena el principal: useAudioPlayer no carga ni reproduce nada
 *     mientras playerStore.remoteDeviceId no es null.
 *
 * `koko_device_id` es la identidad de CUENTA (se sobreescribe con el user_id
 * al iniciar sesión) — no distingue dispositivos físicos, así que cada
 * instalación tiene además su propio id estable en `koko_this_device_id`.
 */
import { usePlayerStore, registerRemoteCommandSender, sendRemoteCommandIfConnected } from '../store/playerStore';
import { useDeviceSyncStore } from '../store/deviceSyncStore';
import { seekAudio, unlockAudio } from '../hooks/useAudioPlayer';
import {
  isDesktopApp, pushPlaybackState, sendPlaybackCommand,
  type PlaybackDeviceState, type RemoteCommand, type Track,
} from './api';

const CONNECTED_DEVICE_KEY = 'koko_connected_device';
const LAST_COMMAND_KEY = 'koko_last_applied_command';
/** Un comando más viejo que esto se descarta (p.ej. al reabrir la app tras un rato). */
const COMMAND_MAX_AGE_MS = 20_000;
/** Tras mandar un comando, no pisamos el pintado optimista con el sondeo hasta que el principal lo haya aplicado. */
const MIRROR_GRACE_MS = 3000;
/** Solo corregimos el progreso reflejado si se desvía más que esto (evita saltitos cada sondeo). */
const PROGRESS_DRIFT_TOLERANCE_S = 2;
/** El principal publica una ventana de su cola, no la cola entera. */
const QUEUE_WINDOW_BEHIND = 10;
const QUEUE_WINDOW_SIZE = 100;

function getThisDeviceId(): string {
  let id = localStorage.getItem('koko_this_device_id');
  if (!id) {
    id = `dev_${(crypto as any).randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
    localStorage.setItem('koko_this_device_id', id);
  }
  return id;
}

function detectDeviceName(): string {
  if (isDesktopApp()) return 'App de escritorio';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android' : 'Tablet Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'PC con Windows';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Este dispositivo';
}

export const THIS_DEVICE_ID = getThisDeviceId();
const THIS_DEVICE_NAME = detectDeviceName();

let ignoreMirrorUntil = 0;
let lastMirroredQueueKey = '';
let lastPushAt = 0;
/** serverNow - Date.now() del último sondeo: permite estimar la hora del servidor sin fiarse del reloj local. */
let serverOffsetMs = 0;
let lastAppliedCommandId: string | null = sessionStorage.getItem(LAST_COMMAND_KEY);

// Todo lo que el reproductor reenvía en modo mando sale por aquí.
registerRemoteCommandSender((cmd) => {
  const target = usePlayerStore.getState().remoteDeviceId;
  if (!target) return;
  ignoreMirrorUntil = Date.now() + MIRROR_GRACE_MS;
  sendPlaybackCommand(target, cmd).catch(() => {
    useDeviceSyncStore.getState().showBanner('No se pudo enviar la orden al otro dispositivo');
  });
});

export function getLastPushAt() {
  return lastPushAt;
}

// ── Publicar el estado de este dispositivo ────────────────────────────────────
export function pushState() {
  if (!localStorage.getItem('koko_device_id')) return;
  lastPushAt = Date.now();
  const s = usePlayerStore.getState();

  if (s.remoteDeviceId) {
    // Un mando no tiene reproducción propia: solo avisa de a quién controla
    // (el principal lo enseña como "X conectado a este dispositivo").
    pushPlaybackState({
      deviceId: THIS_DEVICE_ID, deviceName: THIS_DEVICE_NAME,
      trackId: null, title: null, artist: null, cover: null,
      positionS: 0, durationS: 0, isPlaying: false,
      track: null, queue: null, queueIndex: 0,
      controllingDeviceId: s.remoteDeviceId,
    }).catch(() => {});
    return;
  }

  const start = Math.max(0, s.queueIndex - QUEUE_WINDOW_BEHIND);
  pushPlaybackState({
    deviceId: THIS_DEVICE_ID, deviceName: THIS_DEVICE_NAME,
    trackId: s.currentTrack?.id ?? null,
    title: s.currentTrack?.title ?? null,
    artist: s.currentTrack?.artist ?? null,
    cover: s.currentTrack?.cover ?? null,
    positionS: s.progress,
    durationS: s.duration,
    isPlaying: s.isPlaying,
    track: s.currentTrack,
    queue: s.queue.slice(start, start + QUEUE_WINDOW_SIZE),
    queueIndex: s.queueIndex - start,
    controllingDeviceId: null,
  }).catch(() => {/* silencioso — un fallo de heartbeat no debe interrumpir la reproducción */});
}

// ── Principal: ejecutar lo que manda el mando ─────────────────────────────────
function applyCommand(cmd: RemoteCommand) {
  const s = usePlayerStore.getState();
  switch (cmd.type) {
    case 'play_track':
      s.setTrack(cmd.track, cmd.queue?.length ? cmd.queue : undefined);
      break;
    case 'set_playing':
      s.setIsPlaying(cmd.isPlaying);
      break;
    case 'next':
      s.nextTrack();
      break;
    case 'prev':
      s.prevTrack();
      break;
    case 'seek':
      seekAudio(cmd.positionS);
      break;
    case 'jump': {
      const i = s.queue.findIndex((t) => t.id === cmd.trackId);
      s.jumpToQueueIndex(i >= 0 ? i : cmd.index);
      break;
    }
    case 'add_to_queue':
      s.addToQueue(cmd.track);
      break;
    case 'remove_from_queue': {
      const i = s.queue.findIndex((t, idx) => idx > s.queueIndex && t.id === cmd.trackId);
      if (i >= 0) s.removeFromQueue(i);
      break;
    }
  }
  // Publicar enseguida para que el mando vea el resultado sin esperar al heartbeat.
  window.setTimeout(pushState, 500);
}

// ── Mando: pintar el estado del principal ─────────────────────────────────────
function trackFromRow(d: PlaybackDeviceState): Track | null {
  if (d.track) return d.track;
  if (!d.track_id) return null;
  return {
    id: d.track_id, title: d.title ?? '', artist: d.artist ?? '', album: '',
    cover: d.cover ?? '', duration: (d.duration_s || 0) * 1000, popularity: 0, preview_url: null,
  };
}

function applyMirror(d: PlaybackDeviceState, force = false) {
  if (!force && Date.now() < ignoreMirrorUntil) return;
  const s = usePlayerStore.getState();
  const track = trackFromRow(d);
  const queue = d.queue?.length ? d.queue : (track ? [track] : []);

  // position_s es de cuando el principal publicó; si está sonando, sumamos lo
  // que ha pasado desde entonces (con la hora del servidor, no la local).
  const serverNow = Date.now() + serverOffsetMs;
  const elapsed = d.is_playing ? Math.min(10, Math.max(0, (serverNow - Date.parse(d.updated_at)) / 1000)) : 0;
  const progress = d.duration_s ? Math.min(d.position_s + elapsed, d.duration_s) : d.position_s + elapsed;

  const patch: Parameters<typeof s.applyRemoteMirror>[0] = {
    isPlaying: d.is_playing,
    duration: d.duration_s,
    queueIndex: d.queue_index ?? 0,
  };
  const trackChanged = !!track && s.currentTrack?.id !== track.id;
  if (trackChanged) patch.currentTrack = track;
  if (force || trackChanged || Math.abs(s.progress - progress) > PROGRESS_DRIFT_TOLERANCE_S) patch.progress = progress;

  const queueKey = queue.map((t) => t.id).join(',');
  if (force || queueKey !== lastMirroredQueueKey) {
    patch.queue = queue;
    patch.originalQueue = queue;
    lastMirroredQueueKey = queueKey;
  }
  s.applyRemoteMirror(patch);
}

// ── Conectar / desconectar / traer el audio aquí ──────────────────────────────
export function connectTo(device: PlaybackDeviceState) {
  const s = usePlayerStore.getState();
  s.setRemoteDevice(device.device_id, device.device_name);
  sessionStorage.setItem(CONNECTED_DEVICE_KEY, device.device_id);
  lastMirroredQueueKey = '';
  applyMirror(device, true);
  pushState();
}

/** Suelta la conexión: el principal sigue sonando, este dispositivo queda en pausa con la misma canción. */
export function disconnect() {
  const s = usePlayerStore.getState();
  // isPlaying a false ANTES de soltar remoteDeviceId: si no, al dejar de ser
  // mando useAudioPlayer cargaría la canción reflejada y empezaría a sonar
  // aquí también (doble audio).
  s.setIsPlaying(false);
  s.setRemoteDevice(null, null);
  sessionStorage.removeItem(CONNECTED_DEVICE_KEY);
  pushState();
}

/** "Escuchar aquí": el audio pasa a este dispositivo en el mismo punto y el principal se pausa. */
export function playHere() {
  const s = usePlayerStore.getState();
  if (!s.remoteDeviceId) return;
  const wasPlaying = s.isPlaying;
  sendRemoteCommandIfConnected({ type: 'set_playing', isPlaying: false });
  unlockAudio();
  s.setRemoteDevice(null, null);
  sessionStorage.removeItem(CONNECTED_DEVICE_KEY);
  // El progreso reflejado se conserva: useAudioPlayer carga la canción y
  // arranca en ese punto.
  s.setIsPlaying(wasPlaying);
  pushState();
}

// ── Resultado de cada sondeo (lo llama el motor, useDeviceSyncEngine) ─────────
export function handlePollResult(
  mine: PlaybackDeviceState | null,
  others: PlaybackDeviceState[],
  serverNowIso: string,
  isFirstPoll: boolean,
) {
  const serverNow = Date.parse(serverNowIso);
  if (!isNaN(serverNow)) serverOffsetMs = serverNow - Date.now();

  const sync = useDeviceSyncStore.getState();
  sync.setOtherDevices(others);
  const s = usePlayerStore.getState();

  // Principal: ¿nos han mandado algo?
  if (!s.remoteDeviceId && mine?.command && mine.command_id && mine.command_id !== lastAppliedCommandId) {
    lastAppliedCommandId = mine.command_id;
    sessionStorage.setItem(LAST_COMMAND_KEY, mine.command_id);
    const age = serverNow - Date.parse(mine.command_at ?? '');
    if (age >= 0 && age < COMMAND_MAX_AGE_MS) applyCommand(mine.command);
  }

  // Recuperar una conexión tras recargar la página.
  if (isFirstPoll && !s.remoteDeviceId) {
    const savedId = sessionStorage.getItem(CONNECTED_DEVICE_KEY);
    if (savedId) {
      const target = others.find((d) => d.device_id === savedId && d.track_id);
      if (target) connectTo(target);
      else sessionStorage.removeItem(CONNECTED_DEVICE_KEY);
    }
    return;
  }

  // Mando: reflejar al principal (o soltar si ha desaparecido).
  if (s.remoteDeviceId) {
    const target = others.find((d) => d.device_id === s.remoteDeviceId);
    if (!target) {
      disconnect();
      sync.showBanner('El otro dispositivo se desconectó');
      return;
    }
    applyMirror(target);
  }
}
