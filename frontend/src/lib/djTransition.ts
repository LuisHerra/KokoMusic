import type { CrossfadeCurve, TransitionRule } from '../store/playerStore';
import { getLyrics, getStreamUrl, type Track } from './api';
import { parseSyncedLyrics } from './lyricsParser';

/**
 * Estimación determinista de BPM a partir de título+artista — misma fórmula
 * que el backend (candidateGenerator.ts:estimateBpm), portada aquí para no
 * necesitar ida y vuelta al servidor solo para ordenar el picker de Deck B.
 * NO es análisis de audio real — ver el prefijo "~" que se muestra en UI.
 */
export function estimateBpm(title: string, artist: string): number {
  const charSum =
    title.split('').reduce((s, c) => s + c.charCodeAt(0), 0) +
    artist.split('').reduce((s, c) => s + c.charCodeAt(0), 0) || 100;
  return 75 + (charSum % 76); // 75-150 BPM
}

export function getFadeRatio(ratio: number, curve: CrossfadeCurve): number {
  switch (curve) {
    case 'exponential': return Math.pow(ratio, 2);
    case 'logarithmic': return Math.log10(1 + 9 * ratio);
    case 's-curve': return ratio * ratio * (3 - 2 * ratio);
    case 'linear':
    default: return ratio;
  }
}

export type AutoMixResult = Pick<TransitionRule, 'fromTime' | 'toTime' | 'curve' | 'duration'>;

/**
 * "Auto-Mix Perfecto": analiza las letras sincronizadas de ambas pistas.
 *  - Salida de A: justo después de la última frase cantada (la mezcla cae en
 *    la cola instrumental), nunca en mitad del último estribillo. Si la cola
 *    es larguísima se recorta; si no queda sitio, se ajusta al final real.
 *  - Entrada de B: si tiene una intro instrumental larga, se salta para que la
 *    voz entre justo cuando termina el fundido; si no, arranca desde el inicio.
 *  - Sin letras sincronizadas, cae a un fade sobre los últimos segundos.
 */
export async function computeAutoMix(fromTrack: Track, toTrack: Track): Promise<AutoMixResult> {
  const [fromRes, toRes] = await Promise.allSettled([getLyrics(fromTrack.id), getLyrics(toTrack.id)]);
  const fromLyrics = fromRes.status === 'fulfilled' ? fromRes.value : null;
  const toLyrics = toRes.status === 'fulfilled' ? toRes.value : null;

  const fromLines = fromLyrics?.syncedLyrics ? parseSyncedLyrics(fromLyrics.syncedLyrics) : [];
  const toLines = toLyrics?.syncedLyrics ? parseSyncedLyrics(toLyrics.syncedLyrics) : [];

  const fromDur = fromTrack.duration ? fromTrack.duration / 1000 : 180;
  let duration = 8;

  let fromTime: number;
  if (fromLines.length > 0) {
    const lastVocal = fromLines[fromLines.length - 1].time;
    fromTime = lastVocal + 4; // deja terminar la última frase
  } else {
    fromTime = fromDur - duration - 4;
  }
  // Nunca antes de la mitad de la canción, y siempre con sitio para el fundido
  fromTime = Math.max(fromTime, fromDur * 0.5);
  const tail = fromDur - fromTime;
  if (tail < duration + 1) {
    duration = Math.max(3, Math.floor(tail - 1));
    fromTime = Math.max(0, fromDur - duration - 1);
  }

  let toTime = 0;
  if (toLines.length > 0) {
    const firstVocal = toLines[0].time;
    if (firstVocal > duration + 6) toTime = Math.max(0, firstVocal - duration - 1);
  }

  return { fromTime, toTime, curve: 's-curve', duration };
}

export interface CrossfadePreviewHandle {
  stop: () => void;
}

/** Reproduce un preview real (fuera del reproductor principal) del crossfade entre dos pistas. */
export function startCrossfadePreview(
  fromTrack: Track,
  toTrack: Track,
  rule: Pick<TransitionRule, 'fromTime' | 'toTime' | 'curve' | 'duration'>,
  onEnd: () => void
): CrossfadePreviewHandle {
  const a1 = new Audio(getStreamUrl(fromTrack.id));
  const a2 = new Audio(getStreamUrl(toTrack.id));

  let timeout: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    a1.pause();
    a2.pause();
    if (timeout) clearTimeout(timeout);
    if (interval) clearInterval(interval);
    a1.src = '';
    a2.src = '';
  };

  const preRoll = 3;
  const startA1 = Math.max(0, rule.fromTime - preRoll);
  a1.currentTime = startA1;
  a1.volume = 1;
  a2.currentTime = rule.toTime;
  a2.volume = 0;

  const begin = () => {
    a1.play().catch(() => stop());
    const actualPreRoll = rule.fromTime - startA1;

    timeout = setTimeout(() => {
      if (stopped) return;
      a2.play().catch(() => {});
      let step = 0;
      const steps = 20;
      const stepTime = (rule.duration * 1000) / steps;

      interval = setInterval(() => {
        step++;
        const ratioIn = getFadeRatio(step / steps, rule.curve);
        a1.volume = Math.max(0, 1 - ratioIn);
        a2.volume = Math.min(1, ratioIn);

        if (step >= steps) {
          if (interval) clearInterval(interval);
          a1.pause();
          setTimeout(() => {
            stop();
            onEnd();
          }, 3000);
        }
      }, stepTime);
    }, actualPreRoll * 1000);
  };

  let canplayFired = false;
  const onCanPlay = () => {
    if (canplayFired) return;
    canplayFired = true;
    begin();
  };
  a1.addEventListener('canplay', onCanPlay, { once: true });
  if (a1.readyState >= 3) onCanPlay();

  return { stop };
}
