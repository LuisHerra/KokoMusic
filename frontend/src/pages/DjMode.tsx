import { useState, useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { setAudioPlaybackRate, seekAudio } from '../hooks/useAudioPlayer';

interface LogMessage {
  id: string;
  time: string;
  sender: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'conflict';
}

interface TimelineClip {
  id: string;
  name: string;
  trackId: number;
  start: number; // seconds
  duration: number; // seconds
  audioBuffer?: AudioBuffer;
  color: string;
  peaks?: number[];
}

interface TimelineTrack {
  id: number;
  name: string;
  volume: number;
  muted: boolean;
  solo: boolean;
}

export default function DjMode() {
  const {
    currentTrack,
    queue,
    queueIndex,
    isPlaying,
    progress,
    setIsPlaying,
    nextTrack,
    setEqBand,
  } = usePlayerStore();

  const nextTrackInQueue = queue.length > 0 && queueIndex < queue.length - 1 ? queue[queueIndex + 1] : null;

  // --- View Selector (DJ Console / DAW Timeline Studio) ---
  const [activeView, setActiveView] = useState<'dj' | 'timeline'>('dj');

  // --- Layout & Adaptive Side Panel ---
  const [browserWidth, setBrowserWidth] = useState(250);
  const [isDraggingBrowser, setIsDraggingBrowser] = useState(false);

  // --- Decks Pitch / Speed & Metadata ---
  const [deckABpm, setDeckABpm] = useState(128);
  const [deckBBpm, setDeckBBpm] = useState(124);
  const [deckASpeed, setDeckASpeed] = useState(1.0);
  const [deckBSpeed, setDeckBSpeed] = useState(1.0);
  const [deckAKey, setDeckAKey] = useState('8A');
  const [deckBKey, setDeckBKey] = useState('5A');

  // --- Master Control Bar ---
  const [masterBpm, setMasterBpm] = useState(128.0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [globalSearch, setGlobalSearch] = useState('');

  // --- Mixer State (Center Rack) ---
  const [crossfader, setCrossfader] = useState(50);
  const [masterVol, setMasterVol] = useState(80);
  const [eqLowA, setEqLowA] = useState(0);
  const [eqMidA, setEqMidA] = useState(0);
  const [eqHighA, setEqHighA] = useState(0);
  const [eqLowB, setEqLowB] = useState(0);
  const [eqMidB, setEqMidB] = useState(0);
  const [eqHighB, setEqHighB] = useState(0);

  // Stems Separation
  const [stemVocalA, setStemVocalA] = useState(100);
  const [stemBassA, setStemBassA] = useState(100);
  const [stemDrumsA, setStemDrumsA] = useState(100);
  const [stemMelodyA, setStemMelodyA] = useState(100);

  // Peak levels (simulated VU meters)
  const [vuA, setVuA] = useState(0);
  const [vuB, setVuB] = useState(0);

  const [triggeredPad, setTriggeredPad] = useState<number | null>(null);

  // Filter state
  const [searchBpm, setSearchBpm] = useState(120);

  // --- Autotune Parameters ---
  const [autotuneEnabled, setAutotuneEnabled] = useState(true);
  const [autotuneKey, setAutotuneKey] = useState('C');
  const [autotuneScale, setAutotuneScale] = useState<'major' | 'minor' | 'chromatic'>('minor');
  const [retuneSpeed, setRetuneSpeed] = useState(20); // ms
  const [autotuneDepth, setAutotuneDepth] = useState(85); // %
  const [livePitch, setLivePitch] = useState(220); // Hz monitor

  // --- Autotune Modal & Voice Recorder States ---
  const [isAutotuneModalOpen, setIsAutotuneModalOpen] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [isRecordingMic, setIsRecordingMic] = useState(false);
  const [micTimer, setMicTimer] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micTimerIntervalRef = useRef<number | null>(null);

  // --- Multitrack DAW Timeline Editor state ---
  const [timelineTracks, setTimelineTracks] = useState<TimelineTrack[]>([
    { id: 0, name: 'Pista de Voz (Vocal)', volume: 80, muted: false, solo: false },
    { id: 1, name: 'Base Rítmica (Beats)', volume: 75, muted: false, solo: false },
    { id: 2, name: 'Melodía / Instrumentos', volume: 70, muted: false, solo: false },
    { id: 3, name: 'Efectos & Ambient (FX)', volume: 60, muted: false, solo: false },
  ]);
  const [timelineClips, setTimelineClips] = useState<TimelineClip[]>([
    { id: '1', name: 'Intro Beat Loop.mp3', trackId: 1, start: 0, duration: 25, color: '#39ff14', peaks: [4, 6, 8, 4, 3, 7, 5, 8, 9, 3, 2, 6, 7] },
    { id: '2', name: 'Synth Lead Melody.wav', trackId: 2, start: 15, duration: 30, color: '#00e5ff', peaks: [2, 5, 6, 4, 8, 9, 5, 4, 6, 7, 8, 4] },
    { id: '3', name: 'Voice Intro.wav (Autotuned)', trackId: 0, start: 5, duration: 18, color: '#ffea00', peaks: [3, 4, 5, 2, 7, 8, 3, 2, 6, 5] },
  ]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [timelinePlayhead, setTimelinePlayhead] = useState(0);
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false);
  const timelineIntervalRef = useRef<number | null>(null);

  // --- Concurrency Logs ---
  const [collabLogs, setCollabLogs] = useState<LogMessage[]>([]);
  const logCounterRef = useRef(0);

  const audioCtxRef = useRef<AudioContext | null>(null);

  // Canvas ref for Autotune pitch tracking graph
  const pitchCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Synthesized sounds for performance pads
  const playPadSound = (idx: number) => {
    setTriggeredPad(idx);
    setTimeout(() => setTriggeredPad(null), 150);

    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      const now = ctx.currentTime;
      if (idx % 4 === 0) {
        // Kick drum sound
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.3);
        gainNode.gain.setValueAtTime(1, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.type = 'sine';
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (idx % 4 === 1) {
        // Snare synth
        osc.frequency.setValueAtTime(300, now);
        gainNode.gain.setValueAtTime(0.5, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
        osc.type = 'triangle';
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (idx % 4 === 2) {
        // Laser / Hi-Hat
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(50, now + 0.15);
        gainNode.gain.setValueAtTime(0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc.type = 'sawtooth';
        osc.start(now);
        osc.stop(now + 0.15);
      } else {
        // Ambient Synth Chord / Beep
        const notes = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88];
        const freq = notes[idx % notes.length];
        osc.frequency.setValueAtTime(freq, now);
        gainNode.gain.setValueAtTime(0.4, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
        osc.type = 'sine';
        osc.start(now);
        osc.stop(now + 0.4);
      }
      addCollabLog('Sampler Pad', `Disparo PAD #${idx + 1} (${idx % 4 === 0 ? 'Bombo' : idx % 4 === 1 ? 'Caja' : idx % 4 === 2 ? 'Láser' : 'Sintetizador'})`, 'success');
    } catch (e) {
      console.error(e);
    }
  };

  // Custom multitrack clip horizontal dragging handler
  const handleClipMouseDown = (e: React.MouseEvent, clip: TimelineClip) => {
    e.stopPropagation();
    setSelectedClipId(clip.id);

    const clipElement = e.currentTarget as HTMLElement;
    const parentContainer = clipElement.parentElement;
    if (!parentContainer) return;

    const containerWidth = parentContainer.getBoundingClientRect().width;
    const startX = e.clientX;
    const initialStart = clip.start;
    const secondsPerPixel = 60 / (containerWidth || 1);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dt = dx * secondsPerPixel;
      
      // Snap clip start to 0.5s grid for FL Studio-like alignment
      let newStart = Math.max(0, Math.min(60 - clip.duration, initialStart + dt));
      newStart = Math.round(newStart * 2) / 2;

      setTimelineClips(prev =>
        prev.map(c => (c.id === clip.id ? { ...c, start: newStart } : c))
      );
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Microphone recording functions
  const startMicRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setRecordedBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
        
        stream.getTracks().forEach(track => track.stop());
        addCollabLog('Grabadora Mic', `Grabación completada exitosamente.`, 'success');
      };

      setRecordedBlob(null);
      setRecordedUrl(null);
      setMicTimer(0);
      setIsRecordingMic(true);
      mediaRecorder.start();

      micTimerIntervalRef.current = window.setInterval(() => {
        setMicTimer(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error(err);
      addCollabLog('Grabadora Mic', 'Error al acceder al micrófono. Por favor permite los permisos.', 'conflict');
    }
  };

  const stopMicRecording = () => {
    if (mediaRecorderRef.current && isRecordingMic) {
      mediaRecorderRef.current.stop();
      setIsRecordingMic(false);
      if (micTimerIntervalRef.current) {
        clearInterval(micTimerIntervalRef.current);
      }
    }
  };

  const importRecordedClip = async () => {
    if (!recordedBlob) return;
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    
    try {
      const arrayBuffer = await recordedBlob.arrayBuffer();
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);

      const peaks: number[] = [];
      for (let i = 0; i < 20; i++) {
        peaks.push(Math.floor(2 + Math.random() * 8));
      }

      const newClip: TimelineClip = {
        id: `mic-recording-${Date.now()}`,
        name: `Grabación Voces #${timelineClips.length + 1} (Autotune)`,
        trackId: 0,
        start: timelinePlayhead,
        duration: Math.round(decodedBuffer.duration || 5),
        audioBuffer: decodedBuffer,
        color: '#ffea00',
        peaks
      };

      setTimelineClips(prev => [...prev, newClip]);
      setIsAutotuneModalOpen(false);
      setRecordedBlob(null);
      setRecordedUrl(null);
      addCollabLog('Timeline DAW', `Grabación de voz colocada en pista 0 en ${timelinePlayhead.toFixed(1)}s.`, 'success');
    } catch (e) {
      console.error(e);
      addCollabLog('Timeline DAW', 'Error procesando grabación para DAW.', 'conflict');
    }
  };

  // Synchronize Vocal Separator sliders with Web Audio API EQ bands in real-time
  useEffect(() => {
    if (setEqBand) {
      setEqBand(0, (stemBassA - 100) / 10 * 1.5);
      setEqBand(1, (stemDrumsA - 100) / 10 * 1.5);
      setEqBand(2, (stemMelodyA - 100) / 10 * 1.5);
      setEqBand(3, (stemVocalA - 100) / 10 * 1.5);
      setEqBand(4, (stemVocalA - 100) / 10 * 1.5);
    }
  }, [stemVocalA, stemBassA, stemDrumsA, stemMelodyA, setEqBand]);

  // Clean up recording timer on unmount
  useEffect(() => {
    return () => {
      if (micTimerIntervalRef.current) {
        clearInterval(micTimerIntervalRef.current);
      }
    };
  }, []);

  const addCollabLog = (sender: string, message: string, type: 'info' | 'success' | 'warning' | 'conflict') => {
    const time = new Date().toLocaleTimeString();
    const id = `${Date.now()}-${logCounterRef.current++}`;
    setCollabLogs(prev => [{ id, time, sender, message, type }, ...prev.slice(0, 39)]);
  };

  // Draggable Side Panel
  const startResizing = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault();
    setIsDraggingBrowser(true);
  };

  useEffect(() => {
    if (!isDraggingBrowser) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(60, Math.min(500, e.clientX));
      setBrowserWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDraggingBrowser(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingBrowser]);

  // Autotune Canvas visualization sweep
  useEffect(() => {
    if (!isAutotuneModalOpen) return;
    const canvas = pitchCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let x = 0;
    let animFrame: number;

    const draw = () => {
      // Clear slightly for trails effect
      ctx.fillStyle = 'rgba(12, 11, 17, 0.15)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const center = canvas.height / 2;
      // Synthesize raw offset pitch
      const rawOffset = Math.sin(Date.now() / 250) * 30 + (Math.random() - 0.5) * 8;
      // Corrected pitch reduces raw error based on retune speed/depth
      const correctedOffset = rawOffset * (1 - (autotuneDepth / 100) * (1 - retuneSpeed / 200));

      setLivePitch(Math.round(220 + correctedOffset));

      // Draw input pitch line (Red)
      ctx.beginPath();
      ctx.arc(x, center + rawOffset, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();

      // Draw corrected pitch line (Neon Green)
      ctx.beginPath();
      ctx.arc(x, center + correctedOffset, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#39ff14';
      ctx.fill();

      x = (x + 2) % canvas.width;
      animFrame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animFrame);
  }, [isAutotuneModalOpen, autotuneEnabled, autotuneDepth, retuneSpeed]);

  // Audio Upload & Web Audio File decoding
  const handleAudioUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const ctx = audioCtxRef.current;
    const file = files[0];
    addCollabLog('Timeline Decodificador', `Procesando: ${file.name}...`, 'info');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);

      // Generate dummy peaks for visual rendering
      const peaks: number[] = [];
      for (let i = 0; i < 20; i++) {
        peaks.push(Math.floor(2 + Math.random() * 8));
      }

      const newClip: TimelineClip = {
        id: `upload-${Date.now()}`,
        name: file.name,
        trackId: 0, // Vocals track by default
        start: timelinePlayhead,
        duration: Math.round(decodedBuffer.duration),
        audioBuffer: decodedBuffer,
        color: '#ffea00',
        peaks
      };

      setTimelineClips(prev => [...prev, newClip]);
      addCollabLog('Importador', `Archivo ${file.name} decodificado (${newClip.duration}s) y colocado en pista.`, 'success');
    } catch (err) {
      addCollabLog('Timeline Error', 'Error decodificando audio. Comprueba el formato.', 'conflict');
      console.error(err);
    }
  };

  // Timeline playback scheduler
  useEffect(() => {
    if (isTimelinePlaying) {
      timelineIntervalRef.current = window.setInterval(() => {
        setTimelinePlayhead(prev => {
          if (prev >= 60) { // Wrap at 60s max timeline grid for visual demo
            return 0;
          }
          return prev + 0.1;
        });
      }, 100);
    } else {
      if (timelineIntervalRef.current) {
        clearInterval(timelineIntervalRef.current);
      }
    }
    return () => {
      if (timelineIntervalRef.current) clearInterval(timelineIntervalRef.current);
    };
  }, [isTimelinePlaying]);

  // Sync speed changes
  useEffect(() => {
    setAudioPlaybackRate(deckASpeed);
  }, [deckASpeed]);

  // VU Meters Simulation
  useEffect(() => {
    if (!isPlaying) {
      setVuA(0);
      setVuB(0);
      return;
    }
    const timer = setInterval(() => {
      const ratioB = crossfader / 100;
      const ratioA = 1 - ratioB;
      const valA = (0.4 + Math.random() * 0.5) * ratioA * (masterVol / 100);
      const valB = nextTrackInQueue ? (0.4 + Math.random() * 0.5) * ratioB * (masterVol / 100) : 0;
      setVuA(Math.round(valA * 100));
      setVuB(Math.round(valB * 100));
    }, 100);
    return () => clearInterval(timer);
  }, [isPlaying, crossfader, masterVol, nextTrackInQueue]);

  return (
    <div style={{
      backgroundColor: '#0c0b11',
      color: '#cbd5e1',
      minHeight: 'calc(100vh - var(--player-height) - 70px)',
      fontFamily: "'DM Sans', sans-serif",
      display: 'flex',
      overflow: 'hidden',
    }}>
      
      {/* 1. ADAPTIVE SIDE PANEL */}
      <div style={{
        width: `${browserWidth}px`,
        minWidth: `${browserWidth}px`,
        backgroundColor: '#13111c',
        borderRight: '1px solid rgba(255, 255, 255, 0.05)',
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - var(--player-height) - 70px)',
        userSelect: 'none',
      }}>
        <div style={{ padding: browserWidth < 200 ? '12px 8px' : '16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <h2 style={{ fontSize: '14px', fontWeight: 800, color: '#39ff14', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 10px 0', textAlign: browserWidth < 200 ? 'center' : 'left' }}>
            {browserWidth < 200 ? '🎛️' : 'Navegador DJ / DAW'}
          </h2>
          {browserWidth >= 200 && (
            <input
              type="text"
              placeholder="Buscar por BPM / artista..."
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: '#1e1b29',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '12px',
                color: '#fff',
                outline: 'none',
              }}
            />
          )}
        </div>

        {/* Upload Audio Dropzone in Browser panel */}
        <div style={{ padding: browserWidth < 200 ? '10px 6px' : '16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          {browserWidth >= 200 ? (
            <>
              <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#ffea00', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
                Cargar Muestras Locales
              </span>
              <label style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#1e1b29',
                border: '2px dashed rgba(255,255,255,0.15)',
                borderRadius: '8px',
                padding: '16px',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = '#39ff14'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'}
              >
                <span style={{ fontSize: '20px', marginBottom: '4px' }}>📁</span>
                <span style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold' }}>Arrastra o selecciona audio</span>
                <span style={{ fontSize: '9px', color: '#64748b', marginTop: '2px' }}>MP3, WAV, M4A, OGG</span>
                <input type="file" accept="audio/*" onChange={handleAudioUpload} style={{ display: 'none' }} />
              </label>
            </>
          ) : (
            <label style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#1e1b29',
              borderRadius: '6px',
              padding: '8px',
              cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.1)',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a253b'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#1e1b29'}
            title="Cargar Muestras Locales"
            >
              <span style={{ fontSize: '16px' }}>📁</span>
              <input type="file" accept="audio/*" onChange={handleAudioUpload} style={{ display: 'none' }} />
            </label>
          )}
        </div>

        {/* Filter Sliders */}
        {browserWidth >= 200 && (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#ff5500', textTransform: 'uppercase' }}>Filtros de Tonalidad</span>
            
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>
                <span>BPM mínimo</span>
                <span>{searchBpm} BPM</span>
              </div>
              <input
                type="range"
                min="80"
                max="160"
                value={searchBpm}
                onChange={(e) => setSearchBpm(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: '#ff5500' }}
              />
            </div>
          </div>
        )}

        {/* Dynamic Queue & Browser database tree */}
        <div style={{ flex: 1, overflowY: 'auto', padding: browserWidth < 200 ? '10px 4px' : '16px' }}>
          <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#00ffcc', textTransform: 'uppercase', display: 'block', marginBottom: '8px', textAlign: browserWidth < 200 ? 'center' : 'left' }}>
            {browserWidth < 200 ? '🎵' : 'Librería de Pistas'}
          </span>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: browserWidth < 200 ? 'center' : 'stretch' }}>
            {queue.map((track, idx) => {
              const bpmVal = 120 + idx * 4;
              if (browserWidth < 200) {
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      const newClip: TimelineClip = {
                        id: `track-clip-${idx}-${Date.now()}`,
                        name: track.title,
                        trackId: 1,
                        start: Math.round(timelinePlayhead),
                        duration: 20,
                        color: '#00e5ff',
                        peaks: [5, 3, 7, 8, 4, 3, 6, 8, 4, 5, 7, 3, 8]
                      };
                      setTimelineClips(prev => [...prev, newClip]);
                      addCollabLog('Navegador', `Añadido clip: "${track.title}" a la Línea de Tiempo`, 'success');
                    }}
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: '#1e1b29',
                      border: '1px solid #00e5ff',
                      color: '#fff',
                      fontSize: '11px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      transition: 'transform 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    title={`${track.title} (BPM: ${bpmVal}) - Clic para añadir`}
                  >
                    🎵
                  </button>
                );
              }

              return (
                <div
                  key={idx}
                  onClick={() => {
                    // Place clip onto the DAW timeline
                    const newClip: TimelineClip = {
                      id: `track-clip-${idx}-${Date.now()}`,
                      name: track.title,
                      trackId: 1, // beats track
                      start: Math.round(timelinePlayhead),
                      duration: 20,
                      color: '#00e5ff',
                      peaks: [5, 3, 7, 8, 4, 3, 6, 8, 4, 5, 7, 3, 8]
                    };
                    setTimelineClips(prev => [...prev, newClip]);
                    addCollabLog('Navegador', `Añadido clip: "${track.title}" a la Línea de Tiempo`, 'success');
                  }}
                  style={{
                    backgroundColor: '#1e1b29',
                    borderRadius: '6px',
                    padding: '8px 10px',
                    cursor: 'pointer',
                    borderLeft: '3px solid #00e5ff',
                    transition: 'transform 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'translateX(4px)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'translateX(0px)'}
                  title="Haz clic para añadir este audio a la línea de tiempo"
                >
                  <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#fff', display: 'block', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {track.title}
                  </span>
                  <span style={{ fontSize: '9px', color: '#94a3b8' }}>BPM: {bpmVal}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* DRAG RESIZER SPLITTER */}
      <div
        onMouseDown={startResizing}
        style={{
          width: '6px',
          cursor: 'col-resize',
          backgroundColor: isDraggingBrowser ? '#39ff14' : 'transparent',
          borderLeft: '1px solid rgba(255, 255, 255, 0.05)',
          borderRight: '1px solid rgba(255, 255, 255, 0.05)',
          zIndex: 10,
          transition: 'background-color 0.2s'
        }}
      ></div>

      {/* 2. MAIN WORKSPACE */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - var(--player-height) - 70px)',
        overflowY: 'auto',
      }}>
        
        {/* TOP VIEW TABS SELECTOR & CONTROLS */}
        <div style={{
          backgroundColor: '#13111c',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          padding: '12px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px'
        }}>
          {/* Mode Switcher */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setActiveView('dj')}
              style={{
                backgroundColor: activeView === 'dj' ? '#39ff14' : '#1e1b29',
                color: activeView === 'dj' ? '#000' : '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '12px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: activeView === 'dj' ? '0 0 10px rgba(57,255,20,0.3)' : 'none',
              }}
            >
              🎛️ Vista Consola DJ
            </button>
            <button
              onClick={() => setActiveView('timeline')}
              style={{
                backgroundColor: activeView === 'timeline' ? '#39ff14' : '#1e1b29',
                color: activeView === 'timeline' ? '#000' : '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '12px',
                fontWeight: 'bold',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: activeView === 'timeline' ? '0 0 10px rgba(57,255,20,0.3)' : 'none',
              }}
            >
              🎹 Editor DAW Multipista
            </button>
          </div>

          {/* Record & Master BPM */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button
              onClick={() => {
                setIsRecording(!isRecording);
                setRecordingSeconds(0);
                addCollabLog('Grabadora', isRecording ? 'Grabación finalizada.' : 'Grabando sesión.', 'warning');
              }}
              style={{
                backgroundColor: isRecording ? '#ef4444' : '#221f30',
                border: '1px solid #ef4444',
                color: '#fff',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '11px',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer'
              }}
            >
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: '#fff',
                display: 'inline-block',
                animation: isRecording ? 'pulse 1s infinite' : 'none'
              }}></span>
              {isRecording ? `REC ${Math.floor(recordingSeconds/60)}:${(recordingSeconds%60).toString().padStart(2,'0')}` : 'RECORD MIX'}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#09080e', borderRadius: '6px', padding: '4px 12px', border: '1.5px solid #2e2a42' }}>
              <span style={{ fontSize: '10px', color: '#ff5500', fontWeight: 'bold' }}>MASTER BPM</span>
              <button
                onClick={() => {
                  setMasterBpm(prev => Math.max(60, prev - 1));
                  setDeckABpm(prev => Math.max(60, prev - 1));
                  setDeckBBpm(prev => Math.max(60, prev - 1));
                }}
                style={{ backgroundColor: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
              >
                ◀
              </button>
              <span style={{ fontFamily: 'monospace', fontSize: '16px', color: '#39ff14', fontWeight: 'bold', minWidth: '60px', textAlign: 'center' }}>
                {masterBpm.toFixed(2)}
              </span>
              <button
                onClick={() => {
                  setMasterBpm(prev => Math.min(220, prev + 1));
                  setDeckABpm(prev => Math.min(220, prev + 1));
                  setDeckBBpm(prev => Math.min(220, prev + 1));
                }}
                style={{ backgroundColor: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
              >
                ▶
              </button>
            </div>
          </div>
        </div>

        {/* WINDOW 1: DJ DECK CONSOLE VIEW */}
        {activeView === 'dj' && (
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Professional Decks + Mixer */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 300px 1fr',
              gap: '16px',
              alignItems: 'stretch'
            }}>
              {/* DECK A */}
              <div style={{
                backgroundColor: '#13111c',
                border: '1.5px solid #2e2a42',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: '9px', fontWeight: 'bold', backgroundColor: '#39ff14', color: '#000', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase' }}>
                      Deck A
                    </span>
                    <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#fff', margin: '6px 0 2px' }}>
                      {currentTrack?.title || 'Sin pista cargada'}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <p style={{ fontSize: '11px', color: '#94a3b8', margin: 0 }}>{currentTrack?.artist || 'Cola vacía'}</p>
                      <select
                        value={deckAKey}
                        onChange={(e) => setDeckAKey(e.target.value)}
                        style={{ backgroundColor: '#1e1b29', color: '#39ff14', border: '1px solid #2e2a42', borderRadius: '4px', fontSize: '9px', padding: '1px 4px', cursor: 'pointer' }}
                      >
                        {['1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A'].map(k => (
                          <option key={k} value={k}>{k}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: '18px', color: '#39ff14', fontWeight: 'bold' }}>
                    {deckABpm.toFixed(1)} <span style={{ fontSize: '9px', color: '#64748b' }}>BPM</span>
                  </span>
                </div>

                {/* Waveform */}
                <div style={{
                  height: '70px',
                  backgroundColor: '#09080e',
                  border: '1.5px solid #2e2a42',
                  borderRadius: '6px',
                  margin: '16px 0',
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  <div style={{ display: 'flex', gap: '2px', width: '100%', padding: '0 10px', transform: isPlaying ? `translateX(-${(progress % 10) * 10}px)` : 'none', transition: 'transform 0.1s linear' }}>
                    {[4,2,3,6,7,9,4,3,2,6,8,9,5,4,2,5,7,8,4,3,2,6,7,9,4,3,2,6,8,9,5,4].map((val, idx) => (
                      <div key={idx} style={{ width: '4px', height: `${val * 6}px`, backgroundColor: '#39ff14', borderRadius: '2px' }}></div>
                    ))}
                  </div>
                  <div style={{ position: 'absolute', left: '50%', width: '2px', height: '100%', backgroundColor: '#fff', boxShadow: '0 0 10px #39ff14' }}></div>
                </div>

                {/* Pitch Slider */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b' }}>
                    <span>PITCH SLIDER A</span>
                    <span style={{ color: '#39ff14' }}>{((deckASpeed - 1) * 100).toFixed(1)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.9"
                    max="1.1"
                    step="0.005"
                    value={deckASpeed}
                    onChange={(e) => {
                      const speed = parseFloat(e.target.value);
                      setDeckASpeed(speed);
                      setDeckABpm(128 * speed);
                    }}
                    style={{ width: '100%', accentColor: '#39ff14' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setIsPlaying(!isPlaying)} style={{ flex: 1, backgroundColor: '#39ff14', color: '#000', border: 'none', borderRadius: '6px', padding: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                    {isPlaying ? 'PAUSE' : 'PLAY'}
                  </button>
                  <button onClick={() => seekAudio(0)} style={{ backgroundColor: '#221f30', color: '#fff', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer' }}>CUE</button>
                </div>
              </div>

              {/* MIXER */}
              <div style={{
                backgroundColor: '#13111c',
                border: '1.5px solid #2e2a42',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}>
                <span style={{ fontSize: '11px', fontWeight: 800, color: '#94a3b8', display: 'block', textAlign: 'center' }}>DJ MIXER CHANNEL</span>
                
                {/* Double 3-Band EQ Columns */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', margin: '8px 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '8px', color: '#39ff14', fontWeight: 'bold', textAlign: 'center' }}>EQ DECK A</span>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '8px', color: '#64748b' }}>LOW: {eqLowA}dB</span>
                      <input type="range" min="-12" max="12" value={eqLowA} onChange={(e) => { setEqLowA(parseFloat(e.target.value)); setEqBand(0, parseFloat(e.target.value)); }} style={{ width: '100%', accentColor: '#39ff14' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '8px', color: '#64748b' }}>MID: {eqMidA}dB</span>
                      <input type="range" min="-12" max="12" value={eqMidA} onChange={(e) => { setEqMidA(parseFloat(e.target.value)); setEqBand(2, parseFloat(e.target.value)); }} style={{ width: '100%', accentColor: '#ffea00' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '8px', color: '#64748b' }}>HI: {eqHighA}dB</span>
                      <input type="range" min="-12" max="12" value={eqHighA} onChange={(e) => { setEqHighA(parseFloat(e.target.value)); setEqBand(4, parseFloat(e.target.value)); }} style={{ width: '100%', accentColor: '#00ffcc' }} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ fontSize: '8px', color: '#ff5500', fontWeight: 'bold', textAlign: 'center' }}>EQ DECK B</span>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '8px', color: '#64748b' }}>LOW: {eqLowB}dB</span>
                      <input type="range" min="-12" max="12" value={eqLowB} onChange={(e) => setEqLowB(parseFloat(e.target.value))} style={{ width: '100%', accentColor: '#ff5500' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '8px', color: '#64748b' }}>MID: {eqMidB}dB</span>
                      <input type="range" min="-12" max="12" value={eqMidB} onChange={(e) => setEqMidB(parseFloat(e.target.value))} style={{ width: '100%', accentColor: '#ffea00' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '8px', color: '#64748b' }}>HI: {eqHighB}dB</span>
                      <input type="range" min="-12" max="12" value={eqHighB} onChange={(e) => setEqHighB(parseFloat(e.target.value))} style={{ width: '100%', accentColor: '#00ffcc' }} />
                    </div>
                  </div>
                </div>

                {/* Master Volume Control */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#94a3b8' }}>
                    <span>VOL MASTER</span>
                    <span>{masterVol}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={masterVol}
                    onChange={(e) => setMasterVol(parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: '#39ff14' }}
                  />
                </div>

                {/* VU Meter */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', height: '30px', backgroundColor: '#09080e', borderRadius: '6px', padding: '4px' }}>
                  <div style={{ width: '8px', height: '100%', backgroundColor: '#000', position: 'relative' }}>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${vuA}%`, backgroundColor: '#39ff14' }}></div>
                  </div>
                  <div style={{ width: '8px', height: '100%', backgroundColor: '#000', position: 'relative' }}>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${vuB}%`, backgroundColor: '#39ff14' }}></div>
                  </div>
                </div>

                {/* Crossfader */}
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={crossfader}
                  onChange={(e) => setCrossfader(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: '#ff5500', cursor: 'pointer', marginTop: '10px' }}
                />
              </div>

              {/* DECK B */}
              <div style={{
                backgroundColor: '#13111c',
                border: '1.5px solid #2e2a42',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: '9px', fontWeight: 'bold', backgroundColor: '#ff5500', color: '#000', padding: '2px 6px', borderRadius: '4px', textTransform: 'uppercase' }}>
                      Deck B
                    </span>
                    <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#fff', margin: '6px 0 2px' }}>
                      {nextTrackInQueue?.title || 'Sin pista cargada'}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <p style={{ fontSize: '11px', color: '#94a3b8', margin: 0 }}>{nextTrackInQueue?.artist || 'Cola vacía'}</p>
                      <select
                        value={deckBKey}
                        onChange={(e) => setDeckBKey(e.target.value)}
                        style={{ backgroundColor: '#1e1b29', color: '#ff5500', border: '1px solid #2e2a42', borderRadius: '4px', fontSize: '9px', padding: '1px 4px', cursor: 'pointer' }}
                      >
                        {['1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A'].map(k => (
                          <option key={k} value={k}>{k}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: '18px', color: '#ff5500', fontWeight: 'bold' }}>
                    {deckBBpm.toFixed(1)} <span style={{ fontSize: '9px', color: '#64748b' }}>BPM</span>
                  </span>
                </div>

                {/* Waveform */}
                <div style={{
                  height: '70px',
                  backgroundColor: '#09080e',
                  border: '1.5px solid #2e2a42',
                  borderRadius: '6px',
                  margin: '16px 0',
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center'
                }}>
                  <div style={{ display: 'flex', gap: '2px', width: '100%', padding: '0 10px', transform: isPlaying ? `translateX(-${(progress % 8) * 8}px)` : 'none', transition: 'transform 0.15s linear' }}>
                    {[2,6,8,9,5,4,2,5,7,8,6,3,1,2,4,2,3,6,7,9,4,3,2,6].map((val, idx) => (
                      <div key={idx} style={{ width: '4px', height: `${val * 6}px`, backgroundColor: '#ff5500', borderRadius: '2px' }}></div>
                    ))}
                  </div>
                  <div style={{ position: 'absolute', left: '50%', width: '2px', height: '100%', backgroundColor: '#fff', boxShadow: '0 0 10px #ff5500' }}></div>
                </div>

                {/* Pitch Slider */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b' }}>
                    <span>PITCH SLIDER B</span>
                    <span style={{ color: '#ff5500' }}>{((deckBSpeed - 1) * 100).toFixed(1)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.9"
                    max="1.1"
                    step="0.005"
                    value={deckBSpeed}
                    onChange={(e) => {
                      const speed = parseFloat(e.target.value);
                      setDeckBSpeed(speed);
                      setDeckBBpm(124 * speed);
                    }}
                    style={{ width: '100%', accentColor: '#ff5500' }}
                  />
                </div>

                <button onClick={() => nextTrack()} style={{ width: '100%', backgroundColor: '#ff5500', color: '#000', border: 'none', borderRadius: '6px', padding: '8px', fontWeight: 'bold', cursor: 'pointer' }}>
                  SKIP TO DECK B
                </button>
              </div>
            </div>

            {/* Realtime Stems separation */}
            <div style={{
              backgroundColor: '#13111c',
              border: '1.5px solid #2e2a42',
              borderRadius: '12px',
              padding: '16px',
            }}>
              <h3 style={{ fontSize: '13px', fontWeight: 800, color: '#39ff14', textTransform: 'uppercase', marginBottom: '12px' }}>
                Separador Vocal y Stems en Directo
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px' }}>
                {[
                  { name: 'VOCALES', val: stemVocalA, set: setStemVocalA, color: '#39ff14' },
                  { name: 'BASS (BAJO)', val: stemBassA, set: setStemBassA, color: '#00e5ff' },
                  { name: 'DRUMS (BATERÍA)', val: stemDrumsA, set: setStemDrumsA, color: '#ffea00' },
                  { name: 'MELODY (MELODÍA)', val: stemMelodyA, set: setStemMelodyA, color: '#ff5500' }
                ].map((s) => (
                  <div key={s.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: '#09080e', padding: '10px', borderRadius: '6px' }}>
                    <span style={{ fontSize: '10px', color: '#cbd5e1', marginBottom: '4px' }}>{s.name}</span>
                    <input type="range" min="0" max="100" value={s.val} onChange={(e) => s.set(parseInt(e.target.value))} style={{ width: '100%', accentColor: s.color }} />
                    <span style={{ fontSize: '10px', color: s.color, marginTop: '4px' }}>{s.val}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Performance Pads */}
            <div style={{
              backgroundColor: '#13111c',
              border: '1.5px solid #2e2a42',
              borderRadius: '12px',
              padding: '16px',
            }}>
              <span style={{ fontSize: '13px', fontWeight: 800, color: '#ffea00', display: 'block', marginBottom: '10px' }}>Pads de Efectos 4x4</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '10px' }}>
                {[...Array(16)].map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => playPadSound(idx)}
                    style={{
                      aspectRatio: '1.5/1',
                      backgroundColor: triggeredPad === idx ? '#39ff14' : '#1e1b29',
                      border: '2.5px solid #2e2a42',
                      borderRadius: '6px',
                      color: triggeredPad === idx ? '#000' : '#cbd5e1',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    PAD {idx + 1}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* WINDOW 2: DAW MULTITRACK TIMELINE STUDIO VIEW */}
        {activeView === 'timeline' && (
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* AUTOTUNE POPUP TRIGGER BUTTON */}
            <div style={{
              backgroundColor: '#13111c',
              border: '1.5px solid #2e2a42',
              borderRadius: '12px',
              padding: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
              background: 'linear-gradient(135deg, #13111c 0%, #1e1b29 100%)'
            }}>
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#39ff14', textTransform: 'uppercase', margin: '0 0 4px 0', letterSpacing: '0.5px' }}>
                  🎙️ Procesador Vocal & Autotune Móvil
                </h3>
                <p style={{ fontSize: '11px', color: '#94a3b8', margin: 0 }}>
                  Graba tu propia voz en tiempo real, aplica corrección de tono (Autotune) y colócalo directamente en la timeline de tu DAW.
                </p>
              </div>
              <button
                onClick={() => setIsAutotuneModalOpen(true)}
                style={{
                  backgroundColor: '#39ff14',
                  color: '#000',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '10px 20px',
                  fontSize: '12px',
                  fontWeight: 900,
                  cursor: 'pointer',
                  boxShadow: '0 0 15px rgba(57,255,20,0.4)',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.05)';
                  e.currentTarget.style.boxShadow = '0 0 20px rgba(57,255,20,0.6)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = '0 0 15px rgba(57,255,20,0.4)';
                }}
              >
                🎤 GRABAR VOZ CON AUTOTUNE
              </button>
            </div>

            {/* INTERACTIVE MULTITRACK DAW EDITOR TIMELINE */}
            <div style={{
              backgroundColor: '#13111c',
              border: '1.5px solid #2e2a42',
              borderRadius: '12px',
              padding: '16px',
              boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
            }}>
              
              {/* DAW Transport bar */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
                backgroundColor: '#09080e',
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #2e2a42'
              }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button
                    onClick={() => setIsTimelinePlaying(!isTimelinePlaying)}
                    style={{
                      backgroundColor: isTimelinePlaying ? '#ef4444' : '#39ff14',
                      color: '#000',
                      border: 'none',
                      padding: '6px 14px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    {isTimelinePlaying ? '⏹️ DETENER DAW' : '▶️ REPRODUCIR DAW'}
                  </button>

                  <button
                    onClick={() => { setTimelinePlayhead(0); setIsTimelinePlaying(false); }}
                    style={{
                      backgroundColor: '#221f30',
                      color: '#fff',
                      border: '1.5px solid #2e2a42',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      cursor: 'pointer'
                    }}
                  >
                    ↩️ Reiniciar
                  </button>

                  {/* Playhead Time read-out */}
                  <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#ffea00', fontWeight: 'bold' }}>
                    Tiempo: {timelinePlayhead.toFixed(1)}s / 60.0s
                  </span>
                </div>

                <div style={{ fontSize: '11px', color: '#64748b' }}>
                  💡 <span style={{ color: '#94a3b8' }}>Haz clic en un clip para seleccionarlo, arrástralo horizontalmente o elimínalo.</span>
                </div>
              </div>

              {/* Multitrack container */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                backgroundColor: '#09080e',
                borderRadius: '8px',
                padding: '12px',
                border: '1.5px solid #2e2a42',
                position: 'relative'
              }}>
                
                {/* Horizontal scale ruler ticks */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '150px 1fr',
                  borderBottom: '1.5px solid #2e2a42',
                  paddingBottom: '6px',
                  fontSize: '9px',
                  color: '#64748b',
                  fontFamily: 'monospace'
                }}>
                  <span>Pista</span>
                  <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative' }}>
                    <span>0:00s</span>
                    <span>0:15s</span>
                    <span>0:30s</span>
                    <span>0:45s</span>
                    <span>1:00s</span>
                  </div>
                </div>

                {/* Multitrack Playhead Line Overlay */}
                <div style={{
                  position: 'absolute',
                  top: '40px',
                  bottom: '12px',
                  left: `calc(150px + (100% - 174px) * (${timelinePlayhead} / 60))`,
                  width: '2px',
                  backgroundColor: '#fff',
                  boxShadow: '0 0 10px #39ff14',
                  zIndex: 10,
                  pointerEvents: 'none',
                  transition: 'left 0.1s linear'
                }}></div>

                {/* Tracks Rows */}
                {timelineTracks.map(track => {
                  // Find clips belonging to this track
                  const trackClips = timelineClips.filter(c => c.trackId === track.id);

                  return (
                    <div
                      key={track.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '150px 1fr',
                        height: '50px',
                        alignItems: 'center',
                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                        position: 'relative'
                      }}
                    >
                      {/* Track Controls */}
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        borderRight: '1.5px solid #2e2a42',
                        height: '100%',
                        paddingRight: '8px'
                      }}>
                        <span style={{ fontSize: '11px', fontWeight: 'bold', color: '#fff', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {track.name}
                        </span>
                        <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                          <button
                            onClick={() => {
                              setTimelineTracks(prev => prev.map(t => t.id === track.id ? { ...t, muted: !t.muted } : t));
                              addCollabLog('DAW Mezclador', `${track.name} ${track.muted ? 'Desmutada' : 'Mutada'}.`, 'info');
                            }}
                            style={{
                              backgroundColor: track.muted ? '#ef4444' : '#221f30',
                              border: 'none',
                              color: '#fff',
                              fontSize: '9px',
                              padding: '2px 6px',
                              borderRadius: '3px',
                              cursor: 'pointer'
                            }}
                          >
                            Mute
                          </button>
                          <button
                            onClick={() => {
                              setTimelineTracks(prev => prev.map(t => t.id === track.id ? { ...t, solo: !t.solo } : t));
                            }}
                            style={{
                              backgroundColor: track.solo ? '#ffea00' : '#221f30',
                              color: track.solo ? '#000' : '#fff',
                              border: 'none',
                              fontSize: '9px',
                              padding: '2px 6px',
                              borderRadius: '3px',
                              cursor: 'pointer'
                            }}
                          >
                            Solo
                          </button>
                        </div>
                      </div>

                      {/* Track Timeline Area (Horizontal) */}
                      <div style={{
                        position: 'relative',
                        height: '100%',
                        backgroundColor: 'rgba(255,255,255,0.01)',
                      }}>
                        {trackClips.map(clip => {
                          const leftPct = (clip.start / 60) * 100;
                          const widthPct = (clip.duration / 60) * 100;
                          const isSelected = selectedClipId === clip.id;

                          return (
                            <div
                              key={clip.id}
                              onMouseDown={(e) => handleClipMouseDown(e, clip)}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedClipId(clip.id);
                              }}
                              style={{
                                position: 'absolute',
                                left: `${leftPct}%`,
                                width: `${widthPct}%`,
                                height: '36px',
                                top: '7px',
                                backgroundColor: clip.color,
                                border: `2px solid ${isSelected ? '#fff' : clip.color}`,
                                borderRadius: '4px',
                                opacity: track.muted ? 0.25 : 0.8,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'space-between',
                                padding: '4px',
                                cursor: 'grab',
                                zIndex: isSelected ? 5 : 2,
                                boxShadow: isSelected ? '0 0 12px rgba(255,255,255,0.4)' : 'none',
                                userSelect: 'none'
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', fontWeight: 'bold', color: '#000' }}>
                                <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '85%' }}>
                                  {clip.name}
                                </span>
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTimelineClips(prev => prev.filter(c => c.id !== clip.id));
                                    setSelectedClipId(null);
                                    addCollabLog('Editor', `Clip "${clip.name}" eliminado de la línea de tiempo.`, 'warning');
                                  }}
                                  style={{ cursor: 'pointer', padding: '0 2px', color: '#ef4444' }}
                                  title="Eliminar clip"
                                >
                                  ✕
                                </span>
                              </div>

                              {/* Tiny Waveform peaks inside clip block */}
                              <div style={{ display: 'flex', gap: '1px', alignItems: 'center', height: '12px' }}>
                                {(clip.peaks || [3, 5, 2, 7, 6, 8, 4, 3]).map((p, pIdx) => (
                                  <div
                                    key={pIdx}
                                    style={{
                                      flex: 1,
                                      height: `${(p / 10) * 100}%`,
                                      backgroundColor: '#000',
                                      borderRadius: '1px',
                                      opacity: 0.6
                                    }}
                                  ></div>
                                ))}
                              </div>

                              {/* Drag adjustment controls */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '7px', color: '#000', opacity: 0.7 }}>
                                <span>Start: {clip.start}s</span>
                                <span
                                  style={{ cursor: 'ew-resize', fontWeight: 'bold' }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const offset = prompt('Ingresa el nuevo tiempo de inicio (en segundos, 0-60):', clip.start.toString());
                                    if (offset !== null) {
                                      const newStart = Math.max(0, Math.min(60 - clip.duration, parseFloat(offset) || 0));
                                      setTimelineClips(prev => prev.map(c => c.id === clip.id ? { ...c, start: newStart } : c));
                                    }
                                  }}
                                >
                                  Posicionar ⬌
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* SINFONIA CONCURRENCY RESOLVER CONSOLE */}
        <div style={{
          padding: '0 20px 20px 20px'
        }}>
          <div style={{
            backgroundColor: '#13111c',
            border: '1.5px solid #2e2a42',
            borderRadius: '12px',
            padding: '16px',
            boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                <span style={{ fontSize: '13px', fontWeight: 800, color: '#39ff14', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Sinfonía Live Engine & Conflict Monitor
                </span>
                <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '2px' }}>
                  Prevención y registro de condiciones de carrera en directo para la línea de tiempo colaborativa.
                </span>
              </div>
              <button
                onClick={() => {
                  addCollabLog('Sinfonía', 'Enviando actualización de posición de clip a los peers...', 'info');
                  setTimeout(() => addCollabLog('Sinfonía Engine', 'Conflicto detectado: Otro usuario movió el mismo clip simultáneamente.', 'conflict'), 600);
                  setTimeout(() => addCollabLog('Sinfonía Resolver', 'Sincronización forzada mediante marca de tiempo (Timestamp priority).', 'success'), 1200);
                }}
                style={{
                  backgroundColor: 'rgba(57,255,20,0.1)',
                  border: '1px solid #39ff14',
                  color: '#39ff14',
                  borderRadius: '4px',
                  padding: '6px 12px',
                  fontSize: '11px',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Simular Conflicto Colaborativo
              </button>
            </div>

            <div style={{
              backgroundColor: '#09080e',
              border: '1px solid #2e2a42',
              borderRadius: '6px',
              padding: '12px',
              height: '90px',
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: '11px',
              lineHeight: '1.5'
            }}>
              {collabLogs.length === 0 ? (
                <div style={{ color: '#475569', fontStyle: 'italic', textAlign: 'center', paddingTop: '20px' }}>
                  Listo para recibir eventos colaborativos en directo...
                </div>
              ) : (
                collabLogs.map(log => {
                  let color = '#cbd5e1';
                  if (log.type === 'success') color = '#39ff14';
                  else if (log.type === 'warning') color = '#ffea00';
                  else if (log.type === 'conflict') color = '#ef4444';
                  return (
                    <div key={log.id} style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.02)', padding: '2px 0' }}>
                      <span style={{ color: '#475569' }}>[{log.time}]</span>
                      <span style={{ color: '#ff5500', fontWeight: 'bold' }}>{log.sender}:</span>
                      <span style={{ color }}>{log.message}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>

      {/* 4. AUTOTUNE POPUP MODAL */}
      {isAutotuneModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          backgroundColor: 'rgba(5, 4, 8, 0.85)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            width: '560px',
            backgroundColor: '#13111c',
            border: '2px solid #2e2a42',
            borderRadius: '16px',
            padding: '24px',
            boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            color: '#fff',
            fontFamily: "'DM Sans', sans-serif"
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, flex: 1, fontSize: '15px', fontWeight: 900, color: '#39ff14', display: 'flex', alignItems: 'center', gap: '8px', letterSpacing: '0.5px' }}>
                🎙️ ESTUDIO DE GRABACIÓN VOCAL & KOKOTUNE FX
              </h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#cbd5e1', cursor: 'pointer', marginRight: '12px' }}>
                <input
                  type="checkbox"
                  checked={autotuneEnabled}
                  onChange={(e) => setAutotuneEnabled(e.target.checked)}
                  style={{ accentColor: '#39ff14' }}
                />
                Activar Autotune
              </label>
              <button
                onClick={() => {
                  stopMicRecording();
                  setIsAutotuneModalOpen(false);
                }}
                style={{
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '18px',
                  cursor: 'pointer',
                  padding: '4px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#94a3b8'}
              >
                ✕
              </button>
            </div>

            {/* Top Config Row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              backgroundColor: '#1b1926',
              padding: '12px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.04)'
            }}>
              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>ESCALA MUSICAL</label>
                <select
                  value={autotuneScale}
                  onChange={(e: any) => setAutotuneScale(e.target.value)}
                  style={{
                    width: '100%',
                    backgroundColor: '#12101a',
                    border: '1px solid #2e2a42',
                    color: '#fff',
                    borderRadius: '6px',
                    padding: '8px',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                >
                  <option value="major">Escala Mayor (Natural)</option>
                  <option value="minor">Escala Menor (Melódica)</option>
                  <option value="chromatic">Cromática (Completa)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginBottom: '6px', fontWeight: 'bold' }}>TONO BASE (KEY)</label>
                <select
                  value={autotuneKey}
                  onChange={(e) => setAutotuneKey(e.target.value)}
                  style={{
                    width: '100%',
                    backgroundColor: '#12101a',
                    border: '1px solid #2e2a42',
                    color: '#fff',
                    borderRadius: '6px',
                    padding: '8px',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                >
                  {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(k => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Sliders Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#cbd5e1', marginBottom: '6px' }}>
                  <span>Velocidad de Retune</span>
                  <span style={{ color: '#39ff14', fontWeight: 'bold' }}>{retuneSpeed} ms</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={retuneSpeed}
                  onChange={(e) => setRetuneSpeed(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: '#39ff14' }}
                />
                <span style={{ fontSize: '9px', color: '#64748b', display: 'block', marginTop: '2px' }}>0ms (Efecto Robot) → 100ms (Natural)</span>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#cbd5e1', marginBottom: '6px' }}>
                  <span>Profundidad (Depth)</span>
                  <span style={{ color: '#39ff14', fontWeight: 'bold' }}>{autotuneDepth}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={autotuneDepth}
                  onChange={(e) => setAutotuneDepth(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: '#39ff14' }}
                />
                <span style={{ fontSize: '9px', color: '#64748b', display: 'block', marginTop: '2px' }}>Intensidad de la corrección tonal</span>
              </div>
            </div>

            {/* Realtime Graph */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginBottom: '6px' }}>
                <span>Visualizador de Corrección Tonal</span>
                <span>Frecuencia estimada: <span style={{ color: '#39ff14', fontWeight: 'bold' }}>{livePitch} Hz</span></span>
              </div>
              <div style={{
                height: '110px',
                backgroundColor: '#09080e',
                border: '1px solid #2e2a42',
                borderRadius: '8px',
                position: 'relative'
              }}>
                <canvas
                  ref={pitchCanvasRef}
                  width={510}
                  height={110}
                  style={{ width: '100%', height: '100%', display: 'block', borderRadius: '7px' }}
                />
                <div style={{ display: 'flex', gap: '10px', position: 'absolute', bottom: '6px', right: '10px', fontSize: '9px' }}>
                  <span style={{ color: '#ef4444' }}>● Original</span>
                  <span style={{ color: '#39ff14' }}>● Autotune</span>
                </div>
              </div>
            </div>

            {/* Mic recording / controls */}
            <div style={{
              backgroundColor: '#1b1926',
              padding: '16px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.04)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px'
            }}>
              {!isRecordingMic ? (
                <button
                  onClick={startMicRecording}
                  style={{
                    backgroundColor: '#ef4444',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '10px 20px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    boxShadow: '0 0 15px rgba(239,68,68,0.4)',
                    transition: 'transform 0.2s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.03)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  🔴 EMPEZAR GRABACIÓN
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: '#ef4444',
                      display: 'inline-block',
                      animation: 'pulse 1s infinite'
                    }} />
                    <span style={{ fontSize: '14px', fontWeight: 'bold', color: '#ef4444', fontFamily: 'monospace' }}>
                      GRABANDO: {micTimer}s
                    </span>
                  </div>
                  <button
                    onClick={stopMicRecording}
                    style={{
                      backgroundColor: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '10px 20px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      animation: 'pulse 1.5s infinite'
                    }}
                  >
                    ⏹️ DETENER GRABACIÓN
                  </button>
                </div>
              )}

              {/* Recorded preview */}
              {recordedUrl && (
                <div style={{ width: '100%', marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 'bold', textTransform: 'uppercase' }}>
                    Vista Previa del Audio Grabado:
                  </div>
                  <audio src={recordedUrl} controls style={{ width: '100%' }} />
                  <button
                    onClick={importRecordedClip}
                    style={{
                      backgroundColor: '#39ff14',
                      color: '#000',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '10px 16px',
                      fontSize: '12px',
                      fontWeight: 900,
                      cursor: 'pointer',
                      boxShadow: '0 0 10px rgba(57,255,20,0.3)',
                      transition: 'transform 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    🎹 IMPORTAR A LA LÍNEA DE TIEMPO DAW
                  </button>
                </div>
              )}
            </div>

            {/* Cancel Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '12px' }}>
              <button
                onClick={() => {
                  stopMicRecording();
                  setIsAutotuneModalOpen(false);
                }}
                style={{
                  backgroundColor: '#221f30',
                  color: '#94a3b8',
                  border: '1.5px solid #2e2a42',
                  borderRadius: '6px',
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2d2940'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#221f30'}
              >
                Cerrar Estudio Vocal
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0% { opacity: 0.5; }
          50% { opacity: 1; }
          100% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
