/**
 * VinylLauncher — el vinilo de la canción elegida gira y se "lanza" hacia
 * arriba arrastrándolo (como una pokeball) para publicarla en BeMusic.
 * También se puede lanzar con el botón (teclado / accesibilidad).
 */
import { useRef, useState } from 'react';

const LAUNCH_DISTANCE = 110; // px hacia arriba
const LAUNCH_VELOCITY = 0.9; // px/ms hacia arriba (flick rápido)

export default function VinylLauncher({
  cover,
  disabled,
  busy,
  onLaunch,
}: {
  cover?: string;
  disabled?: boolean;
  busy?: boolean;
  onLaunch: () => Promise<boolean>;
}) {
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'flying' | 'landed'>('idle');
  const start = useRef<{ y: number; t: number; lastY: number; lastT: number } | null>(null);

  const launch = async () => {
    if (disabled || busy || phase !== 'idle') return;
    setPhase('flying');
    setDragging(false);
    // Deja volar el vinilo antes de pedir la publicación
    await new Promise((r) => setTimeout(r, 650));
    const ok = await onLaunch();
    if (ok) {
      setPhase('landed');
      setTimeout(() => { setPhase('idle'); setDragY(0); }, 1400);
    } else {
      setPhase('idle');
      setDragY(0);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || busy || phase !== 'idle') return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const now = performance.now();
    start.current = { y: e.clientY, t: now, lastY: e.clientY, lastT: now };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || !start.current) return;
    const dy = e.clientY - start.current.y;
    // Hacia abajo apenas se mueve (resistencia); hacia arriba sigue al dedo
    setDragY(dy > 0 ? dy * 0.2 : dy);
    start.current.lastY = e.clientY;
    start.current.lastT = performance.now();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging || !start.current) return;
    const dy = e.clientY - start.current.y;
    const dt = Math.max(1, performance.now() - start.current.t);
    const velocity = -dy / dt;
    start.current = null;
    if (-dy > LAUNCH_DISTANCE || (velocity > LAUNCH_VELOCITY && dy < -30)) {
      launch();
    } else {
      setDragging(false);
      setDragY(0);
    }
  };

  const pull = Math.min(1, Math.max(0, -dragY / LAUNCH_DISTANCE));

  return (
    <div className={`vl ${disabled ? 'vl--disabled' : ''}`}>
      <div className="vl-stage">
        {/* Estela de lanzamiento */}
        <div className={`vl-trail ${phase === 'flying' ? 'vl-trail--on' : ''}`} />
        {phase === 'landed' && <div className="vl-burst" aria-hidden>{Array.from({ length: 12 }).map((_, i) => <span key={i} style={{ '--i': i } as React.CSSProperties} />)}</div>}

        <div
          className={`vl-disc-wrap ${dragging ? 'vl-disc-wrap--drag' : ''} ${phase === 'flying' ? 'vl-disc-wrap--fly' : ''} ${phase === 'landed' ? 'vl-disc-wrap--gone' : ''}`}
          style={phase === 'idle' ? { transform: `translateY(${dragY}px) scale(${1 + pull * 0.06})` } : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="button"
          aria-label="Desliza el vinilo hacia arriba para publicarlo"
        >
          <div className={`vl-disc ${dragging || phase === 'flying' ? 'vl-disc--fast' : ''}`}>
            <div className="vl-label" style={cover ? { backgroundImage: `url("${cover}")` } : undefined} />
            <div className="vl-hole" />
          </div>
          <div className="vl-sheen" />
        </div>
      </div>

      <div className="vl-hint" style={{ opacity: phase === 'idle' ? 1 - pull * 0.8 : 0 }}>
        <svg className="vl-hint-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        {busy ? 'Enviando…' : 'Desliza hacia arriba para lanzarla'}
      </div>
      <button className="vl-fallback" onClick={launch} disabled={disabled || busy || phase !== 'idle'}>
        o pulsa para lanzar
      </button>
    </div>
  );
}
