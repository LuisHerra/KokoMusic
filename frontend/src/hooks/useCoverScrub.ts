/**
 * Gestos sobre la portada del reproductor móvil:
 *  - Deslizar en horizontal: mueve la canción (adelante a la derecha, atrás a
 *    la izquierda). El ancho de la pantalla equivale a ~1/3 de la canción.
 *  - Swipe largo (pasar del 60 % del ancho) o muy rápido: siguiente / anterior.
 * Un toque sin arrastre sigue funcionando como antes (abre el vídeo).
 */
import { useRef, useState } from 'react';
import { seekAudio } from './useAudioPlayer';
import { usePlayerStore } from '../store/playerStore';

const START_PX = 12;          // movimiento mínimo para considerar que se arrastra
const TRACK_SWITCH_RATIO = 0.6;   // pasar del 60 % del ancho: siguiente / anterior
const FLING_PX_PER_MS = 1.4;      // gesto muy rápido: cambia de canción aunque sea más corto
const FLING_MIN_PX = 110;

export interface ScrubState {
  active: boolean;
  /** 'seek' mientras se mueve la canción; 'next' / 'prev' si al soltar cambia de canción */
  mode: 'seek' | 'next' | 'prev';
  targetS: number;
  deltaS: number;
  dx: number;
}

export function useCoverScrub() {
  const start = useRef<{ x: number; y: number; t: number; progress: number; width: number } | null>(null);
  const axis = useRef<'none' | 'x' | 'y'>('none');
  const suppressClick = useRef(false);
  const [scrub, setScrub] = useState<ScrubState>({ active: false, mode: 'seek', targetS: 0, deltaS: 0, dx: 0 });

  const compute = (dx: number, width: number, progress: number, duration: number, velocity = 0): ScrubState => {
    // Precisión: el ancho de la pantalla equivale a ~1/3 de la canción (antes,
    // medio ancho era la canción entera y 70 px ya saltaban minuto y medio).
    const secPerPx = Math.min(0.6, Math.max(0.12, duration / (width * 3)));
    const fling = Math.abs(velocity) > FLING_PX_PER_MS && Math.abs(dx) > FLING_MIN_PX;
    const mode: ScrubState['mode'] = Math.abs(dx) >= width * TRACK_SWITCH_RATIO || fling ? (dx > 0 ? 'next' : 'prev') : 'seek';
    const targetS = Math.max(0, Math.min(Math.max(0, duration - 1), progress + dx * secPerPx));
    return { active: true, mode, targetS, deltaS: targetS - progress, dx };
  };

  const onTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    const touch = e.touches[0];
    const width = e.currentTarget.getBoundingClientRect().width || window.innerWidth;
    start.current = { x: touch.clientX, y: touch.clientY, t: performance.now(), progress: usePlayerStore.getState().progress, width };
    axis.current = 'none';
  };

  const onTouchMove = (e: React.TouchEvent<HTMLElement>) => {
    const s = start.current;
    if (!s) return;
    const touch = e.touches[0];
    const dx = touch.clientX - s.x;
    const dy = touch.clientY - s.y;
    if (axis.current === 'none') {
      if (Math.abs(dx) < START_PX && Math.abs(dy) < START_PX) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (axis.current !== 'x') return;
    e.stopPropagation();
    const { duration } = usePlayerStore.getState();
    if (!duration) return;
    setScrub(compute(dx, s.width, s.progress, duration));
  };

  const onTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    const s = start.current;
    start.current = null;
    if (!s || axis.current !== 'x') { axis.current = 'none'; return; }
    axis.current = 'none';
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 350);

    const touch = e.changedTouches[0];
    const dx = touch.clientX - s.x;
    const velocity = dx / Math.max(1, performance.now() - s.t);
    const { duration, nextTrack, prevTrack } = usePlayerStore.getState();
    const result = compute(dx, s.width, s.progress, duration || 0, velocity);

    if (result.mode === 'next') nextTrack();
    else if (result.mode === 'prev') prevTrack();
    else if (duration) seekAudio(result.targetS);

    if ('vibrate' in navigator) { try { navigator.vibrate?.(result.mode === 'seek' ? 8 : 20); } catch { /* sin vibración */ } }
    setScrub({ active: false, mode: 'seek', targetS: 0, deltaS: 0, dx: 0 });
  };

  /** Para envolver el onClick de la portada: ignora el "click" que sigue a un arrastre. */
  const guardClick = (fn: () => void) => () => { if (!suppressClick.current) fn(); };
  /** true justo después de un arrastre (para ignorar el click que lo sigue). */
  const wasDragging = () => suppressClick.current;

  return { scrub, handlers: { onTouchStart, onTouchMove, onTouchEnd }, guardClick, wasDragging };
}

export const fmtScrubTime = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
