import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { searchTracks, addToJamQueue, getRecommendations } from '../lib/api';
import type { Track } from '../lib/api';
import { usePlayerStore } from '../store/playerStore';
import { useSwipeToQueue } from '../hooks/useSwipeToQueue';

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function PlayingBars() {
  return (
    <div className="playing-bars" style={{ height: 16 }}>
      <span /><span /><span />
    </div>
  );
}

function SearchTrackRow({
  track,
  idx,
  currentTrack,
  isPlaying,
  handlePlay,
  addToQueue,
  setError,
  activeJamCode,
  addingToSinfonia,
  handleAddToSinfonia
}: {
  track: Track;
  idx: number;
  currentTrack: Track | null;
  isPlaying: boolean;
  handlePlay: (t: Track) => void;
  addToQueue: (t: Track) => void;
  setError: (msg: string) => void;
  activeJamCode: string | null;
  addingToSinfonia: Record<string, boolean>;
  handleAddToSinfonia: (t: Track) => void;
}) {
  const isActive = currentTrack?.id === track.id;
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
        className={`track-row${isActive ? ' playing' : ''}`}
        onClick={() => handlePlay(track)}
        style={{
          ...swipeStyle,
          position: 'relative',
          zIndex: 1,
        }}
        {...touchHandlers}
      >
        <div className="track-row-num">
          {isActive && isPlaying ? (
            <PlayingBars />
          ) : (
            <span style={isActive ? { color: 'var(--accent)' } : {}}>{idx + 1}</span>
          )}
        </div>

        <div className="track-row-info">
          <img className="track-row-cover" src={track.cover} alt={track.title} loading="lazy" />
          <div style={{ minWidth: 0 }}>
            <div className="track-row-name" style={isActive ? { color: 'var(--accent)' } : {}}>
              {track.title}
            </div>
            {track.artistId ? (
              <Link
                to={(track.artistId !== 0) ? `/artist/${track.artistId}` : `/artist/${encodeURIComponent(track.artist)}`}
                className="track-row-artist"
                style={{ textDecoration: 'none' }}
                onClick={(e) => e.stopPropagation()}
              >
                {track.artist}
              </Link>
            ) : (
              <div className="track-row-artist">{track.artist}</div>
            )}
          </div>
        </div>

        <div className="track-row-album">{track.album}</div>
        <div className="track-row-duration" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              addToQueue(track);
              setError(`Añadido a la cola: ${track.title}`);
            }}
            className="ctrl-btn"
            title="Añadir a la cola"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '11px',
              fontWeight: 600,
              borderRadius: 4,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              transition: 'all 0.2s',
              flexShrink: 0
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Cola</span>
          </button>
          {activeJamCode && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleAddToSinfonia(track);
              }}
              className="ctrl-btn"
              title="Añadir a la Sinfonía"
              style={{
                background: 'transparent',
                border: 'none',
                color: addingToSinfonia[track.id] ? 'var(--accent)' : 'var(--text-secondary)',
                cursor: 'pointer',
                padding: '4px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '11px',
                fontWeight: 600,
                borderRadius: 4,
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                transition: 'all 0.2s',
                flexShrink: 0
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
              {addingToSinfonia[track.id] ? 'Añadido ✓' : 'Sinfonía'}
            </button>
          )}
          <span>{formatDuration(track.duration)}</span>

          {/* Mobile menu trigger */}
          <button 
            className="track-row-mobile-trigger"
            onClick={(e) => {
              e.stopPropagation();
              setIsActionsOpen(true);
            }}
            style={{
              padding: '8px',
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'none' // hidden by default on desktop, shown via CSS on mobile
            }}
            title="Más opciones"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
            </svg>
          </button>
        </div>
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
              <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); handlePlay(track); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                <span>Reproducir</span>
              </button>
              
              <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); addToQueue(track); setError(`Añadido a la cola: ${track.title}`); }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                <span>Añadir a la cola</span>
              </button>

              {activeJamCode && (
                <button className="track-action-sheet-btn" onClick={() => { setIsActionsOpen(false); handleAddToSinfonia(track); }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                  <span>Añadir a la Sinfonía</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const DISCOVERY_CATEGORIES = [
  { label: 'Pop', color: '#148a08', bg: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=100&auto=format&fit=crop&q=60', query: 'pop hits' },
  { label: 'Chill', color: '#3182ce', bg: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=100&auto=format&fit=crop&q=60', query: 'chill vibes lofi' },
  { label: 'Lofi', color: '#d69e2e', bg: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=100&auto=format&fit=crop&q=60', query: 'lofi study beats' },
  { label: 'Gym', color: '#e53e3e', bg: 'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=100&auto=format&fit=crop&q=60', query: 'workout hits' },
  { label: 'Sad', color: '#805ad5', bg: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=100&auto=format&fit=crop&q=60', query: 'sad songs emotional' },
  { label: 'Focus', color: '#319795', bg: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?w=100&auto=format&fit=crop&q=60', query: 'deep focus concentration' },
  { label: 'Rap', color: '#dd6b20', bg: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=100&auto=format&fit=crop&q=60', query: 'hip hop rap hits' },
  { label: 'Fiesta', color: '#ed64a6', bg: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=100&auto=format&fit=crop&q=60', query: 'party anthems reggaeton' },
];

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mood = searchParams.get('mood');
  const [input, setInput] = useState(searchParams.get('q') ?? '');
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [source, setSource] = useState<'itunes' | 'youtube' | 'lyrics'>('itunes');

  const { currentTrack, isPlaying, setTrack, activeJamCode, addToQueue, setError } = usePlayerStore();

  const [recentSearches, setRecentSearches] = useState<any[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('koko_recent_searches') || '[]');
    } catch {
      return [];
    }
  });

  const { data, isLoading } = useQuery({
    queryKey: ['search', query, source, mood],
    queryFn: () => {
      if (mood && !query) {
        return getRecommendations(30, mood).then(tracks => ({ tracks, source: 'youtube' }));
      }
      return searchTracks(query, 30, source as any);
    },
    enabled: query.trim().length > 0 || (!!mood && !query),
    staleTime: 60_000,
  });

  // Sync URL
  useEffect(() => {
    if (query) {
      setSearchParams({ q: query });
    } else if (!mood) {
      setSearchParams({});
    }
  }, [query, mood, setSearchParams]);

  const addRecentSearch = (item: any) => {
    setRecentSearches(prev => {
      const filtered = prev.filter(p => {
        if (item.type === 'keyword' && p.type === 'keyword') {
          return p.query !== item.query;
        }
        if (item.type === 'track' && p.type === 'track') {
          return p.id !== item.id;
        }
        return true;
      });
      const updated = [item, ...filtered].slice(0, 8);
      localStorage.setItem('koko_recent_searches', JSON.stringify(updated));
      return updated;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      const q = input.trim();
      setQuery(q);
      setSearchParams({ q });
      addRecentSearch({ type: 'keyword', query: q });
    }
  };

  const handleClearSearch = () => {
    setInput('');
    setQuery('');
    setSearchParams({});
  };

  const handleCategoryClick = (category: typeof DISCOVERY_CATEGORIES[0]) => {
    setInput(category.query);
    setQuery(category.query);
    setSearchParams({ q: category.query });
    addRecentSearch({ type: 'keyword', query: category.query });
  };

  const handleRemoveRecent = (e: React.MouseEvent, itemToRemove: any) => {
    e.stopPropagation();
    setRecentSearches(prev => {
      const updated = prev.filter(p => {
        if (itemToRemove.type === 'keyword') {
          return p.query !== itemToRemove.query;
        }
        return p.id !== itemToRemove.id;
      });
      localStorage.setItem('koko_recent_searches', JSON.stringify(updated));
      return updated;
    });
  };

  // Sort tracks based on followed artists and listened artists for more logical searches
  const tracks = (() => {
    const rawTracks = data?.tracks ?? [];
    if (rawTracks.length === 0) return [];
    try {
      const listenedArtists = JSON.parse(localStorage.getItem('koko_listened_artists') || '[]');
      const followedArtists = JSON.parse(localStorage.getItem('koko_followed_artists') || '[]');

      return [...rawTracks].sort((a, b) => {
        const aFollowed = followedArtists.some((fa: string) => fa.toLowerCase() === a.artist.toLowerCase());
        const bFollowed = followedArtists.some((fa: string) => fa.toLowerCase() === b.artist.toLowerCase());
        if (aFollowed && !bFollowed) return -1;
        if (!aFollowed && bFollowed) return 1;

        const aIndex = listenedArtists.findIndex((la: string) => la.toLowerCase() === a.artist.toLowerCase());
        const bIndex = listenedArtists.findIndex((la: string) => la.toLowerCase() === b.artist.toLowerCase());
        if (aIndex !== -1 && bIndex === -1) return -1;
        if (aIndex === -1 && bIndex !== -1) return 1;
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;

        return 0;
      });
    } catch {
      return rawTracks;
    }
  })();

  const [addingToSinfonia, setAddingToSinfonia] = useState<Record<string, boolean>>({});

  const handleAddToSinfonia = async (track: Track) => {
    if (!activeJamCode) return;
    try {
      setAddingToSinfonia(prev => ({ ...prev, [track.id]: true }));
      await addToJamQueue(activeJamCode, {
        track_id: track.id,
        track_title: track.title,
        track_artist: track.artist,
        track_cover: track.cover,
        added_by: '9847b87c-04e7-4595-af2f-3c02448ebf67',
        added_by_name: 'Koko',
      });
      setTimeout(() => {
        setAddingToSinfonia(prev => ({ ...prev, [track.id]: false }));
      }, 2000);
    } catch {
      setAddingToSinfonia(prev => ({ ...prev, [track.id]: false }));
    }
  };

  const handlePlay = async (track: Track) => {
    setTrack(track, [track]);
    addRecentSearch({ type: 'track', ...track });
    try {
      // Recomendar de una en una basándose en los elementos de la cola activa
      const recs = await getRecommendations(1, undefined, undefined, [track.id]);
      if (recs && recs.length > 0) {
        const currentStore = usePlayerStore.getState();
        if (currentStore.currentTrack?.id === track.id) {
          usePlayerStore.setState({
            queue: [track, ...recs],
            originalQueue: [track, ...recs],
            queueIndex: 0
          });
        }
      }
    } catch (err) {
      console.error('Error fetching recommendation for played search track:', err);
    }
  };

  const handlePlayRecentTrack = async (track: any) => {
    setTrack(track, [track]);
    try {
      const recs = await getRecommendations(1, undefined, undefined, [track.id]);
      if (recs && recs.length > 0) {
        const currentStore = usePlayerStore.getState();
        if (currentStore.currentTrack?.id === track.id) {
          usePlayerStore.setState({
            queue: [track, ...recs],
            originalQueue: [track, ...recs],
            queueIndex: 0
          });
        }
      }
    } catch (err) {
      console.error('Error fetching recommendation for played recent track:', err);
    }
  };

  return (
    <div className="main-body" style={{ paddingTop: 16 }}>
      <div className="search-header-container">
        <h1 className="section-title" style={{ marginTop: 0, marginBottom: 0, fontSize: 24, fontWeight: 800 }}>
          {mood && !query ? `Mood: ${mood.charAt(0).toUpperCase() + mood.slice(1)}` : 'Buscar'}
        </h1>
        {/* Source Toggle */}
        <div className="search-source-toggle">
          {(['itunes', 'youtube', 'lyrics'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={source === s ? 'active' : ''}
            >
              {s === 'itunes' ? 'KokoMusic' : s === 'youtube' ? 'YouTube' : 'Letra'}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ marginBottom: 24 }}>
        <div className="search-bar" style={{ maxWidth: '100%', position: 'relative' }}>
          <span className="search-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
            </svg>
          </span>
          <input
            className="search-input"
            type="text"
            placeholder={source === 'lyrics' ? 'Introduce fragmento de letra...' : 'Artistas, canciones, podcasts...'}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (!e.target.value.trim()) {
                setQuery('');
              }
            }}
            autoFocus
          />
          {input && (
            <button
              type="button"
              onClick={handleClearSearch}
              style={{
                position: 'absolute',
                right: 42,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          )}

          {/* Voice Search Mic Button (Only 1 mic button, positioned in top search bar on mobile) */}
          <button
            type="button"
            onClick={() => {
              const evt = new KeyboardEvent('keydown', { key: 'v', altKey: true, bubbles: true });
              window.dispatchEvent(evt);
            }}
            className="search-bar-mic-btn"
            title="Control por voz"
            style={{
              position: 'absolute',
              right: 10,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'rgba(29, 185, 84, 0.15)',
              border: '1px solid rgba(29, 185, 84, 0.3)',
              borderRadius: '50%',
              width: 32,
              height: 32,
              color: '#1DB954',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'transform 0.15s ease',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </button>
        </div>
      </form>

      {/* Empty / Initial State: Recent Searches & Categories */}
      {!query && !mood && (
        <div style={{ animation: 'fadeIn var(--duration-fast) ease-out' }}>
          {recentSearches.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12, color: '#fff' }}>Búsquedas recientes</h2>
              <div className="recent-searches-list">
                {recentSearches.map((item, idx) => (
                  <div key={idx} className="recent-search-row">
                    {item.type === 'keyword' ? (
                      <div 
                        className="recent-search-clickable" 
                        onClick={() => {
                          setInput(item.query);
                          setQuery(item.query);
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
                          <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span style={{ fontSize: 14, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.query}
                        </span>
                      </div>
                    ) : (
                      <div 
                        className="recent-search-clickable" 
                        onClick={() => handlePlayRecentTrack(item)}
                      >
                        <img 
                          src={item.cover} 
                          alt={item.title} 
                          style={{ width: 36, height: 36, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} 
                        />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Canción • {item.artist}</div>
                        </div>
                      </div>
                    )}
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {item.type === 'track' && (
                        <button
                          onClick={() => {
                            addToQueue(item);
                            setError(`Añadido a la cola: ${item.title}`);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            padding: 4,
                            display: 'flex',
                            alignItems: 'center'
                          }}
                          title="Añadir a la cola"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={(e) => handleRemoveRecent(e, item)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          padding: 4,
                          display: 'flex',
                          alignItems: 'center'
                        }}
                        title="Eliminar de recientes"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 12, color: '#fff' }}>Explorar todo</h2>
          <div className="discovery-grid">
            {DISCOVERY_CATEGORIES.map((category) => (
              <div
                key={category.label}
                className="discovery-card"
                style={{ backgroundColor: category.color }}
                onClick={() => handleCategoryClick(category)}
              >
                <span>{category.label}</span>
                <div className="discovery-card-bg" style={{ backgroundImage: `url(${category.bg})` }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skeletons */}
      {isLoading && (
        <div className="track-list">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="track-row" style={{ cursor: 'default' }}>
              <div className="skeleton" style={{ width: 20, height: 14 }} />
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 4 }} />
                <div>
                  <div className="skeleton" style={{ width: 140, height: 13, marginBottom: 6 }} />
                  <div className="skeleton" style={{ width: 90, height: 11 }} />
                </div>
              </div>
              <div className="skeleton" style={{ width: 100, height: 13 }} />
              <div className="skeleton" style={{ width: 36, height: 13, marginLeft: 'auto' }} />
            </div>
          ))}
        </div>
      )}

      {/* Top result cards */}
      {!isLoading && tracks.length > 0 && (
        tracks[0].artist.toLowerCase().includes(query.replace('@', '').toLowerCase()) ||
        query.startsWith('@') ||
        query.includes('youtube.com')
      ) && (
        <div style={{ marginBottom: 32, animation: 'fadeIn var(--duration-fast) ease-out' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>Mejor resultado</h2>
          <Link
            to={(tracks[0].artistId && tracks[0].artistId !== 0) ? `/artist/${tracks[0].artistId}` : `/artist/${encodeURIComponent(tracks[0].artist)}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              padding: 24,
              background: 'var(--bg-card)',
              borderRadius: 12,
              textDecoration: 'none',
              transition: 'background 0.2s',
            }}
            className="hover-card"
          >
            <img
              src={tracks[0].cover}
              alt={tracks[0].artist}
              style={{ width: 88, height: 88, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 6px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tracks[0].artist}</h3>
              <div style={{ display: 'inline-flex', alignItems: 'center', background: 'rgba(255,255,255,0.1)', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, color: '#fff' }}>
                Artista
              </div>
            </div>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', opacity: 0.8, flexShrink: 0 }} className="play-button-hover">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </Link>
          <h2 style={{ fontSize: 18, fontWeight: 800, marginTop: 32, marginBottom: 12 }}>Canciones</h2>
        </div>
      )}

      {/* Table headers */}
      {!isLoading && tracks.length > 0 && (
        <div
          className="track-row"
          style={{ color: 'var(--text-muted)', fontSize: 12, borderBottom: '1px solid #ffffff10', marginBottom: 8 }}
        >
          <span style={{ textAlign: 'center' }}>#</span>
          <span>TÍTULO</span>
          <span>ÁLBUM</span>
          <span style={{ textAlign: 'right' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm4.24 16L12 15.45 7.77 18l1.12-4.81-3.73-3.23 4.92-.42L12 5l1.92 4.53 4.92.42-3.73 3.23L16.23 18z" />
            </svg>
          </span>
        </div>
      )}

      {/* Search Track list */}
      {!isLoading && tracks.length > 0 && (
        <div className="track-list" style={{ animation: 'fadeIn var(--duration-fast) ease-out' }}>
          {tracks.map((track, idx) => (
            <SearchTrackRow
              key={`${track.id}-${idx}`}
              track={track}
              idx={idx}
              currentTrack={currentTrack}
              isPlaying={isPlaying}
              handlePlay={handlePlay}
              addToQueue={addToQueue}
              setError={setError}
              activeJamCode={activeJamCode}
              addingToSinfonia={addingToSinfonia}
              handleAddToSinfonia={handleAddToSinfonia}
            />
          ))}
        </div>
      )}

      {/* Empty / Error state */}
      {!isLoading && query && tracks.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.4"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg></div>
          <p>Sin resultados para "{query}"</p>
          <small>Prueba con otro término de búsqueda</small>
        </div>
      )}
    </div>
  );
}
