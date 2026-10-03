import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePlayerStore } from '../../store/playerStore';
import { useLikedSongs } from '../../hooks/useLikedSongs';
import HeartButton from '../Common/HeartButton';
import ParticleBurst from '../Common/ParticleBurst';
import ArtistLinks from '../Common/ArtistLinks';
import { seekAudio } from '../../hooks/useAudioPlayer';
import { useQuery } from '@tanstack/react-query';
import { getLyrics, resolveImageUrl, getTrackVideo, searchTracks, type Lyrics, type VideoData, formatYoutubeEmbedUrl, BASE } from '../../lib/api';
import { parseSyncedLyrics } from '../../lib/lyricsParser';
import { isTrackOffline, saveTrackOffline, deleteOfflineTrack } from '../../lib/offlineAudio';
import { saveTrackToDevice } from '../../lib/deviceDownload';
import DownloadChoiceSheet from '../Common/DownloadChoiceSheet';
import { getApiUrl } from '../../lib/backendResolver';
import { useVideoSync } from '../../hooks/useVideoSync';
import { useDeviceSyncStore } from '../../store/deviceSyncStore';
import SongCreditsModal from './SongCreditsModal';
import JamModal from './JamModal';
import DeviceList from './DeviceList';
import { useScreenTour } from '../GuidedTour';
import {
  IconPlay, IconPause, IconPrev, IconNext, IconShuffle, IconRepeat, IconRepeatOne,
  IconLyrics, IconRadio, IconVideo, IconChevronDown,
  IconCheck, IconLoadingSpinner, IconCloudDownload, IconUser, IconQueue, IconGroupListen, IconDevices,
} from './PlayerIcons';

function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface MobileFullPlayerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MobileFullPlayer({ isOpen, onClose }: MobileFullPlayerProps) {
  const {
    currentTrack, isPlaying, progress, duration,
    togglePlay, nextTrack, prevTrack,
    isShuffle, toggleShuffle,
    repeatMode, cycleRepeat,
    isLyricsOpen, toggleLyrics,
    isEmbedMode, embedYoutubeId,
    manualVideoId, setManualVideo,
    queue, queueIndex, removeFromQueue, jumpToQueueIndex,
    activeJamCode,
  } = usePlayerStore();

  const { isLiked, toggleLike } = useLikedSongs();
  const [showJamModal, setShowJamModal] = useState(false);
  useScreenTour('mobile-player', isOpen);
  const otherDevices = useDeviceSyncStore((s) => s.otherDevices);
  const banner = useDeviceSyncStore((s) => s.banner);
  const remoteDeviceId = usePlayerStore((s) => s.remoteDeviceId);
  const remoteDeviceName = usePlayerStore((s) => s.remoteDeviceName);
  const hasConnectableDevices = otherDevices.some((d) => d.track_id);

  // Navigation layout state — en móvil no hay otra forma de ver la cola (el
  // botón de cola de escritorio vive en .player-right, oculto en pantallas
  // pequeñas), así que aquí también hace de sustituto de QueuePanel.
  const [playerView, setPlayerView] = useState<'cover' | 'video' | 'artist' | 'queue' | 'devices'>('cover');

  // Buscador de vídeo de YouTube para la canción (pestaña "Vídeo"): el usuario
  // elige manualmente qué vídeo de YouTube asociar, no subimos nada a un CDN.
  const [videoSearchQuery, setVideoSearchQuery] = useState('');
  const [videoSearchResults, setVideoSearchResults] = useState<Array<{ id: string; title: string; artist: string; cover: string }>>([]);
  const [isSearchingVideo, setIsSearchingVideo] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const progressRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Vídeo de fondo: al tocar la portada, se sustituye por el vídeo musical de
  // YouTube (silenciado, el audio sigue viniendo del stream normal) — igual
  // que el antiguo panel de escritorio, pero integrado en este player único.
  // Si el usuario eligió un vídeo a mano (pestaña "Vídeo"), ese manda siempre
  // y se muestra de fondo sin necesidad de tocar la portada.
  // Preferencia de Perfil ("Vídeo de fondo por defecto"): se lee en cada uso
  // para que cambiarla surta efecto sin recargar la app.
  const prefersBgVideo = () => localStorage.getItem('koko_default_bg_video') === 'true';
  const [showBackgroundVideo, setShowBackgroundVideo] = useState(prefersBgVideo);
  useEffect(() => {
    if (isOpen && prefersBgVideo()) setShowBackgroundVideo(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  const { data: videoData } = useQuery<VideoData>({
    queryKey: ['video', currentTrack?.id],
    queryFn: () => getTrackVideo(currentTrack!.id),
    enabled: !!currentTrack && isOpen,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
  const autoYoutubeId = videoData?.youtubeId || null;
  const backgroundYoutubeId = manualVideoId || autoYoutubeId;
  const isBgVideoActive = !!manualVideoId || showBackgroundVideo;

  // Video sync for embed mode
  const [iframeEl, setIframeEl] = useState<HTMLIFrameElement | null>(null);
  useVideoSync(iframeEl, isEmbedMode ? embedYoutubeId : (isBgVideoActive ? backgroundYoutubeId : null));

  // Offline track download status
  const [downloadStatus, setDownloadStatus] = useState<'none' | 'downloading' | 'downloaded'>('none');
  const [showCreditsModal, setShowCreditsModal] = useState(false);

  // Touch-to-dismiss gesture state
  const touchStartY = useRef(0);
  const touchDeltaY = useRef(0);
  const [translateY, setTranslateY] = useState(0);

  const progressPct = isDragging ? dragProgress : (duration > 0 ? (progress / duration) * 100 : 0);

  // Al cambiar de canción: volver a la portada (para no arrastrar el vídeo de
  // la anterior), salvo que el usuario prefiera vídeo de fondo por defecto —
  // entonces se queda activado y aparece en cuanto se resuelva el de la nueva
  // (backgroundYoutubeId pasa a ser el de la canción nueva).
  useEffect(() => {
    setShowBackgroundVideo(prefersBgVideo());
    setManualVideo(null);
    setVideoSearchQuery('');
    setVideoSearchResults([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrack?.id]);

  const runVideoSearch = async (query: string) => {
    if (!query.trim()) { setVideoSearchResults([]); return; }
    setIsSearchingVideo(true);
    try {
      const res = await searchTracks(query, 10, 'youtube');
      setVideoSearchResults(res.tracks.map(t => ({ id: t.id, title: t.title, artist: t.artist, cover: t.cover })));
    } catch {
      setVideoSearchResults([]);
    } finally {
      setIsSearchingVideo(false);
    }
  };

  // Datos reales del artista (oyentes mensuales + biografía), misma API que la
  // página de Artista — sin esto la pestaña mostraría datos inventados.
  //
  // Siempre buscamos por NOMBRE (nunca por currentTrack.artistId): ese id solo
  // es un iTunes artistId real cuando el track vino de iTunes. Para tracks de
  // Deezer trae el id de Deezer, y para YouTube un hash — números que no
  // significan nada para el lookup de iTunes del backend, así que la búsqueda
  // fallaba en silencio (404) aunque sí existiera biografía/oyentes reales.
  const artistLookupName = currentTrack?.artist;
  const { data: artistInfo, isLoading: isArtistInfoLoading } = useQuery({
    queryKey: ['artist-summary', artistLookupName],
    queryFn: async () => {
      const url = `${BASE}/artist/0?name=${encodeURIComponent(artistLookupName || '')}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('No se pudo cargar el artista');
      const json = await res.json();
      return json.artist as { monthlyListeners?: number; bio?: string; image?: string } | null;
    },
    enabled: !!artistLookupName && isOpen && playerView === 'artist',
    retry: 1,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      setPlayerView('cover');
      setTranslateY(0);
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Check and poll offline status
  useEffect(() => {
    if (!currentTrack) return;
    
    let isMounted = true;
    let pollInterval: any = null;

    const checkStatus = async () => {
      try {
        const API_BASE = await getApiUrl();
        // First check IndexedDB local
        const isOffline = await isTrackOffline(currentTrack.id);
        if (isOffline) {
          if (isMounted) setDownloadStatus('downloaded');
          if (pollInterval) clearInterval(pollInterval);
          return;
        }

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

  const [showDownloadChoice, setShowDownloadChoice] = useState(false);
  const [savingToDevice, setSavingToDevice] = useState(false);

  const openDownloadChoice = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentTrack || downloadStatus === 'downloading' || savingToDevice) return;
    setShowDownloadChoice(true);
  };

  const handleDeviceDownload = async () => {
    if (!currentTrack) return;
    const { setError } = usePlayerStore.getState();
    setSavingToDevice(true);
    try {
      setError(await saveTrackToDevice(currentTrack.id, { title: currentTrack.title, artist: currentTrack.artist }));
    } catch (err: any) {
      console.error('[MobilePlayer] Error al descargar al dispositivo:', err);
      setError(err?.message || 'Error al descargar');
    } finally {
      setSavingToDevice(false);
    }
  };

  const handleRemoveOffline = async () => {
    if (!currentTrack) return;
    await deleteOfflineTrack(currentTrack.id);
    setDownloadStatus('none');
    usePlayerStore.getState().setError('Quitada de la app');
  };

  const handleDownload = async () => {
    if (!currentTrack || downloadStatus !== 'none') return;

    setDownloadStatus('downloading');

    try {
      await saveTrackOffline(currentTrack.id, {
        title: currentTrack.title,
        artist: currentTrack.artist,
        cover: currentTrack.cover || '',
        duration: currentTrack.duration
      });
      setDownloadStatus('downloaded');
    } catch (offlineErr: any) {
      console.error('[MobilePlayer] Error al descargar y guardar offline localmente:', offlineErr);
      setDownloadStatus('none');
    }
  };

  // Lyrics query
  const { data: lyrics } = useQuery<Lyrics>({
    queryKey: ['lyrics', currentTrack?.id],
    queryFn: () => getLyrics(currentTrack!.id),
    enabled: !!currentTrack && (isOpen || isLyricsOpen),
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
      if (progress >= parsedLines[i].time) idx = i;
      else break;
    }
    return idx;
  }, [parsedLines, progress]);

  // Progress bar drag handlers
  const handleProgressMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    updateProgress(e.clientX);
  };

  const updateProgress = (clientX: number) => {
    if (!progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setDragProgress(pct * 100);
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => updateProgress(e.clientX);
    const onUp = (e: MouseEvent) => {
      if (!progressRef.current) return;
      const rect = progressRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seekAudio(pct * duration);
      setIsDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, duration]);

  // Touch progress
  const handleProgressTouch = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (!progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    setIsDragging(true);
    setDragProgress(pct * 100);
  };
  const handleProgressTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (!progressRef.current || !isDragging) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    setDragProgress(pct * 100);
  };
  const handleProgressTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (!progressRef.current) return;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.changedTouches[0].clientX - rect.left) / rect.width));
    seekAudio(pct * duration);
    setIsDragging(false);
  };

  // Swipe-down to dismiss gesture
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchDeltaY.current = 0;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) {
      touchDeltaY.current = delta;
      setTranslateY(delta);
    }
  };
  const handleTouchEnd = () => {
    if (touchDeltaY.current > 120) {
      onClose();
    } else {
      setTranslateY(0);
    }
    touchDeltaY.current = 0;
  };

  // Fondo teñido con el acento elegido por el usuario (antes usaba
  // dominantColor, que nadie calculaba nunca y se quedaba en el verde por defecto).
  const accentBg = 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 80%, transparent) 0%, #0d0d0d 60%)';

  // ImmersiveLyrics vive en el layout principal (App.tsx), por debajo de este
  // overlay fijo — si solo lo activáramos, quedaría oculto detrás hasta cerrar
  // el reproductor. Abrimos las letras y cerramos el overlay para mostrarlas.
  const openLyrics = () => {
    if (!isLyricsOpen) toggleLyrics();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="mfp-overlay"
      style={{ transform: `translateY(${translateY}px)`, transition: isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.16,1,0.3,1)' }}
    >
      {/* Dynamic gradient background */}
      <div className="mfp-bg" style={{ background: accentBg, opacity: isBgVideoActive && backgroundYoutubeId ? 0 : 1 }} />

      {/* Vídeo musical de fondo a pantalla completa (no dentro de la portada).
          Se activa igual tanto si vino del auto-detectado (tocando la portada)
          como si el usuario lo eligió a mano en la pestaña "Vídeo". */}
      {isBgVideoActive && backgroundYoutubeId && !isEmbedMode && (
        <div
          className="mfp-bg-video"
          onClick={() => { setShowBackgroundVideo(false); setManualVideo(null); }}
        >
          <iframe
            ref={setIframeEl}
            src={formatYoutubeEmbedUrl(backgroundYoutubeId, { autoplay: true, mute: true, controls: false })}
            title="Vídeo musical de fondo"
            frameBorder="0"
            allow="autoplay; encrypted-media"
          />
          <div className="mfp-bg-video-overlay" />
        </div>
      )}

      {/* Header */}
      <div
        className="mfp-header"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="mfp-drag-pill" />
        <button className="mfp-close-btn" onClick={onClose}>
          <IconChevronDown />
        </button>
        <div className="mfp-header-context">
          {currentTrack?.album && (
            <span className="mfp-header-label">{currentTrack.album}</span>
          )}
        </div>
        <button
          className="mfp-header-btn"
          onClick={openLyrics}
          style={{ color: isLyricsOpen ? 'var(--accent)' : 'rgba(255,255,255,0.6)' }}
          title="Letras"
        >
          <IconLyrics />
        </button>
      </div>

      {/* Main content — flips between cover, video picker, artist and queue.
          Letras usa el mismo overlay inmersivo que escritorio (ImmersiveLyrics,
          montado globalmente en App.tsx) en vez de una vista propia — así el
          control de color/efectos, antes solo accesible en escritorio porque
          vivía en .player-right (oculto en móvil), funciona igual en ambos. */}
      <div className="mfp-body" ref={containerRef}>
        {playerView === 'video' ? (
          /* ── Vídeo view: elegir manualmente un vídeo de YouTube para la canción ── */
          <div className="mfp-video-picker">
            {manualVideoId && (
              <div className="mfp-video-picker-current">
                <div className="mfp-video-picker-preview">
                  <iframe
                    src={formatYoutubeEmbedUrl(manualVideoId, { autoplay: false, mute: true, controls: false })}
                    title="Vídeo actual"
                    frameBorder="0"
                    style={{ pointerEvents: 'none' }}
                  />
                </div>
                <button className="mfp-video-picker-clear" onClick={() => setManualVideo(null)}>
                  Quitar vídeo
                </button>
              </div>
            )}

            <form
              className="mfp-video-search-row"
              onSubmit={(e) => { e.preventDefault(); runVideoSearch(videoSearchQuery); }}
            >
              <input
                type="text"
                value={videoSearchQuery}
                onChange={(e) => setVideoSearchQuery(e.target.value)}
                placeholder={`Buscar vídeo en YouTube (ej. "${currentTrack?.artist} ${currentTrack?.title}")`}
                className="mfp-video-search-input"
              />
              <button type="submit" className="mfp-video-search-btn">Buscar</button>
            </form>

            <div className="mfp-video-results">
              {isSearchingVideo ? (
                <div className="mfp-lyrics-empty"><div className="spinner" style={{ width: 28, height: 28 }} /></div>
              ) : videoSearchResults.length > 0 ? (
                videoSearchResults.map((v) => (
                  <button
                    key={v.id}
                    className={`mfp-video-result ${manualVideoId === v.id ? 'active' : ''}`}
                    onClick={() => setManualVideo(v.id)}
                  >
                    <img src={resolveImageUrl(v.cover) || ''} alt="" />
                    <div className="mfp-video-result-info">
                      <span className="mfp-video-result-title">{v.title}</span>
                      <span className="mfp-video-result-artist">{v.artist}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="mfp-lyrics-empty">
                  <span>Busca un vídeo de YouTube para asociarlo a esta canción</span>
                </div>
              )}
            </div>
          </div>
        ) : playerView === 'artist' ? (
          /* ── Artist view ── */
          <div className="mfp-artist-wrap">
            <img
              className="mfp-artist-avatar"
              src={resolveImageUrl(artistInfo?.image || currentTrack?.cover || '') || ''}
              alt={currentTrack?.artist}
            />
            <h2 className="mfp-artist-name">{currentTrack?.artist}</h2>
            <span className="mfp-artist-tag">Artista</span>

            <div className="mfp-artist-stat">
              {isArtistInfoLoading ? (
                <span className="skeleton" style={{ display: 'inline-block', width: 90, height: 22 }} />
              ) : artistInfo?.monthlyListeners ? (
                <span className="mfp-artist-stat-num">{Intl.NumberFormat('es-ES').format(artistInfo.monthlyListeners)}</span>
              ) : (
                <span className="mfp-artist-stat-num">—</span>
              )}
              <span className="mfp-artist-stat-lbl">Oyentes mensuales</span>
            </div>

            <div className="mfp-artist-bio">
              {isArtistInfoLoading ? (
                <p>Cargando biografía…</p>
              ) : artistInfo?.bio && artistInfo.bio !== 'Biografía no disponible.' ? (
                <p>{artistInfo.bio}</p>
              ) : (
                <p>Todavía no tenemos una biografía para {currentTrack?.artist}.</p>
              )}
            </div>

            <Link
              to={
                currentTrack?.artistId && currentTrack.artistId !== 0
                  ? `/artist/${currentTrack.artistId}`
                  : `/artist/${encodeURIComponent(currentTrack?.artist || '')}`
              }
              className="mfp-artist-full-link"
              onClick={onClose}
            >
              Ver perfil completo
            </Link>
          </div>
        ) : playerView === 'devices' ? (
          /* ── Devices view — único acceso a la sincronización entre dispositivos en móvil ── */
          <div className="mfp-queue-wrap" data-tour="devices-list">
            <span className="mfp-queue-section-label">Dispositivos</span>
            <DeviceList />
          </div>
        ) : playerView === 'queue' ? (
          /* ── Queue view — único acceso a la cola en móvil ── */
          <div className="mfp-queue-wrap">
            {currentTrack && (
              <div className="mfp-queue-now-playing">
                <span className="mfp-queue-section-label">Sonando ahora</span>
                <div className="mfp-queue-item current">
                  <img src={resolveImageUrl(currentTrack.cover) || ''} alt="" />
                  <div className="mfp-queue-item-info">
                    <span className="mfp-queue-item-title">{currentTrack.title}</span>
                    <ArtistLinks artist={currentTrack.artist} artistId={currentTrack.artistId} className="mfp-queue-item-artist" />
                  </div>
                </div>
              </div>
            )}

            <span className="mfp-queue-section-label">A continuación</span>
            {queue.length - queueIndex - 1 <= 0 ? (
              <div className="mfp-lyrics-empty"><span>No hay más canciones en la cola</span></div>
            ) : (
              <div className="mfp-queue-list">
                {queue.slice(queueIndex + 1).map((track, i) => {
                  const realIndex = queueIndex + 1 + i;
                  return (
                    <div key={`${track.id}-${realIndex}`} className="mfp-queue-item">
                      <button className="mfp-queue-item-main" onClick={() => jumpToQueueIndex(realIndex)}>
                        <img src={resolveImageUrl(track.cover) || ''} alt="" />
                        <div className="mfp-queue-item-info">
                          <span className="mfp-queue-item-title">{track.title}</span>
                          <span className="mfp-queue-item-artist">{track.artist}</span>
                        </div>
                      </button>
                      <button
                        className="mfp-queue-item-remove"
                        onClick={() => removeFromQueue(realIndex)}
                        title="Quitar de la cola"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* ── Cover art / Embed / Background video view ── */
          <div className="mfp-cover-wrap">
            {isEmbedMode && embedYoutubeId ? (
              <div className="mfp-cover-container embed-active" style={{ width: '100%', aspectRatio: '16/9', overflow: 'hidden', borderRadius: 'var(--radius-lg)' }}>
                <iframe
                  ref={setIframeEl}
                  src={formatYoutubeEmbedUrl(embedYoutubeId, { autoplay: true, mute: false, controls: true, enableApi: true })}
                  title="Reproductor YouTube Embed Mobile"
                  frameBorder="0"
                  allow="autoplay; encrypted-media; fullscreen"
                  allowFullScreen
                  style={{ width: '100%', height: '100%', borderRadius: 'var(--radius-lg)' }}
                />
              </div>
            ) : isBgVideoActive && backgroundYoutubeId ? (
              /* El vídeo real se pinta a pantalla completa en .mfp-bg-video (fuera de
                 este contenedor pequeño) — aquí solo dejamos ver la letra activa y
                 un aviso para volver a la portada, todo tappable y transparente.
                 Si el vídeo fue elegido a mano (pestaña "Vídeo"), no se puede volver
                 a la portada tocando aquí — para eso está "Quitar vídeo" en esa
                 pestaña — solo el auto-detectado se puede cerrar con un toque. */
              <div
                className="mfp-cover-video-active"
                onClick={() => !manualVideoId && setShowBackgroundVideo(false)}
                title={manualVideoId ? undefined : 'Toca para volver a la portada'}
              >
                {activeIndex >= 0 && parsedLines[activeIndex] ? (
                  <div className="mfp-bg-video-lyric-centered">{parsedLines[activeIndex].text}</div>
                ) : !manualVideoId ? (
                  <div className="mfp-video-hint">
                    <span>Toca para volver a la portada</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div
                className="mfp-cover-container"
                onClick={() => backgroundYoutubeId && setShowBackgroundVideo(true)}
                title={backgroundYoutubeId ? 'Toca para ver el vídeo musical' : undefined}
              >
                <img
                  className="mfp-cover"
                  src={resolveImageUrl(currentTrack?.cover || '') || ''}
                  alt={currentTrack?.title}
                />
                {backgroundYoutubeId && (
                  <div className="mfp-video-hint">
                    <IconPlay size={12} />
                    <span>Toca para ver el vídeo</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Track info + actions */}
      <div className="mfp-info-row">
        <div className="mfp-track-text">
          <div className="mfp-track-title">{currentTrack?.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            {currentTrack && (
              <ArtistLinks
                artist={currentTrack.artist}
                artistId={currentTrack.artistId}
                className="mfp-track-artist"
                onLinkClick={onClose}
              />
            )}
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Song Radio & Credits Button */}
          <button
            onClick={() => setShowCreditsModal(true)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.7)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 8,
              cursor: 'pointer',
            }}
            title="Radio de la Canción & Créditos"
          >
            <IconRadio size={22} />
          </button>

          {/* Caching/Offline Button */}
          <button
            className={`mfp-download-btn ${downloadStatus === 'downloaded' ? 'active' : ''}`}
            onClick={openDownloadChoice}
            disabled={downloadStatus === 'downloading' || savingToDevice}
            style={{
              background: 'transparent',
              border: 'none',
              color: downloadStatus === 'downloaded' ? 'var(--accent)' : 'rgba(255,255,255,0.6)',
              opacity: downloadStatus === 'downloading' || savingToDevice ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 8,
              cursor: downloadStatus === 'downloading' || savingToDevice ? 'default' : 'pointer',
            }}
            title={downloadStatus === 'downloaded' ? "Audio guardado sin conexión — descargar o quitar" : downloadStatus === 'downloading' || savingToDevice ? "Guardando..." : "Guardar sin conexión"}
          >
            {downloadStatus === 'downloading' || savingToDevice ? (
              <IconLoadingSpinner size={24} />
            ) : downloadStatus === 'downloaded' ? (
              <IconCheck size={24} />
            ) : (
              <IconCloudDownload size={24} />
            )}
          </button>
          {currentTrack && (
            <DownloadChoiceSheet
              open={showDownloadChoice}
              onClose={() => setShowDownloadChoice(false)}
              track={{ title: currentTrack.title, artist: currentTrack.artist, cover: currentTrack.cover }}
              internalSaved={downloadStatus === 'downloaded'}
              onInternal={() => (downloadStatus === 'downloaded' ? handleRemoveOffline() : handleDownload())}
              onExternal={handleDeviceDownload}
            />
          )}



          {/* Like Button */}
          <HeartButton
            isLiked={isLiked(currentTrack?.id || '')}
            onClick={() => currentTrack && toggleLike(currentTrack.id)}
            size={26}
          />
        </div>
      </div>

      {/* Progress bar */}
      <div className="mfp-progress-wrap">
        <div
          className="mfp-progress-track"
          ref={progressRef}
          onMouseDown={handleProgressMouseDown}
          onTouchStart={handleProgressTouch}
          onTouchMove={handleProgressTouchMove}
          onTouchEnd={handleProgressTouchEnd}
        >
          <div className="mfp-progress-fill" style={{ width: `${progressPct}%` }}>
            <div className="mfp-progress-thumb" />
          </div>
        </div>
        <div className="mfp-progress-times">
          <span>{formatTime(progress)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Playback controls */}
      <div className="mfp-controls">
        <button
          className="mfp-ctrl-btn"
          onClick={toggleShuffle}
          style={{ color: isShuffle ? 'var(--accent)' : 'rgba(255,255,255,0.6)' }}
        >
          <IconShuffle size={22} />
        </button>

        <button className="mfp-ctrl-btn mfp-ctrl-prev" onClick={prevTrack}>
          <IconPrev size={32} />
        </button>

        <ParticleBurst type="note" count={10}>
          <button className="mfp-play-btn" onClick={togglePlay}>
            {isPlaying ? <IconPause size={32} /> : <IconPlay size={32} />}
          </button>
        </ParticleBurst>

        <button className="mfp-ctrl-btn mfp-ctrl-next" onClick={nextTrack}>
          <IconNext size={32} />
        </button>

        <button
          className="mfp-ctrl-btn"
          onClick={cycleRepeat}
          style={{ color: repeatMode !== 'off' ? 'var(--accent)' : 'rgba(255,255,255,0.6)', position: 'relative' }}
        >
          {repeatMode === 'one' ? <IconRepeatOne size={22} /> : <IconRepeat size={22} />}
          {repeatMode !== 'off' && <span className="mfp-repeat-dot" />}
        </button>
      </div>

      {remoteDeviceId && (
        <button className="remote-output-strip mfp-remote-strip" onClick={() => setPlayerView('devices')}>
          <IconDevices size={14} /> Sonando en {remoteDeviceName || 'otro dispositivo'}
        </button>
      )}

      {/* Extra actions row */}
      <div className="mfp-extras">
        <button
          className="mfp-extra-btn"
          onClick={openLyrics}
          data-tour="mfp-lyrics"
          style={{ color: isLyricsOpen ? 'var(--accent)' : 'rgba(255,255,255,0.5)' }}
        >
          <IconLyrics />
          <span>Letras</span>
        </button>

        <button
          className="mfp-extra-btn"
          onClick={() => setPlayerView(prev => prev === 'artist' ? 'cover' : 'artist')}
          style={{ color: playerView === 'artist' ? 'var(--accent)' : 'rgba(255,255,255,0.5)' }}
        >
          <IconUser />
          <span>Artista</span>
        </button>

        <button
          className="mfp-extra-btn"
          onClick={() => setPlayerView(prev => prev === 'video' ? 'cover' : 'video')}
          data-tour="mfp-video"
          style={{ color: playerView === 'video' ? 'var(--accent)' : 'rgba(255,255,255,0.5)' }}
        >
          <IconVideo />
          <span>Vídeo</span>
        </button>

        <button
          className="mfp-extra-btn"
          onClick={() => setPlayerView(prev => prev === 'queue' ? 'cover' : 'queue')}
          style={{ color: playerView === 'queue' ? 'var(--accent)' : 'rgba(255,255,255,0.5)' }}
        >
          <IconQueue />
          <span>Cola</span>
        </button>

        <button
          className="mfp-extra-btn"
          onClick={() => setShowJamModal(true)}
          data-tour="mfp-sinfonia"
          style={{ color: activeJamCode ? 'var(--accent)' : 'rgba(255,255,255,0.5)' }}
        >
          <IconGroupListen />
          <span>Sinfonía</span>
        </button>

        <button
          className="mfp-extra-btn"
          onClick={() => setPlayerView(prev => prev === 'devices' ? 'cover' : 'devices')}
          data-tour="mfp-devices"
          style={{ color: playerView === 'devices' || remoteDeviceId || hasConnectableDevices ? 'var(--accent)' : 'rgba(255,255,255,0.5)' }}
        >
          <IconDevices />
          <span>Dispositivos</span>
        </button>
      </div>

      {banner && <div className="mfp-device-toast">{banner}</div>}

      {showCreditsModal && currentTrack && (
        <SongCreditsModal track={currentTrack} onClose={() => setShowCreditsModal(false)} />
      )}

      <JamModal isOpen={showJamModal} onClose={() => setShowJamModal(false)} />
    </div>
  );
}
