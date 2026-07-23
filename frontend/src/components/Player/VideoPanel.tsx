import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '../../store/playerStore';
import { getTrackVideo, getLyrics, type VideoData, type Lyrics } from '../../lib/api';
import { useVideoSync } from '../../hooks/useVideoSync';
import { useLikedSongs } from '../../hooks/useLikedSongs';
import { seekAudio } from '../../hooks/useAudioPlayer';
import PlaylistModal from './PlaylistModal';
import { isTrackOffline, saveTrackOffline } from '../../lib/offlineAudio';
import { getApiUrl } from '../../lib/backendResolver';

import { parseSyncedLyrics } from '../../lib/lyricsParser';
import { useResizableRightPanel } from '../../hooks/useResizable';

function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VideoPanel() {
  const { 
    currentTrack, isVideoOpen, toggleVideo, progress, dominantColor,
    isPlaying, togglePlay, nextTrack, prevTrack, isShuffle, toggleShuffle, repeatMode, cycleRepeat, duration, toggleQueue,
    toggleLyrics, isKaraokeMode, toggleKaraoke, isEmbedMode, embedYoutubeId, setEmbedMode
  } = usePlayerStore();
  const { isLiked, toggleLike } = useLikedSongs();
  const { startResize, isResizing } = useResizableRightPanel();
  
  const [showVideo, setShowVideo] = useState(true);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [isLyricsPageActive, setIsLyricsPageActive] = useState(false);
  const [activeTab, setActiveTab] = useState<'player' | 'lyrics' | 'artist' | 'video'>('player');
  
  const [downloadStatus, setDownloadStatus] = useState<'none' | 'downloading' | 'downloaded'>('none');
  const [autoDownloadYt, setAutoDownloadYt] = useState(() => localStorage.getItem('autoDownloadYt') !== 'false');
  const [followedArtists, setFollowedArtists] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('koko_followed_artists') || '[]');
    } catch {
      return [];
    }
  });

  // Escuchar cambios de localStorage para autoDownloadYt
  useEffect(() => {
    const handleStorageChange = () => {
      setAutoDownloadYt(localStorage.getItem('autoDownloadYt') !== 'false');
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Verificar y hacer polling al estado de descarga cuando cambie currentTrack.id o status
  useEffect(() => {
    if (!currentTrack) return;
    
    let isMounted = true;
    let pollInterval: any = null;

    const checkStatus = async () => {
      try {
        // Primero verificar IndexedDB local
        const isOffline = await isTrackOffline(currentTrack.id);
        if (isOffline) {
          if (isMounted) setDownloadStatus('downloaded');
          if (pollInterval) clearInterval(pollInterval);
          return;
        }

        const API_BASE = await getApiUrl();
        const res = await fetch(`${API_BASE}/stream/${currentTrack.id}/status`);
        if (!res.ok) return;
        const data = await res.json();
        if (!isMounted) return;

        if (data.downloaded) {
          setDownloadStatus('downloaded');
          if (pollInterval) clearInterval(pollInterval);
        } else if (data.status === 'downloading') {
          setDownloadStatus('downloading');
          if (!pollInterval) {
            pollInterval = setInterval(checkStatus, 3000);
          }
        } else {
          setDownloadStatus('none');
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        }
      } catch {
        // ignore
      }
    };

    checkStatus();

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [currentTrack?.id]);

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentTrack || downloadStatus !== 'none') return;

    setDownloadStatus('downloading');

    try {
      // Intentar guardar offline localmente en IndexedDB
      await saveTrackOffline(currentTrack.id, {
        title: currentTrack.title,
        artist: currentTrack.artist,
        cover: currentTrack.cover || '',
        duration: currentTrack.duration
      });
      setDownloadStatus('downloaded');
    } catch (offlineErr: any) {
      console.error('[VideoPanel] Error al descargar y guardar offline localmente:', offlineErr);
      setDownloadStatus('none');
    }
  };
  const [videoFormat, setVideoFormat] = useState<'vertical' | 'rectangular'>(() => {
    return (localStorage.getItem('koko_video_format') as 'vertical' | 'rectangular') || 'vertical';
  });
  
  const [iframeEl, setIframeEl] = useState<HTMLIFrameElement | null>(null);

  useEffect(() => {
    localStorage.setItem('koko_video_format', videoFormat);
  }, [videoFormat]);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const lyricsScrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Resetear posición de scroll y pestaña al cambiar de canción
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    setIsLyricsPageActive(false);
    setActiveTab('player');
  }, [currentTrack?.id]);

  // Forzar formato rectangular si es modo embed de YouTube largo
  useEffect(() => {
    if (isEmbedMode) {
      setVideoFormat('rectangular');
    }
  }, [isEmbedMode]);

  // Escuchar mensajes del iframe de YouTube en modo embed para sincronizar progreso y controles
  useEffect(() => {
    if (!isEmbedMode || !iframeEl) return;

    const handleWindowMessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      try {
        const data = JSON.parse(e.data);
        if (data.event === 'infoDelivery' && data.info) {
          const info = data.info;
          const store = usePlayerStore.getState();

          // Sincronizar currentTime si es un número válido
          if (typeof info.currentTime === 'number') {
            const diff = Math.abs(store.progress - info.currentTime);
            // Evitar loops: actualizar solo si difiere en más de 0.8s
            if (diff > 0.8) {
              store.setProgress(info.currentTime);
            }
          }

          // Sincronizar playerState (1 = playing, 2 = paused, 0 = ended)
          if (info.playerState === 1 && !store.isPlaying) {
            store.setIsPlaying(true);
          } else if (info.playerState === 2 && store.isPlaying) {
            store.setIsPlaying(false);
          } else if (info.playerState === 0) {
            // Canción terminada, saltar a la siguiente
            store.setIsPlaying(false);
            store.nextTrack();
          }
        }
      } catch (err) {
        // Ignorar otros mensajes
      }
    };

    window.addEventListener('message', handleWindowMessage);

    let interval: number | undefined;
    
    // Indicar periódicamente al iframe que estamos escuchando eventos
    // Se inicia con un retraso para evitar errores "isExternalMethodAvailable" en el API interno de YouTube
    const timeout = setTimeout(() => {
      interval = setInterval(() => {
        try {
          iframeEl.contentWindow?.postMessage(
            JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
            '*'
          );
        } catch {}
      }, 1000);
    }, 2500);

    return () => {
      window.removeEventListener('message', handleWindowMessage);
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [isEmbedMode, iframeEl]);

  // Resetear scroll al abrir el panel en mÃ³vil
  useEffect(() => {
    if (isVideoOpen && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
    setIsLyricsPageActive(false);
  }, [isVideoOpen]);

  // Cargar letras de la canciÃ³n actual
  const { data: lyrics } = useQuery<Lyrics>({
    queryKey: ['lyrics', currentTrack?.id],
    queryFn: () => getLyrics(currentTrack!.id),
    enabled: !!currentTrack && isVideoOpen,
    retry: false,
    staleTime: 24 * 60 * 60 * 1000,
  });

  const parsedLines = useMemo(() => {
    if (!lyrics?.syncedLyrics) return [];
    return parseSyncedLyrics(lyrics.syncedLyrics);
  }, [lyrics]);

  const activeIndex = useMemo(() => {
    if (parsedLines.length === 0) return -1;
    let idx = -1;
    for (let i = 0; i < parsedLines.length; i++) {
      if (progress >= parsedLines[i].time) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [parsedLines, progress]);

  const karaokeRatio = useMemo(() => {
    if (activeIndex < 0 || activeIndex >= parsedLines.length) return 0;
    const lineStart = parsedLines[activeIndex].time;
    const lineEnd = activeIndex + 1 < parsedLines.length
      ? parsedLines[activeIndex + 1].time
      : lineStart + 5;
    const elapsed = progress - lineStart;
    const duration = Math.max(0.1, lineEnd - lineStart);
    return Math.min(1, Math.max(0, elapsed / duration));
  }, [progress, activeIndex, parsedLines]);

  // Read translation settings from localStorage as states so setting changes trigger re-renders
  const [translationMode, setTranslationMode] = useState<'none' | 'replace' | 'both'>(() => {
    const saved = localStorage.getItem('koko_lyrics_translationMode');
    return saved ? JSON.parse(saved) : 'none';
  });
  const [translationLang, setTranslationLang] = useState<string>(() => {
    const saved = localStorage.getItem('koko_lyrics_translationLang');
    return saved ? JSON.parse(saved) : 'es';
  });
  const [mobileBaseSize, setMobileBaseSize] = useState<number>(() => {
    const saved = localStorage.getItem('koko_lyrics_baseSize_mobile');
    return saved ? JSON.parse(saved) : 26; // Default CSS size is 26px
  });
  const [showMobileSettings, setShowMobileSettings] = useState(false);

  useEffect(() => {
    localStorage.setItem('koko_lyrics_translationMode', JSON.stringify(translationMode));
  }, [translationMode]);

  useEffect(() => {
    localStorage.setItem('koko_lyrics_translationLang', JSON.stringify(translationLang));
  }, [translationLang]);

  useEffect(() => {
    localStorage.setItem('koko_lyrics_baseSize_mobile', JSON.stringify(mobileBaseSize));
  }, [mobileBaseSize]);

  // Query para traducción (Mobile)
  const { data: translationsRecord } = useQuery({
    queryKey: ['lyricsTranslation', currentTrack?.id, translationLang],
    queryFn: async () => {
      if (!parsedLines || parsedLines.length === 0) return {};
      const allText = parsedLines.map(line => line.text).join('\n');
      const res = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + translationLang + '&dt=t', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'q=' + encodeURIComponent(allText)
      });
      if (!res.ok) throw new Error('Translation failed');
      const data = await res.json();
      const translatedText = data[0].map((s: any) => s[0]).join('');
      const translatedLines = translatedText.split('\n');
      const record: Record<number, string> = {};
      parsedLines.forEach((_, idx) => {
        if (translatedLines[idx]) record[idx] = translatedLines[idx].trim();
      });
      return record;
    },
    enabled: translationMode !== 'none' && parsedLines.length > 0 && !!currentTrack,
    staleTime: 24 * 60 * 60 * 1000,
  });

  // Auto-scroll active lyric line on mobile full screen page only if lyrics page is active
  const lastActiveIndex = useRef(-1);
  const wasPageActive = useRef(false);

  useEffect(() => {
    if (!isMobile || !isLyricsPageActive || !lyricsScrollContainerRef.current) {
      if (!isLyricsPageActive) {
        wasPageActive.current = false;
      }
      return;
    }

    const activeEl = lyricsScrollContainerRef.current.querySelector('.sp-lyric-line.active');
    if (activeEl) {
      // If we just entered the lyrics page, jump immediately (behavior: 'auto')
      const justEntered = !wasPageActive.current;
      activeEl.scrollIntoView({
        behavior: justEntered ? 'auto' : 'smooth',
        block: 'center',
      });
      wasPageActive.current = true;
      lastActiveIndex.current = activeIndex;
    }
  }, [activeIndex, isMobile, isLyricsPageActive]);


  // Cargar datos de video (ID de youtube y relacionados)
  const { data: videoData, isLoading, error } = useQuery<VideoData>({
    queryKey: ['video', currentTrack?.id],
    queryFn: () => getTrackVideo(currentTrack!.id),
    enabled: !!currentTrack && isVideoOpen,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  const activeYoutubeId = embedYoutubeId || videoData?.youtubeId || null;
  const isBackgroundVideoActive = showVideo && activeYoutubeId;

  // Sincronizar el iframe de YouTube con el estado de reproducción del audio (tanto en modo embed como normal)
  useVideoSync(iframeEl, (isBackgroundVideoActive || isEmbedMode) ? activeYoutubeId : null);

  if (!currentTrack) return null;

  if (isMobile) {
    if (!isVideoOpen && !isEmbedMode) return null;

    const progressPct = duration > 0 ? (progress / duration) * 100 : 0;
    
    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      seekAudio(ratio * duration);
    };

    const hasLyrics = !!(lyrics && !lyrics.instrumental && (parsedLines.length > 0 || lyrics.plainLyrics));

    return (
      <div 
        className="sp-mobile-player" 
        style={!isVideoOpen ? {
          position: 'fixed',
          top: -9999,
          left: -9999,
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none',
          zIndex: -1000
        } : { 
          background: dominantColor ? `linear-gradient(175deg, ${dominantColor}d9 0%, #0c0c0c 70%)` : '#0c0c0c' 
        }}
      >

        {/* ── Fullscreen background video for mobile */}
        {isBackgroundVideoActive && !isEmbedMode && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, overflow: 'hidden' }}>
            <iframe
              ref={setIframeEl}
              src={`https://www.youtube.com/embed/${activeYoutubeId}?enablejsapi=1&autoplay=1&mute=1&controls=0&showinfo=0&rel=0&iv_load_policy=3&cc_load_policy=0&origin=${window.location.origin}`}
              title="Video Background"
              frameBorder="0"
              allow="autoplay; encrypted-media"
              style={{
                position: 'absolute',
                width: '177.78vh',
                height: '100vh',
                minWidth: '100%',
                minHeight: '100%',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
            />
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.65)' }} />
          </div>
        )}

        {/* ── Blurred background art */}
        <div className="sp-mobile-bg" style={{ opacity: (isBackgroundVideoActive && !isEmbedMode) ? 0 : 1 }}>
          <img src={currentTrack.cover} alt="" className="sp-mobile-bg-img" />
        </div>
        <div className="sp-mobile-bg-overlay" style={{ background: (isBackgroundVideoActive && !isEmbedMode) ? 'rgba(0,0,0,0.45)' : undefined }} />

        {/* Main layout wrapper */}
        <div className="sp-mobile-layout">
          
          {/* Header */}
          <div className="sp-header">
            <button className="sp-icon-btn sp-chevron-down" onClick={toggleVideo} title="Cerrar">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            
            {/* Tab switch controller */}
            <div className="sp-mobile-tabs">
              <button 
                className={`sp-mobile-tab-btn ${activeTab === 'player' ? 'active' : ''}`}
                onClick={() => setActiveTab('player')}
              >
                Canción
              </button>
              {hasLyrics && (
                <button 
                  className={`sp-mobile-tab-btn ${activeTab === 'lyrics' ? 'active' : ''}`}
                  onClick={() => setActiveTab('lyrics')}
                >
                  Letras
                </button>
              )}
              <button 
                className={`sp-mobile-tab-btn ${activeTab === 'artist' ? 'active' : ''}`}
                onClick={() => setActiveTab('artist')}
              >
                Artista
              </button>
              {activeYoutubeId && (
                <button 
                  className={`sp-mobile-tab-btn ${activeTab === 'video' ? 'active' : ''}`}
                  onClick={() => setActiveTab('video')}
                >
                  Video
                </button>
              )}
            </div>

            <button className="sp-icon-btn" onClick={() => setShowPlaylistModal(true)} title="Opciones">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
              </svg>
            </button>
          </div>

          {/* Active Tab Screen Content */}
          <div className="sp-mobile-body">
            
            {/* TAB 1: PLAYER SCREEN */}
            {activeTab === 'player' && (
              <div className="sp-tab-content sp-tab-player">
                <div className="sp-player-main-viewport">
                  {/* Artwork / Video mode preview */}
                  {isEmbedMode && embedYoutubeId ? (
                    <div className="sp-artwork-wrap embed-active">
                      <iframe
                        ref={setIframeEl}
                        src={`https://www.youtube.com/embed/${embedYoutubeId}?enablejsapi=1&autoplay=1&mute=0&controls=1&showinfo=0&rel=0&iv_load_policy=3&cc_load_policy=0&origin=${window.location.origin}`}
                        title="Reproductor YouTube Embed Mobile"
                        frameBorder="0"
                        allow="autoplay; encrypted-media; fullscreen"
                        allowFullScreen
                        style={{ width: '100%', height: '100%', pointerEvents: 'auto', borderRadius: '12px' }}
                      />
                    </div>
                  ) : isBackgroundVideoActive ? (
                    <div className="sp-artwork-wrap active-lyric-overlay-container" onClick={() => setShowVideo(!showVideo)}>
                      {activeIndex >= 0 && parsedLines[activeIndex] ? (
                        <div className="sp-bg-lyrics-overlay">
                          {parsedLines[activeIndex].text}
                          {translationMode !== 'none' && translationsRecord?.[activeIndex] && (
                            <div className="sp-bg-lyrics-translation">
                              {translationsRecord[activeIndex]}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="sp-artwork-wrap" onClick={() => setShowVideo(!showVideo)}>
                      <img 
                        src={currentTrack.cover} 
                        alt={currentTrack.title} 
                        className="sp-cover-art" 
                      />
                    </div>
                  )}

                  {/* Track Row */}
                  <div className="sp-track-row">
                    {isBackgroundVideoActive && (
                      <img 
                        src={currentTrack.cover} 
                        alt="" 
                        className="sp-track-mini-cover"
                      />
                    )}
                    <div className="sp-track-info">
                      <div className="sp-track-title">{currentTrack.title}</div>
                      <div className="sp-track-artist">{currentTrack.artist}</div>
                    </div>
                    <div className="sp-track-actions">
                      {!autoDownloadYt && (
                        <button
                          className={`sp-icon-btn sp-download-btn ${downloadStatus === 'downloaded' ? 'active' : ''}`}
                          onClick={handleDownload}
                          disabled={downloadStatus !== 'none'}
                          title={
                            downloadStatus === 'downloaded'
                              ? 'Audio guardado en caché'
                              : downloadStatus === 'downloading'
                              ? 'Descargando audio...'
                              : 'Descargar audio'
                          }
                        >
                          {downloadStatus === 'downloaded' && (
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                          {downloadStatus === 'downloading' && (
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <circle cx="12" cy="12" r="10" stroke="rgba(255, 255, 255, 0.15)" />
                              <path d="M12 2a10 10 0 0 1 10 10" stroke="var(--accent)">
                                <animateTransform
                                  attributeName="transform"
                                  type="rotate"
                                  from="0 12 12"
                                  to="360 12 12"
                                  dur="1s"
                                  repeatCount="indefinite"
                                />
                              </path>
                            </svg>
                          )}
                          {downloadStatus === 'none' && (
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                          )}
                        </button>
                      )}
                      
                      <button
                        className={`sp-icon-btn sp-heart-btn ${isLiked(currentTrack.id) ? 'active' : ''}`}
                        onClick={() => toggleLike(currentTrack.id)}
                      >
                        <svg width="28" height="28" viewBox="0 0 24 24"
                           fill={isLiked(currentTrack.id) ? 'var(--accent)' : 'none'}
                           stroke={isLiked(currentTrack.id) ? 'var(--accent)' : 'rgba(255,255,255,0.7)'}
                           strokeWidth="2">
                          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="sp-progress-section">
                    <div className="sp-progress-bar" onClick={handleProgressClick}>
                      <div className="sp-progress-bg" />
                      <div className="sp-progress-fill" style={{ width: `${progressPct}%` }}>
                        <div className="sp-progress-thumb" />
                      </div>
                    </div>
                    <div className="sp-progress-times">
                      <span>{formatTime(progress)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>

                  {/* Playback controls */}
                  <div className="sp-controls">
                    <button
                      className={`sp-icon-btn sp-ctrl-secondary ${isShuffle ? 'active' : ''}`}
                      onClick={toggleShuffle}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" />
                        <polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" />
                        <line x1="4" y1="4" x2="9" y2="9" />
                      </svg>
                    </button>

                    <button className="sp-icon-btn sp-ctrl-prev" onClick={prevTrack}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
                      </svg>
                    </button>

                    <button className="sp-play-btn" onClick={togglePlay}>
                      {isPlaying ? (
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                        </svg>
                      ) : (
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 3 }}>
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      )}
                    </button>

                    <button className="sp-icon-btn sp-ctrl-next" onClick={nextTrack}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 18l8.5-6L6 6v12zm2.5-6 5.5 4V8l-5.5 4zm7.5-6h2v12h-2z"/>
                      </svg>
                    </button>

                    <button
                      className={`sp-icon-btn sp-ctrl-secondary ${repeatMode !== 'off' ? 'active' : ''}`}
                      onClick={cycleRepeat}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                        <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
                      </svg>
                      {repeatMode === 'one' && <span className="sp-repeat-one-dot" />}
                    </button>
                  </div>

                  {/* Footer Buttons Row */}
                  <div className="sp-footer-row">
                    <button className="sp-icon-btn sp-footer-btn" onClick={toggleQueue} title="Cola">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
                        <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
                        <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                      </svg>
                    </button>

                    {hasLyrics && (
                      <button className="sp-footer-lyrics-btn" onClick={() => setActiveTab('lyrics')}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                        </svg>
                        <span>Letras</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="sp-player-previews">
                  {/* Lyrics Preview Card */}
                  {hasLyrics && (
                    <div 
                      className="sp-preview-card lyrics-preview"
                      onClick={() => setActiveTab('lyrics')}
                    >
                      <div className="sp-preview-card-header">
                        <span className="sp-preview-title">Letras</span>
                        <span className="sp-preview-action">
                          VER TODO
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </span>
                      </div>
                      <div className="sp-preview-lines">
                        {parsedLines.slice(Math.max(0, activeIndex), Math.min(parsedLines.length, Math.max(0, activeIndex) + 3)).map((line, idx) => {
                          const isCurrent = parsedLines.indexOf(line) === activeIndex;
                          return (
                            <div 
                              key={idx}
                              className={`sp-preview-line ${isCurrent ? 'active' : ''}`}
                            >
                              {line.text}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Artist Preview Card */}
                  <div 
                    className="sp-preview-card artist-preview"
                    onClick={() => setActiveTab('artist')}
                  >
                    <div className="sp-artist-card-cover">
                      <img 
                        src={currentTrack.cover} 
                        alt="" 
                      />
                      <div className="sp-artist-card-overlay">
                        <span className="sp-artist-subtitle">Artista</span>
                        <span className="sp-artist-name">{currentTrack.artist}</span>
                      </div>
                    </div>
                    <div className="sp-artist-card-body">
                      <div className="sp-artist-stats">
                        <div className="sp-artist-stat-col">
                          <span className="sp-stat-val">
                            {((Math.abs(currentTrack.artist.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) * 12457) % 3500000 + 450000).toLocaleString()}
                          </span>
                          <span className="sp-stat-lbl">Oyentes mensuales</span>
                        </div>
                        <button
                          className={`sp-follow-btn ${followedArtists.includes(currentTrack.artist) ? 'following' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const isFollowing = followedArtists.includes(currentTrack.artist);
                            setFollowedArtists(prev => {
                              const next = isFollowing
                                ? prev.filter(a => a !== currentTrack.artist)
                                : [...prev, currentTrack.artist];
                              localStorage.setItem('koko_followed_artists', JSON.stringify(next));
                              return next;
                            });
                          }}
                        >
                          {followedArtists.includes(currentTrack.artist) ? 'Siguiendo' : 'Seguir'}
                        </button>
                      </div>
                      <p className="sp-artist-bio">
                        Descubre más música y contenido oficial de {currentTrack.artist} en KokoMusic.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: LYRICS SCREEN */}
            {activeTab === 'lyrics' && hasLyrics && (
              <div className="sp-tab-content sp-tab-lyrics">
                <div className="sp-lyrics-header">
                  <div className="sp-lyrics-thumb">
                    <img src={currentTrack.cover} alt="" />
                  </div>
                  <div className="sp-lyrics-song-info">
                    <span className="sp-lyrics-song-title">{currentTrack.title}</span>
                    <span className="sp-lyrics-song-artist">{currentTrack.artist}</span>
                  </div>
                  <button 
                    className="sp-icon-btn" 
                    onClick={() => setShowMobileSettings(prev => !prev)}
                    title="Ajustes de Letras"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={showMobileSettings ? "var(--accent)" : "currentColor"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
                </div>

                {/* Mobile Lyrics Settings panel */}
                {showMobileSettings && (
                  <div className="sp-lyrics-settings-panel">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4.5px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 'bold', color: '#fff' }}>Apariencia de Letras</span>
                      <button 
                        onClick={() => setShowMobileSettings(false)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold' }}
                      >
                        Listo
                      </button>
                    </div>

                    {/* Tamaño de Letra */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Tamaño</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.06)', borderRadius: '20px', padding: '4px 12px' }}>
                        <button onClick={() => setMobileBaseSize(p => Math.max(16, p - 2))} style={{ padding: '4px 8px', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>A-</button>
                        <span style={{ fontSize: '13px', width: '24px', textAlign: 'center', fontWeight: 'bold' }}>{mobileBaseSize}</span>
                        <button onClick={() => setMobileBaseSize(p => Math.min(48, p + 2))} style={{ padding: '4px 8px', background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>A+</button>
                      </div>
                    </div>

                    {/* Modo Karaoke */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Modo Karaoke</span>
                      <button 
                        onClick={toggleKaraoke} 
                        style={{ 
                          background: isKaraokeMode ? 'var(--accent)' : 'rgba(255,255,255,0.06)', 
                          color: isKaraokeMode ? '#000' : '#fff',
                          borderRadius: '20px', 
                          padding: '6px 14px', 
                          fontSize: '12px', 
                          border: 'none', 
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          transition: 'all 0.2s'
                        }}
                      >
                        {isKaraokeMode ? 'ACTIVADO' : 'DESACTIVADO'}
                      </button>
                    </div>

                    {/* Modo Traducción */}
                    <div>
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'block', marginBottom: '8px' }}>Traducción</span>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                        {(['none', 'both', 'replace'] as const).map(mode => (
                          <button 
                            key={mode} 
                            onClick={() => setTranslationMode(mode)} 
                            style={{
                              padding: '8px', 
                              borderRadius: '8px', 
                              border: 'none', 
                              cursor: 'pointer',
                              background: translationMode === mode ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)',
                              color: '#fff', 
                              fontSize: '12px',
                              fontWeight: translationMode === mode ? 'bold' : 'normal'
                            }}
                          >
                            {mode === 'none' ? 'Apagado' : mode === 'both' ? 'Ambas' : 'Reemplazar'}
                          </button>
                        ))}
                      </div>

                      {translationMode !== 'none' && (
                        <select 
                          value={translationLang} 
                          onChange={e => setTranslationLang(e.target.value)}
                          style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer', fontSize: '13px' }}
                        >
                          <option value="es" style={{ color: '#000' }}>Español</option>
                          <option value="en" style={{ color: '#000' }}>Inglés</option>
                          <option value="fr" style={{ color: '#000' }}>Francés</option>
                          <option value="de" style={{ color: '#000' }}>Alemán</option>
                          <option value="it" style={{ color: '#000' }}>Italiano</option>
                          <option value="pt" style={{ color: '#000' }}>Portugués</option>
                          <option value="ja" style={{ color: '#000' }}>Japonés</option>
                          <option value="ko" style={{ color: '#000' }}>Coreano</option>
                        </select>
                      )}
                    </div>
                  </div>
                )}

                {/* Lyrics Lines scroll container */}
                <div className="sp-lyrics-scroll" ref={lyricsScrollContainerRef}>
                  {parsedLines.length > 0 ? (
                    <div className="sp-lyrics-lines">
                      {parsedLines.map((line, idx) => {
                        const isActive = idx === activeIndex;
                        const isPast = idx < activeIndex;
                        return (
                          <div
                            key={idx}
                            className={`sp-lyric-line ${isActive ? 'active' : ''} ${isPast ? 'past' : ''}`}
                            onClick={() => seekAudio(line.time)}
                            style={{ fontSize: `${mobileBaseSize}px` }}
                          >
                            <span style={{ display: 'block' }}>
                              {isActive && isKaraokeMode
                                ? (() => {
                                    const text = translationMode === 'replace' && translationsRecord?.[idx]
                                      ? translationsRecord[idx]
                                      : line.text;
                                    const words = text.split(' ');
                                    const revealedCount = Math.floor(words.length * karaokeRatio);
                                    return words.map((word, wIdx) => (
                                      <span
                                        key={wIdx}
                                        style={{
                                          display: 'inline',
                                          opacity: wIdx < revealedCount ? 1 : 0.25,
                                          transition: 'opacity 0.15s ease',
                                          marginRight: wIdx < words.length - 1 ? '0.25em' : 0,
                                          color: wIdx < revealedCount ? undefined : 'rgba(255,255,255,0.25)',
                                        }}
                                      >
                                        {word}
                                      </span>
                                    ));
                                  })()
                                : (translationMode === 'replace' && translationsRecord?.[idx]
                                    ? translationsRecord[idx]
                                    : line.text)
                              }
                            </span>
                            {translationMode === 'both' && translationsRecord?.[idx] && (
                              <span style={{ 
                                display: 'block', 
                                fontSize: '0.65em', 
                                opacity: isActive ? 0.8 : 0.5, 
                                marginTop: '4px',
                                fontWeight: 500
                              }}>
                                {translationsRecord[idx]}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="sp-lyrics-plain">{lyrics!.plainLyrics}</div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: ARTISTA (ARTIST) SCREEN */}
            {activeTab === 'artist' && (
              <div className="sp-tab-content sp-tab-artist">
                <div className="sp-artist-header">
                  <div className="sp-artist-bg-blur">
                    <img src={currentTrack.cover} alt="" />
                  </div>
                  <img src={currentTrack.cover} alt="" className="sp-artist-main-img" />
                  <h2 className="sp-artist-title">{currentTrack.artist}</h2>
                  <span className="sp-artist-sub">Artista Oficial de KokoMusic</span>
                </div>
                <div className="sp-artist-details">
                  <div className="sp-artist-card-row">
                    <div className="sp-artist-info-col">
                      <span className="sp-info-num">
                        {((Math.abs(currentTrack.artist.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)) * 12457) % 3500000 + 450000).toLocaleString()}
                      </span>
                      <span className="sp-info-txt">Oyentes mensuales en todo el mundo</span>
                    </div>
                    <button
                      className={`sp-follow-btn-large ${followedArtists.includes(currentTrack.artist) ? 'following' : ''}`}
                      onClick={() => {
                        const isFollowing = followedArtists.includes(currentTrack.artist);
                        setFollowedArtists(prev => {
                          const next = isFollowing
                            ? prev.filter(a => a !== currentTrack.artist)
                            : [...prev, currentTrack.artist];
                          localStorage.setItem('koko_followed_artists', JSON.stringify(next));
                          return next;
                        });
                      }}
                    >
                      {followedArtists.includes(currentTrack.artist) ? 'Siguiendo' : 'Seguir Artista'}
                    </button>
                  </div>
                  <div className="sp-artist-bio-section">
                    <h3>Biografía del Artista</h3>
                    <p>
                      {currentTrack.artist} es uno de los artistas más escuchados en la plataforma, con una presencia icónica en las listas de reproducción de KokoMusic. Sus sonidos únicos definen tendencias globales.
                    </p>
                    <p>
                      Conecta inmersivamente con sus canciones habilitando las notificaciones y guardando sus temas offline directamente desde KokoMusic.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: VIDEO SCREEN */}
            {activeTab === 'video' && activeYoutubeId && (
              <div className="sp-tab-content sp-tab-video">
                <div className="sp-video-player-wrap">
                  <iframe
                    ref={setIframeEl}
                    src={`https://www.youtube.com/embed/${activeYoutubeId}?enablejsapi=1&autoplay=1&mute=0&controls=1&showinfo=0&rel=0&iv_load_policy=3&cc_load_policy=0&origin=${window.location.origin}`}
                    title="YouTube Video Player Tab"
                    frameBorder="0"
                    allow="autoplay; encrypted-media; fullscreen"
                    allowFullScreen
                    className="sp-tab-video-iframe"
                  />
                </div>
                <div className="sp-video-track-info">
                  <h3>{currentTrack.title}</h3>
                  <p>{currentTrack.artist} • Video Musical Oficial</p>
                </div>
                {/* Overlay lines in real-time */}
                {activeIndex >= 0 && parsedLines[activeIndex] && (
                  <div className="sp-video-lyric-card">
                    <span className="sp-video-lyric-text">{parsedLines[activeIndex].text}</span>
                    {translationMode !== 'none' && translationsRecord?.[activeIndex] && (
                      <span className="sp-video-lyric-translation">{translationsRecord[activeIndex]}</span>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>

        <PlaylistModal
          isOpen={showPlaylistModal}
          onClose={() => setShowPlaylistModal(false)}
          trackId={currentTrack.id}
        />
      </div>
    );
  }


  if (!isVideoOpen && !isEmbedMode) return null;

  return (
    <div 
      className="video-panel"
      style={!isVideoOpen ? {
        position: 'fixed',
        top: -9999,
        left: -9999,
        width: '1px',
        height: '1px',
        opacity: 0,
        pointerEvents: 'none',
        zIndex: -1000
      } : {}}
    >
      {isVideoOpen && (
        <div 
          className="resize-handle"
          onMouseDown={startResize}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '4px',
            height: '100%',
            cursor: 'col-resize',
            zIndex: 100,
            backgroundColor: isResizing ? 'var(--accent)' : 'transparent',
            transition: 'background-color 0.2s',
          }}
          onMouseEnter={(e) => {
            if (!isResizing) e.currentTarget.style.backgroundColor = 'var(--accent)';
          }}
          onMouseLeave={(e) => {
            if (!isResizing) e.currentTarget.style.backgroundColor = 'transparent';
          }}
        />
      )}
      {/* Cabecera */}
      <div className="video-header">
        <span className="video-header-title">
          En reproducción
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Botón de alternar formato */}
          <button 
            className="video-format-btn" 
            onClick={() => setVideoFormat(videoFormat === 'vertical' ? 'rectangular' : 'vertical')}
            title={videoFormat === 'vertical' ? "Cambiar a formato rectangular (16:9)" : "Cambiar a formato vertical (9:16)"}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px',
              borderRadius: '50%',
              transition: 'color var(--duration-fast), background var(--duration-fast)',
            }}
          >
            {videoFormat === 'vertical' ? (
              // Icono de Rectángulo / Horizontal
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2" ry="2" />
              </svg>
            ) : (
              // Icono de Teléfono / Vertical
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
            )}
          </button>
          <button className="video-close-btn" onClick={toggleVideo} title="Cerrar panel de vídeo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="video-panel-content">
        {/* Contenedor de Video / Portada */}
        <div className={`video-player-container ${videoFormat}`}>
          {isEmbedMode && embedYoutubeId ? (
            // ── EMBED MODE: Video largo de YouTube — audio directo de YT, controles visibles ──
            <div className="video-iframe-wrapper" style={{ position: 'relative', width: '100%', height: '100%' }}>
              <iframe
                ref={setIframeEl}
                src={`https://www.youtube.com/embed/${embedYoutubeId}?enablejsapi=1&autoplay=1&mute=0&controls=1&showinfo=0&rel=0&iv_load_policy=3&cc_load_policy=0&origin=${window.location.origin}`}
                title="Reproductor YouTube Embed"
                frameBorder="0"
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
                className="video-iframe"
                style={{ pointerEvents: 'auto' }}
              />
            </div>
          ) : showVideo && activeYoutubeId ? (
            <div 
              className="video-iframe-wrapper"
              onClick={() => setShowVideo(false)}
              style={{ cursor: 'pointer' }}
            >
              <iframe
                ref={setIframeEl}
                src={`https://www.youtube.com/embed/${activeYoutubeId}?enablejsapi=1&autoplay=1&mute=1&controls=0&showinfo=0&rel=0&iv_load_policy=3&cc_load_policy=0&origin=${window.location.origin}`}
                title="Reproductor de vídeo sincronizado"
                frameBorder="0"
                allow="autoplay; encrypted-media"
                className="video-iframe"
              />
            </div>
          ) : (
            <div 
              className="video-cover-wrapper"
              onClick={() => activeYoutubeId && setShowVideo(true)}
              style={{ cursor: activeYoutubeId ? 'pointer' : 'default' }}
            >
              <img src={currentTrack.cover} alt={currentTrack.title} className="video-cover-img" />
            </div>
          )}
        </div>

        {/* Detalles de la canciÃ³n actual */}
        <div className="video-track-details">
          <div className="video-track-info">
            <h4 className="video-track-title" title={currentTrack.title}>{currentTrack.title}</h4>
            <p className="video-track-artist" title={currentTrack.artist}>{currentTrack.artist}</p>
          </div>
          <div className="video-track-actions">
            <button 
              className={`video-action-btn ${isLiked(currentTrack.id) ? 'liked' : ''}`}
              onClick={() => toggleLike(currentTrack.id)}
              title="Me gusta"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill={isLiked(currentTrack.id) ? "var(--accent)" : "none"} stroke={isLiked(currentTrack.id) ? "var(--accent)" : "currentColor"} strokeWidth="2">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </button>
            <button 
              className="video-action-btn"
              onClick={() => setShowPlaylistModal(true)}
              title="AÃ±adir a playlist"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="16" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tarjeta de Letras */}
        {lyrics && !lyrics.instrumental && (parsedLines.length > 0 || lyrics.plainLyrics) && (
          <div 
            className="video-lyrics-card" 
            onClick={() => toggleLyrics()}
            style={{
              background: `linear-gradient(135deg, ${dominantColor ? `${dominantColor}aa` : 'rgba(255, 255, 255, 0.08)'} 0%, rgba(15, 15, 15, 0.9) 100%)`,
            }}
          >
            <div className="video-lyrics-card-header">
              <span className="video-lyrics-card-title">Letras</span>
              <button 
                className="video-lyrics-expand-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLyrics();
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 4 }}>
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                </svg>
                <span>Ampliar</span>
              </button>
            </div>
            
            <div className="video-lyrics-card-body">
              {parsedLines.length > 0 ? (
                <div className="video-lyrics-preview-container">
                  {parsedLines.slice(Math.max(0, activeIndex - 1), Math.max(0, activeIndex - 1) + 4).map((line, idx) => {
                    const lineRealIdx = Math.max(0, activeIndex - 1) + idx;
                    const isActive = lineRealIdx === activeIndex;
                    return (
                      <div 
                        key={lineRealIdx} 
                        className={`video-lyric-preview-line ${isActive ? 'active' : ''}`}
                      >
                        {line.text}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="video-lyrics-plain-preview">
                  {lyrics.plainLyrics}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Vídeos relacionados */}
        <div className="related-videos-section">
          <h5 className="related-videos-title">Vídeos musicales relacionados</h5>
          
          {isLoading ? (
            <div className="related-loading">
              <div className="spinner" />
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Cargando vídeos recomendados...</span>
            </div>
          ) : error || !videoData || videoData.relatedVideos.length === 0 ? (
            <div className="related-empty">No se encontraron vídeos relacionados</div>
          ) : (
            <div className="related-videos-carousel">
              {videoData.relatedVideos.map((video) => (
                <div 
                  key={video.id} 
                  className={`related-video-card ${activeYoutubeId === video.id ? 'active' : ''}`}
                  onClick={() => {
                    setEmbedMode(true, video.id);
                    setShowVideo(true);
                  }}
                  title={`Reproducir: ${video.title}`}
                >
                  <div className="related-video-thumbnail-wrapper">
                    <img src={video.thumbnail} alt={video.title} className="related-video-thumbnail" />
                    <span className="related-video-duration">{video.duration}</span>
                    {activeYoutubeId === video.id && (
                      <div className="related-playing-overlay">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--accent)">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="related-video-info">
                    <div className="related-video-card-title">{video.title}</div>
                    <div className="related-video-card-channel">{video.artist}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal para aÃ±adir a playlist */}
      <PlaylistModal 
        isOpen={showPlaylistModal} 
        onClose={() => setShowPlaylistModal(false)} 
        trackId={currentTrack.id} 
      />
    </div>
  );
}
