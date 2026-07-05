/**
 * Zustand Player Store
 * Estado global del reproductor: track actual, cola, play/pause, volumen, progreso.
 * Zustand se elige sobre Redux por ser minimalista y sin boilerplate.
 */

import { create } from 'zustand';
import type { Track } from '../lib/api';
import { getApiUrl } from '../lib/backendResolver';

type RepeatMode = 'off' | 'all' | 'one';

export type CrossfadeCurve = 'linear' | 'exponential' | 'logarithmic' | 's-curve';

export interface TransitionRule {
  fromTrackId: string;
  toTrackId: string;
  fromTime: number;
  toTime: number;
  curve: CrossfadeCurve;
  duration: number;
  // Volume fade extensions
  fadeOutPercent?: number;   // 0-100: % de reducción al final del track saliente
  fadeInPercent?: number;    // 0-100: % de boost al inicio del track entrante  
  fadeOutDuration?: number;  // segundos del fade out
  fadeInDuration?: number;   // segundos del fade in
}

interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  originalQueue: Track[];   // preserva el orden original para unshuffle
  queueIndex: number;
  isPlaying: boolean;
  volume: number;          // 0 - 1
  isMuted: boolean;
  progress: number;        // segundos actuales
  duration: number;        // duración total en segundos
  isLoading: boolean;
  error: string | null;
  dominantColor: string;   // color extraído de la carátula
  isLyricsOpen: boolean;
  isQueueOpen: boolean;
  isVideoOpen: boolean;
  isShuffle: boolean;
  repeatMode: RepeatMode;  // off → all → one
  autoplayEnabled: boolean;

  // Sleep Timer
  sleepTimerMinutes: number | null;   // null = off, -1 = end of track
  sleepTimerEndTime: number | null;   // timestamp when sleep fires

  // DJ Transitions
  transitions: Record<string, TransitionRule>;

  // Sinfonía Sync
  isSinfoniaSyncEnabled: boolean;
  setSinfoniaSyncEnabled: (enabled: boolean) => void;

  // Sinfonía Active Session
  activeJamCode: string | null;
  activeJamId: string | null;
  activeJamHostName: string | null;
  isJamHost: boolean;
  setActiveJam: (jam: { code: string; id: string; hostName: string; isHost: boolean } | null) => void;
  jamQueue: any[];
  setJamQueue: (q: any[]) => void;

  // EQ
  eqBands: number[];           // 5 bandas en dB [-12, 12]
  setEqBand: (index: number, gainDb: number) => void;
  setEqPreset: (preset: number[]) => void;

  // Karaoke
  isKaraokeMode: boolean;
  toggleKaraoke: () => void;

  // Actions
  setTrack: (track: Track, queue?: Track[]) => void;
  setQueue: (tracks: Track[], startIndex?: number) => void;
  togglePlay: () => void;
  setIsPlaying: (v: boolean) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setProgress: (s: number) => void;
  setDuration: (s: number) => void;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  setDominantColor: (color: string) => void;
  toggleLyrics: () => void;
  setIsLyricsOpen: (open: boolean) => void;
  toggleQueue: () => void;
  setIsQueueOpen: (open: boolean) => void;
  toggleVideo: () => void;
  setIsVideoOpen: (open: boolean) => void;
  toggleShuffle: () => void;
  toggleAutoplay: () => void;
  cycleRepeat: () => void;
  removeFromQueue: (index: number) => void;
  addToQueue: (track: Track) => void;
  jumpToQueueIndex: (index: number) => void;
  moveInQueue: (from: number, to: number) => void;
  setSleepTimer: (minutes: number | null) => void;
  clearSleepTimer: () => void;
  setTransition: (rule: TransitionRule) => void;
  removeTransition: (fromId: string, toId: string) => void;

  // Embed Mode
  isEmbedMode: boolean;
  embedYoutubeId: string | null;
  setEmbedMode: (active: boolean, youtubeId: string | null) => void;
}

// Fisher-Yates shuffle — retorna un nuevo array con el track actual primero
function shuffleArray(array: Track[], currentTrack: Track | null): Track[] {
  const clone = [...array];
  if (currentTrack) {
    const idx = clone.findIndex(t => t.id === currentTrack.id);
    if (idx !== -1) {
      clone.splice(idx, 1);
    }
  }
  for (let i = clone.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  if (currentTrack) {
    clone.unshift(currentTrack);
  }
  return clone;
}

const savedTransitions = JSON.parse(localStorage.getItem('koko_dj_transitions') || '{}');

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  queue: [],
  originalQueue: [],
  queueIndex: 0,
  isPlaying: false,
  volume: 0.8,
  isMuted: false,
  progress: 0,
  duration: 0,
  isLoading: false,
  error: null,
  dominantColor: '#1DB954',
  isLyricsOpen: false,
  isQueueOpen: false,
  isVideoOpen: false,
  isShuffle: false,
  repeatMode: 'off',
  autoplayEnabled: localStorage.getItem('koko_autoplay_enabled') !== 'false',
  sleepTimerMinutes: null,
  sleepTimerEndTime: null,

  transitions: savedTransitions,

  isEmbedMode: false,
  embedYoutubeId: null,
  setEmbedMode: (active, youtubeId) => set({ isEmbedMode: active, embedYoutubeId: youtubeId }),

  eqBands: JSON.parse(localStorage.getItem('koko_eq_bands') || '[0,0,0,0,0]'),
  setEqBand: (index, gainDb) => set((s) => {
    const bands = [...s.eqBands];
    bands[index] = gainDb;
    localStorage.setItem('koko_eq_bands', JSON.stringify(bands));
    return { eqBands: bands };
  }),
  setEqPreset: (preset) => {
    localStorage.setItem('koko_eq_bands', JSON.stringify(preset));
    set({ eqBands: preset });
  },

  isKaraokeMode: localStorage.getItem('koko_karaoke_mode') === 'true',
  toggleKaraoke: () => set((s) => {
    const next = !s.isKaraokeMode;
    localStorage.setItem('koko_karaoke_mode', String(next));
    return { isKaraokeMode: next };
  }),

  setTrack: (track, queue) => {
    const { isShuffle } = get();
    const newOriginal = queue ?? get().originalQueue;
    let newQueue: Track[];
    let idx: number;

    if (isShuffle) {
      newQueue = shuffleArray(newOriginal, track);
      idx = newQueue.findIndex((t) => t.id === track.id);
    } else {
      newQueue = newOriginal;
      idx = newOriginal.findIndex((t) => t.id === track.id);
    }

    set({
      currentTrack: track,
      queue: newQueue,
      originalQueue: newOriginal,
      queueIndex: idx >= 0 ? idx : 0,
      isPlaying: true,
      progress: 0,
      error: null,
    });
  },

  setQueue: (tracks, startIndex = 0) =>
    set({ queue: tracks, originalQueue: tracks, queueIndex: startIndex }),

  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  setIsPlaying: (v) => set({ isPlaying: v }),

  nextTrack: async () => {
    const { queue, queueIndex, repeatMode, currentTrack, autoplayEnabled } = get();

    if (repeatMode === 'one') {
      // Repeat one: reiniciar la canción actual
      set({ progress: 0 });
      return;
    }

    const next = queueIndex + 1;
    if (next < queue.length) {
      set({ currentTrack: queue[next], queueIndex: next, progress: 0, error: null, isPlaying: true });
    } else if (repeatMode === 'all' && queue.length > 0) {
      // Volver al inicio de la cola
      set({ currentTrack: queue[0], queueIndex: 0, progress: 0, error: null, isPlaying: true });
    } else if (autoplayEnabled && currentTrack) {
      try {
        set({ isLoading: true });
        const userId = localStorage.getItem('koko_device_id') || '';
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
          ...(userId ? { 'x-user-id': userId } : {}),
        };
        const apiBase = await getApiUrl();
        const res = await fetch(
          `${apiBase}/tracks/recommendations?seedTrackId=${currentTrack.id}&limit=5`,
          { headers }
        );
        if (!res.ok) throw new Error();
        const recs = await res.json() as Track[];
        if (recs && recs.length > 0) {
          const newQueue = [...queue, ...recs];
          set({
            queue: newQueue,
            originalQueue: newQueue,
            queueIndex: next,
            currentTrack: recs[0],
            progress: 0,
            error: null,
            isPlaying: true,
            isLoading: false
          });
          return;
        }
      } catch (err) {
        console.error('Failed to autoplay recommendations:', err);
      }
      set({ isPlaying: false, isLoading: false });
    } else {
      // No hay más canciones, parar
      set({ isPlaying: false });
    }
  },

  prevTrack: () => {
    const { queue, queueIndex, progress } = get();
    // Si llevamos >3s en la canción → volver al inicio; si no → track anterior
    if (progress > 3) {
      set({ progress: 0 });
    } else if (queueIndex > 0) {
      const prev = queueIndex - 1;
      set({ currentTrack: queue[prev], queueIndex: prev, progress: 0, error: null, isPlaying: true });
    }
  },

  setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)), isMuted: false }),
  toggleMute: () => set((s) => ({ isMuted: !s.isMuted })),
  setProgress: (s) => set({ progress: s }),
  setDuration: (s) => set({ duration: s }),
  setLoading: (v) => set({ isLoading: v }),
  setError: (msg) => set({ error: msg, isLoading: false }),
  setDominantColor: (color) => set({ dominantColor: color }),
  toggleLyrics: () => set((s) => ({ isLyricsOpen: !s.isLyricsOpen })),
  setIsLyricsOpen: (open) => set({ isLyricsOpen: open }),
  toggleQueue: () => set((s) => ({ isQueueOpen: !s.isQueueOpen, isVideoOpen: s.isQueueOpen ? s.isVideoOpen : false })),
  setIsQueueOpen: (open) => set({ isQueueOpen: open, isVideoOpen: open ? false : get().isVideoOpen }),
  toggleVideo: () => set((s) => ({ isVideoOpen: !s.isVideoOpen, isQueueOpen: s.isVideoOpen ? s.isQueueOpen : false })),
  setIsVideoOpen: (open) => set({ isVideoOpen: open, isQueueOpen: open ? false : get().isQueueOpen }),

  toggleShuffle: () => {
    const { isShuffle, originalQueue, queue, currentTrack } = get();
    if (isShuffle) {
      // Desactivar shuffle → restaurar orden original
      const idx = currentTrack ? originalQueue.findIndex((t) => t.id === currentTrack.id) : 0;
      set({ isShuffle: false, queue: originalQueue, queueIndex: idx >= 0 ? idx : 0 });
    } else {
      // Activar shuffle → barajar cola manteniendo el track actual en su posición
      const shuffled = shuffleArray(queue, currentTrack);
      set({ isShuffle: true, queue: shuffled, queueIndex: 0 });
    }
  },

  toggleAutoplay: () => set((s) => {
    const next = !s.autoplayEnabled;
    localStorage.setItem('koko_autoplay_enabled', String(next));
    return { autoplayEnabled: next };
  }),

  cycleRepeat: () => {
    const { repeatMode } = get();
    const next: RepeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    set({ repeatMode: next });
  },

  removeFromQueue: (index) => {
    const { queue, queueIndex } = get();
    if (index <= queueIndex || index >= queue.length) return; // no remover track actual o anteriores
    const newQueue = [...queue];
    newQueue.splice(index, 1);
    set({ queue: newQueue });
  },

  addToQueue: (track) => {
    const { queue, currentTrack } = get();
    // Si no hay nada reproduciéndose → reproducir directamente
    if (!currentTrack) {
      set({ currentTrack: track, queue: [track], originalQueue: [track], queueIndex: 0, isPlaying: true, progress: 0, error: null });
      return;
    }
    // Añadir al final de la cola
    set({ queue: [...queue, track] });
  },

  jumpToQueueIndex: (index) => {
    const { queue } = get();
    if (index < 0 || index >= queue.length) return;
    set({
      currentTrack: queue[index],
      queueIndex: index,
      progress: 0,
      error: null,
      isPlaying: true,
    });
  },

  moveInQueue: (from, to) => {
    const { queue, queueIndex } = get();
    if (from === to || from <= queueIndex || to <= queueIndex) return;
    const newQueue = [...queue];
    const [moved] = newQueue.splice(from, 1);
    newQueue.splice(to, 0, moved);
    set({ queue: newQueue });
  },

  setSleepTimer: (minutes) => {
    if (minutes === null) {
      set({ sleepTimerMinutes: null, sleepTimerEndTime: null });
      return;
    }
    if (minutes === -1) {
      // "End of track" mode — will be handled in useAudioPlayer
      set({ sleepTimerMinutes: -1, sleepTimerEndTime: null });
      return;
    }
    set({
      sleepTimerMinutes: minutes,
      sleepTimerEndTime: Date.now() + minutes * 60 * 1000,
    });
  },

  clearSleepTimer: () => set({ sleepTimerMinutes: null, sleepTimerEndTime: null }),

  setTransition: (rule) => set((state) => {
    const newTransitions = {
      ...state.transitions,
      [`${rule.fromTrackId}-${rule.toTrackId}`]: rule
    };
    localStorage.setItem('koko_dj_transitions', JSON.stringify(newTransitions));
    return { transitions: newTransitions };
  }),

  removeTransition: (fromId, toId) => set((state) => {
    const newRules = { ...state.transitions };
    delete newRules[`${fromId}-${toId}`];
    localStorage.setItem('koko_dj_transitions', JSON.stringify(newRules));
    return { transitions: newRules };
  }),

  isSinfoniaSyncEnabled: localStorage.getItem('koko_sinfonia_sync') !== 'false',
  setSinfoniaSyncEnabled: (enabled) => {
    localStorage.setItem('koko_sinfonia_sync', enabled ? 'true' : 'false');
    set({ isSinfoniaSyncEnabled: enabled });
  },

  activeJamCode: null,
  activeJamId: null,
  activeJamHostName: null,
  isJamHost: false,
  setActiveJam: (jam) => {
    if (!jam) {
      set({ activeJamCode: null, activeJamId: null, activeJamHostName: null, isJamHost: false });
    } else {
      set({
        activeJamCode: jam.code,
        activeJamId: jam.id,
        activeJamHostName: jam.hostName,
        isJamHost: jam.isHost
      });
    }
  },

  jamQueue: [],
  setJamQueue: (q) => set({ jamQueue: q }),
}));
