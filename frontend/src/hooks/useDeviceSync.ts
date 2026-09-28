/**
 * useDeviceSync — sincronización de reproducción entre dispositivos de la
 * misma cuenta ("Spotify Connect"), por polling directo contra Postgres
 * (Supabase vía backend), sin Redis ni Supabase Realtime.
 *
 * Cada dispositivo escribe su estado cada pocos segundos (heartbeat) y lee el
 * de los demás. `is_active` marca cuál "manda": si otro dispositivo se activa
 * (el usuario le da a "reproducir aquí" allí), este detecta en el siguiente
 * sondeo que ya no es el activo y se pausa solo.
 *
 * `koko_device_id` es la identidad de CUENTA (se sobreescribe con el user_id
 * al iniciar sesión) — no sirve para distinguir dispositivos físicos, así que
 * generamos un id de instalación aparte y estable en `koko_this_device_id`.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { seekAudio } from './useAudioPlayer';
import { getTrack, isDesktopApp, pushPlaybackState, getPlaybackState, activatePlaybackDevice, type PlaybackDeviceState } from '../lib/api';

const WRITE_INTERVAL_MS = 6000;
const READ_INTERVAL_MS = 5000;

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
  const [takenOverBanner, setTakenOverBanner] = useState<string | null>(null);

  const { currentTrack, isPlaying, progress, duration, setIsPlaying } = usePlayerStore();

  const userId = localStorage.getItem('koko_device_id') || '';

  // ── Escritura: heartbeat cada pocos segundos + al cambiar de canción/estado ──
  const pushState = useCallback(() => {
    if (!userId) return;
    pushPlaybackState({
      deviceId: deviceIdRef.current,
      deviceName: deviceNameRef.current,
      trackId: currentTrack?.id ?? null,
      title: currentTrack?.title ?? null,
      artist: currentTrack?.artist ?? null,
      cover: currentTrack?.cover ?? null,
      positionS: progress,
      durationS: duration,
      isPlaying,
    }).catch(() => {/* silencioso — un fallo de heartbeat no debe interrumpir la reproducción */});
  }, [userId, currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.cover, progress, duration, isPlaying]);

  useEffect(() => {
    if (!userId) return;
    pushState();
    const id = window.setInterval(pushState, WRITE_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Empuja de inmediato en los eventos importantes (no solo en el heartbeat).
  useEffect(() => {
    if (userId) pushState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id, isPlaying]);

  // ── Lectura: sondea el estado de los demás dispositivos ─────────────────────
  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const { mine, others } = await getPlaybackState(deviceIdRef.current);
        if (cancelled) return;
        setOtherDevices(others);

        // Si este dispositivo ya no es el activo pero sigue sonando aquí,
        // otro dispositivo tomó el control — nos pausamos y avisamos.
        if (mine && !mine.is_active && usePlayerStore.getState().isPlaying) {
          setIsPlaying(false);
          setTakenOverBanner('Reproduciendo en otro dispositivo');
          window.setTimeout(() => setTakenOverBanner(null), 4000);
        }
      } catch {
        /* un fallo de sondeo no debe afectar la reproducción local */
      }
    };

    poll();
    const id = window.setInterval(poll, READ_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [userId, setIsPlaying]);

  // ── "Reproducir aquí" — toma el control y arranca desde el estado remoto ───
  const activateHere = useCallback(async (device: PlaybackDeviceState) => {
    await activatePlaybackDevice(deviceIdRef.current);
    if (!device.track_id) return;
    try {
      const track = await getTrack(device.track_id);
      if (!track) return;
      usePlayerStore.getState().setTrack(track);
      // setTrack ya pone isPlaying=true y progress=0 — ajustamos a la posición remota.
      window.setTimeout(() => seekAudio(device.position_s || 0), 300);
      if (!device.is_playing) usePlayerStore.getState().setIsPlaying(false);
    } catch {
      /* si falla, al menos ya se activó este dispositivo para la próxima vez */
    }
  }, []);

  return { otherDevices, activateHere, takenOverBanner, myDeviceId: deviceIdRef.current };
}
