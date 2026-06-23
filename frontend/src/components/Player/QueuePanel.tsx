import { usePlayerStore } from '../../store/playerStore';
import { useState, useEffect } from 'react';
import DjMixerModal from './DjMixerModal';
import { getJamQueue, voteJamQueueItem, removeFromJamQueue, getRecommendations, type Track } from '../../lib/api';
import { useResizableRightPanel } from '../../hooks/useResizable';

function getUserId(): string {
  let id = localStorage.getItem('koko_device_id');
  if (!id) {
    id = `device_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem('koko_device_id', id);
  }
  return id;
}

export default function QueuePanel() {
  const {
    queue, queueIndex, currentTrack, isPlaying,
    isQueueOpen, toggleQueue, removeFromQueue, jumpToQueueIndex,
    activeJamCode, isJamHost, jamQueue, setJamQueue,
    autoplayEnabled, toggleAutoplay
  } = usePlayerStore();

  const [djModalTracks, setDjModalTracks] = useState<{ from: any, to: any } | null>(null);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const { startResize, isResizing } = useResizableRightPanel();
  const [autoplayRecs, setAutoplayRecs] = useState<Track[]>([]);

  // Sync votedIds with jamQueue voted properties
  useEffect(() => {
    if (jamQueue) {
      const voted = new Set(jamQueue.filter(item => item.voted).map(item => item.id));
      setVotedIds(voted);
    }
  }, [jamQueue]);

  // Fetch recommendations for queue autoplay when current track or autoplay status changes
  useEffect(() => {
    if (!currentTrack || !autoplayEnabled || activeJamCode) {
      setAutoplayRecs([]);
      return;
    }

    const loadRecs = async () => {
      try {
        const data = await getRecommendations(5, undefined, currentTrack.id);
        setAutoplayRecs(data);
      } catch (err) {
        console.error('Error fetching similar recommendations:', err);
      }
    };

    loadRecs();
  }, [currentTrack?.id, autoplayEnabled, activeJamCode]);

  // Poll Sinfonia collaborative queue when panel is open
  useEffect(() => {
    if (!isQueueOpen || !activeJamCode) return;

    const refresh = async () => {
      try {
        const q = await getJamQueue(activeJamCode);
        setJamQueue(q);
      } catch {}
    };

    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [isQueueOpen, activeJamCode, setJamQueue]);

  const handleVote = async (itemId: string) => {
    if (!activeJamCode) return;
    try {
      const { voted } = await voteJamQueueItem(activeJamCode, itemId, getUserId());
      setVotedIds(prev => {
        const next = new Set(prev);
        voted ? next.add(itemId) : next.delete(itemId);
        return next;
      });
      const q = await getJamQueue(activeJamCode);
      setJamQueue(q);
    } catch {}
  };

  const handleRemove = async (itemId: string) => {
    if (!activeJamCode) return;
    try {
      await removeFromJamQueue(activeJamCode, itemId, getUserId());
      setJamQueue(jamQueue.filter(q => q.id !== itemId));
    } catch {}
  };

  if (!isQueueOpen) return null;

  const upcoming = queue.slice(queueIndex + 1);

  return (
    <div className="queue-panel">
      <div 
        className="resize-handle"
        onMouseDown={startResize}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '4px',
          height: '100%',
          cursor: 'col-resize',
          zIndex: 100,
          backgroundColor: isResizing ? 'var(--accent)' : 'transparent',
          transition: 'background-color 0.2s',
        }}
        onMouseEnter={(e) => {
          if (!isResizing) e.currentTarget.style.backgroundColor = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          if (!isResizing) e.currentTarget.style.backgroundColor = 'transparent';
        }}
      />
      <div className="queue-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Cola de reproducción</h3>
          <button className="lyrics-close-btn" onClick={toggleQueue} title="Cerrar cola" style={{ padding: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
        {!activeJamCode && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
            <span style={{ color: 'var(--text-muted)' }}>Autoplay similar al finalizar cola</span>
            <label className="autoplay-switch" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={autoplayEnabled} 
                onChange={toggleAutoplay}
                style={{ display: 'none' }}
              />
              <span className="autoplay-slider" />
            </label>
          </div>
        )}
      </div>

      <div className="queue-content">
        {/* Reproduciendo ahora */}
        {currentTrack && (
          <div className="queue-section">
            <span className="queue-section-label">Reproduciendo ahora</span>
            <div className="queue-item queue-item-current">
              <img className="queue-item-cover" src={currentTrack.cover} alt={currentTrack.title} />
              <div className="queue-item-info">
                <div className="queue-item-title" style={{ color: 'var(--accent)' }}>{currentTrack.title}</div>
                <div className="queue-item-artist">{currentTrack.artist}</div>
              </div>
              {isPlaying && (
                <div className="playing-bars" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                  <span /><span /><span />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Cola Colaborativa de Sinfonía o Siguiente */}
        {activeJamCode ? (
          <div className="queue-section">
            <span className="queue-section-label">
              Sinfonía (Cola Colaborativa) &bull; {jamQueue.length} {jamQueue.length === 1 ? 'canción' : 'canciones'}
            </span>
            {jamQueue.length > 0 ? (
              jamQueue.map((item, i) => {
                const canRemove = isJamHost || item.added_by === getUserId();
                const isVoted = votedIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className="queue-item"
                    style={{ cursor: 'default' }}
                  >
                    <span className="queue-item-num">{i + 1}</span>
                    <img className="queue-item-cover" src={item.track_cover} alt={item.track_title} />
                    <div className="queue-item-info" style={{ flex: 1, minWidth: 0 }}>
                      <div className="queue-item-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.track_title}
                      </div>
                      <div className="queue-item-artist" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '11px', color: 'var(--text-muted)' }}>
                        {item.track_artist} &bull; <span style={{ color: 'var(--accent)' }}>Por {item.added_by_name}</span>
                      </div>
                    </div>

                    {/* Votar */}
                    <button
                      className="queue-item-dj"
                      onClick={() => handleVote(item.id)}
                      title={isVoted ? "Quitar voto" : "Votar canción"}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: isVoted ? 'var(--accent)' : 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: 8,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px'
                      }}
                    >
                      <span style={{ fontSize: '14px' }}>▲</span>
                      <span style={{ fontSize: '11px', fontWeight: 'bold' }}>{item.votes || 0}</span>
                    </button>

                    {/* Eliminar si tiene permisos */}
                    {canRemove && (
                      <button
                        className="queue-item-remove"
                        onClick={() => handleRemove(item.id)}
                        title="Quitar de Sinfonía"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                La cola de la Sinfonía está vacía. Añade canciones.
              </div>
            )}
          </div>
        ) : (
          /* Siguiente */
          upcoming.length > 0 ? (
            <div className="queue-section">
              <span className="queue-section-label">Siguiente — {upcoming.length} {upcoming.length === 1 ? 'canción' : 'canciones'}</span>
              {upcoming.map((track, i) => {
                const realIndex = queueIndex + 1 + i;
                return (
                  <div
                    key={`${track.id}-${realIndex}`}
                    className="queue-item"
                    onClick={() => jumpToQueueIndex(realIndex)}
                  >
                    <span className="queue-item-num">{i + 1}</span>
                    <img className="queue-item-cover" src={track.cover} alt={track.title} />
                    <div className="queue-item-info" style={{ flex: 1, minWidth: 0 }}>
                      <div className="queue-item-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
                      <div className="queue-item-artist" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</div>
                    </div>
                    
                    <button
                      className="queue-item-dj"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        const prevTrack = realIndex === queueIndex + 1 ? currentTrack : queue[realIndex - 1];
                        if (prevTrack) setDjModalTracks({ from: prevTrack, to: track });
                      }}
                      title="Configurar transición DJ con la canción anterior"
                      style={{ background: 'transparent', border: 'none', color: usePlayerStore.getState().transitions[`${(realIndex === queueIndex + 1 ? currentTrack : queue[realIndex - 1])?.id}-${track.id}`] ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', padding: 8 }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                         <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                      </svg>
                    </button>
                    
                    <button
                      className="queue-item-remove"
                      onClick={(e) => { e.stopPropagation(); removeFromQueue(realIndex); }}
                      title="Quitar de la cola"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="queue-empty">
              <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }}><svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>
              <p>No hay más canciones en la cola</p>
            </div>
          )
        )}

        {!activeJamCode && autoplayEnabled && autoplayRecs.length > 0 && (
          <div className="queue-section" style={{ borderTop: '1px solid var(--border)', paddingTop: '16px', marginTop: '16px' }}>
            <span className="queue-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Recomendados a continuación</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Basado en {currentTrack?.title}</span>
            </span>
            {autoplayRecs.map((track) => (
              <div
                key={track.id}
                className="queue-item queue-item-recommendation"
                style={{ opacity: 0.8 }}
                onClick={() => {
                  const { queue: q, queueIndex: qIdx } = usePlayerStore.getState();
                  const newQueue = [...q];
                  newQueue.splice(qIdx + 1, 0, track);
                  usePlayerStore.getState().setQueue(newQueue, qIdx);
                  usePlayerStore.getState().nextTrack();
                }}
              >
                <span className="queue-item-num" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.7 }}>
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </span>
                <img className="queue-item-cover" src={track.cover} alt={track.title} />
                <div className="queue-item-info" style={{ flex: 1, minWidth: 0 }}>
                  <div className="queue-item-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</div>
                  <div className="queue-item-artist" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</div>
                </div>
                
                <button
                  className="queue-item-add"
                  onClick={(e) => {
                    e.stopPropagation();
                    usePlayerStore.getState().addToQueue(track);
                    setAutoplayRecs(prev => prev.filter(t => t.id !== track.id));
                  }}
                  title="Añadir a la cola"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 8,
                    marginRight: 4
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {djModalTracks && (
        <DjMixerModal
          fromTrack={djModalTracks.from}
          toTrack={djModalTracks.to}
          onClose={() => setDjModalTracks(null)}
        />
      )}
    </div>
  );
}
