import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchTracks } from '../../lib/api';
import type { Track } from '../../lib/api';
import { usePlayerStore } from '../../store/playerStore';

export interface TrackCardProps {
  track: Track;
  isPlaying: boolean;
  onClick: () => void;
  onAddToQueue: (e: React.MouseEvent) => void;
}

export function TrackCard({ track, isPlaying, onClick, onAddToQueue }: TrackCardProps) {
  return (
    <div className="track-card" onClick={onClick}>
      <div className="track-card-cover-wrap">
        <img className="track-card-cover" src={track.cover} alt={track.title} loading="lazy" />
        <button 
          className="track-card-play-btn" 
          aria-label={`Reproducir ${track.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {isPlaying ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>
        <button 
          className="track-card-add-queue-btn" 
          aria-label={`Añadir ${track.title} a la cola`}
          onClick={(e) => {
            e.stopPropagation();
            onAddToQueue(e);
          }}
          title="Añadir a la cola"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      <div className="track-card-title">{track.title}</div>
      <div className="track-card-artist">{track.artist}</div>
    </div>
  );
}

interface Props {
  initialQuery?: string;
  showInput?: boolean;
}

export default function TrackGrid({ initialQuery = '', showInput = true }: Props) {
  const [query, setQuery] = useState<string>(initialQuery);
  const [searchQ, setSearchQ] = useState<string>(initialQuery);
  const { currentTrack, isPlaying, setTrack, addToQueue, setError } = usePlayerStore();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['search', searchQ],
    queryFn: () => searchTracks(searchQ, 24),
    enabled: searchQ.trim().length > 0,
    staleTime: 60_000,
  });

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (query.trim()) setSearchQ(query.trim());
    },
    [query]
  );

  const handlePlay = (track: Track, tracks: Track[]) => {
    setTrack(track, tracks);
  };

  const tracks = data?.tracks ?? [];

  return (
    <div>
      {showInput && (
        <form onSubmit={handleSearch} className="search-bar" style={{ maxWidth: '100%', marginBottom: 8 }}>
          <div style={{ position: 'relative' }}>
            <span className="search-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
            </span>
            <input
              className="search-input"
              type="text"
              placeholder="Artistas, canciones, álbumes..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus={showInput}
            />
          </div>
        </form>
      )}

      {isLoading || isFetching ? (
        <div className="tracks-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="track-card" style={{ cursor: 'default' }}>
              <div className="skeleton" style={{ aspectRatio: '1', borderRadius: 'var(--radius-md)', marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 14, width: '80%', marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 12, width: '60%' }} />
            </div>
          ))}
        </div>
      ) : tracks.length > 0 ? (
        <div className="tracks-grid">
          {tracks.map((track) => (
            <TrackCard
              key={track.id}
              track={track}
              isPlaying={currentTrack?.id === track.id && isPlaying}
              onClick={() => handlePlay(track, tracks)}
              onAddToQueue={() => {
                addToQueue(track);
                setError(`Añadido a la cola: ${track.title}`);
              }}
            />
          ))}
        </div>
      ) : searchQ ? (
        <div className="empty-state">
          <div className="empty-state-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.4"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>
          <p>No se encontraron resultados para "{searchQ}"</p>
          <small>Prueba con otro término</small>
        </div>
      ) : null}
    </div>
  );
}
