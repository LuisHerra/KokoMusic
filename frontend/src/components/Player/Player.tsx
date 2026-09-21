import { useCallback, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../../store/playerStore';
import HeartButton from '../Common/HeartButton';
import ParticleBurst from '../Common/ParticleBurst';
import ArtistLinks from '../Common/ArtistLinks';
import {
  IconCloudDownload, IconCheck, IconLoadingSpinner,
  IconPlay, IconPause, IconPrev, IconNext, IconShuffle, IconRepeat, IconRepeatOne,
  IconVolumeHigh, IconVolumeMute, IconMusic, IconQueue, IconVideo, IconLyrics, IconVoice,
  IconRadio, IconEqualizer, IconGroupListen, IconGamepad, IconAddCircle, IconHeart,
} from './PlayerIcons';
import { seekAudio, recordEarlySkip } from '../../hooks/useAudioPlayer';
import { useLikedSongs } from '../../hooks/useLikedSongs';
import { sendRecommendationFeedback, triggerRecommendationEvent } from '../../lib/api';
import SleepTimer from './SleepTimer';
import PlaylistModal from './PlaylistModal';
import JamModal from './JamModal';
import EqualizerPanel from './EqualizerPanel';
import ShareTrackModal from '../ShareTrackModal';
import SongCreditsModal from './SongCreditsModal';

function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}


import { isTrackOffline, saveTrackOffline } from '../../lib/offlineAudio';
import { resolveImageUrl, isDesktopApp } from '../../lib/api';
import { getApiUrl } from '../../lib/backendResolver';

export default function Player() {
  const navigate = useNavigate();
  const {
    currentTrack, isPlaying, volume, isMuted, progress, duration, isLoading,
    togglePlay, nextTrack, prevTrack, setVolume, toggleMute,
    isLyricsOpen, toggleLyrics,
    isQueueOpen, toggleQueue,
    isVideoOpen, toggleVideo,
    isShuffle, toggleShuffle,
    repeatMode, cycleRepeat,
    activeJamCode, activeJamHostName, isJamHost,
    isGamerMode, toggleGamerMode
  } = usePlayerStore();

  const { isLiked, toggleLike } = useLikedSongs();
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);
  const [showJamModal, setShowJamModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showEq, setShowEq] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);

  const userId = localStorage.getItem('koko_device_id') || localStorage.getItem('koko_user_id') || '00000000-0000-0000-0000-000000000001';

  // Wrap nextTrack with an early-skip signal: if the user skips before 10s,
  // record the track so the recommendation engine can downrank it.
  const handleSkip = useCallback(() => {
    if (currentTrack) {
      if (progress < 10) {
        recordEarlySkip(currentTrack.id, currentTrack.artist, currentTrack.title);
        sendRecommendationFeedback(currentTrack.id, 'skip');
      } else {
        // Saltó manualmente pero ya había escuchado un tramo — cuenta como
        // escucha real a efectos de refrescar el Koko-Mix.
        triggerRecommendationEvent('track_completed', currentTrack.id);
        sendRecommendationFeedback(currentTrack.id, 'track_completed');
      }
    }
    nextTrack();
  }, [currentTrack, progress, nextTrack]);

  const [downloadStatus, setDownloadStatus] = useState<'none' | 'downloading' | 'downloaded'>('none');

  // Verificar estado de caché/descarga al cambiar de track (single fetch, doble propósito)
  useEffect(() => {
    if (!currentTrack) return;

    let isMounted = true;
    let pollInterval: any = null;

    const checkStatus = async () => {
      try {
        const API_BASE = await getApiUrl();

        // Primero verificar IndexedDB local (sin red)
        const isOffline = await isTrackOffline(currentTrack.id);
        if (isOffline) {
          if (isMounted) {
            setDownloadStatus('downloaded');
          }
          if (pollInterval) clearInterval(pollInterval);
          return;
        }

        const res = await fetch(`${API_BASE}/stream/${currentTrack.id}/status`);
        if (!res.ok || !isMounted) return;
        const data = await res.json();
        if (!isMounted) return;

        // Actualizar botón de descarga
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

  const handleDownload = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
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

  // Layout style for player bar
  const playerStyle = {
    position: 'relative' as const,
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ArtistLinks
                    artist={currentTrack.artist}
                    artistId={currentTrack.artistId}
                    className="player-artist"
                    title={currentTrack.artist}
                  />
                </div>
              </div>
              <div className="hide-on-mobile" style={{ flexShrink: 0 }}>
                <HeartButton
                  isLiked={isLiked(currentTrack.id)}
                  onClick={() => toggleLike(currentTrack.id)}
                  size={20}
                />
              </div>
              <button 
                className="ctrl-btn hide-on-mobile" 
                onClick={() => setShowCreditsModal(true)}
                title="Radio de la Canción & Créditos"
                style={{ padding: 4, flexShrink: 0 }}
              >
                <IconRadio />
              </button>
              <button
                className="ctrl-btn flex-add-to-playlist hide-on-mobile"
                onClick={() => setShowPlaylistModal(true)}
                title="Añadir a playlist"
                style={{ padding: 4, flexShrink: 0 }}
              >
                <IconAddCircle />
              </button>
              <button 
                className={`ctrl-btn hide-on-mobile ${downloadStatus === 'downloaded' ? 'downloaded' : ''}`}
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
              <button 
                className="ctrl-btn show-on-mobile"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMobileMenu(true);
                }}
                title="Opciones"
                style={{ padding: 4, flexShrink: 0 }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2"/>
                  <circle cx="12" cy="12" r="2"/>
                  <circle cx="12" cy="19" r="2"/>
                </svg>
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

          <ParticleBurst type="note" count={8}>
            <button className="ctrl-btn-play" onClick={togglePlay} disabled={!currentTrack}>
              {isLoading ? (
                <div className="spinner" style={{ width: 18, height: 18 }} />
              ) : isPlaying ? (
                <IconPause />
              ) : (
                <IconPlay />
              )}
            </button>
          </ParticleBurst>

          <button className="ctrl-btn" onClick={handleSkip} title="Siguiente">
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
        {isDesktopApp() && (
          <button
            className="ctrl-btn"
            onClick={toggleGamerMode}
            title={isGamerMode ? 'Modo Gamer Activo (Ultra rendimiento GPU/RAM para juegos)' : 'Activar Modo Gamer (Optimizado para Fortnite / Juegos)'}
            style={{ color: isGamerMode ? '#ff0055' : undefined }}
          >
            <IconGamepad />
          </button>
        )}

        <button
          className="ctrl-btn"
          onClick={() => setShowJamModal(true)}
          title="Sinfonía — Escucha con amigos"
          style={{ color: activeJamCode ? 'var(--accent)' : undefined }}
        >
          <IconGroupListen />
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
          <IconLyrics />
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
          <IconEqualizer />
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
      <JamModal isOpen={showJamModal} onClose={() => setShowShareModal(false)} />
      <ShareTrackModal isOpen={showShareModal} onClose={() => setShowShareModal(false)} track={currentTrack} userId={userId} />
      {showEq && <EqualizerPanel onClose={() => setShowEq(false)} />}

      {showMobileMenu && currentTrack && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(10px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
          onClick={() => setShowMobileMenu(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 500,
              background: 'rgba(18, 18, 22, 0.96)',
              borderTop: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '20px 20px 0 0',
              padding: '20px 20px 32px 20px',
              color: '#fff',
              boxShadow: '0 -8px 32px rgba(0,0,0,0.6)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <img src={resolveImageUrl(currentTrack.cover)} alt={currentTrack.title} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentTrack.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{currentTrack.artist}</div>
              </div>
              <button onClick={() => setShowMobileMenu(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => { toggleLike(currentTrack.id); setShowMobileMenu(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                <IconHeart filled={isLiked(currentTrack.id)} />
                <span>{isLiked(currentTrack.id) ? 'Quitar de Tus me gusta' : 'Añadir a Tus me gusta'}</span>
              </button>

              <button
                onClick={() => { setShowShareModal(true); setShowMobileMenu(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                <span>Compartir con un amigo</span>
              </button>

              <button
                onClick={() => { setShowPlaylistModal(true); setShowMobileMenu(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                <IconAddCircle size={20} />
                <span>Añadir a lista de reproducción</span>
              </button>

              <button
                onClick={() => { handleDownload(); setShowMobileMenu(false); }}
                disabled={downloadStatus !== 'none'}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                <IconCloudDownload />
                <span>{downloadStatus === 'downloaded' ? 'Audio guardado sin conexión' : 'Guardar sin conexión'}</span>
              </button>

              <button
                onClick={() => { setShowEq(true); setShowMobileMenu(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                <IconEqualizer size={20} />
                <span>Ecualizador (EQ 5-Bandas)</span>
              </button>

              <button
                onClick={() => { navigate('/karaoke'); setShowMobileMenu(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                <IconVoice size={20} />
                <span>Estudio Karaoke & Auto-Tune</span>
              </button>

              <button
                onClick={() => { setShowCreditsModal(true); setShowMobileMenu(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 12, background: 'rgba(29,185,84,0.1)', border: '1px solid rgba(29,185,84,0.3)', color: '#1DB954', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                <IconRadio size={20} />
                <span>Radio de la Canción & Créditos</span>
              </button>

            </div>
          </div>
        </div>
      )}

      {showCreditsModal && currentTrack && (
        <SongCreditsModal track={currentTrack} onClose={() => setShowCreditsModal(false)} />
      )}
    </div>
  );
}
