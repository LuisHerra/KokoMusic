import { useState, useEffect } from 'react';
import { usePlayerStore, type CrossfadeCurve } from '../../store/playerStore';
import { useRef } from 'react';
import { getLyrics, getStreamUrl, type Track } from '../../lib/api';
import { parseSyncedLyrics, detectLyricSections, type LyricSection, type LyricsLine } from '../../lib/lyricsParser';

interface DjMixerModalProps {
  fromTrack: Track;
  toTrack: Track;
  onClose: () => void;
}

export default function DjMixerModal({ fromTrack, toTrack, onClose }: DjMixerModalProps) {
  const { transitions, setTransition, removeTransition } = usePlayerStore();
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

  const [isPreviewing, setIsPreviewing] = useState(false);
  const previewRef = useRef<{ audio1: HTMLAudioElement, audio2: HTMLAudioElement, timeout: any, interval: any } | null>(null);

  const stopPreview = () => {
    if (previewRef.current) {
        previewRef.current.audio1.pause();
        previewRef.current.audio2.pause();
        clearTimeout(previewRef.current.timeout);
        clearInterval(previewRef.current.interval);
        previewRef.current.audio1.src = '';
        previewRef.current.audio2.src = '';
        previewRef.current = null;
    }
    setIsPreviewing(false);
  };

  useEffect(() => {
    return () => stopPreview();
  }, []);

  function getFadeRatio(ratio: number, c: CrossfadeCurve) {
    switch (c) {
      case 'exponential': return Math.pow(ratio, 2);
      case 'logarithmic': return Math.log10(1 + 9 * ratio);
      case 's-curve': return ratio * ratio * (3 - 2 * ratio);
      case 'linear':
      default: return ratio;
    }
  }

  const playPreview = () => {
    if (isPreviewing) {
        stopPreview();
        return;
    }
    
    // Pause main player if it was playing to avoid cacophony
    usePlayerStore.getState().setIsPlaying(false);
    
    const a1 = new Audio(getStreamUrl(fromTrack.id));
    const a2 = new Audio(getStreamUrl(toTrack.id));
    
    const preRoll = 3;
    const startA1 = Math.max(0, fromTime - preRoll);
    a1.currentTime = startA1;
    a1.volume = 1;
    a2.currentTime = toTime;
    a2.volume = 0;
    
    setIsPreviewing(true);
    
    const onCanPlay = () => {
       a1.play().catch(e => { console.error(e); stopPreview(); });
       const actualPreRoll = fromTime - startA1;
       
       const timeout = setTimeout(() => {
           a2.play().catch(console.error);
           let step = 0;
           const steps = 20;
           const stepTime = (duration * 1000) / steps;
           
           const interval = setInterval(() => {
               step++;
               const ratioIn = getFadeRatio(step / steps, curve);
               a1.volume = Math.max(0, 1 - ratioIn);
               a2.volume = Math.min(1, ratioIn);
               
               if (step >= steps) {
                   clearInterval(interval);
                   a1.pause();
                   setTimeout(() => stopPreview(), 3000);
               }
           }, stepTime);
           
           if (previewRef.current) previewRef.current.interval = interval;
       }, actualPreRoll * 1000);
       
       if (previewRef.current) previewRef.current.timeout = timeout;
    };

    let canplayFired = false;
    const canPlayWrapper = () => {
       if (canplayFired) return;
       canplayFired = true;
       onCanPlay();
    };

    a1.addEventListener('canplay', canPlayWrapper, { once: true });
    if (a1.readyState >= 3) canPlayWrapper();
    
    previewRef.current = { audio1: a1, audio2: a2, timeout: null, interval: null };
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

  const handleSave = () => {
    setTransition({
      fromTrackId: fromTrack.id,
      toTrackId: toTrack.id,
      fromTime,
      toTime,
      curve,
      duration,
      fadeOutPercent: fadeOutPercent > 0 ? fadeOutPercent : undefined,
      fadeOutDuration: fadeOutPercent > 0 ? fadeOutDuration : undefined,
      fadeInPercent: fadeInPercent > 0 ? fadeInPercent : undefined,
      fadeInDuration: fadeInPercent > 0 ? fadeInDuration : undefined,
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
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 100000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ background: '#121212', borderRadius: 16, padding: 32, width: '100%', maxWidth: 600, border: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Mezcla de DJ (Transición)</h2>
          <button 
            onClick={() => {
               if (fromSections.length > 0) setFromTime(fromSections[fromSections.length - 1].startTime);
               else setFromTime((fromTrack.duration || 180000) / 1000 - 10);
               
               if (toSections.length > 0) setToTime(toSections[0].startTime);
               else setToTime(0);
               
               setCurve('s-curve');
               setDuration(8);
            }}
            style={{ padding: '8px 16px', borderRadius: 20, background: 'linear-gradient(135deg, #8b5cf6, #d946ef)', color: '#fff', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 4px 12px rgba(139, 92, 246, 0.3)' }}
            title="Ajustar tiempos automáticamente basándose en las secciones detectadas"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 3H3v18h18V3zm-10 8H9V9H7v2H5v2h2v2h2v-2h2v-2zM15 15h-2v2h-2v-2H9v-2h2v-2h2v2h2v2z"/>
            </svg>
            Auto-Mix Perfecto
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>Analizando secciones musicales...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Track 1 */}
            <div>
               <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <img src={fromTrack.cover} alt="" style={{ width: 40, height: 40, borderRadius: 4 }} />
                  <div>
                     <div style={{ fontSize: 14, fontWeight: 600 }}>{fromTrack.title}</div>
                     <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Punto de salida (Fade Out)</div>
                  </div>
               </div>
               
               {fromSections.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                     {fromSections.map((sec, i) => (
                        <button 
                          key={i} 
                          onClick={() => setFromTime(sec.startTime)}
                          style={{ 
                             background: fromTime === sec.startTime ? 'var(--accent)' : 'rgba(255,255,255,0.1)', 
                             color: fromTime === sec.startTime ? '#000' : '#fff',
                             border: 'none', borderRadius: 16, padding: '6px 12px', fontSize: 13, cursor: 'pointer', fontWeight: 600
                          }}
                        >
                           {sec.type} ({formatSecs(sec.startTime)})
                        </button>
                     ))}
                  </div>
               )}
               <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <input type="range" min="0" max={fromTrack.duration ? fromTrack.duration / 1000 : 300} step="0.1" value={fromTime} onChange={e => setFromTime(Number(e.target.value))} style={{ flex: 1 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, width: 48, textAlign: 'right' }}>{formatSecs(fromTime)}</span>
               </div>
               
               {fromLyrics.length > 0 && (
                  <details style={{ marginTop: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 8, overflow: 'hidden' }}>
                     <summary style={{ padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', outline: 'none', userSelect: 'none' }}>Ver todas las letras para seleccionar con precisión</summary>
                     <div style={{ maxHeight: 150, overflowY: 'auto', padding: '0 8px 8px 8px' }}>
                        {fromLyrics.map((line, i) => (
                           <div 
                              key={i} 
                              onClick={() => setFromTime(line.time)}
                              style={{ 
                                 padding: '6px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 13,
                                 background: Math.abs(fromTime - line.time) < 0.2 ? 'var(--accent)' : 'transparent',
                                 color: Math.abs(fromTime - line.time) < 0.2 ? '#000' : 'var(--text-secondary)',
                                 fontWeight: Math.abs(fromTime - line.time) < 0.2 ? 600 : 400
                              }}
                           >
                              <span style={{ opacity: 0.6, marginRight: 12, display: 'inline-block', width: 36 }}>{formatSecs(line.time)}</span>
                              {line.text}
                           </div>
                        ))}
                     </div>
                  </details>
               )}
            </div>

            {/* Icono Conector */}
            <div style={{ display: 'flex', justifyContent: 'center', opacity: 0.5 }}>
               <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 1l-1.5 1.5 5 5H2v2h17.5l-5 5L16 16l8-7.5L16 1zM8 23l1.5-1.5-5-5H22v-2H4.5l5-5L8 8l-8 7.5L8 23z"/>
               </svg>
            </div>

            {/* Track 2 */}
            <div>
               <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <img src={toTrack.cover} alt="" style={{ width: 40, height: 40, borderRadius: 4 }} />
                  <div>
                     <div style={{ fontSize: 14, fontWeight: 600 }}>{toTrack.title}</div>
                     <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Punto de entrada (Fade In)</div>
                  </div>
               </div>
               
               {toSections.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                     {toSections.map((sec, i) => (
                        <button 
                          key={i} 
                          onClick={() => setToTime(sec.startTime)}
                          style={{ 
                             background: toTime === sec.startTime ? 'var(--accent)' : 'rgba(255,255,255,0.1)', 
                             color: toTime === sec.startTime ? '#000' : '#fff',
                             border: 'none', borderRadius: 16, padding: '6px 12px', fontSize: 13, cursor: 'pointer', fontWeight: 600
                          }}
                        >
                           {sec.type} ({formatSecs(sec.startTime)})
                        </button>
                     ))}
                  </div>
               )}
               <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <input type="range" min="0" max={toTrack.duration ? toTrack.duration / 1000 : 300} step="0.1" value={toTime} onChange={e => setToTime(Number(e.target.value))} style={{ flex: 1 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, width: 48, textAlign: 'right' }}>{formatSecs(toTime)}</span>
               </div>
               
               {toLyrics.length > 0 && (
                  <details style={{ marginTop: 12, background: 'rgba(255,255,255,0.05)', borderRadius: 8, overflow: 'hidden' }}>
                     <summary style={{ padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', outline: 'none', userSelect: 'none' }}>Ver todas las letras para seleccionar con precisión</summary>
                     <div style={{ maxHeight: 150, overflowY: 'auto', padding: '0 8px 8px 8px' }}>
                        {toLyrics.map((line, i) => (
                           <div 
                              key={i} 
                              onClick={() => setToTime(line.time)}
                              style={{ 
                                 padding: '6px 8px', cursor: 'pointer', borderRadius: 4, fontSize: 13,
                                 background: Math.abs(toTime - line.time) < 0.2 ? 'var(--accent)' : 'transparent',
                                 color: Math.abs(toTime - line.time) < 0.2 ? '#000' : 'var(--text-secondary)',
                                 fontWeight: Math.abs(toTime - line.time) < 0.2 ? 600 : 400
                              }}
                           >
                              <span style={{ opacity: 0.6, marginRight: 12, display: 'inline-block', width: 36 }}>{formatSecs(line.time)}</span>
                              {line.text}
                           </div>
                        ))}
                     </div>
                  </details>
               )}
            </div>

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
                       <span>Durante</span><span style={{ fontWeight: 700, color: '#fff' }}>{fadeOutDuration}s</span>
                     </div>
                     <input type="range" min="0.5" max="10" step="0.5" value={fadeOutDuration}
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
                       <span>Durante</span><span style={{ fontWeight: 700, color: '#fff' }}>{fadeInDuration}s</span>
                     </div>
                     <input type="range" min="0.5" max="10" step="0.5" value={fadeInDuration}
                       onChange={e => setFadeInDuration(Number(e.target.value))} style={{ width: '100%' }}
                       disabled={fadeInPercent === 0} />
                   </div>
                 </div>
               </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
               <button 
                 onClick={playPreview} 
                 style={{ 
                    padding: '10px 24px', borderRadius: 8, border: 'none', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    background: isPreviewing ? 'rgba(255,255,255,0.1)' : 'rgba(29, 185, 84, 0.2)',
                    color: isPreviewing ? '#fff' : '#1DB954'
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
