import { useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '../../store/playerStore';
import { getLyrics } from '../../lib/api';
import type { Lyrics } from '../../lib/api';

interface LyricsLine {
  time: number;
  text: string;
}

function parseSyncedLyrics(synced: string | null): LyricsLine[] {
  if (!synced) return [];
  const lines = synced.split('\n');
  const result: LyricsLine[] = [];
  
  // Formato: [mm:ss.xx] Letra
  const regex = /\[(\d+):(\d+)(?:\.(\d+))?\](.*)/;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = match[3] ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      const time = min * 60 + sec + ms / 1000;
      const text = match[4].trim();
      if (text) {
        result.push({ time, text });
      }
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

export default function LyricsPanel() {
  const { currentTrack, isLyricsOpen, toggleLyrics, progress } = usePlayerStore();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { data: lyrics, isLoading, error } = useQuery<Lyrics>({
    queryKey: ['lyrics', currentTrack?.id],
    queryFn: () => getLyrics(currentTrack!.id),
    enabled: !!currentTrack && isLyricsOpen,
    retry: false,
    staleTime: 24 * 60 * 60 * 1000, // Cache de letras por 24h en cliente
  });

  const parsedLines = useMemo(() => {
    if (!lyrics?.syncedLyrics) return [];
    return parseSyncedLyrics(lyrics.syncedLyrics);
  }, [lyrics]);

  // Buscar línea activa según el progreso de reproducción
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

  // Centrado automático de la línea activa en pantalla
  useEffect(() => {
    if (!containerRef.current) return;
    const activeEl = containerRef.current.querySelector('.lyric-line.active');
    if (activeEl) {
      activeEl.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeIndex]);

  if (!isLyricsOpen) return null;

  return (
    <div className="lyrics-panel">
      <div className="lyrics-header">
        <h3>Letras</h3>
        <button className="lyrics-close-btn" onClick={toggleLyrics} title="Cerrar letras">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>

      <div className="lyrics-content" ref={containerRef}>
        {!currentTrack ? (
          <div className="lyrics-empty">Selecciona una canción para empezar</div>
        ) : isLoading ? (
          <div className="lyrics-empty">
            <div className="spinner" style={{ marginBottom: 16 }} />
            Buscando letras...
          </div>
        ) : error || !lyrics ? (
          <div className="lyrics-empty">Letras no encontradas</div>
        ) : lyrics.instrumental ? (
          <div className="lyrics-instrumental text-accent" style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg> Tema Instrumental <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>
        ) : parsedLines.length > 0 ? (
          <div className="lyrics-lines-container">
            {parsedLines.map((line, idx) => (
              <div
                key={idx}
                className={`lyric-line ${idx === activeIndex ? 'active' : ''} ${
                  idx < activeIndex ? 'past' : ''
                }`}
              >
                {line.text}
              </div>
            ))}
          </div>
        ) : lyrics.plainLyrics ? (
          <div className="lyrics-plain-text">{lyrics.plainLyrics}</div>
        ) : (
          <div className="lyrics-empty">Letras no encontradas</div>
        )}
      </div>
    </div>
  );
}
