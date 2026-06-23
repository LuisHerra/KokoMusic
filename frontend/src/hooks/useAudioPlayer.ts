/**
 * useAudioPlayer — Hook central del reproductor
 * Conecta el elemento <audio> con el playerStore de Zustand.
 * Gestiona: play/pause, seeking, volumen, carga, errores, auto-next, sleep timer,
 *           crossfade con curvas DJ, ecualizador de 5 bandas (Web Audio API),
 *           fades de volumen en transiciones, y Media Session API para
 *           reproducción en segundo plano / pantalla apagada (iOS + Android).
 *
 * IMPORTANTE: Este hook solo debe montarse UNA VEZ desde <AudioEngine> en App.tsx.
 * Para hacer seek desde otros componentes usa la función exportada `seekAudio()`.
 */

import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore, type CrossfadeCurve } from '../store/playerStore';
import { getStreamUrl, logTrackPlay } from '../lib/api';
import { getOfflineTrack, isTrackOffline, saveTrackOffline } from '../lib/offlineAudio';

let currentBlobUrl: string | null = null;

// ─── Media Session API ────────────────────────────────────────────────────────
// Registra metadatos y controles de transporte en el SO (lock screen, notificación,
// auriculares Bluetooth, mandos de Android/iOS) para reproducción en 2º plano.

function updateMediaSession(
  track: { title: string; artist: string; album?: string; cover?: string } | null,
  handlers: {
    onPlay: () => void;
    onPause: () => void;
    onPrev: () => void;
    onNext: () => void;
  }
) {
  if (!('mediaSession' in navigator)) return;

  if (!track) {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    return;
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title:  track.title,
    artist: track.artist,
    album:  track.album ?? 'KokoMusic',
    artwork: track.cover
      ? [
          { src: track.cover, sizes: '512x512', type: 'image/jpeg' },
          { src: track.cover, sizes: '256x256', type: 'image/jpeg' },
        ]
      : [],
  });

  // Handlers de transporte — el SO los invoca desde el lock screen / auriculares
  navigator.mediaSession.setActionHandler('play',          handlers.onPlay);
  navigator.mediaSession.setActionHandler('pause',         handlers.onPause);
  navigator.mediaSession.setActionHandler('previoustrack', handlers.onPrev);
  navigator.mediaSession.setActionHandler('nexttrack',     handlers.onNext);
  navigator.mediaSession.setActionHandler('seekbackward',  (d) => seekAudio(Math.max(0, getActiveAudio().currentTime - (d.seekOffset ?? 10))));
  navigator.mediaSession.setActionHandler('seekforward',   (d) => seekAudio(Math.min(getActiveAudio().duration || 0, getActiveAudio().currentTime + (d.seekOffset ?? 10))));
}

function setMediaSessionState(state: 'playing' | 'paused' | 'none') {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = state;
}

function updateMediaSessionPosition(audio: HTMLAudioElement) {
  if (!('mediaSession' in navigator) || !audio.duration) return;
  try {
    navigator.mediaSession.setPositionState({
      duration:     audio.duration,
      playbackRate: audio.playbackRate,
      position:     audio.currentTime,
    });
  } catch { /* algunos navegadores antiguos no lo soportan */ }
}

function getFadeRatio(ratio: number, curve: CrossfadeCurve | undefined) {
  if (!curve) return ratio;
  switch (curve) {
    case 'exponential': return Math.pow(ratio, 2);
    case 'logarithmic': return Math.log10(1 + 9 * ratio);
    case 's-curve': return ratio * ratio * (3 - 2 * ratio);
    case 'linear':
    default: return ratio;
  }
}

// ─── Web Audio API setup ──────────────────────────────────────────────────────
// AudioContext y nodos se crean una sola vez al módulo level
let audioCtx: AudioContext | null = null;

// EQ band frequencies
const EQ_FREQUENCIES = [60, 230, 910, 4000, 14000];
const EQ_TYPES: BiquadFilterType[] = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf'];

interface AudioChain {
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[];
  gain: GainNode;
}

const chains = new Map<HTMLAudioElement, AudioChain>();

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return audioCtx;
}

function getOrCreateChain(audio: HTMLAudioElement): AudioChain {
  if (chains.has(audio)) return chains.get(audio)!;

  const ctx = getAudioContext();
  const source = ctx.createMediaElementSource(audio);
  const filters = EQ_FREQUENCIES.map((freq, i) => {
    const f = ctx.createBiquadFilter();
    f.type = EQ_TYPES[i];
    f.frequency.value = freq;
    f.gain.value = 0;
    f.Q.value = 1.0;
    return f;
  });
  const gain = ctx.createGain();
  gain.gain.value = 1;

  // Chain: source → filter[0] → ... → filter[n] → gain → destination
  source.connect(filters[0]);
  for (let i = 0; i < filters.length - 1; i++) {
    filters[i].connect(filters[i + 1]);
  }
  filters[filters.length - 1].connect(gain);
  gain.connect(ctx.destination);

  const chain = { source, filters, gain };
  chains.set(audio, chain);
  return chain;
}

/**
 * Aplica los valores de EQ a los BiquadFilterNodes del audio dado.
 */
export function applyEqBands(audio: HTMLAudioElement, bands: number[]) {
  const chain = getOrCreateChain(audio);
  bands.forEach((gainDb, i) => {
    if (chain.filters[i]) chain.filters[i].gain.value = gainDb;
  });
}

// ─── Audio elements ───────────────────────────────────────────────────────────
const audio1 = new Audio();
const audio2 = new Audio();
audio1.preload = 'metadata';
audio2.preload = 'metadata';
// crossOrigin needed for Web Audio API
audio1.crossOrigin = 'anonymous';
audio2.crossOrigin = 'anonymous';
// Necesario para que iOS mantenga la sesión de audio en background
// (sin esto Safari puede pausar el audio al bloquear la pantalla)
audio1.setAttribute('playsinline', '');
audio2.setAttribute('playsinline', '');

let activeIdx = 0;
let globalLastLoadedTrackId: string | null = null;
const CROSSFADE_DURATION = 3000; // ms


export function getActiveAudio() {
  return activeIdx === 0 ? audio1 : audio2;
}
export function getInactiveAudio() {
  return activeIdx === 0 ? audio2 : audio1;
}

export function getAudioElements() {
  return { audio1, audio2, activeIdx };
}

export function setAudioPlaybackRate(rate: number) {
  audio1.playbackRate = rate;
  audio2.playbackRate = rate;
}

/**
 * Función global de seek — úsala en cualquier componente sin instanciar el hook.
 */
export function seekAudio(seconds: number) {
  const audio = getActiveAudio();
  audio.currentTime = seconds;
  usePlayerStore.getState().setProgress(seconds);
}

export function useAudioPlayer() {
  const lastLoggedTrackId = useRef<string | null>(null);
  const crossfadeTriggered = useRef(false);
  const fadeIntervalRef = useRef<any>(null);
  const fadeOutIntervalRef = useRef<any>(null);

  const {
    currentTrack,
    isPlaying,
    volume,
    isMuted,
    setProgress,
    setDuration,
    setLoading,
    setError,
    setIsPlaying,
    nextTrack,
    progress,
    sleepTimerMinutes,
    sleepTimerEndTime,
    clearSleepTimer,
    repeatMode,
    eqBands,
  } = usePlayerStore();

  // Apply EQ whenever eqBands change
  useEffect(() => {
    try {
      applyEqBands(audio1, eqBands);
      applyEqBands(audio2, eqBands);
    } catch {
      // Web Audio API may not be initialized yet — will be applied on first play
    }
  }, [eqBands]);

  const handleEnded = useCallback((e: Event) => {
    if (e.target !== getActiveAudio()) return;

    if (sleepTimerMinutes === -1) {
      setIsPlaying(false);
      clearSleepTimer();
      return;
    }

    if (repeatMode === 'one') {
      const audio = getActiveAudio();
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }

    if (!crossfadeTriggered.current) {
      nextTrack();
    }
  }, [sleepTimerMinutes, clearSleepTimer, setIsPlaying, repeatMode, nextTrack]);

  // ── Media Session: actualizar metadatos cuando cambia el track o el estado ──
  useEffect(() => {
    updateMediaSession(currentTrack ?? null, {
      onPlay:  () => { usePlayerStore.getState().setIsPlaying(true);  },
      onPause: () => { usePlayerStore.getState().setIsPlaying(false); },
      onPrev:  () => { usePlayerStore.getState().prevTrack();          },
      onNext:  () => { usePlayerStore.getState().nextTrack();          },
    });
  }, [currentTrack]);

  useEffect(() => {
    setMediaSessionState(isPlaying ? 'playing' : 'paused');
  }, [isPlaying]);

  useEffect(() => {
    const onTimeUpdate = (e: Event) => {
      if (e.target !== getActiveAudio()) return;
      const audio = e.target as HTMLAudioElement;
      setProgress(audio.currentTime);
      // Actualizar barra de progreso del lock screen cada ~2 s (no cada frame)
      if (Math.round(audio.currentTime) % 2 === 0) {
        updateMediaSessionPosition(audio);
      }

      if (audio.duration && audio.currentTime > 0) {
        let shouldCrossfade = false;

        const state = usePlayerStore.getState();
        const currentT = state.currentTrack;
        const queue = state.queue;
        const queueIndex = state.queueIndex;
        let nextT = null;
        if (queue.length > 0) {
          if (queueIndex < queue.length - 1) nextT = queue[queueIndex + 1];
          else if (state.repeatMode === 'all') nextT = queue[0];
        }

        if (currentT && nextT) {
          const rule = state.transitions[`${currentT.id}-${nextT.id}`];
          if (rule && audio.currentTime >= rule.fromTime) {
            shouldCrossfade = true;
          }
        }

        const remaining = audio.duration - audio.currentTime;
        if (!shouldCrossfade && remaining <= CROSSFADE_DURATION / 1000) {
          shouldCrossfade = true;
        }

        if (shouldCrossfade && !crossfadeTriggered.current) {
          if (repeatMode !== 'one') {
            crossfadeTriggered.current = true;
            nextTrack();
          }
        }
      }
    };
    const onDurationChange = (e: Event) => {
      if (e.target !== getActiveAudio()) return;
      setDuration((e.target as HTMLAudioElement).duration || 0);
    };
    const onWaiting = (e: Event) => {
      if (e.target === getActiveAudio()) setLoading(true);
    };
    const onCanPlay = (e: Event) => {
      if (e.target === getActiveAudio()) setLoading(false);
    };
    const onError = (e: Event) => {
      if (e.target === getActiveAudio()) {
        setError('Error al cargar el audio. El archivo puede estar procesándose.');
        setIsPlaying(false);
      }
    };

    [audio1, audio2].forEach((a) => {
      a.addEventListener('timeupdate', onTimeUpdate);
      a.addEventListener('durationchange', onDurationChange);
      a.addEventListener('ended', handleEnded);
      a.addEventListener('waiting', onWaiting);
      a.addEventListener('canplay', onCanPlay);
      a.addEventListener('error', onError);
    });

    return () => {
      [audio1, audio2].forEach((a) => {
        a.removeEventListener('timeupdate', onTimeUpdate);
        a.removeEventListener('durationchange', onDurationChange);
        a.removeEventListener('ended', handleEnded);
        a.removeEventListener('waiting', onWaiting);
        a.removeEventListener('canplay', onCanPlay);
        a.removeEventListener('error', onError);
      });
    };
  }, [handleEnded, setDuration, setError, setIsPlaying, setLoading, setProgress, nextTrack, repeatMode]);

  useEffect(() => {
    if (!currentTrack) return;
    if (globalLastLoadedTrackId === currentTrack.id) return;

    const prevTrackId = globalLastLoadedTrackId;
    globalLastLoadedTrackId = currentTrack.id;
    crossfadeTriggered.current = false;

    // ── Embed Mode Check: para videos de YouTube directos de larga duración ────
    // Realizamos un HEAD/fetch breve al endpoint de stream. Si devuelve JSON con
    // embedMode=true, abrimos el VideoPanel con el iframe de YouTube en lugar de
    // cargar audio. Esto permite escuchar con pantalla apagada vía YouTube nativo.
    const checkEmbedMode = async (): Promise<boolean> => {
      return false;
    };

    const prevAudio = getActiveAudio();
    activeIdx = 1 - activeIdx;
    const nextAudio = getActiveAudio();

    const rule = prevTrackId
      ? usePlayerStore.getState().transitions[`${prevTrackId}-${currentTrack.id}`]
      : undefined;

    const autoDownload = localStorage.getItem('autoDownloadYt') !== 'false';
    const url = `${getStreamUrl(currentTrack.id)}?autoDownload=${autoDownload}`;
    setLoading(true);

    // Primero comprobar si debe usar embed mode; si no, cargar audio normal
    checkEmbedMode().then(async (isEmbed) => {
      if (isEmbed) {
        // El VideoPanel toma el control. Pausar y vaciar src de los audios HTML5 nativos para no duplicar sonido.
        audio1.pause();
        audio2.pause();
        audio1.src = '';
        audio2.src = '';
        if (currentBlobUrl) {
          URL.revokeObjectURL(currentBlobUrl);
          currentBlobUrl = null;
        }
        return;
      }

      // Desactivar el modo embed en el store para audios normales
      usePlayerStore.getState().setEmbedMode(false, null);

      // Liberar Object URL anterior si existe
      if (currentBlobUrl) {
        URL.revokeObjectURL(currentBlobUrl);
        currentBlobUrl = null;
      }

      try {
        // Comprobar si está guardado en caché local (IndexedDB)
        const offlineTrack = await getOfflineTrack(currentTrack.id);
        if (offlineTrack && offlineTrack.blob) {
          console.log(`[Player] 💾 Reproduciendo desde caché local (IndexedDB) para: ${currentTrack.title}`);
          currentBlobUrl = URL.createObjectURL(offlineTrack.blob);
          nextAudio.src = currentBlobUrl;
        } else {
          nextAudio.src = url;
        }
      } catch (err) {
        console.warn('[Player] Error al recuperar de IndexedDB, usando red:', err);
        nextAudio.src = url;
      }

      nextAudio.load();

      const targetVolume = isMuted ? 0 : volume;
      const currentEqBands = usePlayerStore.getState().eqBands;

      const playWhenReady = () => {
        const { isPlaying: shouldPlay } = usePlayerStore.getState();
        if (shouldPlay) {
          if (rule) {
            nextAudio.currentTime = rule.toTime;
          }

          try {
            if (audioCtx?.state === 'suspended') audioCtx.resume();
            applyEqBands(nextAudio, currentEqBands);
          } catch { /* ignore */ }

          const fadeInStartVol = rule?.fadeInPercent
            ? targetVolume * (1 - rule.fadeInPercent / 100)
            : prevAudio.paused ? targetVolume : 0;

          nextAudio.volume = fadeInStartVol;
          nextAudio.play().catch(() => setIsPlaying(false));

          if (!prevAudio.paused && prevAudio.src) {
            if (fadeIntervalRef.current) clearInterval(fadeIntervalRef.current);

            const steps = 20;
            const durationMs = rule ? rule.duration * 1000 : CROSSFADE_DURATION;
            const stepTime = durationMs / steps;
            let step = 0;

            fadeIntervalRef.current = setInterval(() => {
              step++;
              const rawRatio = step / steps;
              const ratioIn = getFadeRatio(rawRatio, rule?.curve);

              const fadeOutFloor = rule?.fadeOutPercent
                ? targetVolume * (1 - rule.fadeOutPercent / 100)
                : 0;

              if (!prevAudio.paused) {
                prevAudio.volume = Math.max(fadeOutFloor, targetVolume * (1 - ratioIn));
              }
              if (!nextAudio.paused) {
                nextAudio.volume = Math.min(targetVolume, fadeInStartVol + (targetVolume - fadeInStartVol) * ratioIn);
              }

              if (step >= steps) {
                clearInterval(fadeIntervalRef.current!);
                fadeIntervalRef.current = null;

                if (rule?.fadeOutDuration && rule.fadeOutDuration > 0 && !prevAudio.paused) {
                  const foSteps = 20;
                  const foStepTime = (rule.fadeOutDuration * 1000) / foSteps;
                  let foStep = 0;
                  const startVol = prevAudio.volume;
                  if (fadeOutIntervalRef.current) clearInterval(fadeOutIntervalRef.current);
                  fadeOutIntervalRef.current = setInterval(() => {
                    foStep++;
                    prevAudio.volume = Math.max(0, startVol * (1 - foStep / foSteps));
                    if (foStep >= foSteps) {
                      clearInterval(fadeOutIntervalRef.current!);
                      fadeOutIntervalRef.current = null;
                      prevAudio.pause();
                      prevAudio.src = '';
                    }
                  }, foStepTime);
                } else {
                  prevAudio.pause();
                  prevAudio.src = '';
                }
              }
            }, stepTime);
          } else {
            nextAudio.volume = targetVolume;

            if (rule?.fadeInDuration && rule.fadeInDuration > 0) {
              const fiSteps = 20;
              const fiStepTime = (rule.fadeInDuration * 1000) / fiSteps;
              let fiStep = 0;
              const startVol = nextAudio.volume;
              const endVol = targetVolume;
              nextAudio.volume = startVol;
              const fiInterval = setInterval(() => {
                fiStep++;
                nextAudio.volume = Math.min(endVol, startVol + (endVol - startVol) * (fiStep / fiSteps));
                if (fiStep >= fiSteps) clearInterval(fiInterval);
              }, fiStepTime);
            }
          }
        }
        nextAudio.removeEventListener('canplay', playWhenReady);
      };

      nextAudio.addEventListener('canplay', playWhenReady);
    });

    return () => {
      // Cleanup: nada que hacer aquí ya que el listener se auto-remueve
    };
  }, [currentTrack, setLoading, setIsPlaying, volume, isMuted]);

  useEffect(() => {
    const audio = getActiveAudio();
    if (!currentTrack) return;

    if (isPlaying) {
      if (audio.src && audio.readyState >= 2) {
        // Resume AudioContext if suspended (browser autoplay policy)
        if (audioCtx?.state === 'suspended') audioCtx.resume();
        audio.play().catch(() => setIsPlaying(false));
      }
    } else {
      audio.pause();
      getInactiveAudio().pause();
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }
    }
  }, [isPlaying, currentTrack, setIsPlaying]);

  // Volume: apply immediately, respecting crossfade
  useEffect(() => {
    const audio = getActiveAudio();
    audio.volume = isMuted ? 0 : volume;
    const inactive = getInactiveAudio();
    if (isMuted) inactive.volume = 0;
  }, [volume, isMuted]);

  useEffect(() => {
    lastLoggedTrackId.current = null;
  }, [currentTrack]);

  useEffect(() => {
    if (!currentTrack || lastLoggedTrackId.current === currentTrack.id) return;
    if (progress >= 10) {
      lastLoggedTrackId.current = currentTrack.id;
      const myId = localStorage.getItem('koko_device_id') ?? '';
      logTrackPlay(
        currentTrack.id,
        { title: currentTrack.title, artist: currentTrack.artist, cover: currentTrack.cover },
        myId,
        myId   // deviceId = same as userId (koko_device_id is device-scoped)
      ).catch((err) => console.error('[PlayLog] Error:', err));

      // ─── Auto-cache logic ───
      const trackId = currentTrack.id;
      const countKey = `koko_play_count_${trackId}`;
      const currentCount = parseInt(localStorage.getItem(countKey) ?? '0') + 1;
      localStorage.setItem(countKey, String(currentCount));

      // Trigger storage event to notify components that play counts updated
      window.dispatchEvent(new Event('storage'));

      const savedThreshold = localStorage.getItem('koko_plays_needed_for_offline');
      const threshold = savedThreshold ? parseInt(savedThreshold) : 3;

      if (currentCount >= threshold) {
        isTrackOffline(trackId).then((isOffline) => {
          if (!isOffline) {
            console.log(`[AutoCache] Caching track ${trackId} because play count ${currentCount} met threshold ${threshold}`);
            saveTrackOffline(trackId, {
              title: currentTrack.title,
              artist: currentTrack.artist,
              cover: currentTrack.cover || '',
              duration: currentTrack.duration
            }).catch((err) => console.error('[AutoCache] Error caching track:', err));
          }
        });
      }
    }
  }, [progress, currentTrack]);

  useEffect(() => {
    if (!sleepTimerEndTime) return;
    const interval = setInterval(() => {
      if (Date.now() >= sleepTimerEndTime) {
        setIsPlaying(false);
        clearSleepTimer();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [sleepTimerEndTime, setIsPlaying, clearSleepTimer]);
}
