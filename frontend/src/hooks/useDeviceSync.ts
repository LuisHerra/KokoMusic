/**
 * useDeviceSync — sincronización de reproducción entre dispositivos de la
 * misma cuenta ("Spotify Connect"), por polling directo contra Postgres
 * (Supabase vía backend), sin Redis ni Supabase Realtime.
 *
 * Modelo: cada dispositivo escribe su estado cada pocos segundos (heartbeat)
 * y lee el de los demás. "Conectarte" a otro dispositivo NO le quita el
 * control ni te trae su canción aquí — al revés: silencia ESTE dispositivo
 * (el que se conecta) y te deja ver en él lo que suena en el otro (el
 * "principal", que sigue sonando ahí sin enterarse de nada). Es solo estado
 * local del que se conecta — el dispositivo principal no necesita saber que
 * alguien lo está mirando.
 *
 * `koko_device_id` es la identidad de CUENTA (se sobreescribe con el user_id
 * al iniciar sesión) — no sirve para distinguir dispositivos físicos, así que
 * generamos un id de instalación aparte y estable en `koko_this_device_id`.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { isDesktopApp, pushPlaybackState, getPlaybackState, type PlaybackDeviceState } from '../lib/api';

const WRITE_INTERVAL_MS = 6000;
const READ_INTERVAL_MS = 5000;
const CONNECTED_DEVICE_KEY = 'koko_connected_device_id';

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

export function useDeviceSync() {
  const deviceIdRef = useRef(getThisDeviceId());
  const deviceNameRef = useRef(detectDeviceName());
  const [otherDevices, setOtherDevices] = useState<PlaybackDeviceState[]>([]);
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(
    () => sessionStorage.getItem(CONNECTED_DEVICE_KEY)
  );
  const [banner, setBanner] = useState<string | null>(null);

  const { currentTrack, isPlaying } = usePlayerStore();

  const userId = localStorage.getItem('koko_device_id') || '';

  const showBanner = (msg: string) => {
    setBanner(msg);
    window.setTimeout(() => setBanner(null), 4000);
  };

  // ── Escritura: heartbeat cada pocos segundos + al cambiar de canción/estado ──
  // Lee SIEMPRE el estado más reciente vía getState() en vez de cerrar sobre
  // props reactivas (progress cambia cada segundo) — si dependiera de esas
  // props, esta función cambiaría de identidad constantemente y el
  // setInterval de abajo (que solo se crea una vez) quedaría con una
  // referencia vieja para siempre, reenviando canción/posición congeladas en
  // el momento del montaje.
  const pushState = useCallback(() => {
    if (!userId) return;
    const s = usePlayerStore.getState();
    pushPlaybackState({
      deviceId: deviceIdRef.current,
      deviceName: deviceNameRef.current,
      trackId: s.currentTrack?.id ?? null,
      title: s.currentTrack?.title ?? null,
      artist: s.currentTrack?.artist ?? null,
      cover: s.currentTrack?.cover ?? null,
      positionS: s.progress,
      durationS: s.duration,
      isPlaying: s.isPlaying,
    }).catch(() => {/* silencioso — un fallo de heartbeat no debe interrumpir la reproducción */});
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    pushState();
    const id = window.setInterval(pushState, WRITE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [userId, pushState]);

  // Empuja de inmediato en los eventos importantes (no solo en el heartbeat).
  useEffect(() => {
    if (userId) pushState();
  }, [currentTrack?.id, isPlaying, userId, pushState]);

  // ── Conectar / desconectar ───────────────────────────────────────────────────
  const connectTo = useCallback((device: PlaybackDeviceState) => {
    setConnectedDeviceId(device.device_id);
    sessionStorage.setItem(CONNECTED_DEVICE_KEY, device.device_id);
    // El objetivo de conectarte es escuchar SOLO en el otro dispositivo (el
    // "principal") — este se silencia. El principal no se entera ni cambia.
    usePlayerStore.getState().setIsPlaying(false);
  }, []);

  const disconnect = useCallback(() => {
    setConnectedDeviceId(null);
    sessionStorage.removeItem(CONNECTED_DEVICE_KEY);
  }, []);

  // ── Lectura: sondea el estado de los demás dispositivos ─────────────────────
  const hasPolledRef = useRef(false);
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const { others } = await getPlaybackState(deviceIdRef.current);
        if (cancelled) return;
        hasPolledRef.current = true;
        setOtherDevices(others);
      } catch {
        /* un fallo de sondeo no debe afectar la reproducción local */
      }
    };

    poll();
    const id = window.setInterval(poll, READ_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [userId]);

  const connectedDevice = connectedDeviceId
    ? otherDevices.find((d) => d.device_id === connectedDeviceId) ?? null
    : null;

  // Si el dispositivo principal desaparece (se cerró, lleva >30s sin avisar),
  // no tiene sentido seguir "conectado" a él — avisamos y soltamos la conexión.
  // hasPolledRef evita disparar esto antes de que llegue el primer sondeo real
  // (otherDevices empieza en [] y aún no significa "no hay nadie").
  useEffect(() => {
    if (connectedDeviceId && hasPolledRef.current && !connectedDevice) {
      disconnect();
      showBanner('El otro dispositivo se desconectó');
    }
  }, [connectedDeviceId, connectedDevice, otherDevices, disconnect]);

  // Si el usuario retoma la reproducción aquí (botón de play normal), ya no
  // tiene sentido seguir mostrando "conectado" a otro — se corta solo. Ojo:
  // depende SOLO de isPlaying (vía ref para connectedDeviceId) — si
  // dependiera también de connectedDeviceId, el propio connectTo() (que pone
  // isPlaying a false Y connectedDeviceId a la vez) podría disparar esto en
  // el mismo tick con un isPlaying todavía sin refrescar y desconectar recién
  // conectado.
  const connectedIdRef = useRef(connectedDeviceId);
  useEffect(() => { connectedIdRef.current = connectedDeviceId; }, [connectedDeviceId]);
  useEffect(() => {
    if (isPlaying && connectedIdRef.current) disconnect();
  }, [isPlaying, disconnect]);

  return {
    otherDevices,
    connectedDeviceId,
    connectedDevice,
    connectTo,
    disconnect,
    banner,
  };
}
