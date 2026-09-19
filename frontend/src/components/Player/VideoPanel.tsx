import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '../../store/playerStore';
import { getTrackVideo, getLyrics, type VideoData, type Lyrics, formatYoutubeEmbedUrl } from '../../lib/api';
import { useVideoSync } from '../../hooks/useVideoSync';
import { useLikedSongs } from '../../hooks/useLikedSongs';
import PlaylistModal from './PlaylistModal';
import { isTrackOffline, saveTrackOffline } from '../../lib/offlineAudio';
import { getApiUrl } from '../../lib/backendResolver';
import { parseSyncedLyrics } from '../../lib/lyricsParser';
import { useResizableRightPanel } from '../../hooks/useResizable';
import ArtistLinks from '../Common/ArtistLinks';

export default function VideoPanel() {
  const {
    currentTrack, isVideoOpen, toggleVideo, dominantColor, progress,
    toggleLyrics, isEmbedMode, embedYoutubeId, setEmbedMode
  } = usePlayerStore();
  const { isLiked, toggleLike } = useLikedSongs();
  const { startResize, isResizing } = useResizableRightPanel();

  const [showVideo, setShowVideo] = useState(true);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  // MobileFullPlayer.tsx cubre el móvil por completo (portada, vídeo de fondo,
  // letras, artista, embed) — este panel solo se renderiza en escritorio.
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const [downloadStatus, setDownloadStatus] = useState<'none' | 'downloading' | 'downloaded'>('none');

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

  const [videoFormat, setVideoFormat] = useState<'vertical' | 'rectangular'>(() => {
    return (localStorage.getItem('koko_video_format') as 'vertical' | 'rectangular') || 'vertical';
  });

  const [iframeEl, setIframeEl] = useState<HTMLIFrameElement | null>(null);

  useEffect(() => {
    localStorage.setItem('koko_video_format', videoFormat);
  }, [videoFormat]);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  // Cargar letras de la canción actual
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

  if (isMobile) return null;

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
                src={formatYoutubeEmbedUrl(embedYoutubeId, { autoplay: true, mute: false, controls: true, enableApi: true })}
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
                src={formatYoutubeEmbedUrl(activeYoutubeId, { autoplay: true, mute: true, controls: false })}
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

        {/* Detalles de la canción actual */}
        <div className="video-track-details">
          <div className="video-track-info">
            <h4 className="video-track-title" title={currentTrack.title}>{currentTrack.title}</h4>
            <ArtistLinks
              artist={currentTrack.artist}
              artistId={currentTrack.artistId}
              title={currentTrack.artist}
              style={{ display: 'block' }}
              className="video-track-artist"
            />
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
              title="Añadir a playlist"
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

      {/* Modal para añadir a playlist */}
      <PlaylistModal
        isOpen={showPlaylistModal}
        onClose={() => setShowPlaylistModal(false)}
        trackId={currentTrack.id}
      />
    </div>
  );
}
