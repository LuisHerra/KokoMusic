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
import { usePlayerStore, type CrossfadeCurve, registerUnlockHandler } from '../store/playerStore';
import { getStreamUrl, logTrackPlay, triggerRecommendationEvent, sendRecommendationFeedback } from '../lib/api';
import { getOfflineTrack, isTrackOffline, saveTrackOffline } from '../lib/offlineAudio';
import { getApiUrl } from '../lib/backendResolver';
import { logToServer } from '../lib/logger';
import { usePrefetchAudio } from './usePrefetchAudio';
import { reportAudioStall, reportAudioHealthy } from '../lib/adaptiveBitrate';

let currentBlobUrl: string | null = null;

const isMobileDevice = () => {
  if (typeof window === 'undefined') return false;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
};

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

function getOrCreateChain(audio: HTMLAudioElement): AudioChain | null {
  if (isMobileDevice()) return null; // Bypassed on mobile for background play compatibility
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
 * Si el EQ está plano (todo en 0, el estado por defecto) y todavía no existe
 * una cadena Web Audio para este elemento, no la crea — conectar
 * `createMediaElementSource` es una operación irreversible que exige
 * `crossOrigin` en el audio (ver `armCrossOriginForEq`), y la mayoría de
 * usuarios nunca toca el ecualizador. Sin este atajo, escritorio pagaría
 * siempre el coste de CORS aunque el EQ nunca se use.
 */
export function applyEqBands(audio: HTMLAudioElement, bands: number[]) {
  if (isMobileDevice()) return; // Bypassed on mobile for background play compatibility
  const isFlat = bands.every(b => b === 0);
  if (isFlat && !chains.has(audio)) return;
  const chain = getOrCreateChain(audio);
  if (!chain) return;
  bands.forEach((gainDb, i) => {
    if (chain.filters[i]) chain.filters[i].gain.value = gainDb;
  });
}

// ─── Audio elements ───────────────────────────────────────────────────────────
const audio1 = new Audio();
const audio2 = new Audio();
audio1.preload = 'metadata';

// crossOrigin solo se activa cuando de verdad hace falta (ecualizador en uso),
// no por defecto — ver armCrossOriginForEq() más abajo. Sin crossOrigin,
// hasta escritorio puede usar el redirect directo a googlevideo con la IP
// real del usuario en vez de pasar por nuestro proxy (más resiliente al 403
// de Google, que penaliza más las IPs de datacenter — ver stream.ts).
const savedEqBands: number[] = (() => {
  try { return JSON.parse(localStorage.getItem('koko_eq_bands') || '[0,0,0,0,0]'); }
  catch { return [0, 0, 0, 0, 0]; }
})();
let crossOriginArmed = !isMobileDevice() && savedEqBands.some((b: number) => b !== 0);
if (crossOriginArmed) {
  audio1.crossOrigin = 'anonymous';
  audio2.crossOrigin = 'anonymous';
}

export function isCrossOriginArmed(): boolean {
  return crossOriginArmed;
}

/**
 * Activa `crossOrigin` para el ecualizador la primera vez que el usuario
 * mueve una banda fuera de 0 en esta sesión. Como cambiar `crossOrigin` en un
 * elemento que ya tiene un recurso cargado/cargando no lo vuelve CORS-limpio
 * retroactivamente, hace falta recargar la pista activa a través de nuestro
 * proxy (forceStream=true) para que el EQ no deje el audio en silencio.
 */
export function armCrossOriginForEq(): void {
  if (crossOriginArmed || isMobileDevice()) return;
  crossOriginArmed = true;
  audio1.crossOrigin = 'anonymous';
  audio2.crossOrigin = 'anonymous';

  const store = usePlayerStore.getState();
  if (!store.currentTrack) return;

  const audio = getActiveAudio();
  const wasPlaying = store.isPlaying;
  const savedTime = audio.currentTime;
  const url = getStreamUrl(store.currentTrack.id, { forceStream: true });
  logToServer('INFO', '[useAudioPlayer] armCrossOriginForEq: recargando pista activa con forceStream para habilitar el EQ');

  const onReady = () => {
    audio.removeEventListener('canplay', onReady);
    if (savedTime > 0) audio.currentTime = savedTime;
    if (wasPlaying) audio.play().catch(() => {});
  };
  audio.addEventListener('canplay', onReady);
  audio.src = url;
  audio.load();
}
// Necesario para que iOS mantenga la sesión de audio en background
// (sin esto Safari puede pausar el audio al bloquear la pantalla)
audio1.setAttribute('playsinline', '');
audio2.setAttribute('playsinline', '');

let activeIdx = 0;
let globalLastLoadedTrackId: string | null = null;
const CROSSFADE_DURATION = 3000; // ms
const DJ_PRELOAD_LEAD_SECONDS = 12; // cuánto antes del punto de transición se calienta el buffer del siguiente track


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

let audioElementsUnlocked = false;

/**
 * Unlocks the Web Audio API AudioContext and HTML5 Audio on mobile browsers.
 * Uses a dedicated dummy Audio element to satisfy user-gesture autoplay policies
 * without polluting or mutating the main playback elements (audio1, audio2).
 */
export function unlockAudio() {
  if (audioElementsUnlocked) return;
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch((err) => {
        logToServer('WARN', '[useAudioPlayer] AudioContext resume failed', err);
      });
    }
  } catch (e) {
    logToServer('ERROR', '[useAudioPlayer] Error resuming AudioContext', e);
  }

  try {
    const unlocker = new Audio();
    unlocker.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
    unlocker.play()
      .then(() => {
        unlocker.pause();
        unlocker.removeAttribute('src');
        logToServer('INFO', '[useAudioPlayer] Mobile audio unlocked successfully via dedicated dummy');
      })
      .catch((err) => {
        logToServer('WARN', '[useAudioPlayer] Mobile audio unlock attempt failed', err);
      });
  } catch (e) {
    logToServer('ERROR', '[useAudioPlayer] Error in unlockAudio execution', e);
  }

  audioElementsUnlocked = true;
}

// Register the unlock handler with the store
registerUnlockHandler(unlockAudio);

/**
 * Función global de seek — úsala en cualquier componente sin instanciar el hook.
 */
export function seekAudio(seconds: number) {
  // En isEmbedMode, useVideoSync detecta el salto de progreso (>1.5s) y envía
  // el comando seekTo al iframe de YouTube automáticamente.
  if (!usePlayerStore.getState().isEmbedMode) {
    const audio = getActiveAudio();
    audio.currentTime = seconds;
  }
  usePlayerStore.getState().setProgress(seconds);
}

/**
 * Records a track as "early-skipped" (< 10s played) in localStorage.
 * The recommendation engine reads this list and applies a score penalty
 * to these tracks so they surface less often in future sessions.
 */
export function recordEarlySkip(trackId: string, artist: string, title: string) {
  try {
    const raw = localStorage.getItem('koko_early_skips');
    const skips: { id: string; artist: string; title: string; skippedAt: number }[] = raw ? JSON.parse(raw) : [];
    // Avoid duplicate entries for the same track
    const filtered = skips.filter(s => s.id !== trackId);
    filtered.unshift({ id: trackId, artist, title, skippedAt: Date.now() });
    localStorage.setItem('koko_early_skips', JSON.stringify(filtered.slice(0, 50)));
  } catch {}
}

export function useAudioPlayer() {
  const lastLoggedTrackId = useRef<string | null>(null);
  const crossfadeTriggered = useRef(false);
  const fadeIntervalRef = useRef<any>(null);
  const fadeOutIntervalRef = useRef<any>(null);
  // Retry counter keyed by trackId — avoids DOM property pollution
  const retryCountRef = useRef<Record<string, number>>({});
  // ── Race-condition guard: each new track load gets a unique generation number.
  // playWhenReady captures its generation at creation time; if a newer load has
  // already started by the time canplay fires, the listener self-destructs.
  const loadGenerationRef = useRef(0);
  // ── Transition guard: true while we are loading a new track.
  // Prevents the native 'pause' event from prevAudio (triggered by prevAudio.pause())
  // from writing isPlaying=false into the store and blocking playWhenReady.
  const isLoadingNewTrackRef = useRef(false);

  // Predictive prefetch: start downloading next 2 queued tracks in background
  usePrefetchAudio();

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
      if (eqBands.some((b) => b !== 0)) armCrossOriginForEq();
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
      // Track ended naturally — not an early skip, no penalty needed.
      // Señal real de "escuchado completo": dispara el refresco del perfil de
      // gustos/candidatos para que esta canción quede excluida de próximas
      // recomendaciones durante un tiempo (sin esto el Koko-Mix la repite).
      const finishedTrack = usePlayerStore.getState().currentTrack;
      if (finishedTrack) {
        triggerRecommendationEvent('track_completed', finishedTrack.id);
        sendRecommendationFeedback(finishedTrack.id, 'track_completed');
      }
      nextTrack();
    }
  }, [sleepTimerMinutes, clearSleepTimer, setIsPlaying, repeatMode, nextTrack]);

  // ── Media Session: actualizar metadatos cuando cambia el track o el estado ──
  useEffect(() => {
    updateMediaSession(currentTrack ?? null, {
      // Ignorar un 'play' de Media Session (control de bloqueo de pantalla /
      // auriculares / barra de medios del SO) hasta que el usuario haya
      // iniciado playback explícitamente al menos una vez en esta sesión.
      // Sin esto, al recargar la página con una canción restaurada de la
      // sesión anterior, algunos sistemas reafirman el estado "reproduciendo"
      // del Media Session apenas se registran los handlers, arrancando el
      // audio solo sin que el usuario pulse play — justo el bug reportado.
      onPlay:  () => { if (audioElementsUnlocked) usePlayerStore.getState().setIsPlaying(true); },
      onPause: () => { usePlayerStore.getState().setIsPlaying(false); },
      onPrev:  () => { usePlayerStore.getState().prevTrack();          },
      onNext:  () => { usePlayerStore.getState().nextTrack();          },
    });
  }, [currentTrack]);

  useEffect(() => {
    setMediaSessionState(isPlaying ? 'playing' : 'paused');
  }, [isPlaying]);

  const cdnPreloadTriggered = useRef<string | null>(null);
  const djBufferPreloaded = useRef<string | null>(null);

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

        // 30s Predictive CDN Upload Pass
        const remainingSec = audio.duration - audio.currentTime;
        if (remainingSec > 0 && remainingSec <= 30 && nextT) {
          if (cdnPreloadTriggered.current !== nextT.id) {
            cdnPreloadTriggered.current = nextT.id;
            logToServer('INFO', `[useAudioPlayer] 🚀 30s before end — triggering predictive CDN pre-upload for next track: ${nextT.title} (${nextT.id})`);
            getApiUrl().then(apiBase => {
              fetch(`${apiBase}/stream/prefetch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [nextT.id] })
              }).catch(() => {});
            });
          }
        }

        if (currentT && nextT) {
          const rule = state.transitions[`${currentT.id}-${nextT.id}`];

          // Precarga real del buffer de audio para transiciones DJ: sin esto, el
          // elemento <audio> del track entrante no empieza a cargar bytes hasta
          // el instante exacto del crossfade (nextTrack() -> loadTrack effect),
          // a diferencia del preview (startCrossfadePreview) que arranca ambos
          // audios de golpe. En redes lentas eso se nota como un corte/carga
          // justo en medio de la mezcla. Calentamos el elemento inactivo unos
          // segundos antes del punto de transición para que ya tenga bytes en
          // buffer cuando de verdad haga falta reproducirlo.
          const pairKeyStr = `${currentT.id}-${nextT.id}`;
          if (rule) {
            const timeUntilTransition = rule.fromTime - audio.currentTime;
            if (
              timeUntilTransition > 0 &&
              timeUntilTransition <= DJ_PRELOAD_LEAD_SECONDS &&
              djBufferPreloaded.current !== pairKeyStr
            ) {
              djBufferPreloaded.current = pairKeyStr;
              const inactiveAudio = getInactiveAudio();
              if (inactiveAudio.paused) {
                logToServer('INFO', `[useAudioPlayer] DJ preload: calentando buffer del siguiente track (${nextT.id}) ${timeUntilTransition.toFixed(1)}s antes de la transición`);
                inactiveAudio.src = getStreamUrl(nextT.id, { forceStream: isCrossOriginArmed() });
                inactiveAudio.load();
              }
            }
          }

          if (rule && audio.currentTime >= rule.fromTime) {
            shouldCrossfade = true;
          }
        }

        if (!isMobileDevice()) {
          const remaining = audio.duration - audio.currentTime;
          if (!shouldCrossfade && remaining <= CROSSFADE_DURATION / 1000) {
            shouldCrossfade = true;
          }
        }

        if (shouldCrossfade && !crossfadeTriggered.current) {
          if (repeatMode !== 'one') {
            crossfadeTriggered.current = true;
            // Log as early skip if the track was skipped before 10 seconds
            const state = usePlayerStore.getState();
            if (state.currentTrack) {
              if (audio.currentTime < 10) {
                recordEarlySkip(state.currentTrack.id, state.currentTrack.artist, state.currentTrack.title);
                sendRecommendationFeedback(state.currentTrack.id, 'skip');
              } else {
                // Crossfade cerca del final (o transición DJ ya avanzada) — se
                // trata como escucha completa a efectos de refrescar recomendaciones.
                triggerRecommendationEvent('track_completed', state.currentTrack.id);
                sendRecommendationFeedback(state.currentTrack.id, 'track_completed');
              }
            }
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
      const audioEl = e.target as HTMLAudioElement;
      logToServer('INFO', `[useAudioPlayer] audio onWaiting. src: ${audioEl.src ? audioEl.src.substring(0, 100) : 'none'}, isActive: ${audioEl === getActiveAudio()}`);
      if (audioEl === getActiveAudio()) {
        setLoading(true);
        reportAudioStall();
      }
    };
    const onCanPlay = (e: Event) => {
      const audioEl = e.target as HTMLAudioElement;
      logToServer('INFO', `[useAudioPlayer] audio onCanPlay. src: ${audioEl.src ? audioEl.src.substring(0, 100) : 'none'}, isActive: ${audioEl === getActiveAudio()}`);
      if (audioEl === getActiveAudio()) setLoading(false);
    };
    const onPlay = (e: Event) => {
      const audioEl = e.target as HTMLAudioElement;
      if (audioEl === getActiveAudio()) {
        logToServer('INFO', `[useAudioPlayer] native onPlay. src: ${audioEl.src ? audioEl.src.substring(0, 100) : 'none'}`);
        setIsPlaying(true);
      }
    };
    const onPlaying = (e: Event) => {
      const audioEl = e.target as HTMLAudioElement;
      if (audioEl === getActiveAudio()) {
        logToServer('INFO', `[useAudioPlayer] native onPlaying. src: ${audioEl.src ? audioEl.src.substring(0, 100) : 'none'}`);
        setIsPlaying(true);
        setLoading(false);
        reportAudioHealthy();

        // Safety volume & AudioContext unfreeze
        const targetVol = isMuted ? 0 : volume;
        if (!fadeIntervalRef.current && audioEl.volume === 0 && targetVol > 0) {
          logToServer('WARN', `[useAudioPlayer] audio volume was 0 during onPlaying! Restoring to ${targetVol}`);
          audioEl.volume = targetVol;
        }

        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
      }
    };
    const onPause = (e: Event) => {
      const audioEl = e.target as HTMLAudioElement;
      if (audioEl === getActiveAudio()) {
        logToServer('INFO', `[useAudioPlayer] native onPause. src: ${audioEl.src ? audioEl.src.substring(0, 100) : 'none'}, isLoadingNewTrack: ${isLoadingNewTrackRef.current}`);
        // FIX: Ignore the native pause event while we are transitioning to a new track.
        // When prevAudio.pause() is called during a track change, the 'pause' event fires
        // on what was the active audio at that moment. This must NOT set isPlaying=false
        // because the new track is about to start playing.
        if (isLoadingNewTrackRef.current) return;
        if (!usePlayerStore.getState().isEmbedMode) {
          setIsPlaying(false);
        }
      }
    };
    const onError = async (e: Event) => {
      const audioEl = e.target as HTMLAudioElement;
      logToServer('ERROR', `[useAudioPlayer] audio onError. src: ${audioEl.src ? audioEl.src.substring(0, 100) : 'none'}, isActive: ${audioEl === getActiveAudio()}`, {
        code: audioEl.error?.code,
        message: audioEl.error?.message
      });
      if (e.target === getActiveAudio()) {
        const currentT = usePlayerStore.getState().currentTrack;
        if (!currentT) return;

        // Purge backend stream cache on Format error (code 4)
        if (audioEl.error?.code === 4) {
          try {
            const API_BASE = await getApiUrl();
            await fetch(`${API_BASE}/stream/${currentT.id}/purge-cache`, { method: 'POST' });
            logToServer('INFO', `[useAudioPlayer] Purgado caché corrupto para track: ${currentT.id}`);
          } catch {}
        }

        const isEmbedModeStore = usePlayerStore.getState().isEmbedMode;
        if (isEmbedModeStore) return;

        // PRIORIDAD 1: reintentar el stream nativo antes de rendirnos al embed de
        // YouTube. La mayoría de "Format error" son fallos puntuales de un edge de
        // googlevideo (403/IP-mismatch) — una resolución fresca (con purge-cache ya
        // ejecutado arriba) suele bastar. Saltar directo a embed en el primer fallo
        // convertía cualquier glitch transitorio en una interrupción total de la
        // transición entre canciones (audio nativo cortado + iframe de YouTube
        // abriéndose de golpe), así que el embed queda como último recurso tras
        // agotar los 3 reintentos nativos.
        const currentTForRetry = currentT;
        const activeAudio = getActiveAudio();
        const retryCount = retryCountRef.current[currentTForRetry.id] || 0;
        if (retryCount < 3) {
          retryCountRef.current[currentTForRetry.id] = retryCount + 1;
          logToServer('WARN', `[useAudioPlayer] onError: Error cargando stream para "${currentTForRetry.title}". Reintentando reproducción del mismo track (${retryCount + 1}/3)...`);
          setError(`Reintentando conexión para "${currentTForRetry.title}"...`);
          // Exponential backoff: 1.5s, 3s, 6s — gives purge-cache time to complete
          const delayMs = 1500 * Math.pow(2, retryCount);
          setTimeout(() => {
            logToServer('INFO', `[useAudioPlayer] Reintentando carga de stream (${retryCount + 1}/3) para track ${currentTForRetry.id}`);
            const baseStreamUrl = getStreamUrl(currentTForRetry.id, { forceStream: isCrossOriginArmed() });
            const sep = baseStreamUrl.includes('?') ? '&' : '?';
            const streamUrl = `${baseStreamUrl}${sep}retry=${retryCount + 1}`;
            activeAudio.src = streamUrl;
            activeAudio.volume = isMuted ? 0 : volume;
            if (audioCtx && audioCtx.state === 'suspended') {
              audioCtx.resume().catch(() => {});
            }
            activeAudio.load();
            activeAudio.play().catch(() => {});
          }, delayMs);
          return;
        }

        // PRIORIDAD 2: reintentos nativos agotados — probar el fallback de YouTube Embed.
        delete retryCountRef.current[currentT.id];
        const isLegacyYoutubeId = /^[a-zA-Z0-9_-]{11}$/.test(currentT.id) && isNaN(Number(currentT.id));
        logToServer('INFO', `[useAudioPlayer] onError: Reintentos nativos agotados. Intentando fallback a YouTube Embed Mode para track: ${currentT.id}`);
        let youtubeId: string | null = usePlayerStore.getState().currentYoutubeId;

        if (isLegacyYoutubeId) {
          youtubeId = currentT.id;
        } else if (!youtubeId) {
          // Intentar resolver desde el backend si no estaba en el store
          try {
            const API_BASE = await getApiUrl();
            const res = await fetch(`${API_BASE}/stream/${currentT.id}/status`);
            if (res.ok) {
              const data = await res.json();
              if (data.youtubeId) {
                youtubeId = data.youtubeId;
                usePlayerStore.getState().setCurrentYoutubeId(youtubeId);
              }
            }
          } catch (fetchErr) {
            console.error('[useAudioPlayer] Failed to fetch resolved youtubeId on error fallback:', fetchErr);
          }
        }

        if (youtubeId) {
          logToServer('INFO', `[useAudioPlayer] onError: Cambiando a YouTube Embed Mode con ID ${youtubeId}`);
          usePlayerStore.getState().setEmbedMode(true, youtubeId);
          setLoading(false);
          // Detener audios nativos y limpiar su src para evitar bucles de error
          audio1.pause();
          audio2.pause();
          audio1.removeAttribute('src');
          audio2.removeAttribute('src');
          if (currentBlobUrl) {
            URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = null;
          }
          // FIX-A: Deactivate the transition guard — embed mode takes over from here.
          isLoadingNewTrackRef.current = false;
          setIsPlaying(true);
          return;
        }

        // PRIORIDAD 3: ni el nativo ni el embed funcionan — nos rendimos.
        // FIX-A: Deactivate the transition guard — all retries exhausted, player is now idle.
        // The user must press play manually to retry; from this point on, native pause
        // events are legitimate and must update the store.
        isLoadingNewTrackRef.current = false;
        setIsPlaying(false);
        setLoading(false);
        setError(`No se pudo conectar al audio de "${currentT.title}". Pulsa reproducir para reintentar.`);
      }
    };

    [audio1, audio2].forEach((a) => {
      a.addEventListener('timeupdate', onTimeUpdate);
      a.addEventListener('durationchange', onDurationChange);
      a.addEventListener('ended', handleEnded);
      a.addEventListener('waiting', onWaiting);
      a.addEventListener('canplay', onCanPlay);
      a.addEventListener('error', onError);
      a.addEventListener('play', onPlay);
      a.addEventListener('playing', onPlaying);
      a.addEventListener('pause', onPause);
    });

    return () => {
      [audio1, audio2].forEach((a) => {
        a.removeEventListener('timeupdate', onTimeUpdate);
        a.removeEventListener('durationchange', onDurationChange);
        a.removeEventListener('ended', handleEnded);
        a.removeEventListener('waiting', onWaiting);
        a.removeEventListener('canplay', onCanPlay);
        a.removeEventListener('error', onError);
        a.removeEventListener('play', onPlay);
        a.removeEventListener('playing', onPlaying);
        a.removeEventListener('pause', onPause);
      });
    };
  }, [handleEnded, setDuration, setError, setIsPlaying, setLoading, setProgress, nextTrack, repeatMode]);

  useEffect(() => {
    if (!currentTrack || !currentTrack.id) return;
    if (globalLastLoadedTrackId === currentTrack.id) return;

    // Increment generation — any in-flight canplay listener from a previous load
    // will see the mismatch and self-destruct without starting audio playback.
    loadGenerationRef.current += 1;

    // FIX: Activate loading guard BEFORE pausing prevAudio.
    // This prevents the native 'pause' event on prevAudio from writing
    // isPlaying=false into the store, which would block playWhenReady.
    isLoadingNewTrackRef.current = true;

    const prevTrackId = globalLastLoadedTrackId;
    globalLastLoadedTrackId = currentTrack.id;
    crossfadeTriggered.current = false;

    // FIX: currentYoutubeId nunca se limpiaba entre tracks — solo se
    // sobrescribía si checkEmbedMode()/el status fetch de ESTA pista
    // encontraban un youtubeId válido. Si esa comprobación fallaba o no
    // devolvía nada (justo lo que pasa con las pistas que más necesitan el
    // fallback), el valor quedaba con el de la pista ANTERIOR, y al caer a
    // YouTube Embed se abría el vídeo de la canción equivocada.
    usePlayerStore.getState().setCurrentYoutubeId(null);

    // ── Embed Mode Check: para videos de YouTube directos de larga duración ────
    // Realizamos un HEAD/fetch breve al endpoint de stream. Si devuelve JSON con
    // embedMode=true, abrimos el VideoPanel con el iframe de YouTube en lugar de
    // cargar audio. Esto permite escuchar con pantalla apagada vía YouTube nativo.
    const checkEmbedMode = async (): Promise<boolean> => {
      const isLegacyYoutubeId = /^[a-zA-Z0-9_-]{11}$/.test(currentTrack.id) && isNaN(Number(currentTrack.id));
      if (isLegacyYoutubeId) {
        usePlayerStore.getState().setCurrentYoutubeId(currentTrack.id);
      }

      try {
        const API_BASE = await getApiUrl();
        const res = await fetch(`${API_BASE}/stream/${currentTrack.id}/status`);
        if (res.ok) {
          const data = await res.json();
          if (data.youtubeId) {
            usePlayerStore.getState().setCurrentYoutubeId(data.youtubeId);
            const useYtPlayer = localStorage.getItem('koko_use_youtube_player') === 'true';
            if (useYtPlayer) {
              usePlayerStore.getState().setEmbedMode(true, data.youtubeId);
              return true;
            }
          }
        }
      } catch (e) {
         console.error('Failed to get youtubeId for status/embed check', e);
      }
      return false;
    };

    const prevAudio = getActiveAudio();
    activeIdx = 1 - activeIdx;
    const nextAudio = getActiveAudio();

    const rule = prevTrackId
      ? usePlayerStore.getState().transitions[`${prevTrackId}-${currentTrack.id}`]
      : undefined;

    // FIX: Always stop prevAudio immediately when changing track — even if
    // crossfade was triggered. The crossfade path (shouldCrossfade in onTimeUpdate)
    // can leave prevAudio running. We stop it here unconditionally unless there
    // is an active DJ rule that requires a simultaneous fade.
    // For DJ rules (rule != null), prevAudio will be faded out inside playWhenReady.
    if (!rule) {
      try {
        prevAudio.pause();
        prevAudio.currentTime = 0;
        prevAudio.removeAttribute('src');
      } catch (e) {
        /* ignore */
      }
    }

    const autoDownload = localStorage.getItem('autoDownloadYt') !== 'false';
    const baseStreamUrl = getStreamUrl(currentTrack.id, { forceStream: isCrossOriginArmed() });
    const sep = baseStreamUrl.includes('?') ? '&' : '?';
    const url = `${baseStreamUrl}${sep}autoDownload=${autoDownload}`;
    logToServer('INFO', `[useAudioPlayer] Loading new track. id: ${currentTrack.id}, title: ${currentTrack.title}, autoDownload: ${autoDownload}, URL: ${url}`);
    setLoading(true);

    // Pre-cargar en segundo plano el siguiente tema de la cola vía API prefetch (sin sockets crudos en móvil)
    const state = usePlayerStore.getState();
    if (state.queue && state.queue.length > state.queueIndex + 1) {
      const nextInQueue = state.queue[state.queueIndex + 1];
      if (nextInQueue && nextInQueue.id) {
        import('../lib/api').then(({ prefetchAudio }) => {
          prefetchAudio([nextInQueue.id]).catch(() => {});
        }).catch(() => {});
      }
    }

    // Primero comprobar si debe usar embed mode; si no, cargar audio normal
    checkEmbedMode().then(async (isEmbed) => {
      logToServer('INFO', `[useAudioPlayer] checkEmbedMode resolved. isEmbed: ${isEmbed}`);
      if (isEmbed) {
        // El VideoPanel toma el control. Pausar y vaciar src de los audios HTML5 nativos para no duplicar sonido.
        audio1.pause();
        audio2.pause();
        audio1.removeAttribute('src');
        audio2.removeAttribute('src');
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
          logToServer('INFO', `[useAudioPlayer] Found in IndexedDB cache.`);
          currentBlobUrl = URL.createObjectURL(offlineTrack.blob);
          nextAudio.src = currentBlobUrl;
        } else {
          logToServer('INFO', `[useAudioPlayer] Not in IndexedDB cache, using network: ${url}`);
          nextAudio.src = url;
        }
      } catch (err) {
        logToServer('WARN', `[useAudioPlayer] IndexedDB check failed. Fallback to network URL: ${url}`, err);
        nextAudio.src = url;
      }

      logToServer('INFO', `[useAudioPlayer] Calling nextAudio.load(). src is: ${nextAudio.src ? nextAudio.src.substring(0, 120) : 'none'}`);
      nextAudio.load();

      const targetVolume = isMuted ? 0 : volume;
      const currentEqBands = usePlayerStore.getState().eqBands;

      // Capture generation at the moment this load started.
      // If loadGenerationRef increments before canplay fires (i.e. user skipped),
      // this listener is stale and must self-destruct without doing anything.
      const myGeneration = loadGenerationRef.current;

      const playWhenReady = () => {
        // Stale listener guard — bail out immediately if a newer load has started
        if (loadGenerationRef.current !== myGeneration) {
          nextAudio.removeEventListener('canplay', playWhenReady);
          logToServer('INFO', `[useAudioPlayer] playWhenReady: stale generation (${myGeneration} vs ${loadGenerationRef.current}), discarding.`);
          return;
        }

        // FIX: Deactivate the transition guard. From this point on, native pause
        // events are legitimate user-initiated pauses and should update the store.
        isLoadingNewTrackRef.current = false;

        const { isPlaying: shouldPlay } = usePlayerStore.getState();
        logToServer('INFO', `[useAudioPlayer] playWhenReady callback fired. shouldPlay: ${shouldPlay}`);
        
        // FIX: Only restore saved progress when explicitly resuming a paused track
        // (not playing). When shouldPlay=true we are starting a NEW track —
        // progress was already reset to 0 by setTrack/nextTrack/prevTrack in the
        // store. Restoring a non-zero savedProg here would seek into the wrong
        // position (leftover from the previous track before localStorage caught up).
        const savedProg = usePlayerStore.getState().progress;
        if (savedProg > 0 && !shouldPlay) {
          nextAudio.currentTime = savedProg;
        }

        if (shouldPlay) {
          if (rule) {
            nextAudio.currentTime = rule.toTime;
          } else if (savedProg > 0) {
            nextAudio.currentTime = savedProg;
          }

          try {
            if (audioCtx?.state === 'suspended') {
              logToServer('INFO', `[useAudioPlayer] playWhenReady: AudioContext suspended. Resuming...`);
              audioCtx.resume();
            }
            applyEqBands(nextAudio, currentEqBands);
          } catch (e) {
            logToServer('WARN', `[useAudioPlayer] playWhenReady: error resuming ctx or applying EQ`, e);
          }

          const isMobile = isMobileDevice();

          let fadeInStartVol = targetVolume;
          const shouldCrossfade = !isMobile && (rule || (crossfadeTriggered.current && prevAudio.src && !prevAudio.paused));

          if (isMobile || !shouldCrossfade) {
            prevAudio.pause();
            prevAudio.removeAttribute('src');
            nextAudio.volume = targetVolume;
          } else {
            fadeInStartVol = rule?.fadeInPercent
              ? targetVolume * (1 - rule.fadeInPercent / 100)
              : 0;
            nextAudio.volume = fadeInStartVol;
          }

          logToServer('INFO', `[useAudioPlayer] playWhenReady: calling nextAudio.play(). volume: ${nextAudio.volume}`);
          nextAudio.play()
            .then(() => logToServer('INFO', `[useAudioPlayer] playWhenReady: play succeeded.`))
            .catch((err) => {
              logToServer('ERROR', `[useAudioPlayer] playWhenReady: play REJECTED`, err);
              if (err.name !== 'NotAllowedError') {
                const event = new Event('error');
                nextAudio.dispatchEvent(event);
              } else {
                setIsPlaying(false);
              }
            });

          if (!isMobile && !prevAudio.paused && prevAudio.src) {
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
                      prevAudio.removeAttribute('src');
                    }
                  }, foStepTime);
                } else {
                  prevAudio.pause();
                  prevAudio.removeAttribute('src');
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
        } else if (rule && !prevAudio.paused) {
          // BUG: cuando existía una regla de transición DJ entre la pista anterior
          // y esta, el pause() síncrono de arriba se salta a propósito (para poder
          // hacer el fundido dentro de esta misma función) — pero ese fundido solo
          // se dispara dentro del `if (shouldPlay)` de arriba. Si el reproductor
          // está en pausa justo en este cambio de pista (recarga de página con
          // isPlaying=false, o navegación mientras estaba pausado), shouldPlay es
          // false y nextAudio.play() nunca se llama — pero tampoco se pausaba
          // nunca prevAudio, así que la pista anterior seguía sonando indefinidamente
          // en segundo plano, sin relación con lo que mostraba la UI.
          try {
            prevAudio.pause();
            prevAudio.currentTime = 0;
            prevAudio.removeAttribute('src');
          } catch (e) {
            /* ignore */
          }
        }
        nextAudio.removeEventListener('canplay', playWhenReady);
      };

      nextAudio.addEventListener('canplay', playWhenReady);
    });

    return () => {
      // Ensure any in-flight fade intervals are killed when the track changes
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }
      if (fadeOutIntervalRef.current) {
        clearInterval(fadeOutIntervalRef.current);
        fadeOutIntervalRef.current = null;
      }
    };
  }, [currentTrack, setLoading, setIsPlaying, volume, isMuted]);

  useEffect(() => {
    const audio = getActiveAudio();
    if (!currentTrack) return;

    // En isEmbedMode, useVideoSync (registrado sobre el iframe de YouTube)
    // se encarga de enviar los comandos playVideo/pauseVideo al embed.
    if (usePlayerStore.getState().isEmbedMode) return;

    logToServer('INFO', `[useAudioPlayer] isPlaying changed effect: ${isPlaying}. audio.src: ${audio.src ? audio.src.substring(0, 100) : 'none'}, readyState: ${audio.readyState}`);

    if (isPlaying) {
      if (audio.src && audio.readyState >= 2) {
        // Resume AudioContext if suspended (browser autoplay policy)
        if (audioCtx?.state === 'suspended') {
          logToServer('INFO', '[useAudioPlayer] isPlaying effect: AudioContext suspended. Resuming...');
          audioCtx.resume();
        }
        logToServer('INFO', '[useAudioPlayer] isPlaying effect: Calling audio.play()');
        audio.play()
          .then(() => logToServer('INFO', '[useAudioPlayer] isPlaying effect: play succeeded'))
          .catch((err) => {
            logToServer('ERROR', '[useAudioPlayer] isPlaying effect: play REJECTED', err);
            if (err.name !== 'NotAllowedError') {
              const event = new Event('error');
              audio.dispatchEvent(event);
            } else {
              setIsPlaying(false);
            }
          });
      } else {
        logToServer('INFO', `[useAudioPlayer] isPlaying effect: cannot play yet, readyState is ${audio.readyState}`);
        // FIX-B+C: Only attempt stream recovery when the audio is genuinely stuck
        // (src set, readyState=0) AND there is no active retry cycle in progress.
        // Checking retryCountRef prevents this from firing mid-retry — which would
        // reset the counter to 0 and restart the retry sequence from 1/3 indefinitely.
        // This path is designed exclusively for the manual-play-after-exhausted-retries
        // scenario where the player is idle and the user explicitly requests playback.
        const stuckTrackId = usePlayerStore.getState().currentTrack?.id;
        const isRetryInProgress = stuckTrackId && !!retryCountRef.current[stuckTrackId];
        if (audio.src && audio.src !== 'about:blank' && audio.readyState === 0 && !isRetryInProgress) {
          logToServer('INFO', '[useAudioPlayer] isPlaying effect: readyState=0, no retry in progress — calling audio.load() to recover stuck stream');

          // Register a one-shot canplay listener BEFORE calling load() to guarantee
          // playback starts even if playWhenReady was already consumed by prior retries.
          const resumeAfterLoad = () => {
            audio.removeEventListener('canplay', resumeAfterLoad);
            if (usePlayerStore.getState().isPlaying) {
              const targetVol = usePlayerStore.getState().isMuted ? 0 : usePlayerStore.getState().volume;
              audio.volume = targetVol;
              if (audioCtx?.state === 'suspended') audioCtx.resume().catch(() => {});
              logToServer('INFO', '[useAudioPlayer] resumeAfterLoad: calling audio.play() after stuck-stream recovery');
              audio.play().catch((err) => {
                logToServer('ERROR', '[useAudioPlayer] resumeAfterLoad: play REJECTED', err);
                if (err.name !== 'NotAllowedError') {
                  const event = new Event('error');
                  audio.dispatchEvent(event);
                } else {
                  setIsPlaying(false);
                }
              });
            }
          };
          audio.addEventListener('canplay', resumeAfterLoad);
          audio.load();
        }
      }
    } else {
      logToServer('INFO', '[useAudioPlayer] isPlaying effect: Calling audio.pause()');
      // FIX: Always pause both audio elements when stopping. During a track
      // transition the "active" audio may have just switched to the new track
      // (nextAudio) while the old track (now inactive) is still playing.
      // Pausing only getActiveAudio() would leave the previous track running.
      audio.pause();
      getInactiveAudio().pause();
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
        fadeIntervalRef.current = null;
      }
      if (fadeOutIntervalRef.current) {
        clearInterval(fadeOutIntervalRef.current);
        fadeOutIntervalRef.current = null;
      }
    }
  }, [isPlaying, currentTrack, setIsPlaying]);

  // Volume: apply immediately, respecting crossfade
  useEffect(() => {
    // En isEmbedMode, useVideoSync sincroniza volumen/mute con el iframe.
    if (usePlayerStore.getState().isEmbedMode) return;
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
        { title: currentTrack.title, artist: currentTrack.artist, cover: currentTrack.cover, genre: currentTrack.genre },
        myId,
        myId   // deviceId = same as userId (koko_device_id is device-scoped)
      ).catch((err) => console.error('[PlayLog] Error:', err));

      // Artist history tracking for logical searches
      try {
        const artist = currentTrack.artist;
        const listened = JSON.parse(localStorage.getItem('koko_listened_artists') || '[]');
        const filtered = listened.filter((a: string) => a.toLowerCase() !== artist.toLowerCase());
        const updated = [artist, ...filtered].slice(0, 20);
        localStorage.setItem('koko_listened_artists', JSON.stringify(updated));
      } catch (e) {
        console.error('[HistoryLog] Error saving listened artist:', e);
      }

      // ─── Auto-cache logic ───
      const trackId = currentTrack.id;
      const countKey = `koko_play_count_${trackId}`;
      const currentCount = parseInt(localStorage.getItem(countKey) ?? '0') + 1;
      localStorage.setItem(countKey, String(currentCount));

      // Guardar en el historial de reproducción local con metadata
      try {
        const playHistoryRaw = localStorage.getItem('koko_play_history');
        const playHistory: any[] = playHistoryRaw ? JSON.parse(playHistoryRaw) : [];
        const existingIdx = playHistory.findIndex((t: any) => t.id === currentTrack.id);
        if (existingIdx !== -1) {
          playHistory[existingIdx].playCount = currentCount;
          playHistory[existingIdx].lastPlayed = Date.now();
          const [item] = playHistory.splice(existingIdx, 1);
          playHistory.unshift(item);
        } else {
          playHistory.unshift({
            id: currentTrack.id,
            title: currentTrack.title,
            artist: currentTrack.artist,
            cover: currentTrack.cover,
            duration: currentTrack.duration,
            playCount: currentCount,
            lastPlayed: Date.now()
          });
        }
        localStorage.setItem('koko_play_history', JSON.stringify(playHistory.slice(0, 100)));
      } catch (e) {
        console.error('[HistoryLog] Error saving play history:', e);
      }

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
