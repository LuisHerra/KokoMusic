import { BrowserRouter, Routes, Route, useNavigate, useSearchParams, useLocation, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import Sidebar from './components/Sidebar/Sidebar';
import Player from './components/Player/Player';
import BottomNav from './components/BottomNav';
import Home from './pages/Home';
import Search from './pages/Search';
import Library from './pages/Library';
import Playlist from './pages/Playlist';
import Stats from './pages/Stats';
import Artist from './pages/Artist';
import Album from './pages/Album';
import TopArtists from './pages/TopArtists';
import Events from './pages/Events';
import Following from './pages/Following';
import Friends from './pages/Friends';
import FriendProfile from './pages/FriendProfile';
import Profile from './pages/Profile';
import DjMode from './pages/DjMode';
import KaraokeStudioPage from './pages/KaraokeStudio';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useListeningSession } from './hooks/useListeningSession';
import { usePlayerStore } from './store/playerStore';
import VideoPanel from './components/Player/VideoPanel';
import MobileFullPlayer from './components/Player/MobileFullPlayer';
import QueuePanel from './components/Player/QueuePanel';
import ImmersiveLyrics from './components/Player/ImmersiveLyrics';
import NotificationBell from './components/NotificationBell';
import { useNotifications } from './hooks/useNotifications';
import { joinJam, getJam, getMyProfile, getProfileNames, cleanName, resolveImageUrl } from './lib/api';
import { cleanupOldOfflineTracks } from './lib/offlineAudio';
import InstallPrompt from './components/InstallPrompt';
import AppSplash from './components/AppSplash';
import { useVoiceControl } from './hooks/useVoiceControl';
import VoiceControlModal, { IconMic } from './components/VoiceControlModal';
import ThemeModal from './components/ThemeModal';
import { useThemeStore } from './store/themeStore';


const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// Hook que inicializa el reproductor de audio a nivel de app — se monta UNA SOLA VEZ
function AudioEngine() {
  useAudioPlayer();

  useEffect(() => {
    if ((window as any).electronAPI) {
      (window as any).electronAPI.onMediaKey((action: string) => {
        const store = usePlayerStore.getState();
        if (action === 'play-pause') store.togglePlay();
        else if (action === 'next-track') store.nextTrack();
        else if (action === 'prev-track') store.prevTrack();
        else if (action === 'toggle-voice') {
          window.dispatchEvent(new CustomEvent('koko-toggle-voice'));
        }
      });
    }
  }, []);

  return null;
}

// Acumula minutos escuchados y los envía al backend solo al salir de la app
function ListeningSessionTracker() {
  useListeningSession();
  return null;
}

// Polls backend for new-release notifications
function NotificationPoller() {
  useNotifications();
  return null;
}

function GlobalSearch({ onFocusChange }: { onFocusChange?: (focused: boolean) => void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');
  const [isFocused, setIsFocused] = useState(false);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      navigate(`/search?q=${encodeURIComponent(value.trim())}`);
      setIsFocused(false);
      onFocusChange?.(false);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    onFocusChange?.(true);
  };

  const handleBlur = () => {
    setTimeout(() => {
      setIsFocused(false);
      onFocusChange?.(false);
    }, 180);
  };

  return (
    <motion.form
      onSubmit={handleSubmit}
      className="search-bar"
      initial={false}
      animate={{
        maxWidth: isFocused ? (isMobile ? 320 : 560) : (isMobile ? 200 : 420),
      }}
      transition={{ type: 'spring', stiffness: 350, damping: 28 }}
      style={{
        flex: 1,
        position: 'relative',
        borderRadius: '9999px',
        background: 'transparent',
        boxShadow: 'none',
        border: 'none',
        padding: 0,
        zIndex: isFocused ? 30 : 1,
      }}
    >
      <span className="search-icon" style={{ color: isFocused ? 'var(--accent)' : 'var(--text-muted)' }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
        </svg>
      </span>
      <input
        className="search-input"
        type="text"
        placeholder="Buscar canciones, artistas..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={{
          borderRadius: '9999px',
          borderColor: isFocused ? 'var(--accent)' : 'rgba(255, 255, 255, 0.12)',
          background: isFocused ? 'var(--bg-highlight)' : 'var(--bg-card)',
          boxShadow: isFocused ? '0 0 20px var(--accent-glow)' : 'none',
          transition: 'all 0.2s ease',
        }}
      />
      {value && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          type="button"
          onClick={() => { setValue(''); navigate('/search'); }}
          style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 4
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </motion.button>
      )}
    </motion.form>
  );
}

// Toast de error del reproductor
function PlayerErrorToast() {
  const { error, setError } = usePlayerStore();

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error, setError]);

  if (!error) return null;
  return (
    <div className="toast" style={{ background: '#c0392b', cursor: 'pointer' }} onClick={() => setError(null)}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white" style={{ flexShrink: 0 }}><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg> {error}
    </div>
  );
}

function AppShell() {
  const { isLyricsOpen, isQueueOpen, isVideoOpen, toggleVideo, currentTrack } = usePlayerStore();
  const location = useLocation();
  const [isHeaderSearchFocused, setIsHeaderSearchFocused] = useState(false);
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

  const voiceControl = useVoiceControl();
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);

  useEffect(() => {
    useThemeStore.getState().applyThemeToDOM();
  }, []);

  const [deviceId, setDeviceId] = useState(() => localStorage.getItem('koko_device_id') || '');
  useEffect(() => {
    const handler = () => {
      setDeviceId(localStorage.getItem('koko_device_id') || '');
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  // Limpiar pistas offline que expiran tras 2 días sin escucharse
  useEffect(() => {
    useThemeStore.getState().applyThemeToDOM();
    cleanupOldOfflineTracks()
      .catch((err) => console.error('[App] Error en la limpieza de IndexedDB:', err));
  }, []);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUUID = UUID_RE.test(deviceId);

  const { data: profileData } = useQuery({
    queryKey: ['my-profile', deviceId],
    queryFn: () => getMyProfile(deviceId),
    enabled: isUUID && !!deviceId,
    staleTime: 5 * 60 * 1000,
  });
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const joinJamCode = searchParams.get('join_jam');
  const [hasAutoJoined, setHasAutoJoined] = useState(false);

  useEffect(() => {
    if (joinJamCode && !hasAutoJoined) {
      setHasAutoJoined(true);
      const autoJoin = async () => {
        try {
          const deviceId = localStorage.getItem('koko_device_id') || `device_${Math.random().toString(36).substring(2, 11)}`;
          if (!localStorage.getItem('koko_device_id')) {
            localStorage.setItem('koko_device_id', deviceId);
          }
          const displayName = localStorage.getItem('koko_display_name') || 'Oyente';
          if (!localStorage.getItem('koko_display_name')) {
            localStorage.setItem('koko_display_name', displayName);
          }

          const { isHost } = await joinJam(joinJamCode, deviceId, displayName);
          const freshJam = await getJam(joinJamCode);
          
          usePlayerStore.getState().setActiveJam({
            code: freshJam.jam_code,
            id: freshJam.id,
            hostName: freshJam.host_name,
            isHost
          });
          
          // Clear query param
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete('join_jam');
          navigate({ search: nextParams.toString() }, { replace: true });
          
          usePlayerStore.getState().setError(`¡Te has unido a la Sinfonía ${joinJamCode}!`);
        } catch (e: any) {
          console.error('[AutoJoin] Failed to join jam:', e);
          usePlayerStore.getState().setError('No se pudo unir a la Sinfonía: Código inválido');
        }
      };
      autoJoin();
    }
  }, [joinJamCode, hasAutoJoined, searchParams, navigate]);

  const period = searchParams.get('period') ?? 'all';

  const handlePeriodChange = (newPeriod: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('period', newPeriod);
    navigate(`/stats?${params.toString()}`);
  };

  const handleShareClick = () => {
    const params = new URLSearchParams(searchParams);
    params.set('share', 'true');
    navigate(`/stats?${params.toString()}`);
  };

  const isRightPanelOpen = isQueueOpen || isVideoOpen;

  return (
    <div className={`app-shell ${isRightPanelOpen ? 'with-right-panel' : ''} ${isLyricsOpen ? 'lyrics-mode' : ''} ${currentTrack ? 'has-track' : ''}`}>
      <PlayerErrorToast />
      <Sidebar />

      {/* Immersive Lyrics if open, otherwise standard main content */}
      {isLyricsOpen ? (
        <ImmersiveLyrics />
      ) : (
        <main className="main-content">
          <header className="main-header" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flex: 1 }}>
              {/* Back/forward */}
              <div className="hide-on-mobile" style={{ display: 'flex', gap: 8 }}>
                <button
                  className="ctrl-btn"
                  style={{ width: 32, height: 32, background: '#000000a0', borderRadius: '50%' }}
                  onClick={() => window.history.back()}
                  title="Atrás"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/>
                  </svg>
                </button>
                <button
                  className="ctrl-btn"
                  style={{ width: 32, height: 32, background: '#000000a0', borderRadius: '50%' }}
                  onClick={() => window.history.forward()}
                  title="Adelante"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                  </svg>
                </button>
              </div>

              {location.pathname !== '/search' && <GlobalSearch onFocusChange={setIsHeaderSearchFocused} />}
            </div>

            {/* Right side header actions */}
            <div style={{ display: (isHeaderSearchFocused && isMobile) ? 'none' : 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className="ctrl-btn"
                onClick={() => {
                  voiceControl.toggleListening();
                  setIsVoiceModalOpen(true);
                }}
                title="Control por voz (Alt + V)"
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 34,
                  height: 34,
                  borderRadius: '50%',
                  background: voiceControl.isListening ? 'var(--accent-glow)' : 'rgba(255, 255, 255, 0.06)',
                  border: voiceControl.isListening ? '1px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.1)',
                  color: voiceControl.isListening ? 'var(--accent)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  transition: 'all var(--duration-fast)',
                }}
              >
                <IconMic size={18} color={voiceControl.isListening ? 'var(--accent)' : 'currentColor'} />
              </button>
              <NotificationBell />
              {isUUID && (
                <Link
                  to="/profile"
                  className="header-profile-link"
                >
                  {profileData?.profile?.avatar_url ? (
                    <img
                      src={resolveImageUrl(profileData.profile.avatar_url)}
                      alt="avatar"
                      style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: 'linear-gradient(135deg, var(--accent), var(--accent-dim))',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700, color: '#000', flexShrink: 0
                    }}>
                      {cleanName(profileData?.profile?.display_name || profileData?.profile?.username || 'Kokoer').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="header-profile-username" style={{
                    fontSize: 13,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 110,
                  }}>
                    {getProfileNames(profileData?.profile, 'Mi perfil').primary}
                  </span>
                </Link>
              )}

              {/* Theme Customizer Palette Button */}
              <button
                onClick={() => useThemeStore.getState().toggleThemeModal()}
                className="ctrl-btn"
                title="Personalizar diseño y colores"
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '50%',
                  width: 36,
                  height: 36,
                  color: 'var(--accent)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'transform 0.15s ease',
                  flexShrink: 0,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
                  <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
                  <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
                  <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
                  <path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10c1.38 0 2.5-1.12 2.5-2.5 0-.61-.23-1.21-.64-1.67-.42-.45-.64-1.04-.64-1.67 0-1.38 1.12-2.5 2.5-2.5H18c2.21 0 4-1.79 4-4 0-4.97-4.43-9.1-10-9.1z"/>
                </svg>
              </button>
            </div>

            {/* Stats Page Specific Header Controls */}
            {location.pathname === '/stats' && (
              <div className="hide-on-mobile" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ position: 'relative' }}>
                  <select
                    value={period}
                    onChange={(e) => handlePeriodChange(e.target.value)}
                    style={{
                      appearance: 'none',
                      padding: '8px 36px 8px 36px',
                      borderRadius: 'var(--radius-md)',
                      background: 'rgba(255,255,255,0.06)',
                      color: 'var(--text-primary)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      outline: 'none',
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: 'pointer',
                      minWidth: 120,
                      transition: 'background var(--duration-fast)'
                    }}
                  >
                    <option value="all" style={{ background: '#1f1f1f', color: '#ffffff' }}>Siempre</option>
                    <option value="day" style={{ background: '#1f1f1f', color: '#ffffff' }}>Últimas 24 horas</option>
                    <option value="week" style={{ background: '#1f1f1f', color: '#ffffff' }}>Última semana</option>
                    <option value="month" style={{ background: '#1f1f1f', color: '#ffffff' }}>Último mes</option>
                    <option value="year" style={{ background: '#1f1f1f', color: '#ffffff' }}>Último año</option>
                  </select>
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none', display: 'flex' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="16" y1="2" x2="16" y2="6"></line>
                      <line x1="8" y1="2" x2="8" y2="6"></line>
                      <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                  </span>
                  <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none', display: 'flex' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
                    </svg>
                  </span>
                </div>

                <button
                  onClick={handleShareClick}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'var(--accent)',
                    color: '#000000',
                    border: 'none',
                    borderRadius: 'var(--radius-full)',
                    padding: '8px 18px',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'background var(--duration-fast), transform var(--duration-fast)',
                  }}
                  className="btn-primary"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="5" r="3"></circle>
                    <circle cx="6" cy="12" r="3"></circle>
                    <circle cx="18" cy="19" r="3"></circle>
                    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                  </svg>
                  Compartir
                </button>
              </div>
            )}
          </header>

          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/library" element={<Library />} />
            <Route path="/playlist/:id" element={<Playlist />} />
            <Route path="/album/:id" element={<Album />} />
            <Route path="/artist/:name" element={<Artist />} />
            <Route path="/top-artists" element={<TopArtists />} />
            <Route path="/following" element={<Following />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/friends/profile/:userId" element={<FriendProfile />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/events" element={<Events />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/dj" element={<DjMode />} />
            <Route path="/karaoke" element={<KaraokeStudioPage />} />
          </Routes>
        </main>
      )}

      <VideoPanel />
      <MobileFullPlayer isOpen={isVideoOpen} onClose={toggleVideo} />
      <QueuePanel />
      <Player />
      <BottomNav />

      <VoiceControlModal
        voiceControl={voiceControl}
        isOpen={isVoiceModalOpen || voiceControl.isListening}
        onClose={() => setIsVoiceModalOpen(false)}
      />

      <ThemeModal />
    </div>
  );
}

export default function App() {
  const [backendReady, setBackendReady] = useState(false);
  const handleReady = useCallback(() => setBackendReady(true), []);

  // import.meta.env.BASE_URL = '/kokoMusic/' in production build (set by vite.config base)
  // and '/' in dev mode — so routing works correctly in both environments
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  return (
    <QueryClientProvider client={queryClient}>
      {/* Splash mientras el backend local (Termux) arranca */}
      {!backendReady && <AppSplash onReady={handleReady} />}

      <BrowserRouter basename={basename}>
        <AudioEngine />
        <ListeningSessionTracker />
        <NotificationPoller />
        <AppShell />
        {/* Banner de instalación PWA — solo aparece si Chrome lo ofrece */}
        <InstallPrompt />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
