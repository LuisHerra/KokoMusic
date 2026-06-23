import { useEffect, useRef, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '../../store/playerStore';
import { seekAudio } from '../../hooks/useAudioPlayer';
import { getLyrics, getTrackVideo, type Lyrics, type VideoData } from '../../lib/api';
import { useVideoSync } from '../../hooks/useVideoSync';

import { parseSyncedLyrics, detectLyricSections } from '../../lib/lyricsParser';

export default function ImmersiveLyrics() {
  const { currentTrack, isLyricsOpen, toggleLyrics, progress, dominantColor, isVideoOpen, isKaraokeMode, toggleKaraoke } = usePlayerStore();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [bgIframeEl, setBgIframeEl] = useState<HTMLIFrameElement | null>(null);

  // LocalStorage Helper para persistir configuración
  const getSaved = (key: string, def: any) => {
    const saved = localStorage.getItem(`koko_lyrics_${key}`);
    return saved ? JSON.parse(saved) : def;
  };

  const [baseSize, setBaseSize] = useState<number>(() => getSaved('baseSize', 36));
  const [alignment, setAlignment] = useState<'left' | 'center' | 'right'>(() => getSaved('alignment', 'center'));
  const [colorMode, setColorMode] = useState<'cover' | 'gradient' | 'white' | 'custom'>(() => getSaved('colorMode', 'cover'));
  const [customColor, setCustomColor] = useState<string>(() => getSaved('customColor', '#a78bfa'));
  const [animation, setAnimation] = useState<'scale' | 'slide' | 'blur' | 'kinetic'>(() => getSaved('animation', 'kinetic'));
  const [extractedColor, setExtractedColor] = useState<string>('#1DB954');
  const [extractedGradient, setExtractedGradient] = useState<string>('');
  
  // Customization States
  const [showSettings, setShowSettings] = useState(false);
  const [shadowEnabled, setShadowEnabled] = useState<boolean>(() => getSaved('shadowEnabled', true));
  const [shadowColor, setShadowColor] = useState<string>(() => getSaved('shadowColor', '#ffffff'));
  const [strokeEnabled, setStrokeEnabled] = useState<boolean>(() => getSaved('strokeEnabled', false));
  const [strokeColor, setStrokeColor] = useState<string>(() => getSaved('strokeColor', '#000000'));
  const [strokeWidth, setStrokeWidth] = useState<number>(() => getSaved('strokeWidth', 1.5));
  const [layoutStyle, setLayoutStyle] = useState<'standard' | 'impact'>(() => getSaved('layoutStyle', 'standard'));
  const [translationMode, setTranslationMode] = useState<'none' | 'replace' | 'both'>(() => getSaved('translationMode', 'none'));
  const [translationLang, setTranslationLang] = useState<string>(() => getSaved('translationLang', 'es'));

  // Guardar en localStorage cada vez que cambian
  useEffect(() => {
    localStorage.setItem('koko_lyrics_baseSize', JSON.stringify(baseSize));
    localStorage.setItem('koko_lyrics_alignment', JSON.stringify(alignment));
    localStorage.setItem('koko_lyrics_colorMode', JSON.stringify(colorMode));
    localStorage.setItem('koko_lyrics_customColor', JSON.stringify(customColor));
    localStorage.setItem('koko_lyrics_animation', JSON.stringify(animation));
    localStorage.setItem('koko_lyrics_shadowEnabled', JSON.stringify(shadowEnabled));
    localStorage.setItem('koko_lyrics_shadowColor', JSON.stringify(shadowColor));
    localStorage.setItem('koko_lyrics_strokeEnabled', JSON.stringify(strokeEnabled));
    localStorage.setItem('koko_lyrics_strokeColor', JSON.stringify(strokeColor));
    localStorage.setItem('koko_lyrics_strokeWidth', JSON.stringify(strokeWidth));
    localStorage.setItem('koko_lyrics_layoutStyle', JSON.stringify(layoutStyle));
    localStorage.setItem('koko_lyrics_translationMode', JSON.stringify(translationMode));
    localStorage.setItem('koko_lyrics_translationLang', JSON.stringify(translationLang));
  }, [baseSize, alignment, colorMode, customColor, animation, shadowEnabled, shadowColor, strokeEnabled, strokeColor, strokeWidth, layoutStyle, translationMode, translationLang]);

  // Extraer color directamente de la portada de la canción (más preciso que playerStore)
  useEffect(() => {
    if (!currentTrack?.cover) return;
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 64, 64);
      const data = ctx.getImageData(0, 0, 64, 64).data;
      let r = 0, g = 0, b = 0, count = 0;
      let r1 = 0, g1 = 0, b1 = 0, c1 = 0;
      let r2 = 0, g2 = 0, b2 = 0, c2 = 0;
      
      for (let y = 0; y < 64; y++) {
         for (let x = 0; x < 64; x++) {
            const i = (y * 64 + x) * 4;
            if (data[i+3] < 255) continue;
            const avg = (data[i] + data[i+1] + data[i+2]) / 3;
            if (avg > 20 && avg < 240) {
               r += data[i]; g += data[i+1]; b += data[i+2]; count++;
               if (x + y < 64) {
                  r1 += data[i]; g1 += data[i+1]; b1 += data[i+2]; c1++;
               } else {
                  r2 += data[i]; g2 += data[i+1]; b2 += data[i+2]; c2++;
               }
            }
         }
      }
      
      const toHex = (n: number) => n.toString(16).padStart(2, '0');
      if (count > 0) {
        setExtractedColor(`#${toHex(Math.floor(r/count))}${toHex(Math.floor(g/count))}${toHex(Math.floor(b/count))}`);
      }
      
      const hex1 = c1 > 0 ? `#${toHex(Math.floor(r1/c1))}${toHex(Math.floor(g1/c1))}${toHex(Math.floor(b1/c1))}` : '#1DB954';
      const hex2 = c2 > 0 ? `#${toHex(Math.floor(r2/c2))}${toHex(Math.floor(g2/c2))}${toHex(Math.floor(b2/c2))}` : '#1DB954';
      setExtractedGradient(`linear-gradient(135deg, ${hex1}, ${hex2})`);
    };
    img.src = currentTrack.cover;
  }, [currentTrack?.cover]);

  // Handle zooming with Ctrl+Scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setBaseSize(prev => Math.min(Math.max(16, prev + (e.deltaY < 0 ? 2 : -2)), 72));
      }
    };
    
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  // Obtener letras
  const { data: lyrics, isLoading, error } = useQuery<Lyrics>({
    queryKey: ['lyrics', currentTrack?.id],
    queryFn: () => getLyrics(currentTrack!.id),
    enabled: !!currentTrack && isLyricsOpen,
    retry: false,
    staleTime: 24 * 60 * 60 * 1000,
  });

  // Obtener video — se carga siempre que las letras estén abiertas
  // (en mobile se usa como fondo; en desktop solo cuando el panel de video está abierto)
  const { data: videoData } = useQuery<VideoData>({
    queryKey: ['video', currentTrack?.id],
    queryFn: () => getTrackVideo(currentTrack!.id),
    enabled: !!currentTrack && isLyricsOpen,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });

  const parsedLines = useMemo(() => {
    if (!lyrics?.syncedLyrics) return [];
    return parseSyncedLyrics(lyrics.syncedLyrics);
  }, [lyrics]);

  // Query para traducción con la API pública de Google Translate
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
        if (translatedLines[idx]) {
          record[idx] = translatedLines[idx].trim();
        }
      });
      return record;
    },
    enabled: translationMode !== 'none' && parsedLines.length > 0 && !!currentTrack,
    staleTime: 24 * 60 * 60 * 1000,
  });

  // Sincronizar video en el fondo (usado en mobile)
  // En desktop sincronizamos el iframe solo si el panel de video está abierto;
  // en mobile el iframe de fondo corre en mute sin sincronía de seek.
  useVideoSync(bgIframeEl, isVideoOpen ? videoData?.youtubeId || null : null);

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

  // Heurística de Secciones (detectar intro, versos, estribillos)
  const sections = useMemo(() => {
    return detectLyricSections(parsedLines);
  }, [parsedLines]);

  // Sección activa
  const activeSectionIndex = useMemo(() => {
    if (sections.length === 0) return -1;
    let idx = 0;
    for (let i = 0; i < sections.length; i++) {
      if (progress >= sections[i].startTime - 1) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [progress, sections]);

  // Karaoke: ratio of the current line's duration that has elapsed (0-1)
  const karaokeRatio = useMemo(() => {
    if (activeIndex < 0 || activeIndex >= parsedLines.length) return 0;
    const lineStart = parsedLines[activeIndex].time;
    const lineEnd = activeIndex + 1 < parsedLines.length
      ? parsedLines[activeIndex + 1].time
      : lineStart + 5; // fallback 5s for last line
    const elapsed = progress - lineStart;
    const duration = Math.max(0.1, lineEnd - lineStart);
    return Math.min(1, Math.max(0, elapsed / duration));
  }, [progress, activeIndex, parsedLines]);

  // Centrado automático de la línea activa
  useEffect(() => {
    if (!containerRef.current) return;
    const activeEl = containerRef.current.querySelector('.immersive-lyric-line.active');
    if (activeEl) {
      activeEl.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [activeIndex]);

  if (!isLyricsOpen) return null;

  // Fondo degradado dinámico e inmersivo (se mezcla con el video si está activo)
  const gradientStyle = {
    background: isVideoOpen && videoData?.youtubeId
      ? 'rgba(10, 10, 10, 0.4)'
      : `linear-gradient(135deg, ${dominantColor}cc 0%, var(--bg-default) 100%)`
  };

  return (
    <div className={`immersive-lyrics-view ${isVideoOpen ? 'has-video-bg' : ''}`} style={gradientStyle}>
      
      {/* Video de fondo — CSS lo oculta en desktop y lo muestra en mobile */}
      {isVideoOpen && videoData?.youtubeId && (
        <div className="immersive-lyrics-video-bg">
          <iframe
            ref={setBgIframeEl}
            src={`https://www.youtube.com/embed/${videoData.youtubeId}?enablejsapi=1&autoplay=1&mute=1&controls=0&showinfo=0&rel=0&iv_load_policy=3&cc_load_policy=0&origin=${window.location.origin}`}
            title="Video de fondo de letras"
            frameBorder="0"
            allow="autoplay; encrypted-media"
            className="immersive-lyrics-iframe"
          />
          <div className="immersive-lyrics-video-overlay" />
        </div>
      )}

      {/* Botón de cierre superior derecho */}
      <button className="immersive-lyrics-close" onClick={toggleLyrics} title="Cerrar letras">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>

      {/* Botón de configuración */}
      <button className="immersive-lyrics-close immersive-lyrics-btn-settings" onClick={() => setShowSettings(!showSettings)} title="Configuración de letras">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.06-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.06,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.43-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.49-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/>
        </svg>
      </button>

      {/* Botón Karaoke */}
      <button
        className="immersive-lyrics-close"
        onClick={toggleKaraoke}
        title={isKaraokeMode ? 'Desactivar Karaoke' : 'Modo Karaoke'}
        style={{
          right: 'auto',
          left: '80px',
          background: isKaraokeMode ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
          color: isKaraokeMode ? '#000' : '#fff',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '13px',
          fontWeight: 700,
          gap: '4px',
          padding: '0 12px',
          width: 'auto',
          minWidth: '42px',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zM17.3 11c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
        </svg>
        {isKaraokeMode && <span>ON</span>}
      </button>

      {/* Panel de Configuración */}
      {showSettings && (
        <div className="immersive-lyrics-settings-popover">
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Apariencia de Letras</h3>
          
          {/* Tamaño */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Tamaño</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: '4px 12px' }}>
              <button onClick={() => setBaseSize(p => Math.max(16, p - 4))} style={{ padding: 4, background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>A-</button>
              <span style={{ fontSize: 13, width: 28, textAlign: 'center' }}>{baseSize}</span>
              <button onClick={() => setBaseSize(p => Math.min(72, p + 4))} style={{ padding: 4, background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>A+</button>
            </div>
          </div>

          {/* Estilo / Tipografía */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Tipografía</span>
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: 4 }}>
              <button onClick={() => setLayoutStyle('standard')} style={{ padding: '4px 12px', color: '#fff', fontSize: 13, background: layoutStyle === 'standard' ? 'rgba(255,255,255,0.2)' : 'transparent', borderRadius: 16, border: 'none', cursor: 'pointer' }}>Normal</button>
              <button onClick={() => setLayoutStyle('impact')} style={{ padding: '4px 12px', color: '#fff', fontSize: 13, background: layoutStyle === 'impact' ? 'rgba(255,255,255,0.2)' : 'transparent', borderRadius: 16, border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>IMPACTO</button>
            </div>
          </div>

          {/* Alineación */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Alineación</span>
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: 4 }}>
              <button onClick={() => setAlignment('left')} style={{ padding: '4px 12px', color: '#fff', fontSize: 13, background: alignment === 'left' ? 'rgba(255,255,255,0.2)' : 'transparent', borderRadius: 16, border: 'none', cursor: 'pointer' }}>Izq</button>
              <button onClick={() => setAlignment('center')} style={{ padding: '4px 12px', color: '#fff', fontSize: 13, background: alignment === 'center' ? 'rgba(255,255,255,0.2)' : 'transparent', borderRadius: 16, border: 'none', cursor: 'pointer' }}>Cen</button>
              <button onClick={() => setAlignment('right')} style={{ padding: '4px 12px', color: '#fff', fontSize: 13, background: alignment === 'right' ? 'rgba(255,255,255,0.2)' : 'transparent', borderRadius: 16, border: 'none', cursor: 'pointer' }}>Der</button>
            </div>
          </div>

          {/* Animación */}
          <div>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>Efecto de Animación</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {['scale', 'slide', 'blur', 'kinetic'].map(anim => (
                <button key={anim} onClick={() => setAnimation(anim as any)} style={{
                  padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: animation === anim ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)',
                  color: '#fff', fontSize: 13, textTransform: 'capitalize'
                }}>{anim === 'kinetic' ? 'Kinetic 3D' : anim}</button>
              ))}
            </div>
          </div>

          {/* Color del texto */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Color Activo</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setColorMode(prev => prev === 'cover' ? 'gradient' : prev === 'gradient' ? 'white' : prev === 'white' ? 'custom' : 'cover')} style={{ background: 'rgba(255,255,255,0.1)', borderRadius: 20, padding: '4px 12px', color: '#fff', fontSize: 13, border: 'none', cursor: 'pointer' }}>
                {colorMode === 'cover' ? 'Auto Sólido' : colorMode === 'gradient' ? 'Auto Gradiente' : colorMode === 'white' ? 'Blanco' : 'Manual'}
              </button>
              {colorMode === 'custom' && (
                <input type="color" value={customColor} onChange={e => setCustomColor(e.target.value)} style={{ width: 24, height: 24, border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 0, backgroundColor: 'transparent' }} />
              )}
            </div>
          </div>

          {/* Sombra y Trazo */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: 14, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={shadowEnabled} onChange={e => setShadowEnabled(e.target.checked)} />
                Resplandor (Sombra)
              </label>
              {shadowEnabled && (
                <input type="color" value={shadowColor} onChange={e => setShadowColor(e.target.value)} style={{ width: 24, height: 24, border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 0, backgroundColor: 'transparent' }} />
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: 14, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={strokeEnabled} onChange={e => setStrokeEnabled(e.target.checked)} />
                Trazo de Texto
              </label>
              {strokeEnabled && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="range" min="0.5" max="5" step="0.5" value={strokeWidth} onChange={e => setStrokeWidth(Number(e.target.value))} style={{ width: 60, cursor: 'pointer' }} title="Grosor del trazo" />
                  <input type="color" value={strokeColor} onChange={e => setStrokeColor(e.target.value)} style={{ width: 24, height: 24, border: 'none', borderRadius: '50%', cursor: 'pointer', padding: 0, backgroundColor: 'transparent' }} />
                </div>
              )}
            </div>
          </div>

          {/* Traducción */}
          <div>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>Traducción de Letras</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
              {['none', 'both', 'replace'].map(mode => (
                <button key={mode} onClick={() => setTranslationMode(mode as any)} style={{
                  padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: translationMode === mode ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)',
                  color: '#fff', fontSize: 13, textTransform: 'capitalize'
                }}>{mode === 'none' ? 'Apagado' : mode === 'both' ? 'Ambos' : 'Reemplazar'}</button>
              ))}
            </div>
            {translationMode !== 'none' && (
              <select 
                value={translationLang} 
                onChange={e => setTranslationLang(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '8px', background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', outline: 'none', cursor: 'pointer' }}
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

      {/* Título de canción y artista en la esquina superior izquierda */}
      {currentTrack && (
        <div className="immersive-lyrics-track-info">
          <img src={currentTrack.cover} alt={currentTrack.title} className="immersive-lyrics-cover" />
          <div>
            <div className="immersive-lyrics-title">{currentTrack.title}</div>
            <div className="immersive-lyrics-artist">{currentTrack.artist}</div>
          </div>
        </div>
      )}

      {/* Sidebar de Secciones */}
      {sections.length > 1 && (
        <div className="il-sections-sidebar">
          {sections.map((sec, idx) => {
            const isSecActive = idx === activeSectionIndex;
            const isSecPast = idx < activeSectionIndex;
            return (
              <div 
                key={idx} 
                className={`il-section-item ${isSecActive ? 'active' : ''} ${isSecPast ? 'past' : ''}`}
                onClick={() => seekAudio(sec.startTime)}
                title={`Ir a ${sec.type}`}
              >
                <div className="il-section-dot"></div>
                <div className="il-section-label">{sec.type}</div>
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        .il-sections-sidebar {
          position: absolute;
          left: 40px;
          top: 50%;
          transform: translateY(-50%);
          display: flex;
          flex-direction: column;
          gap: 16px;
          z-index: 10;
        }

        .il-section-item {
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          opacity: 0.3;
          transition: all 0.3s ease;
        }

        .il-section-item:hover {
          opacity: 0.8;
        }

        .il-section-item.active {
          opacity: 1;
        }

        .il-section-item.past {
          opacity: 0.6;
        }

        .il-section-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background-color: #fff;
          transition: all 0.3s ease;
        }

        .il-section-item.active .il-section-dot {
          width: 8px;
          height: 24px;
          border-radius: 4px;
          background-color: ${colorMode === 'cover' ? extractedColor : colorMode === 'white' ? '#ffffff' : customColor};
          box-shadow: 0 0 10px ${colorMode === 'cover' ? extractedColor : colorMode === 'white' ? '#ffffff' : customColor};
        }

        .il-section-label {
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          color: #fff;
          opacity: 0;
          transform: translateX(-10px);
          transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
          pointer-events: none;
        }

        .il-sections-sidebar:hover .il-section-label,
        .il-section-item.active .il-section-label {
          opacity: 1;
          transform: translateX(0);
        }

        /* En móvil ocultamos la barra lateral para evitar ocupar espacio vital */
        @media (max-width: 768px) {
          .il-sections-sidebar {
            display: none;
          }
        }
      `}</style>

      {/* Contenido de letras */}
      <div className="immersive-lyrics-content" ref={containerRef}>
        {!currentTrack ? (
          <div className="immersive-lyrics-empty">Selecciona una canción para ver sus letras</div>
        ) : isLoading ? (
          <div className="immersive-lyrics-empty">
            <div className="spinner big" />
            <span style={{ marginTop: 16 }}>Buscando letras sincronizadas...</span>
          </div>
        ) : error || !lyrics ? (
          <div className="immersive-lyrics-empty">Letras no disponibles para esta canción</div>
        ) : lyrics.instrumental ? (
          <div className="immersive-lyrics-instrumental">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" style={{ marginBottom: 16 }}>
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
            <div>Tema Instrumental</div>
          </div>
        ) : parsedLines.length > 0 ? (
          <div className={`immersive-lyrics-lines-container anim-${animation}`}>
            {parsedLines.map((line, idx) => {
              const isActive = idx === activeIndex;
              const isPast = idx < activeIndex;
              const activeColor = colorMode === 'cover' ? extractedColor : colorMode === 'white' ? '#ffffff' : colorMode === 'gradient' ? 'transparent' : customColor;
              
              return (
                <div
                  key={idx}
                  className={`immersive-lyric-line ${isActive ? 'active' : ''} ${isPast ? 'past' : ''}`}
                  onClick={() => seekAudio(line.time)}
                  style={{
                    fontSize: isActive ? baseSize : baseSize * (layoutStyle === 'impact' ? 0.7 : 0.85),
                    textAlign: alignment,
                    color: isActive ? activeColor : undefined,
                    backgroundImage: isActive && colorMode === 'gradient' ? extractedGradient : undefined,
                    WebkitBackgroundClip: isActive && colorMode === 'gradient' ? 'text' : undefined,
                    WebkitTextFillColor: isActive && colorMode === 'gradient' ? 'transparent' : undefined,
                    textShadow: isActive ? (shadowEnabled ? `0 0 20px ${shadowColor}99, 0 0 40px ${shadowColor}40` : 'none') : undefined,
                    WebkitTextStroke: isActive && strokeEnabled ? `${strokeWidth}px ${strokeColor}` : undefined,
                    textTransform: layoutStyle === 'impact' ? 'uppercase' : 'none',
                    fontWeight: layoutStyle === 'impact' ? 900 : 800,
                    lineHeight: layoutStyle === 'impact' ? 1.05 : 1.35,
                    display: layoutStyle === 'impact' ? 'flex' : 'block',
                    flexWrap: layoutStyle === 'impact' ? 'wrap' : 'nowrap',
                    gap: layoutStyle === 'impact' ? '0.25em' : 'normal',
                    justifyContent: layoutStyle === 'impact' ? (alignment === 'center' ? 'center' : alignment === 'right' ? 'flex-end' : 'flex-start') : 'normal',
                  }}
                  title={`Ir a este punto (${Math.floor(line.time / 60)}:${Math.floor(line.time % 60).toString().padStart(2, '0')})`}
                >
                  <span className={`il-text ${animation}`} style={{ display: 'block' }}>
                    {isActive && isKaraokeMode && parsedLines.length > 0
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
                                filter: wIdx < revealedCount ? 'none' : 'blur(0px)',
                              }}
                            >
                              {word}
                            </span>
                          ));
                        })()
                      : (translationMode === 'replace' && translationsRecord?.[idx]
                          ? translationsRecord[idx]
                          : (layoutStyle === 'impact'
                              ? line.text.split(' ').map((word, wIdx) => <span key={wIdx}>{word}</span>)
                              : line.text))
                    }
                  </span>
                  
                  {translationMode === 'both' && translationsRecord?.[idx] && (
                    <span 
                      className={`il-translation ${animation}`}
                      style={{
                        display: 'block',
                        fontSize: layoutStyle === 'impact' ? '0.4em' : '0.6em',
                        opacity: isActive ? 0.8 : 0.4,
                        marginTop: '8px',
                        fontWeight: 600,
                        textTransform: 'none',
                        textShadow: isActive ? (shadowEnabled ? `0 0 10px ${shadowColor}99` : 'none') : 'none',
                        WebkitTextStroke: '0px',
                        letterSpacing: 'normal',
                        lineHeight: 1.2
                      }}
                    >
                      {translationsRecord[idx]}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : lyrics.plainLyrics ? (
          <div className="immersive-lyrics-plain-text">{lyrics.plainLyrics}</div>
        ) : (
          <div className="immersive-lyrics-empty">Letras no encontradas</div>
        )}
      </div>
    </div>
  );
}
