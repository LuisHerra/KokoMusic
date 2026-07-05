import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getAlbum } from '../lib/api';
import { usePlayerStore } from '../store/playerStore';
import { useLikedSongs } from '../hooks/useLikedSongs';
import { useSwipeToQueue } from '../hooks/useSwipeToQueue';

function formatDuration(ms: number) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function AlbumTrackRow({ 
  t, 
  i, 
  album, 
  currentTrack, 
  isPlaying, 
  setTrack, 
  tracks, 
  isLiked, 
  toggleLike, 
  addToQueue, 
  setError 
}: { 
  t: any; i: number; album: any; currentTrack: any; isPlaying: boolean;
  setTrack: any; tracks: any[]; isLiked: any; toggleLike: any; addToQueue: any; setError: any;
}) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const mappedTrack = { ...t, album: album.title, cover: album.cover };
  const isActive = currentTrack?.id === t.id;

  const { swipeStyle, touchHandlers, swipeOffset } = useSwipeToQueue(
    mappedTrack,
    addToQueue,
    setError
  );

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
        className={`track-row album-track-row ${isActive ? 'playing' : ''}`} 
        onClick={() => setTrack(mappedTrack, tracks.map((tr: any) => ({ ...tr, album: album.title, cover: album.cover })))}
        style={{
          ...swipeStyle,
          position: 'relative',
          zIndex: 1,
        }}
        {...touchHandlers}
      >
      <div className="track-row-num">
        {isActive && isPlaying
          ? <div className="playing-bars"><span /><span /><span /></div>
          : <span style={isActive ? { color: 'var(--accent)' } : {}}>{t.trackNumber || i + 1}</span>}
      </div>
      
      <div className="track-row-info">
        <div style={{ minWidth: 0 }}>
          <div className="track-row-name" style={isActive ? { color: 'var(--accent)' } : {}}>{t.title}</div>
          <div className="track-row-artist">{t.artist}</div>
        </div>
      </div>

      <div className="track-row-duration" style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
        <button 
          className="ctrl-btn" 
          style={{ padding: 4, opacity: isLiked(t.id) ? 1 : 0.4 }}
          onClick={(e) => { e.stopPropagation(); toggleLike(t.id); }}
          title="Añadir a Tus me gusta"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill={isLiked(t.id) ? "var(--accent)" : "none"} stroke={isLiked(t.id) ? "var(--accent)" : "currentColor"} strokeWidth="2">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
        </button>
        <button 
          className="ctrl-btn" 
          style={{ padding: 4, opacity: 0.6 }}
          onClick={(e) => { 
            e.stopPropagation(); 
            addToQueue(mappedTrack);
            setError(`Añadido a la cola: ${t.title}`);
          }}
          title="Añadir a la cola"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <span style={{ width: 40, textAlign: 'right' }}>{formatDuration(t.duration)}</span>

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
              <img src={album.cover} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover' }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</h4>
                <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.artist}</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); setTrack(mappedTrack, tracks.map((tr: any) => ({ ...tr, album: album.title, cover: album.cover }))); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                <span>Reproducir</span>
              </button>
              
              <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); toggleLike(t.id); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill={isLiked(t.id) ? "var(--accent)" : "none"} stroke={isLiked(t.id) ? "var(--accent)" : "currentColor"} strokeWidth="2">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
                <span>{isLiked(t.id) ? 'Te gusta' : 'Me gusta'}</span>
              </button>

              <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); addToQueue(mappedTrack); setError(`Añadido a la cola: ${t.title}`); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                <span>Añadir a la cola</span>
              </button>
            </div>
            
            <button className="btn btn-secondary" style={{ width: '100%', marginTop: 16 }} onClick={() => setIsActionsOpen(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

export default function Album() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setTrack, currentTrack, isPlaying, addToQueue, setError } = usePlayerStore();
  const { isLiked, toggleLike } = useLikedSongs();

  const { data: album, isLoading, error } = useQuery({
    queryKey: ['album', id],
    queryFn: () => getAlbum(id!),
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="main-body" style={{ paddingTop: 24 }}>
        <div className="skeleton" style={{ height: 240, width: '100%', marginBottom: 32, borderRadius: 16 }} />
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="track-row" style={{ marginBottom: 8 }}>
            <div className="skeleton" style={{ width: 20, height: 14 }} />
            <div className="skeleton" style={{ width: 200, height: 20 }} />
            <div className="skeleton" style={{ width: 40, height: 14, marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    );
  }

  if (error || !album) {
    return (
      <div className="main-body" style={{ paddingTop: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        No se pudo cargar el álbum.
        <br />
        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => navigate(-1)}>Volver</button>
      </div>
    );
  }

  const { tracks = [] } = album;

  return (
    <div style={{ paddingBottom: 120 }}>
      {/* Hero */}
      <div className="playlist-hero" style={{
        background: 'linear-gradient(180deg, rgba(29, 185, 84, 0.3) 0%, var(--bg-elevated) 100%)'
      }}>
        <div className="playlist-cover-container">
          {album.cover && <img src={album.cover} alt={album.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
        </div>
        <div className="playlist-hero-info">
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: '#fff', marginBottom: 8 }}>
            {album.type || 'Álbum'}
          </div>
          <h1 className="playlist-title" style={{ fontWeight: 900, margin: '0 0 16px', letterSpacing: '-0.03em', lineHeight: 1, color: '#fff' }}>
            {album.title}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-secondary)' }}>
            <span style={{ fontWeight: 700, color: '#fff', cursor: 'pointer' }} onClick={() => navigate(`/artist/${encodeURIComponent(album.artist)}`)}>
              {album.artist}
            </span>
            <span>•</span>
            <span>{new Date(album.releaseDate).getFullYear()}</span>
            <span>•</span>
            <span>{album.trackCount} canciones</span>
          </div>
        </div>
      </div>

      <div className="main-body" style={{ paddingTop: 24 }}>
        {/* Actions */}
        {tracks.length > 0 && (
          <div className="playlist-action-bar">
            <button className="ctrl-btn-play" style={{ width: 56, height: 56 }}
              onClick={() => {
                const mappedTracks = tracks.map((t: any) => ({ ...t, album: album.title, cover: album.cover }));
                setTrack(mappedTracks[0], mappedTracks);
              }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
          </div>
        )}

        {/* Tracks */}
        <div className="track-list">
          {tracks.map((t: any, i: number) => (
            <AlbumTrackRow
              key={t.id}
              t={t}
              i={i}
              album={album}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              setTrack={setTrack}
              tracks={tracks}
              isLiked={isLiked}
              toggleLike={toggleLike}
              addToQueue={addToQueue}
              setError={setError}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
