import { useState, useEffect } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { searchTracks, type Track } from '../../lib/api';
import { getApiUrl } from '../../lib/backendResolver';

interface DailyDropComment {
  id: string;
  content: string;
  created_at: string;
  user: {
    display_name: string;
    avatar_url?: string;
  };
}

interface DailyDrop {
  id: string;
  user_id: string;
  track_id: string;
  title: string;
  artist: string;
  cover?: string;
  caption?: string;
  drop_date: string;
  created_at: string;
  user: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
  };
  comments: DailyDropComment[];
}

interface BeMusicFeedProps {
  userId: string;
}

export default function BeMusicFeed({ userId }: BeMusicFeedProps) {
  const { currentTrack, setTrack } = usePlayerStore();
  // Load cached feed for instant 0ms initial display
  const cacheKey = `koko_bemusic_cache_${userId}`;
  const cachedData = (() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const [loading, setLoading] = useState(!cachedData);
  const [hasUserDroppedToday, setHasUserDroppedToday] = useState<boolean>(cachedData?.hasUserDroppedToday || false);
  const [myDropToday, setMyDropToday] = useState<DailyDrop | null>(cachedData?.myDropToday || null);
  const [streak, setStreak] = useState<number>(cachedData?.streak || 0);
  const [friendDrops, setFriendDrops] = useState<DailyDrop[]>(cachedData?.friendDropsToday || []);

  // Post modal / search states
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [caption, setCaption] = useState('');
  const [isPosting, setIsPosting] = useState(false);

  // Comment input state
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});

  // Archive state
  const [showArchive, setShowArchive] = useState(false);
  const [myArchive, setMyArchive] = useState<DailyDrop[]>([]);

  const fetchFeed = async (showSpinner = false) => {
    if (!userId) return;
    if (showSpinner) setLoading(true);
    try {
      const API_BASE = await getApiUrl();
      const res = await fetch(`${API_BASE}/friends/daily-drops?userId=${userId}`);
      if (res.ok) {
        const data = await res.json();
        setHasUserDroppedToday(data.hasUserDroppedToday);
        setMyDropToday(data.myDropToday);
        setStreak(data.streak || 0);
        setFriendDrops(data.friendDropsToday || []);
        localStorage.setItem(cacheKey, JSON.stringify(data));
      }
    } catch (e) {
      console.error('Error fetching BeMusic feed:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeed(!cachedData);
  }, [userId]);

  // Pre-select currentTrack if available
  useEffect(() => {
    if (currentTrack && !selectedTrack) {
      setSelectedTrack(currentTrack);
    }
  }, [currentTrack]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    try {
      const res = await searchTracks(searchQuery.trim(), 5);
      setSearchResults(res.tracks || []);
    } catch (err) {
      console.error('Error searching track:', err);
    }
  };

  const handlePostDrop = async () => {
    if (!selectedTrack || !userId || isPosting) return;
    setIsPosting(true);
    try {
      const API_BASE = await getApiUrl();
      const res = await fetch(`${API_BASE}/friends/daily-drop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          trackId: selectedTrack.id,
          title: selectedTrack.title,
          artist: selectedTrack.artist,
          cover: selectedTrack.cover,
          caption: caption.trim(),
        }),
      });

      if (res.ok) {
        fetchFeed();
      }
    } catch (err) {
      console.error('Error posting daily drop:', err);
    } finally {
      setIsPosting(false);
    }
  };

  const handleAddComment = async (dropId: string) => {
    const text = commentInputs[dropId]?.trim();
    if (!text || !userId) return;
    try {
      const API_BASE = await getApiUrl();
      const res = await fetch(`${API_BASE}/friends/daily-drop/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropId, userId, content: text }),
      });

      if (res.ok) {
        setCommentInputs((prev) => ({ ...prev, [dropId]: '' }));
        fetchFeed();
      }
    } catch (err) {
      console.error('Error adding comment:', err);
    }
  };

  const fetchArchive = async () => {
    if (!userId) return;
    try {
      const API_BASE = await getApiUrl();
      const res = await fetch(`${API_BASE}/friends/daily-drop/mine?userId=${userId}`);
      if (res.ok) {
        const data = await res.json();
        setMyArchive(data.drops || []);
        setShowArchive(true);
      }
    } catch (e) {
      console.error('Error fetching archive:', e);
    }
  };

  return (
    <div style={{ marginBottom: 32, animation: 'fadeIn var(--duration-fast) ease-out' }}>
      {/* Header Banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, rgba(241, 7, 163, 0.15) 0%, rgba(138, 43, 226, 0.15) 100%)',
          padding: '16px 20px',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid rgba(241, 7, 163, 0.25)',
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0, letterSpacing: -0.5 }}>BeMusic</h2>
            {streak > 0 && (
              <span
                style={{
                  background: 'linear-gradient(135deg, #FF9F1C, #FF5400)',
                  color: '#000',
                  padding: '3px 10px',
                  borderRadius: 12,
                  fontSize: 11,
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 23c-4.97 0-9-4.03-9-9 0-4.13 2.82-7.58 6.64-8.62-.25.86-.39 1.76-.39 2.68 0 3.31 2.69 6 6 6s6-2.69 6-6c0-.92-.14-1.82-.39-2.68C20.18 6.42 23 9.87 23 14c0 4.97-4.03 9-9 9z"/></svg>
                {streak} {streak === 1 ? 'Día' : 'Días'} de racha
              </span>
            )}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '4px 0 0 0' }}>
            Tu canción del día. Una publicación diaria compartida con tus amigos.
          </p>
        </div>

        <button
          onClick={fetchArchive}
          style={{
            background: 'rgba(255, 255, 255, 0.08)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            color: '#fff',
            padding: '7px 14px',
            borderRadius: 'var(--radius-full)',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>Mi Historial</span>
        </button>
      </div>

      {/* Posting Section */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 16,
          padding: 16,
          marginBottom: 24,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 12px 0' }}>
          {hasUserDroppedToday ? (
            <span style={{ color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Canción de hoy: {myDropToday?.title} - {myDropToday?.artist}</span>
            </span>
          ) : (
            'Publica tu canción del día'
          )}
        </h3>

        {/* Selected track preview */}
        {selectedTrack ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(255, 255, 255, 0.06)',
              padding: 10,
              borderRadius: 12,
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <img src={selectedTrack.cover} alt={selectedTrack.title} style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{selectedTrack.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{selectedTrack.artist}</div>
              </div>
            </div>
            <button
              onClick={() => setSelectedTrack(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 14 }}
            >
              Cambiar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              placeholder="Buscar canción para publicar..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#fff',
                fontSize: 12,
              }}
            />
            <button
              type="submit"
              style={{
                background: 'var(--accent)',
                color: '#000',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                fontWeight: 700,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Buscar
            </button>
          </form>
        )}

        {/* Search Results selection */}
        {!selectedTrack && searchResults.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, maxHeight: 160, overflowY: 'auto' }}>
            {searchResults.map((t) => (
              <div
                key={t.id}
                onClick={() => { setSelectedTrack(t); setSearchResults([]); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 6,
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)',
                  cursor: 'pointer',
                }}
              >
                <img src={t.cover} alt={t.title} style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover' }} />
                <div style={{ flex: 1, fontSize: 12 }}>
                  <div style={{ fontWeight: 600 }}>{t.title}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: 10 }}>{t.artist}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Caption & Post Button */}
        {selectedTrack && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              placeholder="Añade un comentario (opcional)..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              style={{
                flex: 1,
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#fff',
                fontSize: 12,
              }}
            />
            <button
              onClick={handlePostDrop}
              disabled={isPosting}
              style={{
                background: 'linear-gradient(135deg, var(--accent), var(--accent-dim))',
                color: '#000',
                border: 'none',
                borderRadius: 8,
                padding: '8px 16px',
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {isPosting ? 'Publicando...' : hasUserDroppedToday ? 'Actualizar Canción' : 'Publicar Ahora'}
            </button>
          </div>
        )}
      </div>

      {/* FEED SECTION */}
      {loading ? (
        <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Cargando feed BeMusic...
        </div>
      ) : !hasUserDroppedToday ? (
        /* LOCKED STATE */
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(16px)',
            borderRadius: 16,
            padding: '40px 20px',
            textAlign: 'center',
            border: '1px dashed rgba(255, 255, 255, 0.15)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: 'var(--text-secondary)' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>Feed Bloqueado</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, maxWidth: 360, margin: '0 auto 16px' }}>
            Publica tu canción del día arriba para desbloquear las canciones de tus amigos de hoy.
          </p>
        </div>
      ) : friendDrops.length === 0 ? (
        <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
          Tus amigos aún no han publicado su canción de hoy. ¡Sé el primero!
        </div>
      ) : (
        /* UNLOCKED FRIEND DROPS FEED */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {friendDrops.map((drop) => {
            const isMe = drop.user_id === userId;

            return (
              <div
                key={drop.id}
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 16,
                  padding: 16,
                }}
              >
                {/* Author Info */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: '50%',
                        background: 'var(--accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14,
                        fontWeight: 800,
                        color: '#000',
                        overflow: 'hidden',
                      }}
                    >
                      {drop.user?.avatar_url ? (
                        <img src={drop.user.avatar_url} alt={drop.user.display_name || 'Usuario'} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        (drop.user?.display_name || 'U').charAt(0).toUpperCase()
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>
                        {drop.user?.display_name || 'Usuario Koko'} {isMe && <span style={{ fontSize: 11, color: 'var(--accent)' }}>(Tú)</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>@{drop.user?.username || 'kokoer'}</div>
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {new Date(drop.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Track Card */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    background: 'rgba(0,0,0,0.3)',
                    padding: 12,
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.06)',
                    marginBottom: 12,
                  }}
                >
                  <img src={drop.cover} alt={drop.title} style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{drop.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{drop.artist}</div>
                  </div>
                  <button
                    onClick={() => {
                      const t: Track = {
                        id: drop.track_id,
                        title: drop.title,
                        artist: drop.artist,
                        album: 'Sencillo',
                        cover: drop.cover || '',
                        duration: 180,
                        popularity: 80,
                        preview_url: null,
                      };
                      setTrack(t, [t]);
                    }}
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: '50%',
                      background: 'var(--accent)',
                      color: '#000',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px var(--accent-glow)',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  </button>
                </div>

                {/* Caption */}
                {drop.caption && (
                  <p style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--text-primary)', margin: '0 0 12px 0' }}>
                    "{drop.caption}"
                  </p>
                )}

                {/* Comments List */}
                {drop.comments.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10, background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 10 }}>
                    {drop.comments.map((c) => (
                      <div key={c.id} style={{ fontSize: 12 }}>
                        <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{c.user.display_name}: </span>
                        <span>{c.content}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Comment Input */}
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Escribe un comentario..."
                    value={commentInputs[drop.id] || ''}
                    onChange={(e) => setCommentInputs((prev) => ({ ...prev, [drop.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddComment(drop.id)}
                    style={{
                      flex: 1,
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8,
                      padding: '6px 10px',
                      color: '#fff',
                      fontSize: 11,
                    }}
                  />
                  <button
                    onClick={() => handleAddComment(drop.id)}
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Comentar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Archive Modal */}
      {showArchive && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(12px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowArchive(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 450,
              background: 'rgba(18, 18, 22, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 16,
              padding: 20,
              color: '#fff',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span>Tu Historial BeMusic</span>
              </h3>
              <button onClick={() => setShowArchive(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>

            {myArchive.length === 0 ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
                Aún no tienes publicaciones guardadas
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {myArchive.map((d) => (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 8, borderRadius: 10, background: 'rgba(255,255,255,0.03)' }}>
                    <img src={d.cover} alt={d.title} style={{ width: 40, height: 40, borderRadius: 6, objectFit: 'cover' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>{d.title}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{d.artist} &bull; {d.drop_date}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
