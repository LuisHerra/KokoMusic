import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePlayerStore } from '../../store/playerStore';
import { useLikedSongs } from '../../hooks/useLikedSongs';
import { seekAudio } from '../../hooks/useAudioPlayer';
import { useQuery } from '@tanstack/react-query';
import { getLyrics, resolveImageUrl, type Lyrics } from '../../lib/api';
import { parseSyncedLyrics } from '../../lib/lyricsParser';

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
    dominantColor,
    isLyricsOpen, toggleLyrics,
  } = usePlayerStore();

  const { isLiked, toggleLike } = useLikedSongs();
  const [showLyrics, setShowLyrics] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const progressRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  // Touch-to-dismiss gesture state
  const touchStartY = useRef(0);
  const touchDeltaY = useRef(0);
  const [translateY, setTranslateY] = useState(0);

  const progressPct = isDragging ? dragProgress : (duration > 0 ? (progress / duration) * 100 : 0);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      setShowLyrics(false);
      setTranslateY(0);
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

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

  // Auto-scroll lyrics to active line
  useEffect(() => {
    if (!showLyrics || !lyricsContainerRef.current) return;
    const el = lyricsContainerRef.current.querySelector('.mfp-lyric.active');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex, showLyrics]);

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

  // Accent color from dominant color
  const accentBg = dominantColor
    ? `linear-gradient(180deg, ${dominantColor}cc 0%, #0d0d0d 60%)`
    : 'linear-gradient(180deg, #1a1a2e 0%, #0d0d0d 60%)';

  if (!isOpen) return null;

  return (
    <div
      className="mfp-overlay"
      style={{ transform: `translateY(${translateY}px)`, transition: isDragging ? 'none' : 'transform 0.35s cubic-bezier(0.16,1,0.3,1)' }}
    >
      {/* Dynamic gradient background */}
      <div className="mfp-bg" style={{ background: accentBg }} />

      {/* Header */}
      <div
        className="mfp-header"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="mfp-drag-pill" />
        <button className="mfp-close-btn" onClick={onClose}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
          </svg>
        </button>
        <div className="mfp-header-context">
          {currentTrack?.album && (
            <span className="mfp-header-label">{currentTrack.album}</span>
          )}
        </div>
        <button
          className="mfp-header-btn"
          onClick={() => setShowLyrics(!showLyrics)}
          style={{ color: showLyrics ? 'var(--accent)' : 'rgba(255,255,255,0.6)' }}
          title="Letras"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zM17.3 11c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
          </svg>
        </button>
      </div>

      {/* Main content — flips between cover art and lyrics */}
      <div className="mfp-body" ref={containerRef}>
        {showLyrics ? (
          /* ── Lyrics view ── */
          <div className="mfp-lyrics-wrap" ref={lyricsContainerRef}>
            {!lyrics ? (
              <div className="mfp-lyrics-empty">
                <div className="spinner" style={{ width: 32, height: 32 }} />
                <span>Buscando letras…</span>
              </div>
            ) : lyrics.instrumental ? (
              <div className="mfp-lyrics-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.4 }}>
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                <span>Tema instrumental</span>
              </div>
            ) : parsedLines.length > 0 ? (
              <div className="mfp-lyrics-lines">
                {parsedLines.map((line, idx) => {
                  const isActive = idx === activeIndex;
                  const isPast = idx < activeIndex;
                  return (
                    <div
                      key={idx}
                      className={`mfp-lyric${isActive ? ' active' : ''}${isPast ? ' past' : ''}`}
                      onClick={() => seekAudio(line.time)}
                    >
                      {line.text || ' '}
                    </div>
                  );
                })}
              </div>
            ) : lyrics.plainLyrics ? (
              <div className="mfp-lyrics-plain">{lyrics.plainLyrics}</div>
            ) : (
              <div className="mfp-lyrics-empty">Letras no disponibles</div>
            )}
          </div>
        ) : (
          /* ── Cover art view ── */
          <div className="mfp-cover-wrap">
            <div className="mfp-cover-container">
              <img
                className="mfp-cover"
                src={resolveImageUrl(currentTrack?.cover || '') || ''}
                alt={currentTrack?.title}
              />
            </div>
          </div>
        )}
      </div>

      {/* Track info + actions */}
      <div className="mfp-info-row">
        <div className="mfp-track-text">
          <div className="mfp-track-title">{currentTrack?.title}</div>
          <Link
            to={
              currentTrack?.artistId && currentTrack.artistId !== 0
                ? `/artist/${currentTrack.artistId}`
                : `/artist/${encodeURIComponent(currentTrack?.artist || '')}`
            }
            className="mfp-track-artist"
            onClick={onClose}
          >
            {currentTrack?.artist}
          </Link>
        </div>
        <button
          className="mfp-like-btn"
          onClick={() => currentTrack && toggleLike(currentTrack.id)}
          style={{ color: isLiked(currentTrack?.id || '') ? 'var(--accent)' : 'rgba(255,255,255,0.6)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24"
            fill={isLiked(currentTrack?.id || '') ? 'currentColor' : 'none'}
            stroke="currentColor" strokeWidth="2">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
        </button>
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
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
          </svg>
        </button>

        <button className="mfp-ctrl-btn mfp-ctrl-prev" onClick={prevTrack}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
          </svg>
        </button>

        <button className="mfp-play-btn" onClick={togglePlay}>
          {isPlaying ? (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
            </svg>
          ) : (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>

        <button className="mfp-ctrl-btn mfp-ctrl-next" onClick={nextTrack}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 18l8.5-6L6 6v12zm2.5-6 5.5 4V8l-5.5 4zm7.5-6h2v12h-2z"/>
          </svg>
        </button>

        <button
          className="mfp-ctrl-btn"
          onClick={cycleRepeat}
          style={{ color: repeatMode !== 'off' ? 'var(--accent)' : 'rgba(255,255,255,0.6)', position: 'relative' }}
        >
          {repeatMode === 'one' ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v5zm-4-2V9h-1l-2 1v1h1.5v6H13z"/>
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v5z"/>
            </svg>
          )}
          {repeatMode !== 'off' && <span className="mfp-repeat-dot" />}
        </button>
      </div>

      {/* Extra actions row */}
      <div className="mfp-extras">
        <button
          className="mfp-extra-btn"
          onClick={() => { setShowLyrics(!showLyrics); }}
          style={{ color: showLyrics ? 'var(--accent)' : 'rgba(255,255,255,0.5)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zM17.3 11c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
          </svg>
          <span>Letras</span>
        </button>
        <button
          className="mfp-extra-btn"
          onClick={toggleLyrics}
          style={{ color: 'rgba(255,255,255,0.5)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
          </svg>
          <span>Visualización</span>
        </button>
      </div>
    </div>
  );
}
