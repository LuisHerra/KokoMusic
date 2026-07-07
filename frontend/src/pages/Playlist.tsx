import { useState, useRef, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPlaylist, getTrack, removeTrackFromPlaylist, searchTracks, addTrackToPlaylist, updatePlaylist, createCollabPlaylist, getCollabPlaylist, addTrackToCollabPlaylist, removeTrackFromCollabPlaylist, reorderPlaylist, reorderCollabPlaylist, addToJamQueue, smartReorderPlaylist, smartReorderCollabPlaylist, inviteFriendsToCollab, getFriends, deletePlaylist, resolveImageUrl, getPlaylistTrackCount, getRecommendations, BASE } from '../lib/api';
import type { Track, Friendship } from '../lib/api';
import { usePlayerStore } from '../store/playerStore';
import { useLikedSongs } from '../hooks/useLikedSongs';
import DjMixerModal from '../components/Player/DjMixerModal';

function formatDuration(ms: number) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

import { useSwipeToQueue } from '../hooks/useSwipeToQueue';
import { isTrackOffline, saveTrackOffline, deleteOfflineTrack, getAllOfflineTracks } from '../lib/offlineAudio';

function TrackRow({ trackId, prevTrackId, index, onPlay, onRemove, onChangeVideo, onDuplicateAlias, addedByName, onDjMix, draggable, onDragStart, onDragOver, onDragEnd, onDrop }: {
  trackId: string; prevTrackId?: string; index: number;
  onPlay: (t: Track) => void; onRemove: (id: string) => void;
  onChangeVideo: (t: Track) => void;
  onDuplicateAlias?: (t: Track) => void;
  addedByName?: string;
  onDjMix?: (fromTrack: Track, toTrack: Track) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  const { data: track, isLoading } = useQuery({
    queryKey: ['track', trackId],
    queryFn: () => getTrack(trackId),
  });
  const { data: prevTrack } = useQuery({
    queryKey: ['track', prevTrackId],
    queryFn: () => getTrack(prevTrackId!),
    enabled: !!prevTrackId,
  });
  const { currentTrack, isPlaying, activeJamCode, addToQueue, setError } = usePlayerStore();
  const { isLiked, toggleLike } = useLikedSongs();
  const isActive = currentTrack?.id === trackId;
  const [isAddingSinfonia, setIsAddingSinfonia] = useState(false);
  const [isActionsOpen, setIsActionsOpen] = useState(false);

  const [isOffline, setIsOffline] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (trackId) {
      isTrackOffline(trackId).then(setIsOffline);
    }
  }, [trackId]);

  const handleDownload = async (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (!track) return;
    try {
      setDownloading(true);
      if (isOffline) {
        await deleteOfflineTrack(trackId);
        setIsOffline(false);
        setError('Eliminado del dispositivo');
      } else {
        await saveTrackOffline(trackId, {
          title: track.title,
          artist: track.artist,
          cover: track.cover,
          duration: track.duration,
        });
        setIsOffline(true);
        setError('Descargado para escuchar sin conexión');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error al descargar');
    } finally {
      setDownloading(false);
    }
  };

  const { swipeStyle, touchHandlers, swipeOffset } = useSwipeToQueue(
    track || ({} as Track),
    addToQueue,
    setError
  );

  const handleAddToSinfonia = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeJamCode || !track) return;
    try {
      setIsAddingSinfonia(true);
      await addToJamQueue(activeJamCode, {
        track_id: track.id,
        track_title: track.title,
        track_artist: track.artist,
        track_cover: track.cover,
        added_by: '9847b87c-04e7-4595-af2f-3c02448ebf67',
        added_by_name: 'Koko',
      });
      setTimeout(() => {
        setIsAddingSinfonia(false);
      }, 2000);
    } catch {
      setIsAddingSinfonia(false);
    }
  };

  if (isLoading) {
    return (
      <div className="track-row">
        <div className="skeleton" style={{ width: 20, height: 14 }} />
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 4 }} />
          <div>
            <div className="skeleton" style={{ width: 140, height: 13, marginBottom: 6 }} />
            <div className="skeleton" style={{ width: 90, height: 11 }} />
          </div>
        </div>
        <div className="skeleton" style={{ width: 100, height: 13 }} />
        <div className="skeleton" style={{ width: 36, height: 13, marginLeft: 'auto' }} />
      </div>
    );
  }
  if (!track) return null;

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }}>
      {swipeOffset > 0 && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${swipeOffset}px`,
            background: 'linear-gradient(90deg, #1db954 0%, var(--bg-highlight) 100%)',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: '16px',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 'bold',
            pointerEvents: 'none',
            borderRadius: '8px',
            zIndex: 0,
            opacity: Math.min(1, swipeOffset / 80),
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '8px' }}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {swipeOffset > 80 ? 'Soltar para encolar' : 'Arrastra para encolar'}
        </div>
      )}
      <div 
        className={`track-row${isActive ? ' playing' : ''}`} 
        onClick={() => onPlay(track)}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDrop={onDrop}
        style={{
          ...swipeStyle,
          cursor: draggable ? 'grab' : 'pointer',
          position: 'relative',
          zIndex: 1,
        }}
        {...touchHandlers}
      >
      <div className="track-row-num">
        {isActive && isPlaying
          ? <div className="playing-bars"><span /><span /><span /></div>
          : <span style={isActive ? { color: 'var(--accent)' } : {}}>{index + 1}</span>}
      </div>
      <div className="track-row-info">
        <img className="track-row-cover" src={track.cover} alt={track.title} loading="lazy" />
        <div style={{ minWidth: 0 }}>
          <div className="track-row-name" style={isActive ? { color: 'var(--accent)' } : {}}>{track.title}</div>
          <div className="track-row-artist">{track.artist}</div>
        </div>
      </div>
      <div className="track-row-album">{track.album}</div>
      <div className="track-row-duration" style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
        {addedByName && <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 8, whiteSpace: 'nowrap' }}>Añadida por: <strong style={{color: '#a78bfa'}}>{addedByName}</strong></span>}
        {prevTrack && onDjMix && (
          <button className="ctrl-btn" style={{ padding: 4, opacity: usePlayerStore.getState().transitions[`${prevTrack.id}-${track.id}`] ? 1 : 0.4 }}
            onClick={(e) => { e.stopPropagation(); onDjMix(prevTrack, track); }}
            title="Configurar transición DJ con la canción anterior">
            <svg width="14" height="14" viewBox="0 0 24 24" fill={usePlayerStore.getState().transitions[`${prevTrack.id}-${track.id}`] ? "var(--accent)" : "currentColor"}>
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          </button>
        )}
        <button 
          className="ctrl-btn" 
          style={{ padding: 4, opacity: isLiked(trackId) ? 1 : 0.4 }}
          onClick={(e) => { e.stopPropagation(); toggleLike(trackId); }}
          title="Añadir a Tus me gusta"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={isLiked(trackId) ? "var(--accent)" : "none"} stroke={isLiked(trackId) ? "var(--accent)" : "currentColor"} strokeWidth="2">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
        </button>
        <button 
          className="ctrl-btn" 
          style={{ padding: 4, opacity: 0.6 }}
          onClick={(e) => { 
            e.stopPropagation(); 
            addToQueue(track);
            setError(`Añadido a la cola: ${track.title}`);
          }}
          title="Añadir a la cola"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        {activeJamCode && (
          <button 
            className="ctrl-btn" 
            style={{ 
              padding: '4px 8px', 
              color: isAddingSinfonia ? 'var(--accent)' : 'var(--text-secondary)',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: 'none',
              borderRadius: 4,
              fontSize: '11px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              transition: 'all 0.2s',
              flexShrink: 0
            }}
            onClick={handleAddToSinfonia}
            title="Añadir a la Sinfonía"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            {isAddingSinfonia ? 'Añadido ✓' : 'Sinfonía'}
          </button>
        )}
        {onDuplicateAlias && (
          <button className="ctrl-btn" style={{ padding: 4, opacity: 0.6 }}
            onClick={(e) => { e.stopPropagation(); onDuplicateAlias(track); }}
            title="Duplicar canción con otro nombre (Crear Alias)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
            </svg>
          </button>
        )}
        <button className="ctrl-btn" style={{ padding: 4, opacity: 0.6 }}
          onClick={(e) => { e.stopPropagation(); onChangeVideo(track); }}
          title="Cambiar fuente de YouTube">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 12V9l5 3-5 3z" />
          </svg>
        </button>
        <button 
          className="ctrl-btn" 
          style={{ padding: 4, opacity: isOffline ? 1 : 0.4, color: isOffline ? 'var(--accent)' : 'inherit' }}
          onClick={handleDownload}
          disabled={downloading}
          title={downloading ? 'Descargando...' : isOffline ? 'Eliminar descarga de este dispositivo' : 'Descargar para escuchar sin conexión'}
        >
          {downloading ? (
            <div className="spinner" style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          ) : isOffline ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
          )}
        </button>
        <span style={{ width: 40, textAlign: 'right' }}>{formatDuration(track.duration)}</span>
        <button className="ctrl-btn" style={{ padding: 4, opacity: 0.6 }}
          onClick={(e) => { e.stopPropagation(); onRemove(trackId); }}
          title="Quitar de la playlist">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
        
        {/* Mobile menu trigger */}
        <button 
          className="track-row-mobile-trigger"
          onClick={(e) => {
            e.stopPropagation();
            setIsActionsOpen(true);
          }}
          title="Más opciones"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
          </svg>
        </button>
      </div>

      {/* Mobile actions bottom sheet */}
      {isActionsOpen && (
        <div className="bottom-sheet-overlay open" onClick={(e) => { e.stopPropagation(); setIsActionsOpen(false); }}>
          <div className="bottom-sheet-content open" onClick={(e) => e.stopPropagation()}>
            <div className="bottom-sheet-drag-handle" onClick={() => setIsActionsOpen(false)} />
            
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 16 }}>
              <img src={track.cover} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover' }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.title}</h4>
                <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{track.artist}</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '60vh', overflowY: 'auto' }}>
              <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); onPlay(track); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                <span>Reproducir</span>
              </button>
              
              <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); toggleLike(trackId); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill={isLiked(trackId) ? "var(--accent)" : "none"} stroke={isLiked(trackId) ? "var(--accent)" : "currentColor"} strokeWidth="2">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
                <span>{isLiked(trackId) ? 'Te gusta' : 'Me gusta'}</span>
              </button>

              <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); addToQueue(track); setError(`Añadido a la cola: ${track.title}`); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                <span>Añadir a la cola</span>
              </button>

              <button 
                className="track-action-sheet-btn" 
                onClick={(e) => { 
                  setIsActionsOpen(false); 
                  handleDownload(e); 
                }}
                disabled={downloading}
              >
                {downloading ? (
                  <>
                    <div className="spinner" style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <span>Descargando...</span>
                  </>
                ) : isOffline ? (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--accent)' }}>
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                    <span style={{ color: 'var(--accent)' }}>Eliminar descarga</span>
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                    <span>Descargar sin conexión</span>
                  </>
                )}
              </button>

              {activeJamCode && (
                <button className="track-action-sheet-btn" onClick={(e) => { setIsActionsOpen(false); handleAddToSinfonia(e); }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                  <span>Añadir a la Sinfonía</span>
                </button>
              )}

              {prevTrack && onDjMix && (
                <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); onDjMix(prevTrack, track); }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                  <span>Transición DJ</span>
                </button>
              )}

              <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); onChangeVideo(track); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 12V9l5 3-5 3z" /></svg>
                <span>Cambiar fuente de audio (YouTube)</span>
              </button>

              {onDuplicateAlias && (
                <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); onDuplicateAlias(track); }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg>
                  <span>Duplicar como Alias</span>
                </button>
              )}

              {onRemove && (
                <button className="track-action-sheet-btn" style={{ color: '#ff6b6b' }} onClick={() => { setIsActionsOpen(false); onRemove(trackId); }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                  <span>Quitar de la playlist</span>
                </button>
              )}
            </div>
            
            <button className="btn btn-secondary" style={{ width: '100%', marginTop: 16 }} onClick={() => setIsActionsOpen(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

// ── Invite Friends Modal ─────────────────────────────────────────────────────
function InviteFriendsModal({ collabCode, deviceId, displayName, onClose }: {
  collabCode: string;
  deviceId: string;
  displayName: string;
  onClose: () => void;
}) {
  const { data: friendsData, isLoading } = useQuery({
    queryKey: ['friends', deviceId],
    queryFn: () => getFriends(deviceId),
    enabled: !!deviceId,
  });

  const friends: Friendship[] = friendsData?.friends ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const toggleAll = () => {
    if (selected.size === friends.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(friends.map(f => f.id)));
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handleSend = async () => {
    if (selected.size === 0) { setError('Selecciona al menos un amigo.'); return; }
    setSending(true);
    setError('');
    try {
      await inviteFriendsToCollab(collabCode, deviceId, displayName, Array.from(selected));
      setSent(true);
      setTimeout(onClose, 1800);
    } catch (e: any) {
      setError(e.message ?? 'Error al enviar invitaciones');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#a78bfa"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            Invitar amigos
          </h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
          Selecciona a quién quieres invitar a colaborar en esta playlist. Recibirán una notificación y podrán aceptar o rechazar.
        </p>

        {isLoading && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando amigos...</div>
        )}

        {!isLoading && friends.length === 0 && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.3, marginBottom: 8, display: 'block', margin: '0 auto 8px' }}><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
            Aún no tienes amigos en KokoMusic. ¡Busca y conecta con gente desde la sección Amigos!
          </div>
        )}

        {!isLoading && friends.length > 0 && (
          <>
            {/* Select all toggle */}
            <div
              onClick={toggleAll}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)',
                marginBottom: 10, transition: 'background 0.15s',
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: 6,
                border: `2px solid ${selected.size === friends.length ? '#a78bfa' : 'rgba(255,255,255,0.2)'}`,
                background: selected.size === friends.length ? '#a78bfa' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s'
              }}>
                {selected.size === friends.length && <svg width="12" height="12" viewBox="0 0 24 24" fill="#000"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#a78bfa' }}>Invitar a todos ({friends.length})</span>
            </div>

            {/* Friend list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto', paddingRight: 4 }}>
              {friends.map(f => {
                const isSelected = selected.has(f.id);
                const initials = (f.display_name || '?').charAt(0).toUpperCase();
                return (
                  <div
                    key={f.id}
                    onClick={() => toggle(f.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                      background: isSelected ? 'rgba(139,92,246,0.12)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${isSelected ? 'rgba(139,92,246,0.35)' : 'transparent'}`,
                      transition: 'all 0.15s',
                    }}
                  >
                    {/* Avatar */}
                    {f.avatar_url ? (
                      <img src={f.avatar_url} alt={f.display_name} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, fontWeight: 800, color: 'white', flexShrink: 0
                      }}>{initials}</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {f.display_name || f.username || 'Kokoer'}
                      </div>
                      {f.username && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>@{f.username}</div>}
                    </div>
                    {/* Checkbox */}
                    <div style={{
                      width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                      border: `2px solid ${isSelected ? '#a78bfa' : 'rgba(255,255,255,0.2)'}`,
                      background: isSelected ? '#a78bfa' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s'
                    }}>
                      {isSelected && <svg width="12" height="12" viewBox="0 0 24 24" fill="#000"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {error && <div style={{ color: '#ff6b6b', fontSize: 13, marginTop: 10 }}>{error}</div>}

        {sent && (
          <div style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 600, textAlign: 'center', marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
            ¡Invitaciones enviadas!
          </div>
        )}

        {!sent && friends.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button type="button" className="btn" onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>Cancelar</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={sending || selected.size === 0}
              onClick={handleSend}
              style={{ background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', border: 'none' }}
            >
              {sending ? 'Enviando...' : `Invitar (${selected.size})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DuplicateAliasModal({ track, onClose, onCreated }: { track: Track; onClose: () => void; onCreated: (newTrackId: string) => void }) {
  const [title, setTitle] = useState(`${track.title} (Alias)`);
  const [artist, setArtist] = useState(track.artist);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [loadingYtId, setLoadingYtId] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch(`${BASE}/tracks/${track.id}/video`)
      .then(res => res.json())
      .then((data: any) => {
        if (active && data?.youtubeId) {
          setYoutubeUrl(`https://www.youtube.com/watch?v=${data.youtubeId}`);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (active) setLoadingYtId(false);
      });
    return () => { active = false; };
  }, [track.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    let ytId = youtubeUrl.trim();
    if (ytId.includes('v=')) ytId = ytId.split('v=')[1].split('&')[0].substring(0, 11);
    else if (ytId.includes('youtu.be/')) ytId = ytId.split('youtu.be/')[1].split('?')[0].substring(0, 11);

    if (!ytId || ytId.length !== 11) {
      setError('Por favor introduce una URL o ID de YouTube de 11 caracteres válido.');
      return;
    }

    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('title', title.trim());
      formData.append('artist', artist.trim());
      formData.append('sourceType', 'youtube_alias');
      formData.append('youtubeId', ytId);
      formData.append('duration', String(track.duration));
      formData.append('originalTrackId', track.id);

      const res = await fetch(`${BASE}/tracks/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Error desconocido' }));
        throw new Error(err.error ?? 'Error al guardar el alias');
      }

      const created = await res.json();
      onCreated(created.id);
    } catch (e: any) {
      setError(e.message ?? 'Error en la petición.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 460, background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Duplicar como Alias de YouTube</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 20, fontSize: 13, lineHeight: 1.5 }}>
          Crea una copia personalizada de esta canción en tu biblioteca con otro nombre, artista o fuente de audio de YouTube.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Nuevo Título</label>
            <input
              type="text"
              className="search-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              style={{ padding: '10px 14px', width: '100%', background: 'var(--bg-highlight)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', color: 'white', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Artista</label>
            <input
              type="text"
              className="search-input"
              value={artist}
              onChange={e => setArtist(e.target.value)}
              required
              style={{ padding: '10px 14px', width: '100%', background: 'var(--bg-highlight)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', color: 'white', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Enlace de YouTube o ID {loadingYtId && <span style={{ color: 'var(--accent)', fontSize: 10, textTransform: 'none' }}>(Cargando ID actual...)</span>}
            </label>
            <input
              type="text"
              className="search-input"
              value={youtubeUrl}
              onChange={e => setYoutubeUrl(e.target.value)}
              required
              placeholder="https://www.youtube.com/watch?v=..."
              style={{ padding: '10px 14px', width: '100%', background: 'var(--bg-highlight)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', color: 'white', outline: 'none' }}
            />
          </div>

          {error && <div style={{ color: '#ff6b6b', fontSize: 13, marginTop: 4 }}>{error}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
            <button type="button" className="btn" onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Guardando...' : 'Crear Alias'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ChangeVideoModal({ track, onClose }: { track: Track; onClose: () => void }) {
  const [searchQuery, setSearchQuery] = useState(`${track.artist} ${track.title}`);
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualUrl, setManualUrl] = useState('');
  const [searched, setSearched] = useState(false);

  const doSearch = async (q?: string) => {
    const query = q ?? searchQuery;
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`${BASE}/import/search-youtube`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() })
      });
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch (e) {
      console.error('Error searching YouTube:', e);
    } finally {
      setLoading(false);
    }
  };

  // Auto-search on mount
  useEffect(() => {
    doSearch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectVideo = async (youtubeId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/tracks/${track.id}/resolve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ youtubeId })
      });
      if (res.ok) {
        onClose();
      } else {
        alert('Error al actualizar el audio.');
      }
    } catch (e) {
      alert('Error en la petición.');
    } finally {
      setSaving(false);
    }
  };

  const handleManualSubmit = () => {
    let ytId = manualUrl.trim();
    if (ytId.includes('v=')) ytId = ytId.split('v=')[1].split('&')[0].substring(0, 11);
    else if (ytId.includes('youtu.be/')) ytId = ytId.split('youtu.be/')[1].split('?')[0].substring(0, 11);

    if (ytId.length !== 11) {
      alert('Enlace de YouTube inválido');
      return;
    }
    selectVideo(ytId);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h2 style={{ marginBottom: 8 }}>Cambiar fuente de audio</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14, lineHeight: 1.5 }}>
          Busca el video de YouTube correcto para <strong>{track.title}</strong> de <strong>{track.artist}</strong>
        </p>

        {/* Search bar */}
        <form onSubmit={(e) => { e.preventDefault(); doSearch(); }} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="search-bar" style={{ flex: 1 }}>
              <span className="search-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
              </span>
              <input
                className="search-input"
                type="text"
                placeholder="Buscar en YouTube..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 13, whiteSpace: 'nowrap' }}>
              Buscar
            </button>
          </div>
        </form>

        {/* Results */}
        <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 14 }}>
              Buscando en YouTube...
            </div>
          )}
          {!loading && searched && results.length === 0 && (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 14 }}>
              No se encontraron resultados. Prueba con otro término.
            </div>
          )}
          {!loading && results.map((r, index) => {
            const vidId = r.id || r.videoId || r.youtubeId;
            return (
              <div
                key={`${vidId ?? 'no-id'}-${index}`}
                style={{
                  display: 'flex', gap: 10, alignItems: 'center',
                  background: 'rgba(255,255,255,0.04)', padding: '8px 10px', borderRadius: 8,
                  cursor: 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onClick={() => !saving && vidId && selectVideo(vidId)}
              >
                <img
                  src={r.cover || r.thumbnail}
                  alt=""
                  style={{ width: 64, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }}
                />
                <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 500,
                    whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden'
                  }}>
                    {r.title}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
                    <span>{r.artist}</span>
                    {r.duration > 0 && <span>· {formatDuration(r.duration)}</span>}
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ padding: '5px 12px', fontSize: 11, flexShrink: 0 }}
                  disabled={saving}
                >
                  Usar
                </button>
              </div>
            );
          })}
        </div>

        {/* Manual URL fallback */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12 }}>
          {!showManual ? (
            <button
              onClick={() => setShowManual(true)}
              style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: 12, padding: 0, textDecoration: 'underline',
              }}
            >
              ¿Tienes el enlace? Pegar URL manualmente
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="search-input"
                style={{ flex: 1 }}
                placeholder="https://www.youtube.com/watch?v=..."
                value={manualUrl}
                onChange={e => setManualUrl(e.target.value)}
              />
              <button
                className="btn btn-primary"
                style={{ padding: '8px 14px', fontSize: 12 }}
                disabled={!manualUrl || saving}
                onClick={handleManualSubmit}
              >
                Aplicar
              </button>
            </div>
          )}
        </div>

        {/* Close */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

export default function Playlist() {
  const { id } = useParams<{ id: string }>();
  const isVirtualPlaylist = id === 'on-repeat' || id === 'recommended' || id === 'local-downloads';
  const location = useLocation();
  const navigate = useNavigate();
  const isCollabRoute = new URLSearchParams(location.search).get('collab') === 'true';
  const [failedTracks, setFailedTracks] = useState<any[]>(location.state?.failedTracks || []);
  const qc = useQueryClient();
  const { setTrack } = usePlayerStore();
  const [searchQ, setSearchQ] = useState('');
  const [addQuery, setAddQuery] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [changeVideoTrack, setChangeVideoTrack] = useState<Track | null>(null);
  const [duplicateAliasTrack, setDuplicateAliasTrack] = useState<Track | null>(null);
  const [djModalTracks, setDjModalTracks] = useState<{ from: Track, to: Track } | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  
  const [localTracks, setLocalTracks] = useState<any[]>([]);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  const [downloadProgress, setDownloadProgress] = useState<{ active: boolean; current: number; total: number } | null>(null);

  const handleDownloadPlaylist = async () => {
    if (!pl || !pl.tracks || pl.tracks.length === 0) return;
    try {
      setDownloadProgress({ active: true, current: 0, total: pl.tracks.length });
      for (let i = 0; i < pl.tracks.length; i++) {
        const trackItem = pl.tracks[i];
        setDownloadProgress(prev => prev ? { ...prev, current: i + 1 } : null);
        
        try {
          const trackData = await getTrack(trackItem.trackId);
          if (trackData) {
            const isAlreadyOffline = await isTrackOffline(trackItem.trackId);
            if (!isAlreadyOffline) {
              await saveTrackOffline(trackItem.trackId, {
                title: trackData.title,
                artist: trackData.artist,
                cover: trackData.cover,
                duration: trackData.duration,
              });
            }
          }
        } catch (e) {
          console.error(`Failed to download track ${trackItem.trackId} in playlist:`, e);
        }
      }
      qc.invalidateQueries({ queryKey: [isCollabRoute ? 'collabPlaylist' : 'playlist', id] });
      alert('Playlist descargada con éxito para reproducir sin conexión.');
    } catch (err: any) {
      alert('Error al descargar la playlist: ' + (err.message || err));
    } finally {
      setDownloadProgress(null);
    }
  };


  const fileInputRef = useRef<HTMLInputElement>(null);

  const deviceId = (() => {
    const k = 'koko_device_id';
    let did = localStorage.getItem(k);
    if (!did) { did = crypto.randomUUID(); localStorage.setItem(k, did); }
    return did;
  })();
  const displayName = localStorage.getItem('koko_display_name') ?? 'Oyente';

  // Collab state: persisted per playlist ID
  const collabStorageKey = `koko_collab_for_${id}`;
  const [collabCode, setCollabCode] = useState<string | null>(() => localStorage.getItem(collabStorageKey));
  const [collabData, setCollabData] = useState<import('../lib/api').CollabPlaylist | null>(null);
  const [collabActivating, setCollabActivating] = useState(false);
  const [collabCopied, setCollabCopied] = useState(false);
  const [showCollabCode, setShowCollabCode] = useState(false);

  const { data: pl, isLoading, error } = useQuery({
    queryKey: [isCollabRoute ? 'collabPlaylist' : 'playlist', id],
    enabled: !!id,
    queryFn: async (): Promise<any> => {
      if (id === 'local-downloads') {
        const offlineTracks = await getAllOfflineTracks();
        return {
          id: 'local-downloads',
          name: 'Canciones Descargadas',
          description: 'Música guardada en este dispositivo para escuchar sin conexión a internet.',
          cover: '',
          tracks: offlineTracks.map((t: any, idx: number) => ({
            trackId: t.id,
            position: idx + 1,
            addedAt: new Date().toISOString(),
            addedBy: 'local'
          }))
        };
      }

      if (id === 'on-repeat') {
        const playHistoryRaw = localStorage.getItem('koko_play_history');
        const playHistory = playHistoryRaw ? JSON.parse(playHistoryRaw) : [];
        const repeatTracks = playHistory
          .filter((t: any) => t.playCount >= 2)
          .sort((a: any, b: any) => b.playCount - a.playCount);
        
        return {
          id: 'on-repeat',
          name: 'En Bucle',
          description: 'Tus canciones más escuchadas y repetidas en este dispositivo.',
          cover: '',
          tracks: repeatTracks.map((t: any, idx: number) => ({
            trackId: t.id,
            position: idx + 1,
            addedAt: new Date(t.lastPlayed || Date.now()).toISOString(),
            addedBy: 'local'
          }))
        };
      }

      if (id === 'recommended') {
        const playHistoryRaw = localStorage.getItem('koko_play_history');
        const playHistory = playHistoryRaw ? JSON.parse(playHistoryRaw) : [];
        const sortedHistory = [...playHistory].sort((a: any, b: any) => b.playCount - a.playCount);
        const topTrack = sortedHistory[0];

        let recs: any[] = [];
        try {
          recs = await getRecommendations(30, undefined, topTrack?.id);
        } catch (err) {
          console.error('Error fetching recommendations for virtual playlist:', err);
        }

        if (recs.length === 0) {
          try {
            recs = await getRecommendations(30);
          } catch (e) {
            console.error('Error fetching general recommendations:', e);
          }
        }

        return {
          id: 'recommended',
          name: 'Recomendadas para ti',
          description: 'Música recomendada basada en tus reproducciones recientes y gustos.',
          cover: '',
          tracks: recs.map((t: any, idx: number) => ({
            trackId: t.id,
            position: idx + 1,
            addedAt: new Date().toISOString(),
            addedBy: 'recommender'
          }))
        };
      }

      if (isCollabRoute) {
        const cp = await getCollabPlaylist(id!);
        return {
          id: cp.id,
          name: cp.name,
          description: cp.description || '',
          cover: resolveImageUrl(cp.cover_url),
          tracks: cp.tracks?.map((t: any) => ({
            trackId: t.track_id,
            position: t.position,
            addedAt: t.added_at,
            addedBy: t.added_by,
          })) ?? [],
          createdAt: cp.created_at,
          updatedAt: cp.updated_at,
          _isCollab: true,
          ownerId: cp.owner_id,
          shareCode: cp.share_code,
          collaborators: cp.collaborators ?? [],
        };
      }
      const p = await getPlaylist(id!);
      return {
        ...p,
        cover: resolveImageUrl(p.cover),
      };
    },
  });

  // Config: auto-aceptar upgrades ambiguos (el usuario puede desactivar esto)
  const [autoAcceptUpgrade, setAutoAcceptUpgrade] = useState(() => localStorage.getItem('koko-auto-accept-upgrade') === 'true');
  const [upgradeDisambiguation, setUpgradeDisambiguation] = useState<{
    trackInfo: any;
    oldTrackId: string;
    candidates: any[];
  } | null>(null);

  // Efecto en segundo plano para "upgradear" tracks de YouTube a iTunes
  useEffect(() => {
    if (isVirtualPlaylist) return;
    if (!pl?.tracks) return;

    const ytTracks = pl.tracks.filter((t: any) => isNaN(Number(t.trackId)) || Number(t.trackId) === 0);
    if (ytTracks.length === 0) return;

    let mounted = true;
    const upgradeTracks = async () => {
      for (const t of ytTracks) {
        if (!mounted) break;
        try {
          const trackInfo = await getTrack(t.trackId);
          if (!trackInfo) continue;
          
          const res = await fetch(`${BASE}/import/upgrade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ track: trackInfo })
          });
          
          if (res.ok) {
            const data = await res.json();
            
            if (data.ambiguous && !autoAcceptUpgrade) {
              // Ambiguo: preguntar al usuario
              const chosenId = await new Promise<string | null>((resolve) => {
                setUpgradeDisambiguation({
                  trackInfo,
                  oldTrackId: t.trackId,
                  candidates: data.candidates,
                });
                // Store the resolver for the modal to call
                (window as any).__upgradeResolve = resolve;
              });
              setUpgradeDisambiguation(null);
              
              if (chosenId && mounted) {
                await fetch(`${BASE}/playlists/${id}/tracks/${t.trackId}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ newId: chosenId })
                });
                qc.invalidateQueries({ queryKey: ['playlist', id] });
              }
            } else if (data.id && mounted) {
              // Confiable o auto-accept: upgrade automático
              const upgradeId = data.ambiguous ? data.candidates[0].id : data.id;
              await fetch(`${BASE}/playlists/${id}/tracks/${t.trackId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newId: upgradeId })
              });
              qc.invalidateQueries({ queryKey: ['playlist', id] });
            }
          }
        } catch(e) {}
        
        await new Promise(r => setTimeout(r, 600)); // Delay para evitar rate-limits
      }
    };
    
    upgradeTracks();
    return () => { mounted = false; };
  }, [pl?.tracks, id, qc, autoAcceptUpgrade]);

  const firstTrackId = pl?.tracks?.[0]?.trackId;
  const { data: firstTrack } = useQuery({
    queryKey: ['track', firstTrackId],
    queryFn: () => getTrack(firstTrackId!),
    enabled: !!firstTrackId,
  });

  const [bgColor, setBgColor] = useState<string>('#1DB954');

  useEffect(() => {
    const coverSrc = pl?.cover || firstTrack?.cover;
    if (!coverSrc) {
      setBgColor('#1DB954');
      return;
    }
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 64, 64);
      const data = ctx.getImageData(0, 0, 64, 64).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i+3] < 255) continue;
        const avg = (data[i] + data[i+1] + data[i+2]) / 3;
        if (avg > 20 && avg < 240) {
          r += data[i]; g += data[i+1]; b += data[i+2]; count++;
        }
      }
      if (count > 0) {
        const toHex = (n: number) => n.toString(16).padStart(2, '0');
        setBgColor(`#${toHex(Math.floor(r/count))}${toHex(Math.floor(g/count))}${toHex(Math.floor(b/count))}`);
      } else {
        setBgColor('#1DB954');
      }
    };
    img.onerror = () => setBgColor('#1DB954');
    img.src = coverSrc;
  }, [pl?.cover, firstTrack?.cover]);

  const { data: searchResults } = useQuery({
    queryKey: ['search', addQuery],
    queryFn: () => searchTracks(addQuery, 8),
    enabled: addQuery.length > 1,
    staleTime: 60_000,
  });

  const removeMutation = useMutation<any, Error, string>({
    mutationFn: async (trackId: string) => {
      if (id === 'local-downloads') {
        await deleteOfflineTrack(trackId);
        return;
      }
      return isCollabRoute ? removeTrackFromCollabPlaylist(pl!.id, trackId) : removeTrackFromPlaylist(id!, trackId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [isCollabRoute ? 'collabPlaylist' : 'playlist', id] });
      qc.invalidateQueries({ queryKey: [isCollabRoute ? 'collabPlaylists' : 'playlists'] });
    },
  });

  const addMutation = useMutation<any, Error, string>({
    mutationFn: (trackId: string) => isCollabRoute ? addTrackToCollabPlaylist(pl!.id, trackId, deviceId) : addTrackToPlaylist(id!, trackId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [isCollabRoute ? 'collabPlaylist' : 'playlist', id] });
      qc.invalidateQueries({ queryKey: [isCollabRoute ? 'collabPlaylists' : 'playlists'] });
      setAddQuery('');
      setSearchQ('');
    },
  });

  useEffect(() => {
    if (pl?.tracks) {
      setLocalTracks(pl.tracks);
    }
  }, [pl?.tracks]);

  const updatePlaylistMutation = useMutation({
    mutationFn: (data: { name?: string; cover?: string }) => updatePlaylist(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlist', id] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
      setIsEditingName(false);
    }
  });

  const reorderMutation = useMutation({
    mutationFn: (trackIds: string[]) => (isCollabRoute ? reorderCollabPlaylist(pl!.id, trackIds) : reorderPlaylist(id!, trackIds)) as any,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [isCollabRoute ? 'collabPlaylist' : 'playlist', id] });
      qc.invalidateQueries({ queryKey: [isCollabRoute ? 'collabPlaylists' : 'playlists'] });
    },
  });

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePlayQueue = async (startTrack?: Track) => {
    const cachedQueue = localTracks
      .map((t: any) => qc.getQueryData<Track>(['track', t.trackId]))
      .filter(Boolean) as Track[];
    
    let targetTrack = startTrack;
    
    if (!targetTrack && cachedQueue.length > 0) {
      targetTrack = cachedQueue[0];
    } else if (!targetTrack && localTracks.length > 0) {
      targetTrack = await getTrack(localTracks[0].trackId);
    }
    
    if (!targetTrack) return;

    if (cachedQueue.length === localTracks.length) {
      setTrack(targetTrack, cachedQueue);
    } else {
      setTrack(targetTrack, cachedQueue.some(t => t.id === targetTrack!.id) ? cachedQueue : [targetTrack]);
      Promise.all(localTracks.map((t: any) => 
        qc.getQueryData<Track>(['track', t.trackId]) || getTrack(t.trackId)
      )).then(fullQueue => {
        const resolved = fullQueue.filter(Boolean) as Track[];
        const currentId = usePlayerStore.getState().currentTrack?.id;
        const idx = resolved.findIndex(t => t.id === currentId);
        usePlayerStore.getState().setQueue(resolved, Math.max(0, idx));
      }).catch(console.error);
    }
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    const newTracks = [...localTracks];
    const [dragged] = newTracks.splice(draggedIdx, 1);
    newTracks.splice(idx, 0, dragged);
    setDraggedIdx(idx);
    setLocalTracks(newTracks);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDraggedIdx(null);
    reorderMutation.mutate(localTracks.map(t => t.trackId));
  };

  // Load existing collab data on mount if we already have a code
  useEffect(() => {
    if (!collabCode) return;
    import('../lib/api').then(({ getCollabPlaylist }) =>
      getCollabPlaylist(collabCode)
        .then(setCollabData)
        .catch(() => { /* expired — clear */ localStorage.removeItem(collabStorageKey); setCollabCode(null); })
    );
  }, [collabCode]);

  async function handleActivateCollab() {
    if (!pl || collabActivating) return;
    setCollabActivating(true);
    try {
      const collab = await createCollabPlaylist({
        name: pl.name,
        description: pl.description || '',
        cover_url: pl.cover,
        owner_id: deviceId,
        display_name: displayName,
      });

      // Add all existing tracks to the collab playlist
      if (pl.tracks && pl.tracks.length > 0) {
        for (const t of pl.tracks) {
          try {
            await addTrackToCollabPlaylist(collab.id, t.trackId, deviceId);
          } catch (_) { /* ignore duplicate errors */ }
        }
      }

      // Navigate FIRST so the old query unmounts before we delete (prevents 404)
      navigate(`/playlist/${collab.share_code}?collab=true`, { replace: true });

      // Optimistically remove the old local playlist from the React Query cache
      if (!isCollabRoute && id && id !== 'liked-songs') {
        qc.setQueryData<any[]>(['playlists'], (old) => {
          if (!old) return [];
          return old.filter(p => p.id !== id);
        });
        
        try {
          await deletePlaylist(id);
        } catch (err) {
          console.error('[Playlist] Failed to delete local playlist:', err);
        }
      }

      // Invalidate queries after deletion has finished
      await qc.invalidateQueries({ queryKey: ['collabPlaylists'] });
      await qc.invalidateQueries({ queryKey: ['playlists'] });
    } catch (e: any) {
      alert('Error al activar colaboración: ' + (e.message ?? 'Error desconocido'));
    } finally {
      setCollabActivating(false);
    }
  }

  function copyCollabCode() {
    if (!collabCode) return;
    navigator.clipboard.writeText(collabCode);
    setCollabCopied(true);
    setTimeout(() => setCollabCopied(false), 2000);
  }

  const [smartReordering, setSmartReordering] = useState(false);
  const handleSmartReorder = async () => {
    if (!id || smartReordering) return;
    setSmartReordering(true);
    try {
      if (isCollabRoute) {
        await smartReorderCollabPlaylist(pl!.id);
        qc.invalidateQueries({ queryKey: ['collabPlaylist', id] });
        qc.invalidateQueries({ queryKey: ['collabPlaylists'] });
      } else {
        await smartReorderPlaylist(id);
        qc.invalidateQueries({ queryKey: ['playlist', id] });
        qc.invalidateQueries({ queryKey: ['playlists'] });
      }
    } catch (err: any) {
      console.error(err);
      alert('Error en la mezcla inteligente: ' + err.message);
    } finally {
      setSmartReordering(false);
    }
  };

  if (isLoading) {
    return (
      <div className="main-body" style={{ paddingTop: 24 }}>
        <div className="skeleton" style={{ height: 40, width: 300, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 16, width: 160, marginBottom: 32 }} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="track-row" style={{ marginBottom: 8 }}>
            <div className="skeleton" style={{ width: 20, height: 14 }} />
            <div className="skeleton" style={{ width: 200, height: 40 }} />
            <div className="skeleton" style={{ width: 100, height: 14 }} />
            <div className="skeleton" style={{ width: 40, height: 14 }} />
          </div>
        ))}
      </div>
    );
  }

  const renderAccessDenied = () => (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '80px 24px',
      textAlign: 'center',
      minHeight: '60vh',
    }}>
      <div style={{
        width: 80,
        height: 80,
        borderRadius: '50%',
        background: 'rgba(239, 68, 68, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
        border: '1px solid rgba(239, 68, 68, 0.2)',
      }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12, color: '#fff' }}>
        Acceso Privado
      </h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14, maxWidth: 400, lineHeight: 1.5, marginBottom: 32 }}>
        Esta playlist es colaborativa y privada. Solicita al creador que te envíe una invitación para poder colaborar.
      </p>
      <button
        onClick={() => navigate('/')}
        style={{
          background: 'rgba(255,255,255,0.08)',
          color: '#fff',
          border: 'none',
          borderRadius: 24,
          padding: '10px 24px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
        className="hover-scale"
      >
        Volver al inicio
      </button>
    </div>
  );

  const isForbidden = error && (error.message.includes('Acceso privado') || error.message.includes('403') || error.message.includes('Forbidden'));

  if (isForbidden) {
    return renderAccessDenied();
  }

  if (!pl) return <div className="main-body" style={{ paddingTop: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Playlist no encontrada.</div>;

  const isOwner = isCollabRoute ? (pl.ownerId === deviceId) : true;
  const isCollaborator = isCollabRoute ? (pl.collaborators?.some((c: any) => c.user_id === deviceId) || isOwner) : true;

  if (isCollabRoute && !isCollaborator) {
    return renderAccessDenied();
  }


  return (
    <div>
      <input 
        type="file" 
        accept="image/*" 
        style={{ display: 'none' }} 
        ref={fileInputRef} 
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
              const base64 = ev.target?.result as string;
              updatePlaylistMutation.mutate({ cover: base64 });
            };
            reader.readAsDataURL(file);
          }
        }} 
      />
      {/* Hero banner */}
      <div 
        className="playlist-hero"
        style={{
          background: `linear-gradient(180deg, ${bgColor}40 0%, var(--bg-elevated) 100%)`,
        }}
      >
        <div 
          className="playlist-cover-container"
          style={{
            background: pl.cover ? `url("${pl.cover}") center/cover` : (firstTrack?.cover ? `url("${firstTrack.cover}") center/cover` : `linear-gradient(135deg, ${bgColor}, #0a5c29)`),
            cursor: isVirtualPlaylist ? 'default' : 'pointer'
          }}
          onClick={() => {
            if (isVirtualPlaylist) return;
            const choice = window.confirm("¿Quieres subir una imagen desde tu dispositivo?\n(Haz clic en Cancelar para introducir una URL)");
            if (choice) {
              fileInputRef.current?.click();
            } else {
              const url = window.prompt('Introduce la URL de la nueva portada para la playlist:', pl.cover || '');
              if (url !== null) {
                updatePlaylistMutation.mutate({ cover: url });
              }
            }
          }}
          title={isVirtualPlaylist ? undefined : "Cambiar portada"}
        >
          {!pl.cover && !firstTrack?.cover && (
            <svg width="60" height="60" viewBox="0 0 24 24" fill="white" opacity="0.8">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
          )}
          {!isVirtualPlaylist && (
            <div className="playlist-cover-overlay">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
              </svg>
              <span style={{ fontSize: 12, fontWeight: 'bold', marginTop: 4 }}>Editar</span>
            </div>
          )}
        </div>
        <div className="playlist-hero-info">
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 }}>Playlist</div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            {isEditingName ? (
              <input 
                autoFocus
                className="search-input"
                style={{ fontSize: '1.8rem', fontWeight: 800, padding: '4px 8px', background: 'rgba(0,0,0,0.5)', color: 'white', border: '1px solid #1DB954', width: '100%', maxWidth: 500 }}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => updatePlaylistMutation.mutate({ name: editName })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') updatePlaylistMutation.mutate({ name: editName });
                  if (e.key === 'Escape') setIsEditingName(false);
                }}
              />
            ) : (
              <h1 
                className="playlist-title"
                style={{ fontWeight: 800, letterSpacing: -1, margin: 0, cursor: isVirtualPlaylist ? 'default' : 'pointer' }}
                onClick={() => { if (!isVirtualPlaylist) { setEditName(pl.name); setIsEditingName(true); } }}
                title={isVirtualPlaylist ? undefined : "Haz clic para renombrar"}
              >
                {pl.name}
              </h1>
            )}
          </div>
          {pl.description && <p className="playlist-description" style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>{pl.description}</p>}
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {getPlaylistTrackCount(pl.id || pl.share_code, pl.tracks)} {getPlaylistTrackCount(pl.id || pl.share_code, pl.tracks) === 1 ? 'canción' : 'canciones'}
          </p>
        </div>
        
        {/* Collab info panel — moved to top header */}
        {/* Collab info panel */}
        {(collabCode || pl?._isCollab) && (
          <div className="playlist-collab-panel">
            <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa', boxShadow: '0 0 6px #a78bfa' }} />
              Colaborativa
            </div>
            <button
              onClick={() => {
                if (!showCollabCode) {
                  setShowCollabCode(true);
                } else {
                  copyCollabCode();
                }
              }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', width: '100%' }}
              title={showCollabCode ? "Copiar código" : "Mostrar código"}
            >
              {showCollabCode ? (
                <>
                  <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: 6, color: 'white', marginBottom: 4 }}>{pl?._isCollab ? pl.shareCode : collabCode}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>{collabCopied ? '✓ Copiado' : 'Toca para copiar'}</div>
                </>
              ) : (
                <div style={{ fontSize: 14, fontWeight: 600, color: '#a78bfa', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  Colaboración Activa
                </div>
              )}
            </button>

            {/* Collaborator avatars */}
            {((pl?._isCollab ? pl.collaborators : collabData?.collaborators) || []).length > 0 && (
              <div style={{ display: 'flex', gap: 4, marginTop: 10, flexWrap: 'wrap' }}>
                {(pl?._isCollab ? pl.collaborators : collabData?.collaborators)?.map((c: any) => (
                  <div key={c.user_id} title={c.display_name} style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 800, color: 'white', border: '1.5px solid rgba(139,92,246,0.5)'
                  }}>
                    {c.display_name.charAt(0).toUpperCase()}
                  </div>
                ))}
              </div>
            )}

            {/* Invite friends button */}
            <button
              onClick={() => setShowInviteModal(true)}
              style={{
                marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)',
                borderRadius: 8, padding: '7px 12px', color: '#a78bfa',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s'
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.25)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,92,246,0.15)'; }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
              Invitar amigos
            </button>
          </div>
        )}
      </div>

      <div className="main-body">
        {/* Play + Collab toggle */}
        {pl.tracks.length > 0 && (
          <div className="playlist-action-bar">
            <button className="ctrl-btn-play" style={{ width: 56, height: 56 }}
              onClick={() => handlePlayQueue()}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
            {/* Collab toggle */}
            {!isVirtualPlaylist && !collabCode && !pl?._isCollab && (
              <button
                onClick={handleActivateCollab}
                disabled={collabActivating}
                title="Activar modo colaborativo"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'rgba(139,92,246,0.13)', border: '1px solid rgba(139,92,246,0.28)',
                  borderRadius: 20, padding: '8px 16px',
                  color: '#a78bfa', fontSize: 13, fontWeight: 600, cursor: collabActivating ? 'not-allowed' : 'pointer',
                  opacity: collabActivating ? 0.6 : 1, transition: 'all 0.2s',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                </svg>
                {collabActivating ? 'Activando...' : 'Hacer colaborativa'}
              </button>
            )}
            {!isVirtualPlaylist && (collabCode || pl?._isCollab) && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: 'rgba(139,92,246,0.13)', border: '1px solid rgba(139,92,246,0.28)',
                borderRadius: 20, padding: '6px 14px', color: '#a78bfa', fontSize: 12, fontWeight: 600,
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                </svg>
                Colaborativa activa
              </div>
            )}
 
            {/* Mezcla Inteligente button */}
            {!isVirtualPlaylist && (
              <button
                onClick={handleSmartReorder}
                disabled={smartReordering}
                title="Mezcla Inteligente — Reordena por BPM y transiciones de onda suaves"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'rgba(29, 185, 84, 0.1)',
                  border: '1px solid rgba(29, 185, 84, 0.3)',
                  borderRadius: 20,
                  padding: '8px 16px',
                  color: 'var(--accent)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: smartReordering ? 'not-allowed' : 'pointer',
                  opacity: smartReordering ? 0.6 : 1,
                  transition: 'all 0.2s',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4 6c0-.55-.45-1-1-1s-1 .45-1 1v6c0 .55.45 1 1 1s1-.45 1-1V9zm-4 4c0-.55-.45-1-1-1s-1 .45-1 1v2c0 .55.45 1 1 1s1-.45 1-1v-2zm8-6c0-.55-.45-1-1-1s-1 .45-1 1v8c0 .55.45 1 1 1s1-.45 1-1V7zm-12 8c0-.55-.45-1-1-1s-1 .45-1 1v1c0 .55.45 1 1 1s1-.45 1-1v-1z"/>
                </svg>
                {smartReordering ? 'Mezclando...' : 'Mezcla Inteligente'}
              </button>
            )}

            {/* Download Playlist Button */}
            {pl.tracks.length > 0 && id !== 'local-downloads' && (
              <button
                onClick={handleDownloadPlaylist}
                disabled={downloadProgress?.active}
                title="Descargar toda la playlist para escuchar sin conexión"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'rgba(29, 185, 84, 0.1)',
                  border: '1px solid rgba(29, 185, 84, 0.3)',
                  borderRadius: 20,
                  padding: '8px 16px',
                  color: 'var(--accent)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: downloadProgress?.active ? 'not-allowed' : 'pointer',
                  opacity: downloadProgress?.active ? 0.6 : 1,
                  transition: 'all 0.2s',
                }}
              >
                {downloadProgress?.active ? (
                  <>
                    <div className="spinner" style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <span>Descargando ({downloadProgress.current}/{downloadProgress.total})...</span>
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                    </svg>
                    <span>Descargar Todo</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Track list */}
        {failedTracks.length > 0 && (
          <div style={{ background: 'rgba(255, 60, 60, 0.1)', border: '1px solid rgba(255, 60, 60, 0.2)', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h4 style={{ color: '#ff6b6b', margin: 0, fontSize: '14px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#ff6b6b"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
                {failedTracks.length} canciones no se pudieron importar
              </h4>
              <button 
                onClick={() => setFailedTracks([])}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                Ocultar
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
              Los siguientes temas no se encontraron automáticamente. Puedes buscarlos manualmente e intentar añadirlos desde aquí.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {failedTracks.map((ft, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: '4px' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{ft.title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{ft.artist}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      onClick={() => {
                        const query = `${ft.artist} ${ft.title}`;
                        setSearchQ(query);
                        setAddQuery(query);
                        document.getElementById('add-tracks-section')?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      style={{ fontSize: '12px', padding: '4px 12px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer' }}
                    >
                      Buscar
                    </button>
                    <button 
                      onClick={() => setFailedTracks(prev => prev.filter((_, idx) => idx !== i))}
                      style={{ fontSize: '12px', padding: '4px 12px', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      Descartar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {pl.tracks.length === 0 ? (
          id === 'local-downloads' ? (
            <div className="empty-state" style={{ padding: '60px 20px', textAlign: 'center' }}>
              <div className="empty-state-icon" style={{ marginBottom: 16 }}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'white' }}>No hay descargas locales</h3>
              <p style={{ color: 'var(--text-secondary)', maxWidth: 400, margin: '0 auto 24px auto', fontSize: 14, lineHeight: 1.5 }}>
                Escucha tus temas favoritos sin conexión. Explora y descarga canciones haciendo clic en el icono de descarga <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'inline', verticalAlign: 'middle', color: 'var(--accent)' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> en el reproductor.
              </p>
              <button 
                onClick={() => navigate('/search')}
                className="btn btn-primary"
                style={{ borderRadius: 20, padding: '10px 24px', fontWeight: 600 }}
              >
                Buscar canciones para descargar
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.4"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>
              <p>Esta playlist está vacía</p>
              <small>Añade canciones buscando abajo</small>
            </div>
          )
        ) : (
          <div className="track-list" style={{ marginBottom: 32 }}>
            {localTracks.map((t: any, i: number) => (
              <TrackRow
                key={`${t.trackId}-${i}`}
                trackId={t.trackId}
                prevTrackId={i > 0 ? localTracks[i - 1].trackId : undefined}
                index={i}
                onPlay={async (track) => handlePlayQueue(track)}
                onRemove={(tid) => removeMutation.mutate(tid)}
                onChangeVideo={(track) => setChangeVideoTrack(track)}
                onDuplicateAlias={(track) => setDuplicateAliasTrack(track)}
                addedByName={pl._isCollab && t.addedBy ? (t.addedBy === deviceId ? 'Ti' : pl.collaborators?.find((c: any) => c.user_id === t.addedBy)?.display_name || 'Desconocido') : undefined}
                onDjMix={(from, to) => setDjModalTracks({ from, to })}
                draggable={!searchQ}
                onDragStart={(e) => handleDragStart(e, i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDragEnd={() => setDraggedIdx(null)}
                onDrop={handleDrop}
              />
            ))}
          </div>
        )}

        {/* Add tracks section */}
        {!isVirtualPlaylist && (
          <div id="add-tracks-section" style={{ borderTop: '1px solid #ffffff10', paddingTop: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Añadir canciones</h3>
            <form onSubmit={(e) => { e.preventDefault(); setAddQuery(searchQ); }} style={{ marginBottom: 16 }}>
              <div className="search-bar" style={{ maxWidth: 400 }}>
                <span className="search-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                  </svg>
                </span>
                <input className="search-input" type="text" placeholder="Buscar canciones..."
                  value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
              </div>
            </form>

            {searchResults?.tracks && searchResults.tracks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {searchResults.tracks.map((track) => {
                  const alreadyIn = pl.tracks.some((t: any) => t.trackId === track.id);
                  return (
                    <div key={track.id} className="track-row" style={{ cursor: 'default' }}>
                      <div />
                      <div className="track-row-info">
                        <img className="track-row-cover" src={track.cover} alt={track.title} loading="lazy" />
                        <div>
                          <div className="track-row-name">{track.title}</div>
                          <div className="track-row-artist">{track.artist}</div>
                        </div>
                      </div>
                      <div className="track-row-album">{track.album}</div>
                      <div style={{ textAlign: 'right' }}>
                        <button
                          className={`btn ${alreadyIn ? 'btn-secondary' : 'btn-primary'}`}
                          style={{ padding: '6px 14px', fontSize: 12 }}
                          disabled={alreadyIn || addMutation.isPending}
                          onClick={() => addMutation.mutate(track.id)}
                        >
                          {alreadyIn ? 'Añadida' : '+ Añadir'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {changeVideoTrack && (
        <ChangeVideoModal
          track={changeVideoTrack}
          onClose={() => setChangeVideoTrack(null)}
        />
      )}

      {duplicateAliasTrack && (
        <DuplicateAliasModal
          track={duplicateAliasTrack}
          onClose={() => setDuplicateAliasTrack(null)}
          onCreated={(newTrackId) => {
            addMutation.mutate(newTrackId);
            setDuplicateAliasTrack(null);
          }}
        />
      )}

      {/* Upgrade Disambiguation Modal */}
      {upgradeDisambiguation && (
        <div className="modal-overlay" onClick={() => { (window as any).__upgradeResolve?.(null); setUpgradeDisambiguation(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18 }}>Selecciona la versión correcta</h3>
              <button className="ctrl-btn" onClick={() => { (window as any).__upgradeResolve?.(null); setUpgradeDisambiguation(null); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
              No estamos seguros de cuál es la versión correcta de <strong style={{ color: 'var(--text-primary)' }}>{upgradeDisambiguation.trackInfo.title}</strong> de <strong style={{ color: 'var(--text-primary)' }}>{upgradeDisambiguation.trackInfo.artist}</strong>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflow: 'auto' }}>
              {upgradeDisambiguation.candidates.map((c: any) => (
                <div
                  key={c.id}
                  onClick={() => { (window as any).__upgradeResolve?.(c.id); setUpgradeDisambiguation(null); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)',
                    cursor: 'pointer', border: '1px solid transparent', transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
                >
                  <img src={c.cover} alt="" style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.artist} — {c.album}</div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: c.score >= 50 ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0, background: c.score >= 50 ? 'rgba(29,185,84,0.15)' : 'rgba(255,255,255,0.05)', padding: '3px 8px', borderRadius: 'var(--radius-full)' }}>
                    {c.score}%
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>
                <input
                  type="checkbox"
                  checked={autoAcceptUpgrade}
                  onChange={(e) => {
                    setAutoAcceptUpgrade(e.target.checked);
                    localStorage.setItem('koko-auto-accept-upgrade', e.target.checked.toString());
                  }}
                  style={{ accentColor: 'var(--accent)' }}
                />
                Aceptar automáticamente el mejor resultado
              </label>
              <button
                onClick={() => { (window as any).__upgradeResolve?.(null); setUpgradeDisambiguation(null); }}
                style={{ padding: '6px 16px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 'var(--radius-md)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}
              >
                Saltar
              </button>
            </div>
          </div>
        </div>
      )}

      {djModalTracks && (
        <DjMixerModal
          fromTrack={djModalTracks.from}
          toTrack={djModalTracks.to}
          onClose={() => setDjModalTracks(null)}
        />
      )}

      {showInviteModal && (collabCode || pl?._isCollab) && (
        <InviteFriendsModal
          collabCode={pl?._isCollab ? pl.shareCode : collabCode!}
          deviceId={deviceId}
          displayName={displayName}
          onClose={() => setShowInviteModal(false)}
        />
      )}
    </div>
  );
}
