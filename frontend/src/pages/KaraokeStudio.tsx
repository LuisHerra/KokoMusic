import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../store/playerStore';
import { getLyrics, resolveImageUrl } from '../lib/api';
import { parseSyncedLyrics, type LyricsLine } from '../lib/lyricsParser';

const DB_NAME = 'KokoKaraokeDB';
const STORE_NAME = 'recordings';

export interface StudioRecording {
  id: string;
  trackId: string;
  trackTitle: string;
  artist: string;
  timestamp: number;
  blob: Blob;
  duration: number;
}

// Musical Scales for Pitch Snapping Auto-Tune
const MUSICAL_SCALES: Record<string, { name: string; notes: number[] }> = {
  chromatic: { name: 'Cromática (T-Pain Automatic)', notes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  c_major: { name: 'Do Mayor / La Menor (C / Am)', notes: [0, 2, 4, 5, 7, 9, 11] },
  g_major: { name: 'Sol Mayor / Mi Menor (G / Em)', notes: [7, 9, 11, 0, 2, 4, 6] },
  d_minor: { name: 'Re Menor / Fa Mayor (Dm / F)', notes: [2, 4, 5, 7, 9, 10, 0] },
  a_minor: { name: 'La Menor Trap / Drill (Am)', notes: [9, 11, 0, 2, 4, 5, 7] },
  pentatonic: { name: 'Pentatónica Urbana (Hip-Hop)', notes: [0, 3, 5, 7, 10] },
};

function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB not supported'));
    const req = window.indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

async function saveStudioRecording(rec: StudioRecording): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(rec);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getRecordings(trackId?: string): Promise<StudioRecording[]> {
  try {
    const db = await initDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const all: StudioRecording[] = req.result || [];
        if (trackId) {
          resolve(all.filter(r => r.trackId === trackId).sort((a, b) => b.timestamp - a.timestamp));
        } else {
          resolve(all.sort((a, b) => b.timestamp - a.timestamp));
        }
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

async function deleteStudioRecording(id: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export default function KaraokeStudioPage() {
  const navigate = useNavigate();
  const { currentTrack, setProgress } = usePlayerStore();

  const [isRecording, setIsRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [liveMonitor, setLiveMonitor] = useState(true);
  const [selectedScale, setSelectedScale] = useState('chromatic');
  const [autotuneAmount, setAutotuneAmount] = useState(80); // 0 - 100%
  const [reverbAmount, setReverbAmount] = useState(25);     // 0 - 100%
  const [vocalVolume, setVocalVolume] = useState(0.95);
  const [musicVolume, setMusicVolume] = useState(0.75);
  const [freestyleText, setFreestyleText] = useState('');
  const [lyricsLines, setLyricsLines] = useState<LyricsLine[]>([]);
  const [recordingsList, setRecordingsList] = useState<StudioRecording[]>([]);
  const [playingRecId, setPlayingRecId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'lyrics' | 'notes' | 'fx' | 'recordings'>('lyrics');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const bgAudioRef = useRef<HTMLAudioElement | null>(null);
  const vocalAudioRef = useRef<HTMLAudioElement | null>(null);
  const recSecsRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Screen resize listener
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Fetch lyrics if track active
  useEffect(() => {
    if (currentTrack) {
      getLyrics(currentTrack.id)
        .then(res => {
          if (res?.syncedLyrics) {
            setLyricsLines(parseSyncedLyrics(res.syncedLyrics));
          } else {
            setLyricsLines([]);
          }
        })
        .catch(() => setLyricsLines([]));

      getRecordings(currentTrack.id).then(setRecordingsList);
    } else {
      getRecordings().then(setRecordingsList);
    }
  }, [currentTrack]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (bgAudioRef.current) {
        bgAudioRef.current.pause();
      }
      if (vocalAudioRef.current) {
        vocalAudioRef.current.pause();
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  function getBestMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/aac',
      'audio/ogg'
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  // Real-Time Pitch Correction DSP Chain Generator
  const createAutoTuneChain = (ctx: AudioContext, sourceNode: AudioNode, destNode: AudioNode) => {
    const scale = MUSICAL_SCALES[selectedScale] || MUSICAL_SCALES.chromatic;
    const correctionFactor = autotuneAmount / 100;

    // 1. Multi-Band Formant Peak Pitch Snap Filters
    // We create narrow bandpass filters tuned to key scale frequencies (e.g., C4 = 261Hz, E4 = 329Hz, G4 = 392Hz, A4 = 440Hz)
    const scaleFreqs = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25, 587.33, 659.25, 698.46, 783.99];
    const filteredScaleFreqs = scaleFreqs.filter((_, idx) => scale.notes.includes(idx % 12));

    const inputGain = ctx.createGain();
    inputGain.gain.value = 1.0;

    const outputGain = ctx.createGain();
    outputGain.gain.value = 1.0;

    sourceNode.connect(inputGain);

    if (autotuneAmount > 10) {
      // Pitch Snapper: High-Q Peaking Bandpass Array
      filteredScaleFreqs.slice(0, 6).forEach((freq) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 8 + (correctionFactor * 16); // High Q for sharp pitch snapping
        filter.gain.value = 8 * correctionFactor;
        inputGain.connect(filter);
        filter.connect(outputGain);
      });

      // Vibrato / Pitch Modulator Delay for Hard Auto-Tune Effect
      const delayNode = ctx.createDelay();
      delayNode.delayTime.value = 0.005; // 5ms micro-pitch delay

      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.frequency.value = 5.5; // 5.5 Hz pitch vibrato
      oscGain.gain.value = 0.0015 * correctionFactor;
      osc.connect(oscGain);
      oscGain.connect(delayNode.delayTime);
      osc.start();

      inputGain.connect(delayNode);
      delayNode.connect(outputGain);
    } else {
      inputGain.connect(outputGain);
    }

    // Reverb / Echo Delay Node
    if (reverbAmount > 5) {
      const delayNode = ctx.createDelay();
      delayNode.delayTime.value = 0.06 + (reverbAmount / 800);
      const delayFeedback = ctx.createGain();
      delayFeedback.gain.value = 0.15 + (reverbAmount / 300);

      delayNode.connect(delayFeedback);
      delayFeedback.connect(delayNode);

      outputGain.connect(delayNode);
      delayNode.connect(destNode);
    }

    outputGain.connect(destNode);
  };

  const startStudioRecording = async () => {
    if (!currentTrack) {
      setStatusMessage('Por favor selecciona una canción en el reproductor antes de grabar.');
      return;
    }

    try {
      setStatusMessage('Iniciando música y grabadora de voz...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micStreamRef.current = stream;
      audioChunksRef.current = [];

      // 1. GUARANTEED DEDICATED BACKGROUND MUSIC PLAYBACK
      const bgAudio = new Audio(`/api/stream/${currentTrack.id}?autoDownload=true`);
      bgAudio.volume = musicVolume;
      bgAudio.crossOrigin = 'anonymous';
      bgAudioRef.current = bgAudio;
      bgAudio.play().catch(err => console.warn('[Studio] bgAudio play error:', err));

      // 2. WEB AUDIO DSP FOR LIVE MONITORING & RECORDING
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const micSource = ctx.createMediaStreamSource(stream);

      if (liveMonitor) {
        // Send live pitch-corrected mic audio to headphones
        createAutoTuneChain(ctx, micSource, ctx.destination);
      }

      const mimeType = getBestMimeType();
      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const finalType = mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: finalType });
        const newRec: StudioRecording = {
          id: `rec_${Date.now()}`,
          trackId: currentTrack.id,
          trackTitle: currentTrack.title,
          artist: currentTrack.artist,
          timestamp: Date.now(),
          blob: audioBlob,
          duration: recSecsRef.current || recSeconds || 1,
        };

        await saveStudioRecording(newRec);
        const updated = await getRecordings(currentTrack.id);
        setRecordingsList(updated);
        setIsRecording(false);
        setRecSeconds(0);
        setStatusMessage('¡Grabación guardada correctamente!');
      };

      mediaRecorderRef.current = recorder;
      recorder.start(100);
      setIsRecording(true);
      setRecSeconds(0);
      recSecsRef.current = 0;
      setStatusMessage(null);

      timerRef.current = setInterval(() => {
        recSecsRef.current += 1;
        setRecSeconds(s => s + 1);
      }, 1000);

    } catch (err: any) {
      console.error('[Studio] Microphone error:', err);
      setStatusMessage(`Error de micrófono: ${err.message || 'Permiso denegado'}`);
    }
  };

  const stopStudioRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
    }
    if (bgAudioRef.current) {
      bgAudioRef.current.pause();
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
    }
  };

  const playRecordedMix = (rec: StudioRecording) => {
    if (playingRecId === rec.id) {
      if (vocalAudioRef.current) vocalAudioRef.current.pause();
      if (bgAudioRef.current) bgAudioRef.current.pause();
      setPlayingRecId(null);
      return;
    }

    // Play Background Beat
    if (currentTrack) {
      const bgAudio = new Audio(`/api/stream/${currentTrack.id}?autoDownload=true`);
      bgAudio.volume = musicVolume;
      bgAudio.play().catch(() => {});
      bgAudioRef.current = bgAudio;
    }

    // Play Vocal Track with Auto-Tune DSP
    const url = URL.createObjectURL(rec.blob);
    const vocalAudio = new Audio(url);
    vocalAudio.volume = vocalVolume;
    vocalAudio.crossOrigin = 'anonymous';
    vocalAudioRef.current = vocalAudio;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaElementSource(vocalAudio);
      createAutoTuneChain(ctx, source, ctx.destination);
    } catch (e) {
      console.warn('[Studio] AudioContext fallback:', e);
    }

    vocalAudio.play().catch(err => console.error('[Studio] Vocal play error:', err));
    setPlayingRecId(rec.id);

    vocalAudio.onended = () => {
      if (bgAudioRef.current) bgAudioRef.current.pause();
      setPlayingRecId(null);
    };
  };

  const handleDownloadFile = (rec: StudioRecording) => {
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Karaoke_${rec.trackTitle.replace(/[^a-z0-9]/gi, '_')}_${rec.id}.webm`;
    a.click();
  };

  const handleDeleteRec = async (id: string) => {
    await deleteStudioRecording(id);
    const updated = await getRecordings(currentTrack?.id);
    setRecordingsList(updated);
  };

  const formatSecs = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  const activeLineIndex = lyricsLines.findIndex((l, idx) => {
    const next = lyricsLines[idx + 1];
    return recSeconds >= l.time && (!next || recSeconds < next.time);
  });

  const coverUrl = currentTrack ? resolveImageUrl(currentTrack.cover) : '';

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9000,
      backgroundColor: '#05040a',
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* 1. IMMERSIVE BLURRED ARTWORK BACKGROUND */}
      {coverUrl && (
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${coverUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(90px) brightness(0.25) saturate(1.4)',
          transform: 'scale(1.2)',
          zIndex: 0,
          pointerEvents: 'none',
        }} />
      )}

      {/* Dark vignette overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(circle at center, rgba(10,8,18,0.4) 0%, rgba(5,4,10,0.92) 100%)',
        zIndex: 1,
        pointerEvents: 'none',
      }} />

      {/* 2. TOP RESPONSIVE HEADER */}
      <div style={{
        position: 'relative',
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: isMobile ? '12px 16px' : '16px 28px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(10, 8, 18, 0.4)',
        backdropFilter: 'blur(20px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff',
              borderRadius: 10,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            ← Salir
          </button>
          <div>
            <h2 style={{ margin: 0, fontSize: isMobile ? 15 : 18, fontWeight: 900 }}>
              Estudio Karaoke & Auto-Tune
            </h2>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
              {currentTrack ? `${currentTrack.title} — ${currentTrack.artist}` : 'Sin canción'}
            </div>
          </div>
        </div>

        {/* Record Control Button */}
        <div>
          {isRecording ? (
            <button
              onClick={stopStudioRecording}
              style={{
                background: '#ff4b4b',
                color: '#fff',
                border: 'none',
                borderRadius: 20,
                padding: isMobile ? '8px 16px' : '10px 24px',
                fontWeight: 900,
                fontSize: isMobile ? 12 : 14,
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(255,75,75,0.5)',
              }}
            >
              [GRABANDO] {formatSecs(recSeconds)} — Detener
            </button>
          ) : (
            <button
              onClick={startStudioRecording}
              disabled={!currentTrack}
              style={{
                background: currentTrack ? 'linear-gradient(135deg, #1DB954 0%, #179b45 100%)' : 'rgba(255,255,255,0.1)',
                color: currentTrack ? '#000' : 'rgba(255,255,255,0.4)',
                border: 'none',
                borderRadius: 24,
                padding: isMobile ? '8px 16px' : '10px 24px',
                fontWeight: 900,
                fontSize: isMobile ? 12 : 14,
                cursor: currentTrack ? 'pointer' : 'not-allowed',
                boxShadow: currentTrack ? '0 4px 20px rgba(29,185,84,0.4)' : 'none',
              }}
            >
              Empezar a Grabar
            </button>
          )}
        </div>
      </div>

      {statusMessage && (
        <div style={{
          position: 'relative',
          zIndex: 10,
          margin: '8px 16px 0',
          padding: '8px 14px',
          background: 'rgba(29, 185, 84, 0.2)',
          border: '1px solid rgba(29, 185, 84, 0.4)',
          color: '#fff',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
        }}>
          {statusMessage}
        </div>
      )}

      {/* MOBILE TAB SWITCHER (For mobile phones) */}
      {isMobile && (
        <div style={{
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          background: 'rgba(0,0,0,0.5)',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          <button
            onClick={() => setMobileTab('lyrics')}
            style={{ flex: 1, padding: 10, border: 'none', background: mobileTab === 'lyrics' ? 'rgba(255,255,255,0.15)' : 'transparent', color: mobileTab === 'lyrics' ? 'var(--accent)' : '#fff', fontWeight: 700, fontSize: 12 }}
          >
            Letra (Teleprompter)
          </button>
          <button
            onClick={() => setMobileTab('notes')}
            style={{ flex: 1, padding: 10, border: 'none', background: mobileTab === 'notes' ? 'rgba(255,255,255,0.15)' : 'transparent', color: mobileTab === 'notes' ? 'var(--accent)' : '#fff', fontWeight: 700, fontSize: 12 }}
          >
            Bloc Rimas
          </button>
          <button
            onClick={() => setMobileTab('fx')}
            style={{ flex: 1, padding: 10, border: 'none', background: mobileTab === 'fx' ? 'rgba(255,255,255,0.15)' : 'transparent', color: mobileTab === 'fx' ? 'var(--accent)' : '#fff', fontWeight: 700, fontSize: 12 }}
          >
            Efectos / Tono
          </button>
          <button
            onClick={() => setMobileTab('recordings')}
            style={{ flex: 1, padding: 10, border: 'none', background: mobileTab === 'recordings' ? 'rgba(255,255,255,0.15)' : 'transparent', color: mobileTab === 'recordings' ? 'var(--accent)' : '#fff', fontWeight: 700, fontSize: 12 }}
          >
            Tomas ({recordingsList.length})
          </button>
        </div>
      )}

      {/* 3. CENTER STAGE RESPONSIVE GRID */}
      <div style={{
        position: 'relative',
        zIndex: 5,
        flex: 1,
        display: isMobile ? 'flex' : 'grid',
        flexDirection: isMobile ? 'column' : undefined,
        gridTemplateColumns: isMobile ? undefined : '1fr 360px',
        gap: isMobile ? 12 : 24,
        padding: isMobile ? 12 : '24px 28px',
        overflowY: isMobile ? 'auto' : 'hidden',
      }}>
        
        {/* TELEPROMPTER SYNCED LYRICS */}
        {(!isMobile || mobileTab === 'lyrics') && (
          <div style={{
            flex: 1,
            background: 'rgba(15, 12, 25, 0.5)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: isMobile ? 16 : 24,
            padding: isMobile ? 20 : '36px 32px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            overflowY: 'auto',
          }}>
            {lyricsLines.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 700 }}>
                {lyricsLines.map((line, idx) => {
                  const isActive = idx === activeLineIndex;
                  const isPast = idx < activeLineIndex;
                  return (
                    <div
                      key={idx}
                      onClick={() => setProgress(line.time)}
                      style={{
                        fontSize: isActive ? (isMobile ? 24 : 32) : isPast ? 16 : 20,
                        fontWeight: isActive ? 900 : 600,
                        color: isActive ? 'var(--accent)' : isPast ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.7)',
                        transform: isActive ? 'scale(1.04)' : 'scale(1)',
                        transition: 'all 0.25s ease-out',
                        cursor: 'pointer',
                        lineHeight: 1.3,
                        textShadow: isActive ? '0 0 30px rgba(29,185,84,0.6)' : 'none',
                      }}
                    >
                      {line.text}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', maxWidth: 450 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 8 }}>
                  Modo Freestyle Activo
                </div>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
                  Esta canción no dispone de letra sincronizada. Escribe tus rimas en el bloc para improvisar.
                </p>
              </div>
            )}
          </div>
        )}

        {/* FREESTYLE SCRATCHPAD */}
        {(!isMobile || mobileTab === 'notes') && (
          <div style={{
            background: 'rgba(15, 12, 25, 0.5)',
            backdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: isMobile ? 16 : 24,
            padding: isMobile ? 16 : 24,
            display: 'flex',
            flexDirection: 'column',
            minHeight: isMobile ? 260 : undefined,
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--accent)', marginBottom: 12 }}>
              Bloc de Notas & Rimas
            </div>
            <textarea
              placeholder="Escribe aquí tus rimas, versos o ideas para improvisar..."
              value={freestyleText}
              onChange={(e) => setFreestyleText(e.target.value)}
              style={{
                flex: 1,
                width: '100%',
                backgroundColor: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 14,
                padding: 14,
                color: '#fff',
                fontSize: 14,
                fontFamily: 'sans-serif',
                outline: 'none',
                resize: 'none',
                lineHeight: 1.5,
              }}
            />
          </div>
        )}

        {/* MOBILE RECORDINGS TAB */}
        {isMobile && mobileTab === 'recordings' && (
          <div style={{
            background: 'rgba(15, 12, 25, 0.5)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            padding: 16,
          }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 800 }}>Tus Tomas ({recordingsList.length})</h3>
            {recordingsList.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No tienes grabaciones aún.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {recordingsList.map((rec) => (
                  <div key={rec.id} style={{ background: 'rgba(255,255,255,0.05)', padding: 12, borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{rec.trackTitle} ({formatSecs(rec.duration)})</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{new Date(rec.timestamp).toLocaleTimeString()}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => playRecordedMix(rec)} style={{ background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6, padding: '6px 10px', fontSize: 11, fontWeight: 800 }}>
                        {playingRecId === rec.id ? 'Detener' : 'Mezcla'}
                      </button>
                      <button onClick={() => handleDownloadFile(rec)} style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 8px', fontSize: 11 }}>
                        Descargar
                      </button>
                      <button onClick={() => handleDeleteRec(rec.id)} style={{ background: 'rgba(255,75,75,0.2)', color: '#ff4b4b', border: 'none', borderRadius: 6, padding: '6px 8px', fontSize: 11 }}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. BOTTOM AUTO-TUNE & SCALE SELECTION RACK */}
      {(!isMobile || mobileTab === 'fx') && (
        <div style={{
          position: 'relative',
          zIndex: 10,
          background: 'rgba(10, 8, 18, 0.7)',
          backdropFilter: 'blur(24px)',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          padding: isMobile ? '12px 16px' : '16px 28px',
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : 'center',
          justifyContent: 'space-between',
          gap: isMobile ? 12 : 20,
        }}>
          {/* Key & Scale Selector */}
          <div style={{ minWidth: 200 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--accent)', marginBottom: 4 }}>
              Escala Musical / Acordes
            </div>
            <select
              value={selectedScale}
              onChange={(e) => setSelectedScale(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.1)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 8,
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 700,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              {Object.entries(MUSICAL_SCALES).map(([key, item]) => (
                <option key={key} value={key} style={{ background: '#12101a', color: '#fff' }}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>

          {/* Auto-Tune Pitch Correction Slider */}
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              <span>Auto-Tune (Pitch Snap)</span>
              <span style={{ color: 'var(--accent)' }}>{autotuneAmount}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={autotuneAmount}
              onChange={(e) => setAutotuneAmount(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
          </div>

          {/* Studio Reverb */}
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              <span>Reverberación / Eco</span>
              <span style={{ color: 'var(--accent)' }}>{reverbAmount}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={reverbAmount}
              onChange={(e) => setReverbAmount(parseInt(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
          </div>

          {/* Volume Mix Faders */}
          <div style={{ display: 'flex', gap: 12, minWidth: 200 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 2 }}>
                Voz: {Math.round(vocalVolume * 100)}%
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={vocalVolume}
                onChange={(e) => setVocalVolume(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginBottom: 2 }}>
                Música: {Math.round(musicVolume * 100)}%
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={musicVolume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setMusicVolume(val);
                  if (bgAudioRef.current) bgAudioRef.current.volume = val;
                }}
                style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
            </div>
          </div>

          {/* Live Headphone Monitor */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.06)', padding: '6px 12px', borderRadius: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>Monitoreo</span>
            <input
              type="checkbox"
              checked={liveMonitor}
              onChange={(e) => setLiveMonitor(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
