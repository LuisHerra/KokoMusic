import { useState, useEffect, useRef, useMemo } from 'react';
import { usePlayerStore, type TransitionRule } from '../store/playerStore';
import { seekAudio } from '../hooks/useAudioPlayer';
import { resolveImageUrl, getTrack, type Track } from '../lib/api';
import { IconPlay, IconPause, IconNext, IconMusic } from '../components/Player/PlayerIcons';
import DjMixerModal from '../components/Player/DjMixerModal';
import { computeAutoMix, startCrossfadePreview, type CrossfadePreviewHandle } from '../lib/djTransition';

function formatTime(secs: number): string {
  if (!isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Extrae el color medio de una portada para usarlo como resplandor del deck. */
function useDominantColor(coverUrl?: string): string {
  const [color, setColor] = useState('#1DB954');

  useEffect(() => {
    if (!coverUrl) return;
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 32, 32);
      try {
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
          if (avg > 20 && avg < 240) {
            r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
          }
        }
        if (count > 0) {
          const toHex = (n: number) => Math.round(n / count).toString(16).padStart(2, '0');
          setColor(`#${toHex(r)}${toHex(g)}${toHex(b)}`);
        }
      } catch {
        // getImageData puede fallar si la imagen no permite CORS — nos quedamos con el color por defecto
      }
    };
    img.src = coverUrl;
  }, [coverUrl]);

  return color;
}

function pairKey(fromId: string, toId: string): string {
  return `${fromId}-${toId}`;
}

/** Portada con fallback — algunas pistas (p.ej. recomendaciones) no traen `cover`,
 * y un <img src=""> muestra el icono roto nativo del navegador en vez de nada. */
function CoverThumb({ cover, className, iconSize = 20 }: { cover?: string; className: string; iconSize?: number }) {
  if (!cover) {
    return (
      <div className={`${className}-placeholder`}>
        <IconMusic size={iconSize} />
      </div>
    );
  }
  return <img className={className} src={resolveImageUrl(cover)} alt="" />;
}

export default function DjMode() {
  const {
    currentTrack,
    queue,
    queueIndex,
    isPlaying,
    progress,
    duration,
    setIsPlaying,
    nextTrack,
    setTrack,
    transitions,
    removeTransition,
    setTransition,
  } = usePlayerStore();

  const defaultDeckB = queue.length > 0 && queueIndex < queue.length - 1 ? queue[queueIndex + 1] : null;
  const [deckBId, setDeckBId] = useState<string | null>(null);
  const [showDeckBPicker, setShowDeckBPicker] = useState(false);
  const deckBTrack: Track | null = (deckBId ? queue.find(t => t.id === deckBId) : null) ?? defaultDeckB;

  const [showMixer, setShowMixer] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isAutoMixing, setIsAutoMixing] = useState(false);
  const previewRef = useRef<CrossfadePreviewHandle | null>(null);
  const autoMixedPairs = useRef<Set<string>>(new Set());

  const currentPairKey = currentTrack && deckBTrack ? pairKey(currentTrack.id, deckBTrack.id) : null;
  const currentRule: TransitionRule | undefined = currentPairKey ? transitions[currentPairKey] : undefined;

  // "Auto-Mix Perfecto" automático: en cuanto hay una pareja A→B válida sin
  // transición configurada, se genera una automáticamente (una sola vez por
  // pareja — si el usuario la borra a propósito no se vuelve a regenerar sola).
  useEffect(() => {
    if (!currentTrack || !deckBTrack || !currentPairKey) return;
    if (transitions[currentPairKey] || autoMixedPairs.current.has(currentPairKey)) return;

    autoMixedPairs.current.add(currentPairKey);
    setIsAutoMixing(true);
    computeAutoMix(currentTrack, deckBTrack)
      .then((result) => {
        setTransition({
          fromTrackId: currentTrack.id,
          toTrackId: deckBTrack.id,
          ...result,
        });
      })
      .catch(() => {})
      .finally(() => setIsAutoMixing(false));
  }, [currentTrack, deckBTrack, currentPairKey, transitions, setTransition]);

  useEffect(() => {
    return () => { previewRef.current?.stop(); };
  }, []);

  const stopPreview = () => {
    previewRef.current?.stop();
    previewRef.current = null;
    setIsPreviewing(false);
  };

  const togglePreview = () => {
    if (isPreviewing) {
      stopPreview();
      return;
    }
    if (!currentTrack || !deckBTrack || !currentRule) return;
    setIsPlaying(false);
    setIsPreviewing(true);
    previewRef.current = startCrossfadePreview(currentTrack, deckBTrack, currentRule, () => {
      previewRef.current = null;
      setIsPreviewing(false);
    });
  };

  const handleRemoveTransition = () => {
    if (!currentTrack || !deckBTrack) return;
    stopPreview();
    removeTransition(currentTrack.id, deckBTrack.id);
  };

  const progressPct = duration > 0 ? (progress / duration) * 100 : 0;

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    seekAudio(ratio * duration);
  };

  const deckAColor = useDominantColor(currentTrack ? resolveImageUrl(currentTrack.cover) : undefined);
  const deckBColor = useDominantColor(deckBTrack ? resolveImageUrl(deckBTrack.cover) : undefined);

  // Biblioteca de mezclas: las transiciones son globales y permanentes (se
  // aplican solas en cualquier cola futura donde ese par vuelva a sonar
  // seguido), así que aquí cargamos los datos de CUALQUIER pista referenciada
  // por una transición guardada, aunque ya no esté en la cola actual.
  const [trackCache, setTrackCache] = useState<Record<string, Track>>({});
  const fetchingIds = useRef<Set<string>>(new Set());

  const resolveTrack = (id: string): Track | undefined =>
    queue.find(t => t.id === id) ?? trackCache[id];

  useEffect(() => {
    const missingIds = new Set<string>();
    Object.values(transitions).forEach((rule) => {
      [rule.fromTrackId, rule.toTrackId].forEach((id) => {
        if (!resolveTrack(id) && !fetchingIds.current.has(id)) missingIds.add(id);
      });
    });
    if (missingIds.size === 0) return;

    missingIds.forEach((id) => {
      fetchingIds.current.add(id);
      getTrack(id)
        .then((track) => setTrackCache(prev => ({ ...prev, [id]: track })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transitions, queue]);

  // Todas las mezclas guardadas, salvo la pareja A→B que ya se muestra arriba en el conector.
  const savedTransitions = useMemo(() => Object.values(transitions).filter((rule) => {
    if (rule.fromTrackId === currentTrack?.id && rule.toTrackId === deckBTrack?.id) return false;
    return Boolean(resolveTrack(rule.fromTrackId) && resolveTrack(rule.toTrackId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [transitions, queue, trackCache, currentTrack?.id, deckBTrack?.id]);

  const loadPairIntoQueue = (from: Track, to: Track) => {
    setTrack(from, [from, to]);
  };

  const MIXES_PAGE_SIZE = 5;
  const [mixesPage, setMixesPage] = useState(0);
  const totalMixesPages = Math.max(1, Math.ceil(savedTransitions.length / MIXES_PAGE_SIZE));
  const safeMixesPage = Math.min(mixesPage, totalMixesPages - 1);
  const pagedTransitions = savedTransitions.slice(
    safeMixesPage * MIXES_PAGE_SIZE,
    (safeMixesPage + 1) * MIXES_PAGE_SIZE
  );

  return (
    <div className="dj-page">
      <div className="dj-decks">
        {/* Deck A — pista actual, real */}
        <div className="dj-deck" style={{ boxShadow: `0 8px 40px ${deckAColor}4d` }}>
          <span className="dj-deck-label">Sonando ahora</span>
          <CoverThumb cover={currentTrack?.cover} className="dj-deck-cover" iconSize={40} />
          <div className="dj-deck-info">
            <h3>{currentTrack?.title || 'Sin pista cargada'}</h3>
            <p>{currentTrack?.artist || 'Reproduce algo para empezar'}</p>
          </div>

          <div className="dj-progress-bar">
            <span className="dj-progress-time">{formatTime(progress)}</span>
            <div className="dj-progress-track" onClick={handleProgressClick}>
              <div className="dj-progress-fill" style={{ width: `${progressPct}%` }}>
                <div className="dj-progress-thumb" />
              </div>
            </div>
            <span className="dj-progress-time right">{formatTime(duration)}</span>
          </div>

          <button className="dj-play-btn" onClick={() => setIsPlaying(!isPlaying)} disabled={!currentTrack}>
            {isPlaying ? <IconPause size={22} /> : <IconPlay size={22} />}
          </button>
        </div>

        {/* Conector — estado de la transición real entre A y B */}
        <div className="dj-transition-connector">
          <span className="dj-transition-status">
            {isAutoMixing ? 'Generando mezcla…' : currentRule ? 'Transición lista' : 'Sin transición'}
          </span>
          <div className="dj-transition-actions">
            <button
              className="dj-transition-action-btn"
              onClick={togglePreview}
              disabled={!currentRule}
              title="Escuchar preview"
            >
              {isPreviewing ? <IconPause size={16} /> : <IconPlay size={16} />}
            </button>
            <button
              className="dj-transition-action-btn"
              onClick={() => setShowMixer(true)}
              disabled={!currentTrack || !deckBTrack}
              title="Modificar transición"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z" />
              </svg>
            </button>
            <button
              className="dj-transition-action-btn danger"
              onClick={handleRemoveTransition}
              disabled={!currentRule}
              title="Eliminar transición"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Deck B — pista elegida (por defecto, la siguiente de la cola) */}
        <div className="dj-deck dj-deck-b" style={{ boxShadow: `0 8px 40px ${deckBColor}4d` }}>
          <div className="dj-deck-b-header">
            <span className="dj-deck-label">{deckBId ? 'Deck B' : 'Siguiente en la cola'}</span>
            {queue.length > 1 && (
              <button className="dj-deckb-change-btn" onClick={() => setShowDeckBPicker(p => !p)}>
                Cambiar
              </button>
            )}
          </div>

          {showDeckBPicker && (
            <div className="dj-deckb-picker">
              {queue.filter(t => t.id !== currentTrack?.id).map((t) => (
                <button
                  key={t.id}
                  className={`dj-deckb-picker-item ${deckBTrack?.id === t.id ? 'active' : ''}`}
                  onClick={() => {
                    setDeckBId(t.id === defaultDeckB?.id ? null : t.id);
                    setShowDeckBPicker(false);
                  }}
                >
                  <CoverThumb cover={t.cover} className="dj-deckb-picker-item-cover" iconSize={16} />
                  <div>
                    <div className="dj-deckb-picker-title">{t.title}</div>
                    <div className="dj-deckb-picker-artist">{t.artist}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <CoverThumb cover={deckBTrack?.cover} className="dj-deck-cover" iconSize={40} />
          <div className="dj-deck-info">
            <h3>{deckBTrack?.title || 'Cola vacía'}</h3>
            <p>{deckBTrack?.artist || 'Añade canciones a la cola'}</p>
          </div>

          <button
            className="dj-skip-btn"
            onClick={() => (deckBId ? null : nextTrack())}
            disabled={!deckBTrack || Boolean(deckBId)}
            title={deckBId ? 'Solo disponible para la siguiente pista real de la cola' : undefined}
          >
            <IconNext size={16} />
            Saltar a esta pista
          </button>
        </div>
      </div>

      {savedTransitions.length > 0 && (
        <div className="dj-transitions-panel">
          <h2>Tus mezclas guardadas</h2>
          {pagedTransitions.map((rule) => {
            const from = resolveTrack(rule.fromTrackId);
            const to = resolveTrack(rule.toTrackId);
            if (!from || !to) return null;
            return (
              <div key={pairKey(rule.fromTrackId, rule.toTrackId)} className="dj-transition-row">
                <div className="dj-transition-row-tracks">
                  <div className="dj-transition-row-track">
                    <CoverThumb cover={from.cover} className="dj-transition-row-cover" iconSize={14} />
                    <span className="dj-transition-row-title">{from.title}</span>
                  </div>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="dj-transition-row-arrow">
                    <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
                  </svg>
                  <div className="dj-transition-row-track">
                    <CoverThumb cover={to.cover} className="dj-transition-row-cover" iconSize={14} />
                    <span className="dj-transition-row-title">{to.title}</span>
                  </div>
                </div>
                <div className="dj-transition-row-actions">
                  <button
                    className="dj-transition-action-btn"
                    onClick={() => {
                      stopPreview();
                      setIsPlaying(false);
                      setIsPreviewing(true);
                      previewRef.current = startCrossfadePreview(from, to, rule, () => {
                        previewRef.current = null;
                        setIsPreviewing(false);
                      });
                    }}
                    title="Escuchar preview"
                  >
                    <IconPlay size={14} />
                  </button>
                  <button
                    className="dj-transition-action-btn"
                    onClick={() => loadPairIntoQueue(from, to)}
                    title="Poner en cola y reproducir"
                  >
                    <IconNext size={14} />
                  </button>
                  <button
                    className="dj-transition-action-btn danger"
                    onClick={() => removeTransition(rule.fromTrackId, rule.toTrackId)}
                    title="Eliminar transición"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}

          {totalMixesPages > 1 && (
            <div className="dj-mixes-pagination">
              <button
                className="dj-transition-action-btn"
                onClick={() => setMixesPage(p => Math.max(0, p - 1))}
                disabled={safeMixesPage === 0}
                title="Página anterior"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                </svg>
              </button>
              <span className="dj-mixes-pagination-label">
                Página {safeMixesPage + 1} de {totalMixesPages}
              </span>
              <button
                className="dj-transition-action-btn"
                onClick={() => setMixesPage(p => Math.min(totalMixesPages - 1, p + 1))}
                disabled={safeMixesPage >= totalMixesPages - 1}
                title="Página siguiente"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      {showMixer && currentTrack && deckBTrack && (
        <DjMixerModal
          fromTrack={currentTrack}
          toTrack={deckBTrack}
          onClose={() => setShowMixer(false)}
        />
      )}
    </div>
  );
}
