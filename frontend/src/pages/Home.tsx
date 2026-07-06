import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import TrackGrid, { TrackCard } from '../components/TrackCard/TrackGrid';
import { getPersonalizedRecommendations } from '../lib/api';
import { usePlayerStore } from '../store/playerStore';
import OnboardingModal from '../components/OnboardingModal';


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
  const [activeCategory, setActiveCategory] = useState<'all' | 'music' | 'podcasts'>('all');
  
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
  const [hasAutoOpenedOnboarding, setHasAutoOpenedOnboarding] = useState(false);

  const { data: recData, isLoading: isRecLoading, refetch } = useQuery({
    queryKey: ['personalized-recommendations'],
    queryFn: () => getPersonalizedRecommendations(12),
    refetchOnWindowFocus: false,
    staleTime: 60_000, // 1 min cache
  });

  const recommendations = recData?.tracks ?? [];
  const recSource = recData?.source;

  useEffect(() => {
    if (recSource === 'cold_start' && !hasAutoOpenedOnboarding) {
      setIsOnboardingOpen(true);
      setHasAutoOpenedOnboarding(true);
    }
  }, [recSource, hasAutoOpenedOnboarding]);


  const handlePlay = (track: any, tracks: any[]) => {
    setTrack(track, tracks);
  };

  // Recent items list
  const recentItems = [
    {
      title: 'Tus me gusta',
      cover: 'linear-gradient(135deg, #450af5, #8e2de2)',
      isGradient: true,
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
        </svg>
      ),
      action: () => navigate('/library')
    },
    {
      title: 'Sinfonía en grupo',
      cover: 'linear-gradient(135deg, #0d724f, #051811)',
      isGradient: true,
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
        </svg>
      ),
      action: () => navigate('/dj')
    },
    {
      title: 'Estadísticas',
      cover: 'linear-gradient(135deg, #ff416c, #ff4b2b)',
      isGradient: true,
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-2V7h2v6zm-4 4h-2V10h2v7zm-4-2H7v-4h2v4z"/>
        </svg>
      ),
      action: () => navigate('/stats')
    },
    {
      title: 'Olivia Dean',
      cover: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=150&auto=format&fit=crop&q=60',
      isGradient: false,
      action: () => navigate('/artist/Olivia Dean')
    },
    {
      title: 'Chill Vibes',
      cover: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=150&auto=format&fit=crop&q=60',
      isGradient: false,
      action: () => navigate('/search?mood=chill')
    },
    {
      title: 'Billie Eilish',
      cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=150&auto=format&fit=crop&q=60',
      isGradient: false,
      action: () => navigate('/artist/Billie Eilish')
    }
  ];

  // Recommended stations
  const recommendedStations = [
    { name: 'Rosalía', image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=60' },
    { name: 'Coldplay', image: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=150&auto=format&fit=crop&q=60' },
    { name: 'Daft Punk', image: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=150&auto=format&fit=crop&q=60' },
    { name: 'Billie Eilish', image: 'https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=150&auto=format&fit=crop&q=60' },
    { name: 'Olivia Dean', image: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=150&auto=format&fit=crop&q=60' },
    { name: 'Kendrick Lamar', image: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150&auto=format&fit=crop&q=60' }
  ];

  // Podcasts lists
  const podcasts = [
    { title: 'The Wild Project', host: 'Jordi Wild', cover: '#E53E3E', desc: 'El podcast de Jordi Wild. Entrevistas y actualidad.', query: 'the wild project' },
    { title: 'Leyendas Legendarias', host: 'All Things Comedy', cover: '#805AD5', desc: 'Casos reales, crimen, fenómenos paranormales.', query: 'leyendas legendarias' },
    { title: 'Entiende tu mente', host: 'Molo Cebrián', cover: '#3182CE', desc: 'Psicología y salud mental explicada de forma sencilla.', query: 'entiende tu mente' },
    { title: 'Nadie sabe nada', host: 'Andreu Buenafuente y Berto Romero', cover: '#D69E2E', desc: 'Improvisación, humor y preguntas absurdas.', query: 'nadie sabe nada' },
    { title: 'La Ruina', host: 'Ignasi Taltavull y Tomàs Fuentes', cover: '#4A5568', desc: 'Comedia donde la gente confiesa su peor ruina.', query: 'la ruina' },
    { title: 'Estirando el chicle', host: 'Podimo', cover: '#ED64A6', desc: 'Humor, feminismo y entrevistas con Victoria y Carolina.', query: 'estirando el chicle' },
  ];

  return (
    <div className="main-body" style={{ paddingTop: 16 }}>
      {/* Top filter pills */}
      <div className="pill-filters">
        <button
          onClick={() => setActiveCategory('all')}
          className={`pill-filter ${activeCategory === 'all' ? 'active' : 'inactive'}`}
        >
          Todos
        </button>
        <button
          onClick={() => setActiveCategory('music')}
          className={`pill-filter ${activeCategory === 'music' ? 'active' : 'inactive'}`}
        >
          Música
        </button>
        <button
          onClick={() => setActiveCategory('podcasts')}
          className={`pill-filter ${activeCategory === 'podcasts' ? 'active' : 'inactive'}`}
        >
          Pódcasts
        </button>
      </div>

      {activeCategory === 'podcasts' ? (
        <div style={{ marginBottom: 40, animation: 'fadeIn var(--duration-fast) ease-out' }}>
          <h2 className="section-title">Pódcasts más escuchados</h2>
          <p className="section-subtitle" style={{ marginBottom: 20 }}>Tus shows favoritos en KokoMusic</p>
          <div className="tracks-grid">
            {podcasts.map((podcast) => (
              <div 
                key={podcast.title} 
                className="track-card"
                onClick={() => navigate(`/search?q=${encodeURIComponent(podcast.query)}`)}
                style={{ cursor: 'pointer' }}
              >
                <div style={{
                  aspectRatio: '1',
                  borderRadius: 'var(--radius-md)',
                  background: `linear-gradient(135deg, ${podcast.cover}, #1a1a1a)`,
                  marginBottom: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  padding: 16,
                  position: 'relative',
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.05)'
                }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#ffffff', lineHeight: 1.2 }}>
                    {podcast.title}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    Podcast
                  </div>
                </div>
                <div className="track-card-title">{podcast.title}</div>
                <div className="track-card-artist" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {podcast.host}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Greeting Title */}
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, marginBottom: 16 }}>
            {getGreeting()}
          </h1>

          {/* Banner de inicio frío/onboarding si no hay historial previo */}
          {recSource === 'cold_start' && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(29, 185, 84, 0.15) 0%, rgba(10, 122, 53, 0.05) 100%)',
              border: '1px solid rgba(29, 185, 84, 0.25)',
              borderRadius: 'var(--radius-lg)',
              padding: '20px 24px',
              marginBottom: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
              animation: 'fadeIn var(--duration-base) ease-out'
            }}>
              <div style={{ flex: 1, minWidth: 280 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: '#fff' }}>
                  ¡Sintoniza tu KokoMusic! 🎵
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
                  Tu recomendador está usando la configuración inicial por defecto. Personaliza tus gustos o importa tu historial de Spotify para recibir sugerencias a tu medida.
                </p>
              </div>
              <button 
                onClick={() => setIsOnboardingOpen(true)}
                style={{
                  background: 'var(--accent)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 'var(--radius-full)',
                  padding: '10px 20px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 4px 12px rgba(29, 185, 84, 0.2)',
                  transition: 'transform 0.15s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              >
                Personalizar
              </button>
            </div>
          )}

          {/* 2-column quick-access grid */}

          <div className="recent-grid">
            {recentItems.map((item, idx) => (
              <div key={idx} className="recent-card" onClick={item.action}>
                {item.isGradient ? (
                  <div style={{
                    background: item.cover,
                    width: 56,
                    height: 56,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    flexShrink: 0
                  }}>
                    {item.icon}
                  </div>
                ) : (
                  <img src={item.cover} alt={item.title} className="recent-card-cover" />
                )}
                <div className="recent-card-info">{item.title}</div>
                <button
                  className="recent-card-play"
                  onClick={(e) => {
                    e.stopPropagation();
                    item.action();
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Hero greeting / intro */}
          {activeCategory === 'all' && (
            <div style={{
              background: 'linear-gradient(135deg, #1DB9541a 0%, #121212 100%)',
              borderRadius: 'var(--radius-lg)',
              padding: '24px 20px',
              marginBottom: 32,
              border: '1px solid #1DB95415',
            }}>
              <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
                Tu música, sin límites.
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.4, margin: 0 }}>
                Busca cualquier canción y empieza a escuchar. La primera vez se descarga; las siguientes se sirven al instante desde la nube.
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                {SMART_FILTERS.slice(0, 6).map((filter) => (
                  <button
                    key={filter.label}
                    onClick={() => navigate(`/search?mood=${encodeURIComponent(filter.icon)}`)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 'var(--radius-full)',
                      background: `${filter.color}12`,
                      color: 'var(--text-primary)',
                      border: `1px solid ${filter.color}25`,
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: 'inherit',
                      transition: 'all var(--duration-fast)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = `${filter.color}25`;
                      e.currentTarget.style.borderColor = `${filter.color}50`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = `${filter.color}12`;
                      e.currentTarget.style.borderColor = `${filter.color}25`;
                    }}
                  >
                    <FilterIcon type={filter.icon} />
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Emisoras recomendadas */}
          <div style={{ marginBottom: 32 }}>
            <h2 className="section-title" style={{ marginBottom: 4 }}>Emisoras recomendadas</h2>
            <p className="section-subtitle" style={{ marginBottom: 16 }}>Estaciones de radio basadas en tus artistas</p>
            <div className="stations-row">
              {recommendedStations.map((station) => (
                <div
                  key={station.name}
                  className="station-card"
                  onClick={() => navigate(`/search?q=${encodeURIComponent(station.name + ' radio')}`)}
                >
                  <div className="station-avatar-container">
                    <img src={station.image} alt={station.name} className="station-avatar" />
                  </div>
                  <div className="station-title">Radio de {station.name}</div>
                  <div className="station-subtitle">Con {station.name} y más</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recomendaciones (Koko-Mix) */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <h2 className="section-title" style={{ marginBottom: 4 }}>Koko-Mix</h2>
                <p className="section-subtitle" style={{ marginBottom: 16 }}>Recomendaciones basadas en tu historial de reproducción</p>
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <button
                  onClick={() => setIsOnboardingOpen(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                >
                  ⚙️ Configurar
                </button>
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
        </>
      )}

      {/* Modal de Onboarding y Carga de Historial */}
      <OnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setIsOnboardingOpen(false)}
        onSuccess={() => refetch()}
      />
    </div>
  );
}

