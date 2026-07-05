import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useFollowArtist } from '../hooks/useFollowArtist';
import { BASE } from '../lib/api';
import { useSwipeToQueue } from '../hooks/useSwipeToQueue';

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getSimulatedPlays(track: any, index: number) {
  let hash = 0;
  const str = track.title || '';
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i);
  return Math.floor((track.popularity || 0) * 15) + (Math.abs(hash) % 40000000) + ((10 - index) * 18000000);
}

function ArtistTrackRow({
  track,
  index,
  displayedTracks,
  setTrack,
  addToQueue,
  setError,
  realPlays,
}: {
  track: any; index: number; displayedTracks: any[]; setTrack: any; addToQueue: any; setError: any;
  realPlays: Record<string, number>;
}) {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  
  const { swipeStyle, touchHandlers, swipeOffset } = useSwipeToQueue(
    track,
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
        className="track-row artist-track-row"
        onClick={() => setTrack(track, displayedTracks)}
        style={{
          ...swipeStyle,
          position: 'relative',
          zIndex: 1,
        }}
        {...touchHandlers}
      >
      <div className="track-row-num"><span style={{ color: 'var(--text-muted)' }}>{index + 1}</span></div>
      <div className="track-row-info">
        <img className="track-row-cover" src={track.cover} alt={track.title} style={{ width: 40, height: 40 }} />
        <div style={{ minWidth: 0 }}>
          <div className="track-row-name" style={{ fontSize: 14 }}>{track.title}</div>
        </div>
      </div>
      <div className="track-row-plays">
        {realPlays[track.id] && realPlays[track.id] !== -1
          ? Intl.NumberFormat('es-ES').format(realPlays[track.id])
          : Intl.NumberFormat('es-ES').format(getSimulatedPlays(track, index))}
      </div>
      <div className="track-row-duration" style={{ fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
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
        <span style={{ width: 40, textAlign: 'right' }}>{formatDuration(track.duration)}</span>

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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); setTrack(track, displayedTracks); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                <span>Reproducir</span>
              </button>

              <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); addToQueue(track); setError(`Añadido a la cola: ${track.title}`); }}>
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

export default function Artist() {
  const params = useParams<{ id?: string; name?: string }>();
  const id = params.id || params.name; // Soporta si la ruta es /artist/:id o /artist/:name
  const { setTrack, addToQueue, setError } = usePlayerStore();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery({
    queryKey: ['artist', id],
    queryFn: async () => {
      const isNumeric = id && !isNaN(Number(id)) && id !== '0';
      const url = `${BASE}/artist/${id}${!isNumeric ? `?name=${encodeURIComponent(id || '')}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Error al cargar el artista');
      const json = await res.json();
      return json.artist;
    },
    enabled: !!id,
    retry: 1,
    refetchOnWindowFocus: true,
  });

  // Follow hook — resolves after data loads (artistId from itunesArtistId)
  const artistNumericId: number | null =
    data?.itunesArtistId ?? (id && !isNaN(Number(id)) ? Number(id) : null);
  const { isFollowing, isLoading: followLoading, toggleFollow } = useFollowArtist(
    artistNumericId,
    data?.name,
    data?.image
  );

  const [activeVideo, setActiveVideo] = useState<string | null>(null);
  const [realPlays, setRealPlays] = useState<Record<string, number>>({});
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [albumFilter, setAlbumFilter] = useState<'All' | 'Álbum' | 'Single/EP'>('All');
  const [showAllAlbums, setShowAllAlbums] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const displayedTracks = data?.topTracks ? (showAllTracks ? data.topTracks.slice(0, 10) : data.topTracks.slice(0, 5)) : [];

  useEffect(() => {
    if (data?.topTracks) {
      const fetchRealPlays = async () => {
        for (const track of displayedTracks) {
          try {
            // We only fetch if it's missing (prevent refetching on every re-render)
            setRealPlays((prev) => {
              if (prev[track.id]) return prev;
              // Make fetch call outside of setState
              fetch(`${BASE}/search?q=${encodeURIComponent(track.title + ' ' + track.artist)}&limit=1&source=youtube`)
                .then(res => res.json())
                .then(json => {
                  if (json.tracks && json.tracks[0] && json.tracks[0].popularity) {
                    setRealPlays(current => ({ ...current, [track.id]: json.tracks[0].popularity }));
                  }
                }).catch(e => console.error(e));
              return { ...prev, [track.id]: -1 }; // -1 indicates loading started
            });
          } catch (e) { }
        }
      };
      fetchRealPlays();
    }
  }, [data?.topTracks, showAllTracks]);

  if (isLoading) {
    return (
      <div className="main-body" style={{ paddingTop: 24 }}>
        <div style={{ display: 'flex', gap: 32, marginBottom: 40, alignItems: 'flex-end' }}>
          <div style={{ width: 200, height: 200, borderRadius: '50%', background: 'var(--bg-card)', animation: 'pulse 1.5s infinite', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ width: 80, height: 14, background: 'var(--bg-card)', borderRadius: 4, animation: 'pulse 1.5s infinite' }} />
            <div style={{ width: 280, height: 52, background: 'var(--bg-card)', borderRadius: 8, animation: 'pulse 1.5s infinite' }} />
            <div style={{ width: 400, height: 14, background: 'var(--bg-card)', borderRadius: 4, animation: 'pulse 1.5s infinite' }} />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="main-body" style={{ paddingTop: 24 }}>
        <div className="empty-state">
          <div className="empty-state-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.4"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg></div>
          <p>No se pudo cargar la información del artista</p>
          {error && <p style={{ color: 'red', fontSize: 12 }}>Detalle: {error instanceof Error ? error.message : String(error)}</p>}
          <button onClick={() => navigate(-1)} style={{ marginTop: 16, padding: '8px 24px', borderRadius: 'var(--radius-full)', background: 'var(--accent)', color: '#000', border: 'none', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  const { name, bio, image, genre, topTracks, albums = [], musicVideos = [], livePerformances = [] } = data;

  const globalRank = data.monthlyListeners && data.monthlyListeners > 500000
    ? Math.max(1, Math.floor(150000000 / data.monthlyListeners))
    : 0;
  const isGlobalRanked = globalRank > 0 && globalRank <= 500;

  return (
    <div style={{ paddingBottom: 120 }}>
      <style>{`
        .video-card:hover { transform: scale(1.02); background: rgba(255,255,255,0.1) !important; }
        .video-card:hover .video-play-overlay { opacity: 1 !important; }
        .album-card:hover { background: rgba(255,255,255,0.1) !important; }
        .album-card .play-btn-overlay { opacity: 0; transform: translateY(10px); transition: all 0.3s ease; }
        .album-card:hover .play-btn-overlay { opacity: 1; transform: translateY(0); }
        .hero-banner { filter: blur(40px) brightness(0.4); transform: scale(1.2); transition: all 1s ease-out; }
        
        .follow-btn { transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s, color 0.2s, border-color 0.2s !important; }
        .follow-btn:active { transform: scale(0.9) !important; }
        .follow-btn.following { background: #fff !important; color: #000 !important; border-color: #fff !important; animation: followPop 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        @keyframes followPop {
          0% { transform: scale(0.85); }
          50% { transform: scale(1.08); }
          100% { transform: scale(1); }
        }
      `}</style>

      {/* Hero Immersivo */}
      <div className="artist-hero">
        {/* Fondo (Imagen o Fanart siempre) */}
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundImage: `url(${data.fanart || image})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center top',
          filter: data.fanart ? 'none' : 'blur(40px) brightness(0.4)',
          opacity: data.fanart ? 0.8 : 1,
          transform: 'scale(1.05)',
          zIndex: -1,
          maskImage: data.fanart ? 'linear-gradient(to bottom, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 100%)' : 'none',
          WebkitMaskImage: data.fanart ? 'linear-gradient(to bottom, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 100%)' : 'none'
        }} />

        {/* Gradient superpuesto para transición suave */}
        <div style={{
          position: 'absolute',
          bottom: 0, left: 0, right: 0, height: '60%',
          background: 'linear-gradient(to top, var(--bg-base) 0%, transparent 100%)',
          zIndex: -1,
        }} />
        <div className="artist-hero-content">
          {/* Avatar circular */}
          <div className="artist-avatar-container">
            {image ? (
              <img src={image} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <svg width="80" height="80" viewBox="0 0 24 24" fill="var(--text-muted)">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            )}
          </div>

          {/* Info y Botones */}
          <div className="artist-hero-info">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 12, flexWrap: 'wrap' }}>
              {data.isVerified && (
                <>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="#3D91F4">
                    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z" />
                  </svg>
                  <span>Artista Verificado</span>
                </>
              )}
              {genre ? (data.isVerified ? ` · ${genre}` : genre) : ''}
              <span style={{ margin: '0 4px' }}>•</span>
              {data.playcount ? (
                <>
                  <span style={{ color: 'var(--accent)' }}>{Intl.NumberFormat('es-ES').format(data.playcount)}</span> reproducciones
                  <span style={{ margin: '0 4px' }}>•</span>
                  {Intl.NumberFormat('es-ES').format(data.monthlyListeners)} oyentes mensuales
                </>
              ) : (
                <>{Intl.NumberFormat('es-ES').format(data.monthlyListeners || (topTracks.reduce((acc: number, t: any) => acc + (t.popularity || 0), 0) * 2 + 1500000))} oyentes mensuales</>
              )}
              {isGlobalRanked && (
                <>
                  <span style={{ margin: '0 4px' }}>•</span>
                  <Link
                    to="/top-artists"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      background: 'rgba(255,255,255,0.1)', padding: '4px 10px',
                      borderRadius: 20, color: 'var(--accent)', textDecoration: 'none',
                      transition: 'background 0.2s',
                    }}
                    className="hover-card"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.5 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                    </svg>
                    #{globalRank} del mundo
                  </Link>
                </>
              )}
            </div>
            <h1 className="artist-title" style={{ fontWeight: 900, margin: '0 0 24px', letterSpacing: '-0.04em', lineHeight: 1, color: '#fff' }}>
              {name}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              {/* Botón Play gigante */}
              <button
                className="play-btn"
                style={{ width: 56, height: 56, background: 'var(--accent)', borderRadius: '50%', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', transition: 'transform 0.1s' }}
                onClick={() => topTracks.length > 0 && setTrack(topTracks[0], topTracks)}
                title="Reproducir artista"
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              </button>

              {/* Botón Seguir */}
              <button
                onClick={toggleFollow}
                disabled={followLoading}
                className={`follow-btn ${isFollowing ? 'following' : ''}`}
                style={{
                  background: isFollowing ? '#fff' : 'transparent',
                  border: '1px solid rgba(255,255,255,0.5)',
                  color: isFollowing ? '#000' : '#fff',
                  padding: '8px 32px',
                  borderRadius: 32,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: followLoading ? 'default' : 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  borderColor: isFollowing ? '#fff' : 'rgba(255,255,255,0.5)',
                  opacity: followLoading ? 0.7 : 1,
                }}
                onMouseOver={(e) => !followLoading && (e.currentTarget.style.borderColor = '#fff')}
                onMouseOut={(e) => !followLoading && (e.currentTarget.style.borderColor = isFollowing ? '#fff' : 'rgba(255,255,255,0.5)')}
              >
                {followLoading ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
                    {isFollowing ? 'Siguiendo' : 'Seguir'}
                  </span>
                ) : isFollowing ? 'Siguiendo' : 'Seguir'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Grid Content */}
      <div className="artist-body-grid">

        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
          {/* Top tracks */}
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Populares</h2>
            {topTracks.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No se encontraron canciones.</p>
            ) : (
              <div className="track-list">
                {displayedTracks.map((track: any, index: number) => (
                  <ArtistTrackRow
                    key={`${track.id}-${index}`}
                    track={track}
                    index={index}
                    displayedTracks={displayedTracks}
                    setTrack={setTrack}
                    addToQueue={addToQueue}
                    setError={setError}
                    realPlays={realPlays}
                  />
                ))}
                {topTracks.length > 5 && (
                  <button
                    onClick={() => setShowAllTracks(!showAllTracks)}
                    style={{
                      background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                      fontSize: 14, fontWeight: 700, padding: '16px 12px', cursor: 'pointer',
                      textAlign: 'left', width: '100%'
                    }}
                  >
                    {showAllTracks ? 'Mostrar menos' : 'Ver más'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Discografía (Albums y Singles) */}
          {albums && albums.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Lanzamientos</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { setAlbumFilter('All'); setShowAllAlbums(false); }} style={{ padding: '6px 12px', borderRadius: 20, background: albumFilter === 'All' ? 'var(--accent)' : 'rgba(255,255,255,0.1)', color: albumFilter === 'All' ? '#000' : '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Todos</button>
                  <button onClick={() => { setAlbumFilter('Álbum'); setShowAllAlbums(false); }} style={{ padding: '6px 12px', borderRadius: 20, background: albumFilter === 'Álbum' ? 'var(--accent)' : 'rgba(255,255,255,0.1)', color: albumFilter === 'Álbum' ? '#000' : '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Álbumes</button>
                  <button onClick={() => { setAlbumFilter('Single/EP'); setShowAllAlbums(false); }} style={{ padding: '6px 12px', borderRadius: 20, background: albumFilter === 'Single/EP' ? 'var(--accent)' : 'rgba(255,255,255,0.1)', color: albumFilter === 'Single/EP' ? '#000' : '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Sencillos</button>
                </div>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 24
              }}>
                {albums
                  .filter((a: any) => albumFilter === 'All' || a.type === albumFilter)
                  .slice(0, showAllAlbums ? undefined : 6)
                  .map((album: any) => (
                    <div key={album.id} style={{
                      background: 'var(--bg-card)', padding: 16, borderRadius: 12,
                      transition: 'background 0.3s ease', cursor: 'pointer'
                    }} className="album-card"
                      onClick={() => navigate(`/album/${album.id}`)}
                    >
                      <div style={{ position: 'relative' }}>
                        <img src={album.cover} alt={album.title} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: 8, marginBottom: 16, boxShadow: '0 8px 16px rgba(0,0,0,0.4)' }} />
                        <div className="play-btn-overlay" style={{ position: 'absolute', bottom: 16, right: 8 }}>
                          <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', boxShadow: '0 8px 8px rgba(0,0,0,0.3)' }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                          </div>
                        </div>
                      </div>
                      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album.title}</h3>
                      <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>{new Date(album.releaseDate).getFullYear()} • {album.type}</p>
                    </div>
                  ))}
              </div>

              {albums.filter((a: any) => albumFilter === 'All' || a.type === albumFilter).length > 6 && (
                <button
                  onClick={() => setShowAllAlbums(!showAllAlbums)}
                  style={{
                    marginTop: 24, background: 'transparent', border: 'none', color: 'var(--text-secondary)',
                    fontSize: 14, fontWeight: 700, cursor: 'pointer', textAlign: 'left', width: '100%'
                  }}
                >
                  {showAllAlbums ? 'Mostrar menos' : `Ver más lanzamientos`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 40, height: '100%' }}>

          {/* Selección del Artista (Artist Pick) */}
          {albums && albums.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {image ? (
                  <img src={image} alt={name} style={{ width: 24, height: 24, borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--bg-card)' }} />
                )}
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>Selección del artista</span>
              </div>
              <div
                style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', transition: 'background 0.3s ease' }}
                className="album-card"
                onClick={() => navigate(`/album/${albums[0].id}`)}
              >
                <img src={albums[0].cover} alt="Latest" style={{ width: '100%', height: 300, objectFit: 'cover', objectPosition: 'center 20%' }} />
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    Último lanzamiento • {new Date(albums[0].releaseDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {albums[0].title}
                  </h3>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{albums[0].type}</div>
                </div>
              </div>
            </div>
          )}

          {/* Acerca de Compacto */}
          {bio && bio !== 'Biografía no disponible.' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Acerca de</h2>
              <div style={{
                background: 'var(--bg-card)', borderRadius: 12, padding: 24,
                cursor: 'pointer', transition: 'background 0.3s',
                flex: 1, display: 'flex', flexDirection: 'column', minHeight: 280
              }} className="album-card">
                <p className="custom-scrollbar" style={{
                  fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.7,
                  margin: 0, flex: '1 1 0%', whiteSpace: 'pre-wrap', overflowY: 'auto', paddingRight: 8
                }}>
                  {bio}
                </p>

                <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, background: 'rgba(255,255,255,0.1)', padding: '4px 12px', borderRadius: 12 }}>{genre || 'Música'}</span>
                  </div>

                  {/* Redes Sociales / Fan Support */}
                  {data.socialLinks && (
                    <div style={{ display: 'flex', gap: 16 }}>
                      {data.socialLinks.twitter && (
                        <a href={data.socialLinks.twitter} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)' }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                        </a>
                      )}
                      {data.socialLinks.youtube && (
                        <a href={data.socialLinks.youtube} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)' }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21.582 6.186a2.697 2.697 0 0 0-1.894-1.913C17.986 3.8 12 3.8 12 3.8s-5.986 0-7.688.473A2.697 2.697 0 0 0 2.418 6.186C1.944 7.9 1.944 12 1.944 12s0 4.1.474 5.814a2.697 2.697 0 0 0 1.894 1.913C5.986 20.2 12 20.2 12 20.2s5.986 0 7.688-.473a2.697 2.697 0 0 0 1.894-1.913C22.056 16.1 22.056 12 22.056 12s0-4.1-.474-5.814zM9.912 15.518V8.482L16.036 12z" /></svg>
                        </a>
                      )}
                      {data.socialLinks.instagram && (
                        <a href={data.socialLinks.instagram} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)' }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2zm0 1.5A4.25 4.25 0 0 0 3.5 7.75v8.5A4.25 4.25 0 0 0 7.75 20.5h8.5a4.25 4.25 0 0 0 4.25-4.25v-8.5A4.25 4.25 0 0 0 16.25 3.5h-8.5zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 1.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm4.75-2.75a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z" /></svg>
                        </a>
                      )}
                      {data.socialLinks.spotify && (
                        <a href={data.socialLinks.spotify} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)' }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.622.622 0 0 1-.853.207c-2.333-1.424-5.273-1.745-8.741-.955a.625.625 0 1 1-.274-1.22c3.784-.862 7.039-.494 9.66 1.115a.622.622 0 0 1 .208.853zm1.226-2.74a.78.78 0 0 1-1.07.258c-2.684-1.648-6.78-2.128-9.965-1.162a.781.781 0 1 1-.453-1.493c3.673-1.112 8.196-.583 11.23 1.282a.78.78 0 0 1 .258 1.115zm.116-2.859c-3.215-1.908-8.513-2.083-11.583-1.15a.937.937 0 1 1-.54-1.795c3.528-1.066 9.37-.866 13.084 1.336a.937.937 0 1 1-1.002 1.609z" /></svg>
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Row inferior para Media (Videos) — estilo vertical TikTok/Reels */}
      {(musicVideos.length > 0 || livePerformances.length > 0) && (
        <div style={{ padding: '0 32px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Clips y Canvas</h2>
            <span style={{
              fontSize: 11, fontWeight: 700, background: '#FF0000', color: '#fff',
              padding: '3px 8px', borderRadius: 4, letterSpacing: 0.5,
            }}>
              YOUTUBE
            </span>
          </div>

          {/* Horizontal scroll strip of vertical 9:16 cards */}
          <div style={{
            display: 'flex',
            gap: 16,
            overflowX: 'auto',
            paddingBottom: 16,
            scrollSnapType: 'x mandatory',
            scrollbarWidth: 'none',
          }}>
            {[...musicVideos.slice(0, 6), ...livePerformances.slice(0, 3)].map((video: any) => (
              <div
                key={video.id}
                className="video-card"
                style={{
                  flexShrink: 0,
                  width: 200,
                  scrollSnapAlign: 'start',
                  background: 'var(--bg-card)',
                  borderRadius: 16,
                  overflow: 'hidden',
                  transition: 'transform 0.25s ease',
                  position: 'relative',
                  cursor: 'pointer',
                }}
              >
                {/* 9:16 portrait container */}
                <div style={{ position: 'relative', aspectRatio: '9/16', background: '#000' }}>
                  {activeVideo === video.id ? (
                    <iframe
                      width="100%"
                      height="100%"
                      src={`https://www.youtube.com/embed/${video.id}?autoplay=1&rel=0`}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                    />
                  ) : (
                    <div
                      onClick={() => setActiveVideo(video.id)}
                      style={{ width: '100%', height: '100%', cursor: 'pointer', position: 'relative' }}
                    >
                      {/* Thumbnail — cropped to portrait */}
                      <img
                        src={video.thumbnail}
                        alt={video.title}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          objectPosition: 'center',
                        }}
                      />

                      {/* Dark gradient at bottom */}
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%',
                        background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)',
                      }} />

                      {/* Duration badge — top right */}
                      <div style={{
                        position: 'absolute', top: 10, right: 10,
                        background: 'rgba(0,0,0,0.75)', padding: '3px 7px',
                        borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#fff',
                      }}>
                        {video.duration}
                      </div>

                      {/* YouTube play button overlay — centre */}
                      <div className="video-play-overlay" style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: 0, transition: 'opacity 0.2s',
                      }}>
                        <div style={{
                          width: 52, height: 52, borderRadius: '50%',
                          background: '#FF0000',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: '0 4px 16px rgba(255,0,0,0.5)',
                        }}>
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="#fff">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      </div>

                      {/* Title at bottom */}
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        padding: '12px 12px 14px',
                      }}>
                        <p style={{
                          margin: 0, fontSize: 12, fontWeight: 700, color: '#fff',
                          lineHeight: 1.3,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}>
                          {video.title}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Próximos Eventos & Merchandising */}
      {((data.events && data.events.length > 0) || (data.merch && data.merch.length > 0)) && (
        <div style={{ padding: '0 32px 40px', display: 'flex', gap: 32, flexWrap: 'wrap' }}>

          {/* Próximos Eventos */}
          {data.events && data.events.length > 0 && (
            <div style={{ flex: 2, minWidth: 300 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>En concierto</h2>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Vía Ticketmaster</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {data.events.map((ev: any, i: number) => {
                  const d = ev.date ? new Date(ev.date + 'T12:00:00') : null;
                  const day = d ? d.toLocaleString('es-ES', { day: '2-digit' }) : '--';
                  const month = d ? d.toLocaleString('es-ES', { month: 'short' }).toUpperCase() : '--';
                  const year = d ? d.getFullYear() : '';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card)', padding: '16px', borderRadius: 12, cursor: ev.url ? 'pointer' : 'default', transition: 'background 0.2s', opacity: ev.soldOut ? 0.7 : 1 }} className={ev.url ? 'hover-card' : ''}
                      onClick={() => ev.url && !ev.soldOut && window.open(ev.url, '_blank')}
                    >
                      <div style={{ width: 64, textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: 16, marginRight: 16, flexShrink: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: ev.soldOut ? 'var(--text-muted)' : 'var(--accent)', letterSpacing: 1 }}>{month}</div>
                        <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{day}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{year}</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {ev.name && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.name}</div>}
                        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.city}{ev.country ? `, ${ev.country}` : ''}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.venue}</div>
                      </div>
                      {ev.soldOut ? (
                        <div style={{ background: 'rgba(255,60,60,0.15)', border: '1px solid rgba(255,60,60,0.4)', color: '#ff6b6b', padding: '6px 14px', borderRadius: 20, fontSize: 12, fontWeight: 800, flexShrink: 0, letterSpacing: 0.5 }}>
                          SOLD OUT
                        </div>
                      ) : ev.url ? (
                        <button style={{ background: 'var(--accent)', color: '#000', border: 'none', padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
                          Entradas
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Merchandising */}
          {data.merch && data.merch.length > 0 && (
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Merchandising</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {data.merch.map((item: any, i: number) => (
                  <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', transition: 'background 0.2s' }} className="hover-card">
                      <div style={{ height: 200, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                        {item.image ? (
                          <img src={item.image} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.5)' }} />
                        ) : null}
                        <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20.38 3.46L16 2a8.5 8.5 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z" /></svg>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tienda Oficial</span>
                        </div>
                      </div>
                      <div style={{ padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{item.name}</div>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><path d="M7 17L17 7M7 7h10v10" /></svg>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Artistas Similares */}
      {data.similarArtists && data.similarArtists.length > 0 && (
        <div style={{ padding: '0 32px 40px' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Fans también escuchan</h2>
          <div style={{ display: 'flex', gap: 20, overflowX: 'auto', paddingBottom: 24, scrollSnapType: 'x mandatory' }}>
            {data.similarArtists.map((artist: any, idx: number) => (
              <Link
                key={idx}
                to={`/artist/${encodeURIComponent(artist.name)}`}
                style={{
                  textDecoration: 'none',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  width: 140, flexShrink: 0, scrollSnapAlign: 'start',
                  transition: 'transform 0.3s ease',
                }}
                className="hover-card"
              >
                <div style={{
                  width: 140, height: 140, borderRadius: '50%', overflow: 'hidden',
                  marginBottom: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                  background: 'var(--bg-card)'
                }}>
                  {artist.image ? (
                    <img src={artist.image} alt={artist.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', textAlign: 'center', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {artist.name}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Galería de Imágenes Inferior */}
      {data.gallery && data.gallery.length > 0 && (
        <div style={{ padding: '0 32px 60px' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Galería</h2>
          <div style={{ display: 'flex', gap: 20, overflowX: 'auto', paddingBottom: 24, scrollSnapType: 'x mandatory' }}>
            {data.gallery.map((imgUrl: string, idx: number) => (
              <div
                key={idx}
                onClick={() => setSelectedImage(imgUrl)}
                style={{
                  width: 320, height: 320, flexShrink: 0, scrollSnapAlign: 'start',
                  borderRadius: 16, overflow: 'hidden', cursor: 'pointer',
                  transition: 'transform 0.3s ease',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
                }}
                className="gallery-img"
              >
                <img src={imgUrl} alt="Galería" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fullscreen Image Modal */}
      {selectedImage && (
        <div
          onClick={() => setSelectedImage(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)',
            zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out', padding: 40
          }}
        >
          <img
            src={selectedImage}
            alt="Fullscreen Galería"
            style={{
              maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
              borderRadius: 12, boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
              animation: 'zoomIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
            }}
          />
          <style>{`
            @keyframes zoomIn {
              from { transform: scale(0.9); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
            }
            .gallery-img:hover { transform: scale(1.03); }
          `}</style>
        </div>
      )}
    </div>
  );
}
