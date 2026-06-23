import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import { useNotificationStore } from '../store/notificationStore';
import { usePlayerStore } from '../store/playerStore';

interface FollowedArtist {
  artistId: number;
  artistName: string;
  artistImage?: string;
  followedAt: string;
  lastReleaseDate?: string;
}

export default function Following() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'news'>('all');
  const [playingId, setPlayingId] = useState<number | null>(null);

  // Load from Zustand Stores
  const { notifications, setNotifications, markAllRead } = useNotificationStore();
  const { setTrack } = usePlayerStore();

  // Load followed artists
  const { data, isLoading, error } = useQuery<{ follows: FollowedArtist[] }>({
    queryKey: ['followed-artists'],
    queryFn: async () => {
      const userId = localStorage.getItem('koko_device_id') || '';
      const res = await fetch('http://localhost:3001/api/artist/follows', {
        headers: {
          'Content-Type': 'application/json',
          ...(userId ? { 'x-user-id': userId } : {})
        }
      });
      if (!res.ok) throw new Error('Error al cargar artistas seguidos');
      return res.json();
    },
    refetchOnWindowFocus: true,
  });

  const follows = data?.follows || [];

  // Group unread notifications by artistId
  const unreadByArtist = notifications
    .filter((n) => !n.isRead && n.artistId !== undefined)
    .reduce((acc, curr) => {
      const aId = curr.artistId!;
      if (!acc[aId]) acc[aId] = [];
      acc[aId].push(curr);
      return acc;
    }, {} as Record<number, typeof notifications>);

  const unreadCountGlobal = Object.keys(unreadByArtist).length;

  // Filter follows based on active tab and search query
  const filteredFollows = follows
    .filter((artist) => {
      if (activeTab === 'news') {
        return !!unreadByArtist[artist.artistId];
      }
      return true;
    })
    .filter((artist) =>
      artist.artistName.toLowerCase().includes(searchQuery.toLowerCase())
    );

  // Mark all notifications as read
  const handleMarkAllRead = async () => {
    try {
      markAllRead();
      await fetch('http://localhost:3001/api/artist/notifications/read', {
        method: 'POST',
      });
      // Invalidate query to refresh follows or notification status if needed
      queryClient.invalidateQueries({ queryKey: ['followed-artists'] });
    } catch (err) {
      console.error('Error al marcar notificaciones como leídas:', err);
    }
  };

  // Mark specific artist notifications as read when visiting or performing action
  const handleMarkArtistRead = async (artistId: number) => {
    const artistNotifs = unreadByArtist[artistId];
    if (!artistNotifs || artistNotifs.length === 0) return;

    // Locally mark as read in store
    const updated = notifications.map((n) =>
      n.artistId === artistId ? { ...n, isRead: true } : n
    );
    setNotifications(updated);

    // Call individual mark as read API or trigger global (global is fine)
    try {
      await fetch('http://localhost:3001/api/artist/notifications/read', {
        method: 'POST',
      });
    } catch (e) {
      // ignore
    }
  };

  // Quick Play artist's latest release or top track
  const handleQuickPlay = async (e: React.MouseEvent, artist: FollowedArtist) => {
    e.preventDefault();
    e.stopPropagation();

    const artistNotifs = unreadByArtist[artist.artistId] || [];
    const targetTrackName = artistNotifs[0]?.trackName;

    setPlayingId(artist.artistId);
    try {
      const res = await fetch(`http://localhost:3001/api/artist/${artist.artistId}?name=${encodeURIComponent(artist.artistName)}`);
      if (!res.ok) return;
      const data = await res.json();
      const tracks = data.artist?.topTracks || [];

      if (tracks.length > 0) {
        // Try to find the new release track name in topTracks, otherwise play the first track
        let trackToPlay = tracks[0];
        if (targetTrackName) {
          const found = tracks.find((t: any) =>
            t.title.toLowerCase().includes(targetTrackName.toLowerCase())
          );
          if (found) trackToPlay = found;
        }

        // Mark as read when played
        handleMarkArtistRead(artist.artistId);

        // Play
        setTrack(trackToPlay, tracks);
      }
    } catch (err) {
      console.error('Error al reproducir música del artista:', err);
    } finally {
      setPlayingId(null);
    }
  };

  return (
    <div className="main-body" style={{ paddingTop: 24, paddingBottom: 140 }}>
      {/* Dynamic Keyframes */}
      <style>{`
        .tab-btn {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.06);
          color: var(--text-secondary);
          padding: 8px 18px;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .tab-btn:hover {
          background: rgba(255,255,255,0.08);
          color: #fff;
        }
        .tab-btn.active {
          background: var(--accent);
          color: #000;
          border-color: var(--accent);
        }
        .quick-play-badge {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justifyContent: center;
          opacity: 0;
          transform: scale(0.8);
          transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
          z-index: 5;
        }
        .artist-avatar-wrap:hover .quick-play-badge {
          opacity: 1;
          transform: scale(1);
        }
        .whatsapp-badge {
          position: absolute;
          top: 0;
          right: 0;
          background: #25D366;
          color: #000;
          font-size: 11px;
          font-weight: 900;
          border-radius: 50%;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid var(--bg-card);
          box-shadow: 0 4px 10px rgba(37,211,102,0.4);
          z-index: 10;
          animation: floatBadge 2s ease-in-out infinite;
        }
        @keyframes floatBadge {
          0% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-4px) scale(1.05); }
          100% { transform: translateY(0) scale(1); }
        }
        .glow-ring {
          box-shadow: 0 0 0 3px #25D366, 0 0 20px rgba(37,211,102,0.4);
          animation: glowPulse 2s infinite;
        }
        @keyframes glowPulse {
          0% { box-shadow: 0 0 0 3px #25D366, 0 0 10px rgba(37,211,102,0.3); }
          50% { box-shadow: 0 0 0 5px #25D366, 0 0 25px rgba(37,211,102,0.6); }
          100% { box-shadow: 0 0 0 3px #25D366, 0 0 10px rgba(37,211,102,0.3); }
        }
      `}</style>

      {/* Header Panel */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 32,
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="section-title" style={{ margin: 0 }}>Siguiendo</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '6px 0 0' }}>
            Novedades y lanzamientos en tiempo real de tus artistas preferidos.
          </p>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {unreadCountGlobal > 0 && (
            <button
              onClick={handleMarkAllRead}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff',
                padding: '8px 16px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.2s',
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM2 12.5l5.5 5.5 1.42-1.42-5.5-5.5L2 12.5z" />
              </svg>
              Marcar todo como leído
            </button>
          )}

          {/* Search input */}
          {follows.length > 0 && (
            <div style={{ position: 'relative', width: 220 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
                </svg>
              </span>
              <input
                type="text"
                placeholder="Filtrar artistas..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-card)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 20,
                  color: '#fff',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  padding: '8px 12px 8px 34px',
                  outline: 'none',
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Tabs Menu */}
      {follows.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
          <button
            onClick={() => setActiveTab('all')}
            className={`tab-btn ${activeTab === 'all' ? 'active' : ''}`}
          >
            Todos ({follows.length})
          </button>
          <button
            onClick={() => setActiveTab('news')}
            className={`tab-btn ${activeTab === 'news' ? 'active' : ''}`}
          >
            Novedades
            {unreadCountGlobal > 0 && (
              <span
                style={{
                  background: activeTab === 'news' ? '#000' : '#25D366',
                  color: activeTab === 'news' ? '#fff' : '#000',
                  fontSize: 10,
                  fontWeight: 800,
                  borderRadius: 10,
                  padding: '1px 6px',
                  marginLeft: 4,
                }}
              >
                {unreadCountGlobal}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Main artist Grid */}
      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 24 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ background: 'var(--bg-card)', padding: 20, borderRadius: 16, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div className="skeleton" style={{ width: 110, height: 110, borderRadius: '50%', marginBottom: 16 }} />
              <div className="skeleton" style={{ height: 16, width: '70%', marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 12, width: '40%' }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="empty-state">
          <p style={{ color: 'red' }}>Error al cargar los artistas seguidos</p>
        </div>
      ) : follows.length === 0 ? (
        <div className="empty-state" style={{ padding: '60px 20px', textAlign: 'center', background: 'var(--bg-card)', borderRadius: 16 }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: 'var(--text-muted)' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Aún no sigues a ningún artista</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, maxWidth: 360, margin: '0 auto 24px', lineHeight: 1.5 }}>
            Sigue a tus creadores preferidos para recibir notificaciones inmediatas de sus novedades y reproducir sus últimos sencillos al instante.
          </p>
          <button
            onClick={() => navigate('/search')}
            style={{ background: 'var(--accent)', color: '#000', border: 'none', padding: '10px 24px', borderRadius: 24, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            Descubrir artistas
          </button>
        </div>
      ) : filteredFollows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)', background: 'var(--bg-card)', borderRadius: 16 }}>
          {activeTab === 'news' ? 'No tienes novedades pendientes de leer en este momento.' : `Ningún artista coincide con "${searchQuery}"`}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 24 }}>
          {filteredFollows.map((artist) => {
            const artistNotifs = unreadByArtist[artist.artistId] || [];
            const hasNews = artistNotifs.length > 0;
            const latestNotif = artistNotifs[0];

            return (
              <div
                key={artist.artistId}
                style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}
              >
                <Link
                  to={(artist.artistId && artist.artistId.toString() !== '0') ? `/artist/${artist.artistId}` : `/artist/${encodeURIComponent(artist.artistName)}`}
                  style={{ textDecoration: 'none', color: 'inherit', flex: 1 }}
                  onClick={() => handleMarkArtistRead(artist.artistId)}
                >
                  <div
                    className="album-card hover-card"
                    style={{
                      background: hasNews ? 'rgba(37,211,102,0.03)' : 'var(--bg-card)',
                      border: hasNews ? '1px solid rgba(37,211,102,0.15)' : '1px solid rgba(255,255,255,0.03)',
                      padding: 20,
                      borderRadius: 16,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.25s ease',
                      position: 'relative',
                      height: '100%',
                    }}
                  >
                    {/* Avatar Wrap */}
                    <div
                      className="artist-avatar-wrap"
                      style={{
                        width: 110,
                        height: 110,
                        borderRadius: '50%',
                        position: 'relative',
                        marginBottom: 16,
                      }}
                    >
                      {/* WhatsApp unread count overlay */}
                      {hasNews && (
                        <div className="whatsapp-badge">
                          {artistNotifs.length}
                        </div>
                      )}

                      {/* Avatar Image */}
                      <div
                        className={hasNews ? 'glow-ring' : ''}
                        style={{
                          width: '100%',
                          height: '100%',
                          borderRadius: '50%',
                          overflow: 'hidden',
                          background: 'var(--bg-highlight)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'transform 0.2s',
                        }}
                      >
                        {artist.artistImage ? (
                          <img
                            src={artist.artistImage}
                            alt={artist.artistName}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <svg width="36" height="36" viewBox="0 0 24 24" fill="var(--text-muted)">
                            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                          </svg>
                        )}
                      </div>

                      {/* Hover play overlay */}
                      <button
                        onClick={(e) => handleQuickPlay(e, artist)}
                        disabled={playingId === artist.artistId}
                        className="quick-play-badge"
                        title={hasNews ? `Reproducir lanzamiento: ${latestNotif.trackName}` : 'Reproducir éxitos'}
                        style={{
                          border: 'none',
                          cursor: 'pointer',
                          color: '#000',
                        }}
                      >
                        {playingId === artist.artistId ? (
                          <div className="spinner" style={{ width: 20, height: 20, borderWidth: 3, borderColor: '#25D366 transparent transparent transparent' }} />
                        ) : (
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: '50%',
                              background: '#25D366',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
                            }}
                          >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </div>
                        )}
                      </button>
                    </div>

                    {/* Artist Name */}
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#fff',
                        textAlign: 'center',
                        width: '100%',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        marginBottom: 6,
                      }}
                    >
                      {artist.artistName}
                    </div>

                    {/* Sub title / Update Status */}
                    {hasNews ? (
                      <div
                        style={{
                          fontSize: 11,
                          color: '#25D366',
                          textAlign: 'center',
                          width: '100%',
                          fontWeight: 600,
                          lineHeight: 1.3,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 2,
                        }}
                      >
                        <span style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.8 }}>¡Novedad!</span>
                        <span style={{ fontStyle: 'italic', color: '#fff', display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          "{latestNotif.trackName}"
                        </span>
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                        </svg>
                        Siguiendo
                      </div>
                    )}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
