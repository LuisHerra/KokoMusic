/**
 * Motor de la sincronización entre dispositivos (ver lib/deviceSync.ts para el
 * modelo). Se monta UNA sola vez (DeviceSyncEngine en App.tsx): heartbeat,
 * sondeo y avance local del progreso en modo mando. Montarlo dos veces
 * duplicaría el sondeo y, peor, aplicaría dos veces cada comando recibido
 * (un "siguiente" saltaría dos canciones).
 */
import { useEffect } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useDeviceSyncStore } from '../store/deviceSyncStore';
import { getPlaybackState } from '../lib/api';
import { THIS_DEVICE_ID, pushState, getLastPushAt, handlePollResult } from '../lib/deviceSync';

const HEARTBEAT_TICK_MS = 2000;
const HEARTBEAT_IDLE_MS = 6000;
const POLL_BUSY_MS = 2000;
const POLL_IDLE_MS = 5000;

export function useDeviceSyncEngine() {
  const userId = localStorage.getItem('koko_device_id') || '';
  const { currentTrack, isPlaying, remoteDeviceId } = usePlayerStore();

  // Heartbeat: cada 6 s normalmente; cada 2 s si otro dispositivo nos está
  // controlando, para que su reproductor vaya al día.
  useEffect(() => {
    if (!userId) return;
    pushState();
    const id = window.setInterval(() => {
      const controlled = useDeviceSyncStore.getState().otherDevices
        .some((d) => d.controlling_device_id === THIS_DEVICE_ID);
      if (controlled || Date.now() - getLastPushAt() >= HEARTBEAT_IDLE_MS) pushState();
    }, HEARTBEAT_TICK_MS);
    return () => clearInterval(id);
  }, [userId]);

  // Publicar al instante en los cambios importantes, sin esperar al heartbeat.
  useEffect(() => {
    if (userId) pushState();
  }, [userId, currentTrack?.id, isPlaying, remoteDeviceId]);

  // Sondeo: rápido si hay más dispositivos (o somos mando) — los comandos y el
  // reflejo dependen de él; lento si estamos solos.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let timer: number | undefined;
    let isFirstPoll = true;

    const loop = async () => {
      try {
        const { mine, others, serverNow } = await getPlaybackState(THIS_DEVICE_ID);
        if (cancelled) return;
        handlePollResult(mine, others, serverNow, isFirstPoll);
        isFirstPoll = false;
      } catch {
        /* un fallo de sondeo no debe afectar la reproducción local */
      }
      if (cancelled) return;
      const busy = !!usePlayerStore.getState().remoteDeviceId || useDeviceSyncStore.getState().otherDevices.length > 0;
      timer = window.setTimeout(loop, busy ? POLL_BUSY_MS : POLL_IDLE_MS);
    };

    loop();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [userId]);

  // En modo mando no hay <audio> que avance el progreso: lo avanzamos aquí
  // entre sondeo y sondeo (cada sondeo lo corrige si se desvía).
  useEffect(() => {
    if (!remoteDeviceId || !isPlaying) return;
    const id = window.setInterval(() => {
      const s = usePlayerStore.getState();
      if (!s.remoteDeviceId || !s.isPlaying) return;
      const next = s.progress + 1;
      s.applyRemoteMirror({ progress: s.duration ? Math.min(next, s.duration) : next });
    }, 1000);
    return () => clearInterval(id);
  }, [remoteDeviceId, isPlaying]);
}
