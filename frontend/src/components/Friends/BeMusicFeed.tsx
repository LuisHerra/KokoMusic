import { useState, useEffect } from 'react';
import { usePlayerStore, setPendingStart } from '../../store/playerStore';
import { searchTracks, resolveImageUrl, postDailyDrop, type Track } from '../../lib/api';
import { getApiUrl } from '../../lib/backendResolver';
import VinylLauncher from './VinylLauncher';
import BeMusicHistory from './BeMusicHistory';
import StreakCelebration, { FlameIcon } from './StreakCelebration';
import './BeMusicFeed.css';

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
  start_s?: number;
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

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** La duración de Track llega en ms (búsqueda) o en s según el origen. */
const trackSeconds = (t: Track | null) => {
  if (!t?.duration) return 240;
  return t.duration > 10000 ? Math.round(t.duration / 1000) : t.duration;
};

export default function BeMusicFeed({ userId }: BeMusicFeedProps) {
  const { currentTrack, isPlaying, setTrack, progress } = usePlayerStore();
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

  // Composer
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [startS, setStartS] = useState(0);
  const [caption, setCaption] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [postError, setPostError] = useState('');

  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  // Comentarios desplegados por drop (por defecto solo se ven los 2 últimos)
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});

  const [showArchive, setShowArchive] = useState(false);
  const [myArchive, setMyArchive] = useState<DailyDrop[]>([]);

  const [celebrate, setCelebrate] = useState<number | null>(null);

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

  // Pre-selecciona la canción que suena, desde el momento en que va
  useEffect(() => {
    if (currentTrack && !selectedTrack) {
      setSelectedTrack(currentTrack);
      setStartS(Math.floor(usePlayerStore.getState().progress));
    }
  }, [currentTrack]);

  const pickTrack = (t: Track) => {
    setSelectedTrack(t);
    setSearchResults([]);
    setSearchQuery('');
    setStartS(t.id === currentTrack?.id ? Math.floor(progress) : 0);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    try {
      const res = await searchTracks(searchQuery.trim(), 6);
      setSearchResults(res.tracks || []);
    } catch (err) {
      console.error('Error searching track:', err);
    }
  };

  /** Lo llama el vinilo al lanzarse. Devuelve si la publicación fue bien. */
  const handleLaunch = async (): Promise<boolean> => {
    if (!selectedTrack || !userId) return false;
    setIsPosting(true);
    setPostError('');
    const wasFirstToday = !hasUserDroppedToday;
    try {
      const res = await postDailyDrop(userId, selectedTrack, caption.trim(), startS);
      setCaption('');
      setComposerOpen(false);
      await fetchFeed();
      if (wasFirstToday && res.streak > 0) setTimeout(() => setCelebrate(res.streak), 700);
      return true;
    } catch (err: any) {
      setPostError(err?.message || 'No se pudo publicar. Inténtalo de nuevo.');
      return false;
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

  const playDrop = (d: Pick<DailyDrop, 'track_id' | 'title' | 'artist' | 'cover' | 'start_s'>) => {
    const t: Track = {
      id: d.track_id,
      title: d.title,
      artist: d.artist,
      album: 'Sencillo',
      cover: d.cover || '',
      duration: 180,
      popularity: 80,
      preview_url: null,
    };
    setPendingStart(Number(d.start_s) || 0);
    setTrack(t, [t]);
  };

  const previewMoment = () => {
    if (!selectedTrack) return;
    setPendingStart(startS);
    setTrack(selectedTrack, [selectedTrack]);
  };

  const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  const friendsPosted = friendDrops.filter((d) => d.user_id !== userId).length;
  const showComposer = !hasUserDroppedToday || composerOpen;
  const maxStart = Math.max(0, trackSeconds(selectedTrack) - 15);

  return (
    <div className="bm">
      {/* Hero */}
      <header className="bm-hero">
        <div className="bm-hero-glow" />
        <div className="bm-hero-row">
          <div>
            <p className="bm-date">{today}</p>
            <h2 className="bm-logo">BeMusic<span>.</span></h2>
          </div>
          <div className="bm-hero-actions">
            <button
              className={`bm-streak ${streak > 0 ? 'bm-streak--on' : ''}`}
              onClick={() => streak > 0 && setCelebrate(streak)}
              title={streak > 0 ? 'Ver tu racha' : 'Publica hoy para empezar una racha'}
            >
              <FlameIcon size={20} className={streak > 0 ? '' : 'bm-flame--off'} />
              <span>{streak}</span>
            </button>
            <button className="bm-icon-btn" onClick={fetchArchive} title="Mi historial">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </button>
          </div>
        </div>
        <p className="bm-tagline">Una canción al día. Lánzala y descubre qué suena hoy en la vida de tus amigos.</p>
      </header>

      {/* Tu canción de hoy (ya publicada) */}
      {hasUserDroppedToday && myDropToday && !composerOpen && (
        <section className="bm-mine">
          <div className="bm-mine-disc" style={myDropToday.cover ? { backgroundImage: `url("${myDropToday.cover}")` } : undefined} />
          <div className="bm-mine-meta">
            <span className="bm-kicker">Tu canción de hoy</span>
            <div className="bm-mine-title">{myDropToday.title}</div>
            <div className="bm-mine-artist">
              {myDropToday.artist}
              {Number(myDropToday.start_s) > 0 && <> · desde {fmt(Number(myDropToday.start_s))}</>}
            </div>
          </div>
          <button className="bm-text-btn" onClick={() => setComposerOpen(true)}>Cambiar</button>
        </section>
      )}

      {/* Composer: elegir canción, momento y lanzarla */}
      {showComposer && (
        <section className="bm-composer">
          <span className="bm-kicker">{hasUserDroppedToday ? 'Cambia tu canción de hoy' : 'Tu canción del día'}</span>

          {selectedTrack ? (
            <>
              <div className="bm-picked">
                <div style={{ minWidth: 0 }}>
                  <div className="bm-picked-title">{selectedTrack.title}</div>
                  <div className="bm-picked-artist">{selectedTrack.artist}</div>
                </div>
                <button className="bm-text-btn" onClick={() => setSelectedTrack(null)}>Otra</button>
              </div>

              <VinylLauncher cover={selectedTrack.cover} busy={isPosting} onLaunch={handleLaunch} />

              <div className="bm-moment">
                <div className="bm-moment-head">
                  <span>Empieza en</span>
                  <strong>{fmt(startS)}</strong>
                  <button className="bm-text-btn" onClick={previewMoment} title="Escuchar desde este momento">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    Escuchar
                  </button>
                </div>
                <input
                  className="bm-range"
                  type="range"
                  min={0}
                  max={maxStart}
                  step={1}
                  value={Math.min(startS, maxStart)}
                  onChange={(e) => setStartS(Number(e.target.value))}
                  style={{ '--pct': `${maxStart ? (Math.min(startS, maxStart) / maxStart) * 100 : 0}%` } as React.CSSProperties}
                  aria-label="Momento de la canción"
                />
              </div>

              <input
                className="bm-line-input"
                type="text"
                placeholder="¿Por qué esta canción? (opcional)"
                value={caption}
                maxLength={140}
                onChange={(e) => setCaption(e.target.value)}
              />
              {postError && <p className="bm-error">{postError}</p>}
            </>
          ) : (
            <>
              <form onSubmit={handleSearch} className="bm-search">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                <input
                  type="text"
                  placeholder="Busca la canción que define tu día…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus={composerOpen}
                />
              </form>
              {searchResults.length > 0 && (
                <div className="bm-results">
                  {searchResults.map((t) => (
                    <button key={t.id} className="bm-result" onClick={() => pickTrack(t)}>
                      <img src={t.cover} alt="" />
                      <div style={{ minWidth: 0 }}>
                        <div className="bm-result-title">{t.title}</div>
                        <div className="bm-result-artist">{t.artist}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {composerOpen && <button className="bm-text-btn bm-cancel" onClick={() => setComposerOpen(false)}>Cancelar</button>}
        </section>
      )}

      {/* Feed */}
      {loading ? (
        <div className="bm-feed">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton bm-skeleton" />)}
        </div>
      ) : !hasUserDroppedToday ? (
        <section className="bm-locked">
          <div className="bm-locked-stack">
            <span /><span>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </span><span />
          </div>
          <h3>Las canciones de tus amigos te esperan</h3>
          <p>Lanza tu canción del día para desbloquear lo que están escuchando hoy.</p>
        </section>
      ) : friendDrops.length === 0 ? (
        <section className="bm-empty">
          <span className="bm-empty-emoji">🎧</span>
          Tus amigos aún no han publicado su canción de hoy. ¡Has sido el primero!
        </section>
      ) : (
        <section>
          <div className="bm-feed-head">
            <h3>Hoy en tu círculo</h3>
            <span>{friendsPosted} {friendsPosted === 1 ? 'amigo' : 'amigos'}</span>
          </div>
          <div className="bm-feed">
            {friendDrops.map((drop, idx) => {
              const isMe = drop.user_id === userId;
              const nowPlaying = isPlaying && currentTrack?.id === drop.track_id;
              const comments = expandedComments[drop.id] ? drop.comments : drop.comments.slice(-2);
              const hidden = drop.comments.length - comments.length;
              const draft = commentInputs[drop.id] || '';
              const start = Number(drop.start_s) || 0;

              return (
                <article key={drop.id} className={`bm-card ${isMe ? 'bm-card--me' : ''}`} style={{ animationDelay: `${Math.min(idx, 8) * 60}ms` }}>
                  <div className="bm-author">
                    <BmAvatar src={drop.user?.avatar_url} name={drop.user?.display_name} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="bm-author-name">
                        {drop.user?.display_name || 'Usuario Koko'}
                        {isMe && <span className="bm-me-tag">tú</span>}
                      </div>
                      <div className="bm-author-user">
                        @{drop.user?.username || 'kokoer'} · {new Date(drop.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>

                  <button className={`bm-art ${nowPlaying ? 'bm-art--playing' : ''}`} onClick={() => playDrop(drop)} title={start ? `Reproducir desde ${fmt(start)}` : 'Reproducir'}>
                    {drop.cover ? <img src={drop.cover} alt="" loading="lazy" /> : <div className="bm-art-fallback" />}
                    <span className="bm-play">
                      {nowPlaying
                        ? <span className="bm-eq"><i /><i /><i /></span>
                        : <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>}
                    </span>
                    {start > 0 && <span className="bm-start-chip">▶ {fmt(start)}</span>}
                  </button>

                  <div className="bm-track-title">{drop.title}</div>
                  <div className="bm-track-artist">{drop.artist}</div>

                  {drop.caption && <p className="bm-caption">{drop.caption}</p>}

                  {drop.comments.length > 0 && (
                    <div className="bm-comments">
                      {hidden > 0 && (
                        <button className="bm-comments-toggle" onClick={() => setExpandedComments((p) => ({ ...p, [drop.id]: true }))}>
                          Ver los {drop.comments.length} comentarios
                        </button>
                      )}
                      {comments.map((c) => (
                        <div key={c.id} className="bm-comment">
                          <span className="bm-comment-name">{c.user.display_name}</span>{c.content}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="bm-comment-form">
                    <input
                      className="bm-line-input bm-line-input--sm"
                      type="text"
                      placeholder="Añade un comentario…"
                      value={draft}
                      onChange={(e) => setCommentInputs((prev) => ({ ...prev, [drop.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddComment(drop.id)}
                    />
                    {draft.trim() && (
                      <button className="bm-send" onClick={() => handleAddComment(drop.id)} title="Enviar">Publicar</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Historial (calendario) */}
      {showArchive && (
        <BeMusicHistory drops={myArchive} streak={streak} onPlay={playDrop} onClose={() => setShowArchive(false)} />
      )}

      {celebrate !== null && <StreakCelebration streak={celebrate} onClose={() => setCelebrate(null)} />}
    </div>
  );
}

function BmAvatar({ src, name }: { src?: string; name?: string }) {
  const url = resolveImageUrl(src);
  return (
    <div className="bm-avatar">
      {url ? <img src={url} alt="" /> : (name || 'U').charAt(0).toUpperCase()}
    </div>
  );
}
