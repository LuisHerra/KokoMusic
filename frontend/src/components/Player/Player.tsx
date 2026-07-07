import { useCallback, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { usePlayerStore } from '../../store/playerStore';

function IconCloudDownload() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
      <polyline points="8 16 12 20 16 16" />
      <line x1="12" y1="20" x2="12" y2="10" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', color: 'var(--accent)' }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconLoadingSpinner() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ display: 'block' }}>
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
  );
}
import { seekAudio } from '../../hooks/useAudioPlayer';
import { useLikedSongs } from '../../hooks/useLikedSongs';
import SleepTimer from './SleepTimer';
import PlaylistModal from './PlaylistModal';
import JamModal from './JamModal';
import EqualizerPanel from './EqualizerPanel';

function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function IconHeart({ filled }: { filled?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "var(--accent)" : "none"} stroke={filled ? "var(--accent)" : "currentColor"} strokeWidth="2">
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
    </svg>
  );
}

function IconPlay() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z"/>
    </svg>
  );
}

function IconPause() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
    </svg>
  );
}

function IconPrev() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
    </svg>
  );
}

function IconNext() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 18l8.5-6L6 6v12zm2.5-6 5.5 4V8l-5.5 4zm7.5-6h2v12h-2z"/>
    </svg>
  );
}

function IconShuffle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
    </svg>
  );
}

function IconRepeat() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
    </svg>
  );
}

function IconRepeatOne() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
      <text x="12" y="15" textAnchor="middle" fontSize="7" fontWeight="bold" fill="currentColor">1</text>
    </svg>
  );
}

function IconVolumeHigh() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
    </svg>
  );
}

function IconVolumeMute() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
    </svg>
  );
}

function IconMusic() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
    </svg>
  );
}

function IconMic() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zM17.3 11c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
    </svg>
  );
}

function IconQueue() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
    </svg>
  );
}

function IconVideo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 3H3c-1.11 0-2 .89-2 2v12c0 1.1.89 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.11-.9-2-2-2zm0 14H3V5h18v12zm-5-6l-7 4V7l7 4z"/>
    </svg>
  );
}

import { isTrackOffline, saveTrackOffline } from '../../lib/offlineAudio';
import { resolveImageUrl } from '../../lib/api';
import { getApiUrl } from '../../lib/backendResolver';

export default function Player() {
  const {
    currentTrack, isPlaying, volume, isMuted, progress, duration, isLoading, dominantColor,
    togglePlay, nextTrack, prevTrack, setVolume, toggleMute,
    isLyricsOpen, toggleLyrics,
    isQueueOpen, toggleQueue,
    isVideoOpen, toggleVideo,
    isShuffle, toggleShuffle,
    repeatMode, cycleRepeat,
    activeJamCode, activeJamHostName, isJamHost
  } = usePlayerStore();

  const { isLiked, toggleLike } = useLikedSongs();
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [showJamModal, setShowJamModal] = useState(false);
  const [showEq, setShowEq] = useState(false);

  const [downloadStatus, setDownloadStatus] = useState<'none' | 'downloading' | 'downloaded'>('none');


  // Verificar y hacer polling al estado de descarga cuando cambie currentTrack.id o status
  useEffect(() => {
    if (!currentTrack) return;
    
    let isMounted = true;
    let pollInterval: any = null;

    const checkStatus = async () => {
      try {
        const API_BASE = await getApiUrl();
        // Primero verificar IndexedDB local
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
      console.error('[Player] Error al descargar y guardar offline localmente:', offlineErr);
      setDownloadStatus('none');
    }
  };

  const handleProgressClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      seekAudio(ratio * duration);
    },
    [duration]
  );

  const handleVolumeClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      setVolume(ratio);
    },
    [setVolume]
  );

  const progressPct = duration > 0 ? (progress / duration) * 100 : 0;
  const volumePct = isMuted ? 0 : volume * 100;

  // Color dinámico del player según la carátula
  const playerStyle = {
    position: 'relative' as const,
    ...(currentTrack ? { background: `linear-gradient(to right, ${dominantColor}22, var(--bg-elevated))` } : {})
  };

  const handlePlayerBarClick = (e: React.MouseEvent) => {
    // On mobile, tapping the mini-bar opens the full Spotify-style player (VideoPanel)
    if (window.innerWidth <= 768) {
      const target = e.target as HTMLElement;
      if (!target.closest('button') && !target.closest('a') && !target.closest('.progress-track')) {
        toggleVideo();
      }
    }
  };

  return (
    <div className="player" style={playerStyle} onClick={handlePlayerBarClick}>
      {activeJamCode && (
        <div 
          onClick={(e) => { e.stopPropagation(); setShowJamModal(true); }}
          style={{
            position: 'absolute',
            top: '-28px',
            left: 0,
            right: 0,
            height: '28px',
            background: '#121212',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            borderBottom: '1.5px solid var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.4px',
            zIndex: 10,
            color: 'var(--text-secondary)',
            transition: 'color var(--duration-fast)',
          }}
          className="sinfonia-active-banner"
        >
          <span style={{ 
            width: '6px', 
            height: '6px', 
            borderRadius: '50%', 
            background: 'var(--accent)', 
            marginRight: '8px', 
            display: 'inline-block',
            boxShadow: '0 0 8px var(--accent)'
          }} />
          Sinfonía activa &bull; {isJamHost ? 'Eres el director' : `Escuchando en grupo con ${activeJamHostName}`} &bull; Código: {activeJamCode}
        </div>
      )}
      {/* Track info */}
      <div className="player-track">
        {currentTrack ? (
          <>
            <img 
              className="player-cover" 
              src={resolveImageUrl(currentTrack.cover) || 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?q=80&w=300&auto=format&fit=crop'} 
              alt={currentTrack.title} 
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
              <div className="player-info">
                <div className="player-title" title={currentTrack.title}>{currentTrack.title}</div>
                <Link 
                  to={(currentTrack.artistId && currentTrack.artistId !== 0) ? `/artist/${currentTrack.artistId}` : `/artist/${encodeURIComponent(currentTrack.artist)}`}
                  className="player-artist" 
                  title={currentTrack.artist}
                  style={{ textDecoration: 'none' }}
                >
                  {currentTrack.artist}
                </Link>
              </div>
              <button 
                className="ctrl-btn" 
                onClick={() => toggleLike(currentTrack.id)}
                title="Añadir a Tus me gusta"
                style={{ padding: 4, flexShrink: 0 }}
              >
                <IconHeart filled={isLiked(currentTrack.id)} />
              </button>
              <button 
                className="ctrl-btn flex-add-to-playlist hide-on-mobile" 
                onClick={() => setShowPlaylistModal(true)}
                title="Añadir a playlist"
                style={{ padding: 4, flexShrink: 0 }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ display: 'block' }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </button>
              <button 
                className={`ctrl-btn ${downloadStatus === 'downloaded' ? 'downloaded' : ''}`}
                onClick={handleDownload}
                disabled={downloadStatus !== 'none'}
                title={downloadStatus === 'downloaded' ? "Audio guardado sin conexión" : downloadStatus === 'downloading' ? "Guardando..." : "Guardar sin conexión"}
                style={{ 
                  padding: 4, 
                  flexShrink: 0,
                  color: downloadStatus === 'downloaded' ? 'var(--accent)' : 'var(--text-secondary)',
                  opacity: downloadStatus === 'downloading' ? 0.6 : 1,
                  cursor: downloadStatus === 'none' ? 'pointer' : 'default',
                  background: 'transparent',
                  border: 'none'
                }}
              >
                {downloadStatus === 'downloaded' ? (
                  <IconCheck />
                ) : downloadStatus === 'downloading' ? (
                  <IconLoadingSpinner />
                ) : (
                  <IconCloudDownload />
                )}
              </button>

            </div>
          </>
        ) : (
          <>
            <div className="player-cover-placeholder">
              <IconMusic />
            </div>
            <div className="player-info">
              <div className="player-title" style={{ color: 'var(--text-muted)' }}>
                KokoMusic
              </div>
              <div className="player-artist">Busca una canción para empezar</div>
            </div>
          </>
        )}
      </div>

      {/* Controls + Progress */}
      <div className="player-controls">
        <div className="player-buttons">
          {/* Shuffle */}
          <button
            className="ctrl-btn"
            onClick={toggleShuffle}
            title={isShuffle ? 'Shuffle activado' : 'Shuffle'}
            style={isShuffle ? { color: 'var(--accent)' } : undefined}
          >
            <IconShuffle />
          </button>

          <button className="ctrl-btn" onClick={prevTrack} title="Anterior">
            <IconPrev />
          </button>

          <button className="ctrl-btn-play" onClick={togglePlay} disabled={!currentTrack}>
            {isLoading ? (
              <div className="spinner" style={{ width: 18, height: 18 }} />
            ) : isPlaying ? (
              <IconPause />
            ) : (
              <IconPlay />
            )}
          </button>

          <button className="ctrl-btn" onClick={nextTrack} title="Siguiente">
            <IconNext />
          </button>

          {/* Repeat */}
          <button
            className="ctrl-btn"
            onClick={cycleRepeat}
            title={repeatMode === 'off' ? 'Repetir' : repeatMode === 'all' ? 'Repetir todo' : 'Repetir una'}
            style={repeatMode !== 'off' ? { color: 'var(--accent)' } : undefined}
          >
            {repeatMode === 'one' ? <IconRepeatOne /> : <IconRepeat />}
            {repeatMode !== 'off' && (
              <span className="repeat-dot" />
            )}
          </button>
        </div>

        <div className="progress-bar">
          <span className="progress-time">{formatTime(progress)}</span>
          <div className="progress-track" onClick={handleProgressClick}>
            <div className="progress-fill" style={{ width: `${progressPct}%` }}>
              <div className="progress-thumb" />
            </div>
          </div>
          <span className="progress-time right">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right: Queue, Lyrics, Video, Sleep, Volume */}
      <div className="player-right">
        <button
          className="ctrl-btn"
          onClick={() => setShowJamModal(true)}
          title="Sinfonía — Escucha con amigos"
          style={{ color: activeJamCode ? 'var(--accent)' : undefined }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm-1 14v-4H7l5-8v4h4l-5 8z"/>
          </svg>
        </button>

        <button
          className="ctrl-btn"
          onClick={toggleQueue}
          title="Cola de reproducción"
          style={isQueueOpen ? { color: 'var(--accent)' } : undefined}
          disabled={!currentTrack}
        >
          <IconQueue />
        </button>

        <button
          className="ctrl-btn"
          onClick={toggleLyrics}
          title="Letras"
          style={isLyricsOpen ? { color: 'var(--accent)' } : undefined}
          disabled={!currentTrack}
        >
          <IconMic />
        </button>

        <button
          className="ctrl-btn"
          onClick={toggleVideo}
          title="Ver Video/Portada"
          style={isVideoOpen ? { color: 'var(--accent)' } : undefined}
          disabled={!currentTrack}
        >
          <IconVideo />
        </button>

        <SleepTimer />

        {/* EQ Button */}
        <button
          className="ctrl-btn"
          onClick={() => setShowEq((v) => !v)}
          title="Ecualizador"
          style={showEq ? { color: 'var(--accent)' } : undefined}
          disabled={!currentTrack}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
            <path d="M3 6h2v12H3V6zm4 3h2v9H7V9zm4-2h2v11h-2V7zm4 4h2v7h-2v-7zm4-5h2v12h-2V6z" opacity="0"/>
            <path d="M7 10h2v4H7v-4zm4-3h2v10h-2V7zm4 5h2v2h-2v-2zm-8 0h2v2H7v-2z" opacity="0"/>
            <rect x="3" y="9" width="2" height="6" rx="1"/>
            <rect x="7" y="6" width="2" height="9" rx="1"/>
            <rect x="11" y="11" width="2" height="4" rx="1"/>
            <rect x="15" y="7" width="2" height="8" rx="1"/>
            <rect x="19" y="4" width="2" height="11" rx="1"/>
          </svg>
        </button>

        <div className="volume-bar">
          <button className="ctrl-btn" onClick={toggleMute} style={{ padding: 4 }}>
            {isMuted || volume === 0 ? <IconVolumeMute /> : <IconVolumeHigh />}
          </button>
          <div className="volume-track" onClick={handleVolumeClick}>
            <div className="volume-fill" style={{ width: `${volumePct}%` }} />
          </div>
        </div>
      </div>
      {currentTrack && (
        <PlaylistModal
          isOpen={showPlaylistModal}
          onClose={() => setShowPlaylistModal(false)}
          trackId={currentTrack.id}
        />
      )}
      <JamModal isOpen={showJamModal} onClose={() => setShowJamModal(false)} />
      {showEq && <EqualizerPanel onClose={() => setShowEq(false)} />}
    </div>
  );
}
