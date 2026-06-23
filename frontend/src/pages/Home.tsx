import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import TrackGrid, { TrackCard } from '../components/TrackCard/TrackGrid';
import { getRecommendations } from '../lib/api';
import { usePlayerStore } from '../store/playerStore';

// SVG icons for each filter category
function FilterIcon({ type }: { type: string }) {
  const props = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'currentColor' };
  switch (type) {
    case 'workout': return <svg {...props}><path d="M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z"/></svg>;
    case 'chill': return <svg {...props}><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>;
    case 'study': return <svg {...props}><path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"/></svg>;
    case 'party': return <svg {...props}><path d="M2 22l14-5-9-9zm12.53-9.47l5.59-5.59c.49-.49 1.28-.49 1.77 0l.59.59 1.06-1.06-.59-.59c-1.07-1.07-2.82-1.07-3.89 0l-5.59 5.59 1.06 1.06z"/></svg>;
    case 'rock': return <svg {...props}><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm5-10H7V5h10v2z"/></svg>;
    case 'sad': return <svg {...props}><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>;
    case 'happy': return <svg {...props}><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>;
    case 'latin': return <svg {...props}><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>;
    case 'electronic': return <svg {...props}><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>;
    case 'hiphop': return <svg {...props}><path d="M12 1a9 9 0 0 0-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7a9 9 0 0 0-9-9z"/></svg>;
    case 'classical': return <svg {...props}><path d="M12 3l.01 10.55c-.59-.34-1.27-.55-2.01-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>;
    case 'focus': return <svg {...props}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>;
    default: return <svg {...props}><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>;
  }
}

const SMART_FILTERS = [
  { label: 'Workout', icon: 'workout', query: 'workout hits', color: '#E53E3E' },
  { label: 'Chill', icon: 'chill', query: 'chill vibes lofi', color: '#5B86E5' },
  { label: 'Study', icon: 'study', query: 'lofi study beats', color: '#D69E2E' },
  { label: 'Fiesta', icon: 'party', query: 'party anthems reggaeton', color: '#ED64A6' },
  { label: 'Rock', icon: 'rock', query: 'rock classics hits', color: '#E53E3E' },
  { label: 'Sad', icon: 'sad', query: 'sad songs emotional', color: '#9F7AEA' },
  { label: 'Happy', icon: 'happy', query: 'feel good happy hits', color: '#48BB78' },
  { label: 'Latin', icon: 'latin', query: 'reggaeton latin hits 2024', color: '#DD6B20' },
  { label: 'Electronic', icon: 'electronic', query: 'electronic dance music EDM', color: '#38B2AC' },
  { label: 'Hip-Hop', icon: 'hiphop', query: 'hip hop rap hits', color: '#9F7AEA' },
  { label: 'Classical', icon: 'classical', query: 'classical music piano', color: '#667EEA' },
  { label: 'Focus', icon: 'focus', query: 'deep focus concentration music', color: '#4FD1C5' },
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Buenas noches';
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

export default function Home() {
  const navigate = useNavigate();
  const { currentTrack, isPlaying, setTrack, addToQueue, setError } = usePlayerStore();

  const { data: recommendations, isLoading: isRecLoading, refetch } = useQuery({
    queryKey: ['recommendations'],
    queryFn: () => getRecommendations(8),
    refetchOnWindowFocus: false,
    staleTime: 60_000, // 1 min cache
  });

  const handlePlay = (track: any, tracks: any[]) => {
    setTrack(track, tracks);
  };

  return (
    <div className="main-body" style={{ paddingTop: 24 }}>
      {/* Hero greeting */}
      <div style={{
        background: 'linear-gradient(135deg, #1DB95422 0%, #121212 100%)',
        borderRadius: 'var(--radius-lg)',
        padding: '32px 28px',
        marginBottom: 32,
        border: '1px solid #1DB95420',
      }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -1, marginBottom: 8 }}>
          {getGreeting()}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>
          Busca cualquier canción y empieza a escuchar. La primera vez se descarga; las siguientes se sirven al instante desde la nube.
        </p>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          {SMART_FILTERS.map((filter) => (
            <button
              key={filter.label}
              onClick={() => navigate(`/search?mood=${encodeURIComponent(filter.icon)}`)}
              style={{
                padding: '7px 14px',
                borderRadius: 'var(--radius-full)',
                background: `${filter.color}18`,
                color: 'var(--text-primary)',
                border: `1px solid ${filter.color}30`,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                fontFamily: 'inherit',
                transition: 'all var(--duration-fast)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `${filter.color}30`;
                e.currentTarget.style.borderColor = `${filter.color}60`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = `${filter.color}18`;
                e.currentTarget.style.borderColor = `${filter.color}30`;
              }}
            >
              <FilterIcon type={filter.icon} />
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Recomendaciones (Koko-Mix) */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <h2 className="section-title" style={{ marginBottom: 4 }}>Koko-Mix</h2>
            <p className="section-subtitle" style={{ marginBottom: 16 }}>Recomendaciones basadas en tu historial de reproducción</p>
          </div>
          <button 
            onClick={() => refetch()}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
          >
            Refrescar
          </button>
        </div>

        {isRecLoading ? (
          <div className="tracks-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="track-card" style={{ cursor: 'default' }}>
                <div className="skeleton" style={{ aspectRatio: '1', borderRadius: 'var(--radius-md)', marginBottom: 12 }} />
                <div className="skeleton" style={{ height: 14, width: '80%', marginBottom: 8 }} />
                <div className="skeleton" style={{ height: 12, width: '60%' }} />
              </div>
            ))}
          </div>
        ) : recommendations && recommendations.length > 0 ? (
          <div className="tracks-grid">
            {recommendations.map((track) => (
              <TrackCard
                key={track.id}
                track={track}
                isPlaying={currentTrack?.id === track.id && isPlaying}
                onClick={() => handlePlay(track, recommendations)}
                onAddToQueue={() => {
                  addToQueue(track);
                  setError(`Añadido a la cola: ${track.title}`);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '24px 0', border: '1px dashed #ffffff15', borderRadius: 8 }}>
            <p style={{ color: 'var(--text-secondary)' }}>Escucha tus primeras canciones para activar tu Koko-Mix personalizado</p>
          </div>
        )}
      </div>

      {/* Descubrir general */}
      <h2 className="section-title">Novedades generales</h2>
      <p className="section-subtitle">Lo más sonado de la temporada</p>
      <TrackGrid initialQuery="trending hits" showInput={false} />
    </div>
  );
}
