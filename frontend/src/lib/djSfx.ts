/**
 * Efectos de sonido de transición (riser, boom, bocina…) sintetizados con
 * Web Audio: sin archivos que descargar ni licencias. Usan su propio
 * AudioContext para no tocar la cadena de EQ/efectos del reproductor.
 */

export type SfxId = 'riser' | 'downlifter' | 'boom' | 'airhorn' | 'scratch' | 'reverse' | 'laser' | 'sweep';
export type SfxAt = 'before' | 'start' | 'mid' | 'end';

export interface TransitionSfx {
  id: SfxId;
  at: SfxAt;
  volume: number; // 0-1
}

export const SFX_CATALOG: { id: SfxId; label: string; length: number; hint: string }[] = [
  { id: 'riser', label: 'Subida', length: 3, hint: 'Tensión que sube hasta el cambio' },
  { id: 'downlifter', label: 'Bajada', length: 2.5, hint: 'Cae tras el cambio' },
  { id: 'boom', label: 'Boom', length: 2, hint: 'Golpe grave de impacto' },
  { id: 'airhorn', label: 'Bocina', length: 1.6, hint: 'La bocina de DJ de siempre' },
  { id: 'scratch', label: 'Scratch', length: 0.8, hint: 'Rasgado de vinilo' },
  { id: 'reverse', label: 'Platillo inverso', length: 2, hint: 'Crece y se corta en seco' },
  { id: 'laser', label: 'Láser', length: 0.6, hint: 'Zap electrónico' },
  { id: 'sweep', label: 'Barrido', length: 4, hint: 'Ola de ruido blanco' },
];

export const SFX_AT_LABEL: Record<SfxAt, string> = {
  before: 'Justo antes',
  start: 'Al empezar',
  mid: 'A mitad',
  end: 'Al terminar',
};

export const sfxLength = (id: SfxId) => SFX_CATALOG.find((s) => s.id === id)?.length ?? 1;

/** Segundos respecto al inicio del fundido en que debe sonar el efecto. */
export function sfxOffset(sfx: TransitionSfx, fadeDuration: number): number {
  switch (sfx.at) {
    // "Justo antes": termina exactamente cuando empieza el fundido (risers)
    case 'before': return -sfxLength(sfx.id);
    case 'mid': return fadeDuration / 2;
    case 'end': return fadeDuration;
    case 'start':
    default: return 0;
  }
}

let ctx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function noise(c: AudioContext): AudioBufferSourceNode {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 4, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  return src;
}

/** Reproduce un efecto ya. `volume` 0-1. */
export function playSfx(id: SfxId, volume = 0.8): void {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime + 0.02;
  const out = c.createGain();
  out.gain.value = Math.max(0, Math.min(1, volume));
  out.connect(c.destination);
  const stopAll = (nodes: AudioScheduledSourceNode[], at: number) => nodes.forEach((n) => { n.start(t); n.stop(at); });

  switch (id) {
    case 'riser': {
      const n = noise(c);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 3;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(9000, t + 3);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.9, t + 2.9);
      g.gain.linearRampToValueAtTime(0, t + 3);
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(1400, t + 3);
      const og = c.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.12, t + 2.9);
      og.gain.linearRampToValueAtTime(0, t + 3);
      n.connect(bp).connect(g).connect(out);
      o.connect(og).connect(out);
      stopAll([n, o], t + 3.05);
      break;
    }
    case 'downlifter': {
      const n = noise(c);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(8000, t);
      bp.frequency.exponentialRampToValueAtTime(150, t + 2.5);
      const g = c.createGain();
      g.gain.setValueAtTime(0.8, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
      n.connect(bp).connect(g).connect(out);
      stopAll([n], t + 2.55);
      break;
    }
    case 'boom': {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
      const g = c.createGain();
      g.gain.setValueAtTime(1, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2);
      const n = noise(c);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1800;
      const ng = c.createGain();
      ng.gain.setValueAtTime(0.7, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(out);
      n.connect(lp).connect(ng).connect(out);
      stopAll([o, n], t + 2.05);
      break;
    }
    case 'airhorn': {
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.8;
      bp.connect(out);
      const bursts = [0, 0.32, 0.64, 0.96];
      const lengths = [0.22, 0.22, 0.22, 0.6];
      const oscs: OscillatorNode[] = [];
      bursts.forEach((b, i) => {
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t + b);
        g.gain.linearRampToValueAtTime(0.35, t + b + 0.02);
        g.gain.setValueAtTime(0.35, t + b + lengths[i] - 0.03);
        g.gain.linearRampToValueAtTime(0.0001, t + b + lengths[i]);
        g.connect(bp);
        [466, 470, 587, 698].forEach((f) => {
          const o = c.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(f * 0.97, t + b);
          o.frequency.linearRampToValueAtTime(f, t + b + 0.06);
          o.connect(g);
          o.start(t + b);
          o.stop(t + b + lengths[i] + 0.02);
          oscs.push(o);
        });
      });
      break;
    }
    case 'scratch': {
      const n = noise(c);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 6;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      const moves = [[0, 700], [0.12, 2600], [0.2, 900], [0.34, 3000], [0.45, 600], [0.6, 2400], [0.8, 500]];
      moves.forEach(([dt, f], i) => {
        bp.frequency.linearRampToValueAtTime(f, t + dt);
        g.gain.linearRampToValueAtTime(i % 2 ? 0.9 : 0.15, t + dt);
      });
      g.gain.linearRampToValueAtTime(0, t + 0.8);
      n.connect(bp).connect(g).connect(out);
      stopAll([n], t + 0.82);
      break;
    }
    case 'reverse': {
      const n = noise(c);
      const hp = c.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 4500;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.8, t + 1.95);
      g.gain.linearRampToValueAtTime(0, t + 2);
      n.connect(hp).connect(g).connect(out);
      stopAll([n], t + 2.02);
      break;
    }
    case 'laser': {
      const oscs: OscillatorNode[] = [];
      [0, 0.28].forEach((b) => {
        const o = c.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(2200, t + b);
        o.frequency.exponentialRampToValueAtTime(180, t + b + 0.26);
        const g = c.createGain();
        g.gain.setValueAtTime(0.18, t + b);
        g.gain.exponentialRampToValueAtTime(0.0001, t + b + 0.28);
        o.connect(g).connect(out);
        o.start(t + b);
        o.stop(t + b + 0.3);
        oscs.push(o);
      });
      break;
    }
    case 'sweep': {
      const n = noise(c);
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 1.5;
      lp.frequency.setValueAtTime(200, t);
      lp.frequency.exponentialRampToValueAtTime(12000, t + 2);
      lp.frequency.exponentialRampToValueAtTime(300, t + 4);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 2);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
      n.connect(lp).connect(g).connect(out);
      stopAll([n], t + 4.05);
      break;
    }
  }
}

/**
 * Programa los efectos de una transición. `fadeStartIn` = segundos (reales)
 * que faltan para que empiece el fundido; `rate` = velocidad de reproducción.
 * Devuelve una función para cancelar los que aún no han sonado.
 */
export function scheduleTransitionSfx(
  sfx: TransitionSfx[] | undefined,
  fadeDuration: number,
  fadeStartIn: number,
  rate = 1
): () => void {
  if (!sfx?.length) return () => {};
  const timers = sfx.map((s) => {
    const delay = (fadeStartIn + sfxOffset(s, fadeDuration) / rate) * 1000;
    return setTimeout(() => playSfx(s.id, s.volume), Math.max(0, delay));
  });
  return () => timers.forEach(clearTimeout);
}
