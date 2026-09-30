import { useState, useEffect } from 'react';
import { usePlayerStore, type CrossfadeCurve, NEUTRAL_DJ_FX, isNeutralFx, describeFx, type DjFxSnapshot, type TransitionRule } from '../../store/playerStore';
import { useRef } from 'react';
import { getLyrics, getStreamUrl, type Track } from '../../lib/api';
import MixPointEditor, { fmtTime } from './MixPointEditor';
import { saveCollabTransition } from '../../lib/api';
import { SFX_CATALOG, SFX_AT_LABEL, playSfx, type SfxAt, type SfxId, type TransitionSfx } from '../../lib/djSfx';
import { useQueryClient } from '@tanstack/react-query';
import { IconX, IconArrowRight, IconPlay, IconStop, IconTrash, IconUsers, IconSliders, IconClock, IconCrossfade, IconSpark, IconWand, IconVolume, IconVolumeDown, IconDot, SfxIcon } from '../Common/UiIcons';
import './DjMixerModal.css';

type MixTab = 'times' | 'fade' | 'fx' | 'sfx';
import { parseSyncedLyrics, detectLyricSections, type LyricSection, type LyricsLine } from '../../lib/lyricsParser';
import { startCrossfadePreview, computeAutoMix, type CrossfadePreviewHandle } from '../../lib/djTransition';

interface DjMixerModalProps {
  fromTrack: Track;
  toTrack: Track;
  onClose: () => void;
  /** Si la mezcla es de una playlist colaborativa, se comparte con sus colaboradores */
  collabCode?: string;
}

export default function DjMixerModal({ fromTrack, toTrack, onClose, collabCode }: DjMixerModalProps) {
  const qc = useQueryClient();
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
  const [fxMode, setFxMode] = useState<'track' | 'transition'>(existingRule?.fxMode ?? 'track');
  const [fxLead, setFxLead] = useState<number>(existingRule?.fxLead ?? 2);
  const [fxHold, setFxHold] = useState<number>(existingRule?.fxHold ?? 2);
  const [sfx, setSfx] = useState<TransitionSfx[]>(existingRule?.sfx ?? []);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const addSfx = (id: SfxId) => {
    playSfx(id, 0.8);
    const at: SfxAt = id === 'riser' || id === 'reverse' ? 'before' : id === 'downlifter' ? 'end' : 'start';
    setSfx((l) => (l.length >= 8 ? l : [...l, { id, at, volume: 0.8 }]));
  };
  const updateFx = (partial: Partial<DjFxSnapshot>) => {
    const next = { ...fx, ...partial };
    setFx(next);
    // En Modo DJ se oye al momento sobre lo que suena
    if (isDjModeActive) setDjFx(partial);
  };

  const [isPreviewing, setIsPreviewing] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [tab, setTab] = useState<MixTab>('times');
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
    previewRef.current = startCrossfadePreview(fromTrack, toTrack, { fromTime, toTime, curve, duration, fx, sfx }, () => {
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
  const handleSave = async () => {
    const safeFrom = lenA ? Math.max(0, Math.min(fromTime, lenA - duration)) : fromTime;
    const rule: TransitionRule = {
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
      fxMode: isNeutralFx(fx) ? undefined : fxMode,
      fxLead: !isNeutralFx(fx) && fxMode === 'transition' ? fxLead : undefined,
      fxHold: !isNeutralFx(fx) && fxMode === 'transition' ? fxHold : undefined,
      sfx: sfx.length ? sfx : undefined,
    };
    setTransition({ ...rule, shared: !!collabCode || undefined, collabCode });
    if (collabCode) {
      setSaving(true);
      setSaveError('');
      try {
        const me = localStorage.getItem('koko_device_id') || '';
        await saveCollabTransition(collabCode, me, `${fromTrack.id}-${toTrack.id}`, rule);
        qc.invalidateQueries({ queryKey: ['collabPlaylist'] });
      } catch (e: any) {
        setSaveError(e?.message || 'No se pudo compartir la mezcla');
        setSaving(false);
        return; // queda guardada en local; se deja el modal abierto para reintentar
      }
      setSaving(false);
    }
    onClose();
  };

  const handleRemove = () => {
    removeTransition(fromTrack.id, toTrack.id);
    const code = collabCode ?? existingRule?.collabCode;
    if (code) {
      const me = localStorage.getItem('koko_device_id') || '';
      saveCollabTransition(code, me, `${fromTrack.id}-${toTrack.id}`, null)
        .then(() => qc.invalidateQueries({ queryKey: ['collabPlaylist'] }))
        .catch(() => {});
    }
    onClose();
  };

  const formatSecs = (s: number) => {
     const m = Math.floor(s / 60);
     const sec = Math.floor(s % 60);
     return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const runAutoMix = async () => {
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
  };

  const fxOn = !isNeutralFx(fx);
  const volumeOn = fadeOutPercent > 0 || fadeInPercent > 0;
  const TABS: { key: MixTab; label: string; icon: React.ReactNode; badge?: React.ReactNode }[] = [
    { key: 'times', label: 'Tiempos', icon: <IconClock size={16} />, badge: fadeOverflows ? <IconDot className="mix-tab-dot mix-tab-dot--warn" /> : undefined },
    { key: 'fade', label: 'Fundido', icon: <IconCrossfade size={16} />, badge: volumeOn ? <IconDot className="mix-tab-dot" /> : undefined },
    { key: 'fx', label: 'Efectos', icon: <IconSliders size={16} />, badge: fxOn ? <IconDot className="mix-tab-dot" /> : undefined },
    { key: 'sfx', label: 'Sonidos', icon: <IconSpark size={16} />, badge: sfx.length ? <span className="mix-tab-count">{sfx.length}</span> : undefined },
  ];
  const CURVES: { key: CrossfadeCurve; label: string; path: string }[] = [
    { key: 'linear', label: 'Lineal', path: 'M2 22 22 2' },
    { key: 'exponential', label: 'Exponencial', path: 'M2 22C14 22 20 14 22 2' },
    { key: 'logarithmic', label: 'Logarítmica', path: 'M2 22C4 10 10 2 22 2' },
    { key: 's-curve', label: 'Suave (S)', path: 'M2 22C12 22 12 2 22 2' },
  ];

  return (
    <div className="mix-overlay" onClick={onClose}>
      <div className="mix-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Mezcla de DJ">
        {/* Cabecera fija */}
        <header className="mix-head">
          <div className="mix-head-row">
            <h2>Mezcla</h2>
            <button className="mix-auto" onClick={runAutoMix} disabled={autoBusy || loading} title="Ajusta tiempos, curva y duración automáticamente">
              <IconWand size={15} />
              {autoBusy ? 'Calculando…' : 'Auto-mix'}
            </button>
            <button className="mix-icon-btn" onClick={onClose} aria-label="Cerrar"><IconX size={18} /></button>
          </div>
          <div className="mix-pair">
            <div className="mix-pair-track">
              {fromTrack.cover ? <img src={fromTrack.cover} alt="" /> : <span className="mix-pair-ph" />}
              <span>{fromTrack.title}</span>
            </div>
            <IconCrossfade size={18} className="mix-pair-arrow" />
            <div className="mix-pair-track">
              {toTrack.cover ? <img src={toTrack.cover} alt="" /> : <span className="mix-pair-ph" />}
              <span>{toTrack.title}</span>
            </div>
          </div>
          <nav className="mix-tabs" role="tablist">
            {TABS.map(t => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
                {t.icon}<span>{t.label}</span>{t.badge}
              </button>
            ))}
          </nav>
        </header>

        {/* Contenido del panel */}
        <div className="mix-body">
          {loading ? (
            <div className="mix-loading">Analizando secciones musicales…</div>
          ) : tab === 'times' ? (
            <div className="mix-panel">
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
            </div>
          ) : tab === 'fade' ? (
            <div className="mix-panel">
              <section className="mix-card">
                <h3>Curva</h3>
                <div className="mix-curves">
                  {CURVES.map(c => (
                    <button key={c.key} className={curve === c.key ? 'active' : ''} onClick={() => setCurve(c.key)}>
                      <svg width="34" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d={c.path} /></svg>
                      {c.label}
                    </button>
                  ))}
                </div>
                <div className="mix-row"><span>Duración del fundido</span><strong>{duration}s</strong></div>
                <input className="mix-range" type="range" min="1" max="15" step="0.5" value={duration} onChange={e => setDuration(Number(e.target.value))} />
              </section>

              <section className="mix-card">
                <h3><IconVolumeDown size={16} /> Salida · {fromTrack.title}</h3>
                <div className="mix-row"><span>Bajar volumen</span><strong>{fadeOutPercent}%</strong></div>
                <input className="mix-range" type="range" min="0" max="80" step="5" value={fadeOutPercent} onChange={e => setFadeOutPercent(Number(e.target.value))} />
                <div className="mix-row"><span>Durante</span><strong>{Math.min(fadeOutDuration, duration)}s</strong></div>
                <input className="mix-range" type="range" min="0.5" max={Math.max(0.5, duration)} step="0.5" value={Math.min(fadeOutDuration, duration)}
                  onChange={e => setFadeOutDuration(Number(e.target.value))} disabled={fadeOutPercent === 0} />
              </section>

              <section className="mix-card">
                <h3><IconVolume size={16} /> Entrada · {toTrack.title}</h3>
                <div className="mix-row"><span>Empieza al</span><strong>{100 - fadeInPercent}%</strong></div>
                <input className="mix-range" type="range" min="0" max="80" step="5" value={fadeInPercent} onChange={e => setFadeInPercent(Number(e.target.value))} />
                <div className="mix-row"><span>Durante</span><strong>{Math.min(fadeInDuration, duration)}s</strong></div>
                <input className="mix-range" type="range" min="0.5" max={Math.max(0.5, duration)} step="0.5" value={Math.min(fadeInDuration, duration)}
                  onChange={e => setFadeInDuration(Number(e.target.value))} disabled={fadeInPercent === 0} />
              </section>
            </div>
          ) : tab === 'fx' ? (
            <div className="mix-panel">
              <section className="mix-card">
                <div className="mix-card-head">
                  <h3>Efectos de la mezcla</h3>
                  {fxOn && <button className="mix-link" onClick={() => updateFx(NEUTRAL_DJ_FX)}>Quitar</button>}
                </div>
                {[
                  { key: 'slowedRate' as const, label: 'Slowed', min: 0.7, max: 1.15, step: 0.01, fmt: (v: number) => `${v.toFixed(2)}x` },
                  { key: 'reverbAmount' as const, label: 'Reverb / Eco', min: 0, max: 1, step: 0.01, fmt: (v: number) => `${Math.round(v * 100)}%` },
                  { key: 'filterCutoff' as const, label: 'Filtro', min: 200, max: 20000, step: 100, fmt: (v: number) => (v >= 20000 ? 'Off' : `${(v / 1000).toFixed(1)}kHz`) },
                ].map(c => (
                  <div key={c.key}>
                    <div className="mix-row"><span>{c.label}</span><strong>{c.fmt(fx[c.key])}</strong></div>
                    <input className="mix-range" type="range" min={c.min} max={c.max} step={c.step} value={fx[c.key]}
                      onChange={e => updateFx({ [c.key]: Number(e.target.value) })} />
                  </div>
                ))}
                <p className="mix-note">{isDjModeActive ? 'Parten de los efectos que tienes puestos y se oyen al moverlos.' : 'Se aplican cada vez que suene la mezcla.'}</p>
              </section>

              {fxOn && (
                <section className="mix-card">
                  <h3>¿Cuándo suenan?</h3>
                  <div className="mix-seg">
                    <button className={fxMode === 'track' ? 'active' : ''} onClick={() => setFxMode('track')}>Toda la canción</button>
                    <button className={fxMode === 'transition' ? 'active' : ''} onClick={() => setFxMode('transition')}>Solo en la transición</button>
                  </div>
                  {fxMode === 'transition' && (
                    <>
                      <div className="mix-row"><span>Entran antes del fundido</span><strong>{fxLead}s</strong></div>
                      <input className="mix-range" type="range" min="0.5" max="15" step="0.5" value={fxLead} onChange={e => setFxLead(Number(e.target.value))} />
                      <div className="mix-row"><span>Siguen después del fundido</span><strong>{fxHold}s</strong></div>
                      <input className="mix-range" type="range" min="0" max="20" step="0.5" value={fxHold} onChange={e => setFxHold(Number(e.target.value))} />
                      <p className="mix-note">
                        Activos de {fmtTime(Math.max(0, fromTime - fxLead), false)} en {fromTrack.title} hasta {fmtTime(toTime + duration + fxHold, false)} en {toTrack.title}, con entrada y salida suaves.
                      </p>
                    </>
                  )}
                </section>
              )}
            </div>
          ) : (
            <div className="mix-panel">
              <section className="mix-card">
                <h3>Añadir sonido</h3>
                <p className="mix-note" style={{ marginTop: -4 }}>Tócalo para oírlo y añadirlo a la transición.</p>
                <div className="mix-sfx-grid">
                  {SFX_CATALOG.map(sx => (
                    <button key={sx.id} className="mix-sfx-btn" onClick={() => addSfx(sx.id)} title={sx.hint} disabled={sfx.length >= 8}>
                      <SfxIcon id={sx.id} />{sx.label}
                    </button>
                  ))}
                </div>
              </section>

              {sfx.length > 0 ? (
                <section className="mix-card">
                  <h3>En esta transición</h3>
                  <div className="mix-sfx-list">
                    {sfx.map((it, i) => {
                      const meta = SFX_CATALOG.find(c => c.id === it.id)!;
                      return (
                        <div key={i} className="mix-sfx-item">
                          <button className="mix-sfx-play" onClick={() => playSfx(it.id, it.volume)} title="Oír"><SfxIcon id={it.id} size={18} /></button>
                          <div className="mix-sfx-main">
                            <div className="mix-sfx-name">{meta.label}</div>
                            <div className="mix-seg mix-seg--sm">
                              {(Object.keys(SFX_AT_LABEL) as SfxAt[]).map(at => (
                                <button key={at} className={it.at === at ? 'active' : ''} onClick={() => setSfx(l => l.map((x, j) => j === i ? { ...x, at } : x))}>{SFX_AT_LABEL[at]}</button>
                              ))}
                            </div>
                            <div className="mix-sfx-vol">
                              <IconVolumeDown size={14} />
                              <input className="mix-range" type="range" min="0.1" max="1" step="0.05" value={it.volume} aria-label="Volumen"
                                onChange={e => setSfx(l => l.map((x, j) => j === i ? { ...x, volume: Number(e.target.value) } : x))} />
                            </div>
                          </div>
                          <button className="mix-icon-btn" onClick={() => setSfx(l => l.filter((_, j) => j !== i))} aria-label="Quitar"><IconX size={16} /></button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : (
                <p className="mix-empty">Aún no hay sonidos en esta transición.</p>
              )}
            </div>
          )}
        </div>

        {/* Pie fijo: resumen + acciones */}
        <footer className="mix-foot">
          <div className="mix-summary">
            <span>Sale</span><strong>{fmtTime(fromTime)}</strong>
            <IconArrowRight size={14} />
            <span>{duration}s{fxOn ? ` · ${describeFx(fx)}` : ''}{sfx.length ? ` · ${sfx.length} ${sfx.length === 1 ? 'sonido' : 'sonidos'}` : ''}</span>
            <IconArrowRight size={14} />
            <span>Entra</span><strong>{fmtTime(toTime)}</strong>
          </div>
          {fadeOverflows && <p className="mix-warn">Al guardar, la salida se adelantará a {fmtTime(Math.max(0, lengthA - duration))} para que el fundido quepa.</p>}
          {collabCode && <p className="mix-foot-note"><IconUsers size={13} /> Se comparte con los colaboradores de la playlist.</p>}
          {saveError && <p className="mix-warn">{saveError} (guardada solo en este dispositivo)</p>}
          <div className="mix-actions">
            <button className={`mix-btn mix-btn--ghost ${isPreviewing ? 'on' : ''}`} onClick={playPreview} disabled={loading}>
              {isPreviewing ? <><IconStop size={14} /> Detener</> : <><IconPlay size={14} /> Escuchar</>}
            </button>
            {existingRule && (
              <button className="mix-btn mix-btn--danger" onClick={handleRemove} aria-label="Eliminar mezcla" title="Eliminar mezcla"><IconTrash size={16} /></button>
            )}
            <button className="mix-btn mix-btn--primary" onClick={handleSave} disabled={saving || loading}>
              {saving ? 'Compartiendo…' : collabCode ? 'Guardar y compartir' : 'Guardar'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
