/**
 * Estado de la sincronización entre dispositivos que necesita la UI (lista de
 * otros dispositivos + aviso temporal). Lo escribe un único motor
 * (useDeviceSyncEngine, montado una vez en App.tsx) — los botones de
 * escritorio y móvil solo leen de aquí, así no hay dos sondeos en paralelo.
 * Qué dispositivo controlamos vive en playerStore (remoteDeviceId), porque las
 * acciones del reproductor lo necesitan para reenviarse.
 */
import { create } from 'zustand';
import type { PlaybackDeviceState } from '../lib/api';

let bannerTimer: number | null = null;

interface DeviceSyncState {
  otherDevices: PlaybackDeviceState[];
  banner: string | null;
  setOtherDevices: (devices: PlaybackDeviceState[]) => void;
  showBanner: (msg: string) => void;
}

export const useDeviceSyncStore = create<DeviceSyncState>((set) => ({
  otherDevices: [],
  banner: null,
  setOtherDevices: (devices) => set({ otherDevices: devices }),
  showBanner: (msg) => {
    if (bannerTimer) window.clearTimeout(bannerTimer);
    set({ banner: msg });
    bannerTimer = window.setTimeout(() => set({ banner: null }), 4000);
  },
}));
