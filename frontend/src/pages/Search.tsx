import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { searchTracks, addToJamQueue, getRecommendations } from '../lib/api';
import type { Track } from '../lib/api';
import { usePlayerStore } from '../store/playerStore';

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

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mood = searchParams.get('mood');
  const [input, setInput] = useState(searchParams.get('q') ?? '');
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [source, setSource] = useState<'itunes' | 'youtube'>('itunes');

  const { currentTrack, isPlaying, setTrack, activeJamCode, addToQueue, setError } = usePlayerStore();

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
    }
  }, [query, setSearchParams]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      setQuery(input.trim());
      setSearchParams({ q: input.trim() });
    }
  };

  const tracks = data?.tracks ?? [];

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

  const handlePlay = (track: Track) => setTrack(track, tracks);

  return (
    <div className="main-body" style={{ paddingTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 className="section-title" style={{ marginTop: 0, marginBottom: 0 }}>
          {mood && !query ? `Recomendaciones: Mood ${mood.charAt(0).toUpperCase() + mood.slice(1)}` : 'Buscar'}
        </h1>
        {/* Toggle de fuente */}
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg-card)', borderRadius: 'var(--radius-full)', padding: 4 }}>
          {(['itunes', 'youtube'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              style={{
                padding: '5px 14px',
                borderRadius: 'var(--radius-full)',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: 600,
                transition: 'all 0.2s',
                background: source === s ? 'var(--accent)' : 'transparent',
                color: source === s ? '#000' : 'var(--text-secondary)',
              }}
            >
              {s === 'itunes' ? 'KokoMusic' : 'YouTube'}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={{ marginBottom: 24 }}>
        <div className="search-bar" style={{ maxWidth: 540 }}>
          <span className="search-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
            </svg>
          </span>
          <input
            className="search-input"
            type="text"
            placeholder="Artistas, canciones, álbumes..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
        </div>
      </form>

      {/* Cabecera de tabla */}
      {tracks.length > 0 && (
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

      {/* Top Result / Mejor Resultado (Artista) */}
      {!isLoading && tracks.length > 0 && (
        tracks[0].artist.toLowerCase().includes(query.replace('@', '').toLowerCase()) ||
        query.startsWith('@') ||
        query.includes('youtube.com')
      ) && (
        <div style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Mejor resultado</h2>
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
              style={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
            />
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: 32, fontWeight: 800, margin: '0 0 8px', color: '#fff' }}>{tracks[0].artist}</h3>
              <div style={{ display: 'inline-flex', alignItems: 'center', background: 'rgba(255,255,255,0.1)', padding: '4px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, color: '#fff' }}>
                Artista
              </div>
            </div>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', opacity: 0.8 }} className="play-button-hover">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </Link>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginTop: 32, marginBottom: 16 }}>Canciones</h2>
        </div>
      )}

      {/* Loading skeletons */}
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

      {/* Track list */}
      {!isLoading && tracks.length > 0 && (
        <div className="track-list">
          {tracks.map((track, idx) => {
            const isActive = currentTrack?.id === track.id;
            return (
              <div
                key={`${track.id}-${idx}`}
                className={`track-row${isActive ? ' playing' : ''}`}
                onClick={() => handlePlay(track)}
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
                <div className="track-row-duration" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
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
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && query && tracks.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.4"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg></div>
          <p>Sin resultados para "{query}"</p>
          <small>Prueba con otro término de búsqueda</small>
        </div>
      )}

      {/* Initial state */}
      {!query && !mood && (
        <div className="empty-state">
          <div className="empty-state-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.4"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" /></svg></div>
          <p>Busca cualquier canción o artista</p>
          <small>Los resultados aparecerán aquí</small>
        </div>
      )}
    </div>
  );
}
