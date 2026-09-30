import { useState, useEffect } from 'react';
import { usePlayerStore, type CrossfadeCurve, NEUTRAL_DJ_FX, isNeutralFx, type DjFxSnapshot } from '../../store/playerStore';
import { useRef } from 'react';
import { getLyrics, getStreamUrl, type Track } from '../../lib/api';
import MixPointEditor, { fmtTime } from './MixPointEditor';
import { parseSyncedLyrics, detectLyricSections, type LyricSection, type LyricsLine } from '../../lib/lyricsParser';
import { startCrossfadePreview, computeAutoMix, type CrossfadePreviewHandle } from '../../lib/djTransition';

interface DjMixerModalProps {
  fromTrack: Track;
  toTrack: Track;
  onClose: () => void;
}

export default function DjMixerModal({ fromTrack, toTrack, onClose }: DjMixerModalProps) {
  const { transitions, setTransition, removeTransition, djFx, isDjModeActive, setDjFx, cuesByTrack } = usePlayerStore();
  const currentId = usePlayerStore((st) => st.currentTrack?.id);
  const liveProgress = usePlayerStore((st) => st.progress);
  const liveDuration = usePlayerStore((st) => st.duration);
  const existingRule = transitions[`${fromTrack.id}-${toTrack.id}`];

  const [loading, setLoading] = useState(true);
  const [fromSections, setFromSections] = useState<LyricSection[]>([]);
  const [toSections, setToSections] = useState<LyricSection[]>([]);
  const [fromLyrics, setFromLyrics] = useState<LyricsLine[]>([]);
  const [toLyrics, setToLyrics] = useState<LyricsLine[]>([]);

  const [fromTime, setFromTime] = useState<number>(existingRule?.fromTime || 0);
  const [toTime, setToTime] = useState<number>(existingRule?.toTime || 0);
  const [curve, setCurve] = useState<CrossfadeCurve>(existingRule?.curve || 'linear');
  const [duration, setDuration] = useState<number>(existingRule?.duration || 4);
  const [fadeOutPercent, setFadeOutPercent] = useState<number>(existingRule?.fadeOutPercent ?? 0);
  const [fadeOutDuration, setFadeOutDuration] = useState<number>(existingRule?.fadeOutDuration ?? 2);
  const [fadeInPercent, setFadeInPercent] = useState<number>(existingRule?.fadeInPercent ?? 0);
  const [fadeInDuration, setFadeInDuration] = useState<number>(existingRule?.fadeInDuration ?? 2);
  // Efectos de la mezcla: los guardados, o los que suenan ahora en Modo DJ
  const [fx, setFx] = useState<DjFxSnapshot>(existingRule?.fx ?? (isDjModeActive ? djFx : NEUTRAL_DJ_FX));
  const updateFx = (partial: Partial<DjFxSnapshot>) => {
    const next = { ...fx, ...partial };
    setFx(next);
    // En Modo DJ se oye al momento sobre lo que suena
    if (isDjModeActive) setDjFx(partial);
  };

  const [isPreviewing, setIsPreviewing] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const previewRef = useRef<CrossfadePreviewHandle | null>(null);

  // La duración de Track llega en ms o en s según el origen; si la pista es
  // la que suena, la del reproductor es la fiable. Si no se sabe, se mide.
  const guessLen = (t: Track) => {
    if (t.id === currentId && liveDuration > 0) return liveDuration;
    if (!t.duration) return 0;
    return t.duration > 10000 ? t.duration / 1000 : t.duration;
  };
  const [lenA, setLenA] = useState(() => guessLen(fromTrack));
  const [lenB, setLenB] = useState(() => guessLen(toTrack));
  useEffect(() => {
    const probes: HTMLAudioElement[] = [];
    const probe = (t: Track, setLen: (n: number) => void) => {
      const a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = () => { if (isFinite(a.duration) && a.duration > 0) setLen(a.duration); a.src = ''; };
      a.src = getStreamUrl(t.id);
      probes.push(a);
    };
    if (!lenA) probe(fromTrack, setLenA);
    if (!lenB) probe(toTrack, setLenB);
    return () => probes.forEach((a) => { a.onloadedmetadata = null; a.src = ''; });
  }, [fromTrack.id, toTrack.id]);
  const lengthA = lenA || 300;
  const lengthB = lenB || 300;

  const auditionRef = useRef<{ audio: HTMLAudioElement; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [auditioning, setAuditioning] = useState<'out' | 'in' | null>(null);
  const stopAudition = () => {
    if (auditionRef.current) {
      clearTimeout(auditionRef.current.timer);
      auditionRef.current.audio.pause();
      auditionRef.current.audio.src = '';
      auditionRef.current = null;
    }
    setAuditioning(null);
  };
  const audition = (side: 'out' | 'in') => {
    const same = auditioning === side;
    stopAudition();
    stopPreview();
    if (same) return;
    usePlayerStore.getState().setIsPlaying(false);
    const t = side === 'out' ? fromTrack : toTrack;
    // Salida: se oye un poco antes para notar el corte; entrada: desde el punto
    const start = side === 'out' ? Math.max(0, fromTime - 4) : toTime;
    const secs = side === 'out' ? 4 + Math.min(duration, 6) : 7;
    const a = new Audio(getStreamUrl(t.id));
    a.playbackRate = fx.slowedRate;
    a.preservesPitch = Math.abs(fx.slowedRate - 1) < 0.01;
    a.onloadedmetadata = () => {
      if (isFinite(a.duration) && a.duration > 0) (side === 'out' ? setLenA : setLenB)(a.duration);
      a.currentTime = start;
      a.play().catch(() => stopAudition());
    };
    auditionRef.current = { audio: a, timer: setTimeout(stopAudition, (secs / fx.slowedRate) * 1000 + 1500) };
    setAuditioning(side);
  };
  useEffect(() => () => stopAudition(), []);

  const stopPreview = () => {
    previewRef.current?.stop();
    previewRef.current = null;
    setIsPreviewing(false);
  };

  useEffect(() => {
    return () => stopPreview();
  }, []);

  const playPreview = () => {
    if (isPreviewing) {
      stopPreview();
      return;
    }

    // Pause main player if it was playing to avoid cacophony
    usePlayerStore.getState().setIsPlaying(false);
    stopAudition();

    setIsPreviewing(true);
    previewRef.current = startCrossfadePreview(fromTrack, toTrack, { fromTime, toTime, curve, duration, fx }, () => {
      previewRef.current = null;
      setIsPreviewing(false);
    });
  };

  useEffect(() => {
    async function load() {
      try {
        const results = await Promise.allSettled([
          getLyrics(fromTrack.id),
          getLyrics(toTrack.id)
        ]);
        const l1 = results[0].status === 'fulfilled' ? results[0].value : null;
        const l2 = results[1].status === 'fulfilled' ? results[1].value : null;
        
        if (l1?.syncedLyrics) {
          const parsed = parseSyncedLyrics(l1.syncedLyrics);
          setFromLyrics(parsed);
          const secs = detectLyricSections(parsed);
          setFromSections(secs);
          if (!existingRule && secs.length > 0) {
             const outro = secs[secs.length - 1];
             setFromTime(outro.startTime);
          }
        }
        if (l2?.syncedLyrics) {
          const parsed = parseSyncedLyrics(l2.syncedLyrics);
          setToLyrics(parsed);
          const secs = detectLyricSections(parsed);
          setToSections(secs);
          if (!existingRule && secs.length > 0) {
             setToTime(secs[0].startTime);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fromTrack.id, toTrack.id, existingRule]);

  const fadeOverflows = fromTime + duration > lengthA + 0.05;
  const handleSave = () => {
    const safeFrom = lenA ? Math.max(0, Math.min(fromTime, lenA - duration)) : fromTime;
    setTransition({
      fromTrackId: fromTrack.id,
      toTrackId: toTrack.id,
      fromTime: Math.round(safeFrom * 10) / 10,
      toTime: Math.round(Math.min(toTime, Math.max(0, lengthB - 1)) * 10) / 10,
      curve,
      duration,
      fadeOutPercent: fadeOutPercent > 0 ? fadeOutPercent : undefined,
      fadeOutDuration: fadeOutPercent > 0 ? Math.min(fadeOutDuration, duration) : undefined,
      fadeInPercent: fadeInPercent > 0 ? fadeInPercent : undefined,
      fadeInDuration: fadeInPercent > 0 ? Math.min(fadeInDuration, duration) : undefined,
      fx: isNeutralFx(fx) ? undefined : fx,
    });
    onClose();
  };

  const handleRemove = () => {
    removeTransition(fromTrack.id, toTrack.id);
    onClose();
  };

  const formatSecs = (s: number) => {
     const m = Math.floor(s / 60);
     const sec = Math.floor(s % 60);
     return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 100000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 12px', overflowY: 'auto' }}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', padding: '24px 20px', width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Mezcla de DJ (Transición)</h2>
          <button 
            onClick={async () => {
               setAutoBusy(true);
               try {
                 const r = await computeAutoMix({ ...fromTrack, duration: lengthA * 1000 }, toTrack);
                 setFromTime(Math.round(r.fromTime * 10) / 10);
                 setToTime(Math.round(r.toTime * 10) / 10);
                 setCurve(r.curve);
                 setDuration(r.duration);
               } finally {
                 setAutoBusy(false);
               }
            }}
            disabled={autoBusy}
            style={{ padding: '8px 16px', borderRadius: 'var(--radius-full)', background: 'linear-gradient(135deg, var(--accent), var(--accent-bright))', color: '#000', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 4px 12px rgba(29, 185, 84, 0.3)' }}
            title="Ajustar tiempos automáticamente basándose en las secciones detectadas"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 3H3v18h18V3zm-10 8H9V9H7v2H5v2h2v2h2v-2h2v-2zM15 15h-2v2h-2v-2H9v-2h2v-2h2v2h2v2z"/>
            </svg>
            {autoBusy ? 'Calculando…' : 'Auto-Mix Perfecto'}
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>Analizando secciones musicales...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <MixPointEditor
              side="out"
              title={fromTrack.title}
              cover={fromTrack.cover}
              value={fromTime}
              onChange={setFromTime}
              length={lengthA}
              fadeLength={duration}
              sections={fromSections}
              lyrics={fromLyrics}
              cues={cuesByTrack[fromTrack.id]?.hotCues ?? []}
              livePosition={currentId === fromTrack.id ? liveProgress : null}
              onAudition={() => audition('out')}
              auditioning={auditioning === 'out'}
            />

            {/* Resumen de la transición */}
            <div className="mix-summary">
              <div><strong>{fmtTime(fromTime)}</strong> {fromTrack.title} empieza a desaparecer</div>
              <div className="mix-summary-arrow">⇣ fundido de {duration}s{fx && Math.abs(fx.slowedRate - 1) >= 0.005 ? ` · ${fx.slowedRate.toFixed(2)}x` : ''}</div>
              <div><strong>{fmtTime(toTime)}</strong> {toTrack.title} entra y queda sola en <strong>{fmtTime(toTime + duration)}</strong></div>
              {fadeOverflows && <div className="mix-summary-warn">Al guardar, la salida se adelantará a {fmtTime(Math.max(0, lengthA - duration))} para que el fundido quepa.</div>}
            </div>

            <MixPointEditor
              side="in"
              title={toTrack.title}
              cover={toTrack.cover}
              value={toTime}
              onChange={setToTime}
              length={lengthB}
              fadeLength={duration}
              sections={toSections}
              lyrics={toLyrics}
              cues={cuesByTrack[toTrack.id]?.hotCues ?? []}
              livePosition={currentId === toTrack.id ? liveProgress : null}
              onAudition={() => audition('in')}
              auditioning={auditioning === 'in'}
            />

            {/* Controles de Curva */}
            <div style={{ background: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 12, marginTop: 8 }}>
               <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Curva de Transición</div>
               
               <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                  {['linear', 'exponential', 'logarithmic', 's-curve'].map(c => (
                     <button
                        key={c}
                        onClick={() => setCurve(c as CrossfadeCurve)}
                        style={{
                           flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer',
                           background: curve === c ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                           color: curve === c ? '#000' : '#fff'
                        }}
                     >
                        {c === 'linear' ? 'Lineal' : c === 'exponential' ? 'Exponencial' : c === 'logarithmic' ? 'Logarítmica' : 'S-Curve'}
                     </button>
                  ))}
               </div>

               <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Duración del Crossfade</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{duration}s</span>
               </div>
               <input 
                 type="range" 
                 min="1" max="15" step="0.5" 
                 value={duration} 
                 onChange={e => setDuration(Number(e.target.value))} 
                 style={{ width: '100%', marginBottom: 16 }}
               />

               {/* Volume Fades */}
               <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 16, marginTop: 16 }}>
                 <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--text-secondary)' }}>Fades de Volumen</div>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                   {/* Fade Out */}
                   <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px' }}>
                     <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                       <span>Bajar volumen</span><span style={{ fontWeight: 700, color: '#fff' }}>{fadeOutPercent}%</span>
                     </div>
                     <input type="range" min="0" max="80" step="5" value={fadeOutPercent}
                       onChange={e => setFadeOutPercent(Number(e.target.value))} style={{ width: '100%', marginBottom: 8 }} />
                     <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                       <span>Durante</span><span style={{ fontWeight: 700, color: '#fff' }}>{Math.min(fadeOutDuration, duration)}s</span>
                     </div>
                     <input type="range" min="0.5" max={Math.max(0.5, duration)} step="0.5" value={Math.min(fadeOutDuration, duration)}
                       onChange={e => setFadeOutDuration(Number(e.target.value))} style={{ width: '100%' }}
                       disabled={fadeOutPercent === 0} />
                   </div>

                   {/* Fade In */}
                   <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px' }}>
                     <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>🔊 Fade In (Track Entrante)</div>
                     <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                       <span>Iniciar volumen en</span><span style={{ fontWeight: 700, color: '#fff' }}>{100 - fadeInPercent}%</span>
                     </div>
                     <input type="range" min="0" max="80" step="5" value={fadeInPercent}
                       onChange={e => setFadeInPercent(Number(e.target.value))} style={{ width: '100%', marginBottom: 8 }} />
                     <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                       <span>Durante</span><span style={{ fontWeight: 700, color: '#fff' }}>{Math.min(fadeInDuration, duration)}s</span>
                     </div>
                     <input type="range" min="0.5" max={Math.max(0.5, duration)} step="0.5" value={Math.min(fadeInDuration, duration)}
                       onChange={e => setFadeInDuration(Number(e.target.value))} style={{ width: '100%' }}
                       disabled={fadeInPercent === 0} />
                   </div>
                 </div>
               </div>

               {/* Efectos guardados con la mezcla */}
               <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 16, marginTop: 16 }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                   <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Efectos de la mezcla</span>
                   {!isNeutralFx(fx) && (
                     <button onClick={() => updateFx(NEUTRAL_DJ_FX)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>Quitar efectos</button>
                   )}
                 </div>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px' }}>
                   {[
                     { key: 'slowedRate' as const, label: 'Slowed', min: 0.7, max: 1.15, step: 0.01, fmt: (v: number) => `${v.toFixed(2)}x` },
                     { key: 'reverbAmount' as const, label: 'Reverb / Eco', min: 0, max: 1, step: 0.01, fmt: (v: number) => `${Math.round(v * 100)}%` },
                     { key: 'filterCutoff' as const, label: 'Filtro', min: 200, max: 20000, step: 100, fmt: (v: number) => (v >= 20000 ? 'Off' : `${(v / 1000).toFixed(1)}kHz`) },
                   ].map(c => (
                     <div key={c.key}>
                       <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                         <span>{c.label}</span><span style={{ fontWeight: 700, color: '#fff' }}>{c.fmt(fx[c.key])}</span>
                       </div>
                       <input type="range" min={c.min} max={c.max} step={c.step} value={fx[c.key]}
                         onChange={e => updateFx({ [c.key]: Number(e.target.value) })} style={{ width: '100%' }} />
                     </div>
                   ))}
                   <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                     Se guardan con la mezcla y se aplican cada vez que suene. {isDjModeActive ? 'Parten de los efectos que tienes puestos ahora.' : ''}
                   </div>
                 </div>
               </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
               <button 
                 onClick={playPreview} 
                 style={{ 
                    padding: '10px 24px', borderRadius: 8, border: 'none', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    background: isPreviewing ? 'rgba(255,255,255,0.1)' : 'rgba(29, 185, 84, 0.2)',
                    color: isPreviewing ? '#fff' : 'var(--accent)'
                 }}
               >
                 {isPreviewing ? (
                    <>
                       <div className="wave-bars" style={{ display: 'flex', gap: 2, height: 12, alignItems: 'flex-end' }}>
                          <div style={{ width: 3, background: 'currentColor', animation: 'bounce 0.5s infinite alternate' }} />
                          <div style={{ width: 3, background: 'currentColor', animation: 'bounce 0.5s infinite alternate 0.2s' }} />
                          <div style={{ width: 3, background: 'currentColor', animation: 'bounce 0.5s infinite alternate 0.4s' }} />
                       </div>
                       Detener
                    </>
                 ) : (
                    <>
                       <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                       Escuchar Preview
                    </>
                 )}
               </button>
               {existingRule && (
                 <button onClick={handleRemove} style={{ padding: '10px 24px', borderRadius: 8, background: 'rgba(255,60,60,0.15)', color: '#ff4444', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                   Eliminar
                 </button>
               )}
               <button onClick={onClose} style={{ padding: '10px 24px', borderRadius: 8, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', fontWeight: 600, cursor: 'pointer' }}>
                 Cancelar
               </button>
               <button onClick={handleSave} style={{ padding: '10px 24px', borderRadius: 8, background: 'var(--accent)', color: '#000', border: 'none', fontWeight: 600, cursor: 'pointer' }}>
                 Guardar Mezcla
               </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
