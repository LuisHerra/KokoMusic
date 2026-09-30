/**
 * StreakCelebration — pantalla de racha al estilo Duolingo: la llama crece,
 * el número salta de ayer a hoy, se encienden los días de la semana y
 * suben notas musicales.
 */
import { useEffect, useMemo, useState } from 'react';

const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const NOTES = ['♪', '♫', '♩', '♬'];

export function FlameIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`bm-flame ${className}`} width={size} height={size * 1.2} viewBox="0 0 40 48" aria-hidden>
      <defs>
        <linearGradient id="bmFlameOuter" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ff4b00" />
          <stop offset="1" stopColor="#ff9600" />
        </linearGradient>
        <linearGradient id="bmFlameInner" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ffc800" />
          <stop offset="1" stopColor="#fff3a0" />
        </linearGradient>
      </defs>
      <path className="bm-flame-outer" fill="url(#bmFlameOuter)" d="M20 2c2 7 11 12 11 25a11 11 0 0 1-22 0c0-6 3-9 5-12 0 4 2 6 4 6-1-7 0-13 2-19z" />
      <path className="bm-flame-inner" fill="url(#bmFlameInner)" d="M20 16c1.5 5 9 8 9 17a9 9 0 0 1-18 0c0-4.5 2-7 4.5-9 0 3 1.5 4.5 3 4.5-.8-4.5 0-9 1.5-12.5z" />
    </svg>
  );
}

export default function StreakCelebration({ streak, onClose }: { streak: number; onClose: () => void }) {
  const [shown, setShown] = useState(Math.max(0, streak - 1));

  useEffect(() => {
    const t = setTimeout(() => setShown(streak), 900);
    return () => clearTimeout(t);
  }, [streak]);

  // Días encendidos de esta semana (terminando hoy)
  const todayIdx = (new Date().getDay() + 6) % 7; // lunes = 0
  const litFrom = todayIdx - Math.min(streak, todayIdx + 1) + 1;

  const notes = useMemo(
    () => Array.from({ length: 14 }).map((_, i) => ({
      ch: NOTES[i % NOTES.length],
      left: 6 + Math.random() * 88,
      delay: Math.random() * 2.4,
      dur: 2.6 + Math.random() * 2,
      size: 16 + Math.random() * 18,
      drift: (Math.random() - 0.5) * 80,
    })),
    []
  );

  const embers = useMemo(
    () => Array.from({ length: 22 }).map(() => ({
      left: Math.random() * 100,
      size: 3 + Math.random() * 5,
      delay: Math.random() * 3,
      dur: 3 + Math.random() * 3,
      drift: (Math.random() - 0.5) * 60,
    })),
    []
  );

  return (
    <div className="sc" onClick={onClose} role="dialog" aria-label={`Racha de ${streak} días`}>
      <div className="sc-embers" aria-hidden>
        {embers.map((e, i) => (
          <span key={i} style={{ left: `${e.left}%`, width: e.size, height: e.size, animationDelay: `${e.delay}s`, animationDuration: `${e.dur}s`, '--drift': `${e.drift}px` } as React.CSSProperties} />
        ))}
      </div>
      <div className="sc-notes" aria-hidden>
        {notes.map((n, i) => (
          <span
            key={i}
            style={{
              left: `${n.left}%`,
              fontSize: n.size,
              animationDelay: `${n.delay}s`,
              animationDuration: `${n.dur}s`,
              '--drift': `${n.drift}px`,
            } as React.CSSProperties}
          >
            {n.ch}
          </span>
        ))}
      </div>

      <div className="sc-body" onClick={(e) => e.stopPropagation()}>
        <div className="sc-flame-wrap">
          <div className="sc-glow" />
          <FlameIcon size={190} className="sc-flame" />
          {/* El número va dentro de la llama, sobre el núcleo */}
          <div key={shown} className={`sc-count ${shown >= 100 ? 'sc-count--sm' : ''}`}>{shown}</div>
        </div>

        <h2 className="sc-title">{streak === 1 ? '¡Racha iniciada!' : `¡${streak} días de racha!`}</h2>
        <p className="sc-sub">
          {streak === 1 ? 'Publica mañana para que la llama siga viva.' : 'Tu música no descansa. Vuelve mañana para mantenerla.'}
        </p>

        <div className="sc-week">
          {DAYS.map((d, i) => {
            const lit = i >= litFrom && i <= todayIdx;
            return (
              <div key={d} className={`sc-day ${lit ? 'sc-day--lit' : ''} ${i === todayIdx ? 'sc-day--today' : ''}`} style={{ animationDelay: `${1 + (i - litFrom) * 0.08}s` }}>
                <span className="sc-day-dot">{lit ? '✓' : ''}</span>
                <span className="sc-day-name">{d}</span>
              </div>
            );
          })}
        </div>

        <button className="sc-btn" onClick={onClose}>¡Sigue así!</button>
      </div>
    </div>
  );
}
