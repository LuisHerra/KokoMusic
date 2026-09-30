/**
 * MixPointEditor — editor preciso de un punto de mezcla (salida de A o
 * entrada de B): línea de tiempo con secciones, hot cues y la zona del
 * fundido; ajuste fino (±0,1 / ±1 / ±5 s), tiempo editable, "Ahora" (posición
 * que suena) y escucha rápida del punto.
 */
import { useEffect, useRef, useState } from 'react';
import type { LyricSection, LyricsLine } from '../../lib/lyricsParser';
import './MixPointEditor.css';

export const fmtTime = (s: number, decimals = true) => {
  const safe = Math.max(0, s);
  const m = Math.floor(safe / 60);
  const sec = safe % 60;
  return decimals ? `${m}:${sec.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(sec)).padStart(2, '0')}`;
};

/** Acepta "1:23", "1:23.4", "83" o "83.4". */
export const parseTime = (raw: string): number | null => {
  const t = raw.trim().replace(',', '.');
  const m = t.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
};

export default function MixPointEditor({
  side,
  title,
  cover,
  value,
  onChange,
  length,
  fadeLength,
  sections,
  lyrics,
  cues,
  livePosition,
  onAudition,
  auditioning,
}: {
  side: 'out' | 'in';
  title: string;
  cover?: string;
  value: number;
  onChange: (s: number) => void;
  length: number;           // duración de la pista en s
  fadeLength: number;       // duración del crossfade en s
  sections: LyricSection[];
  lyrics: LyricsLine[];
  cues: (number | null)[];
  livePosition?: number | null; // si esta pista suena ahora, su posición
  onAudition: () => void;
  auditioning: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(fmtTime(value));
  const [editing, setEditing] = useState(false);
  const dragging = useRef(false);

  useEffect(() => { if (!editing) setDraft(fmtTime(value)); }, [value, editing]);

  const clamp = (s: number) => Math.max(0, Math.min(length, Math.round(s * 10) / 10));
  const set = (s: number) => onChange(clamp(s));
  const pct = (s: number) => `${length ? (Math.max(0, Math.min(length, s)) / length) * 100 : 0}%`;

  const fromPointer = (clientX: number) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r) return;
    set(((clientX - r.left) / r.width) * length);
  };

  const commitDraft = () => {
    setEditing(false);
    const p = parseTime(draft);
    if (p !== null) set(p);
    else setDraft(fmtTime(value));
  };

  // Aviso: el fundido no cabe antes del final de la pista saliente
  const overflow = side === 'out' && value + fadeLength > length + 0.05;
  const fadeStart = value;
  const fadeEnd = Math.min(length, value + fadeLength);

  return (
    <div className={`mpe mpe--${side}`}>
      <div className="mpe-head">
        {cover ? <img src={cover} alt="" /> : <div className="mpe-cover-ph" />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mpe-title">{title}</div>
          <div className="mpe-sub">{side === 'out' ? 'Punto de salida · empieza a fundirse' : 'Punto de entrada · empieza a sonar'}</div>
        </div>
        <button className={`mpe-audition ${auditioning ? 'mpe-audition--on' : ''}`} onClick={onAudition} title="Escuchar este punto">
          {auditioning
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>}
          Oír
        </button>
      </div>

      {/* Línea de tiempo */}
      <div
        ref={barRef}
        className="mpe-bar"
        onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); fromPointer(e.clientX); }}
        onPointerMove={(e) => dragging.current && fromPointer(e.clientX)}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={length}
        aria-valuenow={value}
        aria-label={side === 'out' ? 'Punto de salida' : 'Punto de entrada'}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') set(value - (e.shiftKey ? 5 : 1));
          if (e.key === 'ArrowRight') set(value + (e.shiftKey ? 5 : 1));
        }}
      >
        {sections.map((s, i) => (
          <span key={`s${i}`} className={`mpe-sec ${s.type === 'Estribillo' ? 'mpe-sec--chorus' : ''}`} style={{ left: pct(s.startTime) }} />
        ))}
        {cues.map((c, i) => c !== null && (
          <span key={`c${i}`} className="mpe-cue" style={{ left: pct(c) }}>{i + 1}</span>
        ))}
        {side === 'out'
          ? <span className="mpe-played" style={{ width: pct(fadeStart) }} />
          : <span className="mpe-skipped" style={{ width: pct(fadeStart) }} />}
        <span className={`mpe-fade ${overflow ? 'mpe-fade--bad' : ''}`} style={{ left: pct(fadeStart), width: `calc(${pct(fadeEnd)} - ${pct(fadeStart)})` }} />
        {livePosition != null && <span className="mpe-live" style={{ left: pct(livePosition) }} />}
        <span className="mpe-thumb" style={{ left: pct(value) }} />
      </div>
      <div className="mpe-scale"><span>0:00</span><span>{fmtTime(length, false)}</span></div>

      {/* Ajuste fino */}
      <div className="mpe-fine">
        <button onClick={() => set(value - 5)}>−5</button>
        <button onClick={() => set(value - 1)}>−1</button>
        <button onClick={() => set(value - 0.1)}>−.1</button>
        <input
          className="mpe-time"
          value={draft}
          inputMode="decimal"
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Tiempo exacto (m:ss.d)"
        />
        <button onClick={() => set(value + 0.1)}>+.1</button>
        <button onClick={() => set(value + 1)}>+1</button>
        <button onClick={() => set(value + 5)}>+5</button>
      </div>

      {overflow && (
        <p className="mpe-warn">El fundido de {fadeLength}s no cabe: la canción termina en {fmtTime(length, false)}. Adelanta el punto o acorta la duración.</p>
      )}

      {/* Atajos: ahora, secciones, hot cues */}
      <div className="mpe-chips">
        {livePosition != null && (
          <button className="mpe-chip mpe-chip--live" onClick={() => set(livePosition)}>● Ahora ({fmtTime(livePosition, false)})</button>
        )}
        {cues.map((c, i) => c !== null && (
          <button key={`cc${i}`} className={`mpe-chip mpe-chip--cue ${Math.abs(value - c) < 0.15 ? 'active' : ''}`} onClick={() => set(c)}>
            Cue {i + 1} · {fmtTime(c, false)}
          </button>
        ))}
        {sections.map((s, i) => (
          <button key={`sc${i}`} className={`mpe-chip ${Math.abs(value - s.startTime) < 0.15 ? 'active' : ''}`} onClick={() => set(s.startTime)}>
            {s.type} · {fmtTime(s.startTime, false)}
          </button>
        ))}
      </div>

      {lyrics.length > 0 && (
        <details className="mpe-lyrics">
          <summary>Elegir por la letra</summary>
          <div className="mpe-lyrics-list">
            {lyrics.map((l, i) => {
              const on = Math.abs(value - l.time) < 0.2;
              return (
                <button key={i} className={on ? 'active' : ''} onClick={() => set(l.time)}>
                  <span>{fmtTime(l.time, false)}</span>{l.text}
                </button>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
