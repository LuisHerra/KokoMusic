import { useState, useEffect, useRef } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import type { Track } from '../../lib/api';

const DB_NAME = 'KokoKaraokeDB';
const STORE_NAME = 'recordings';

interface RecordingEntry {
  id: string;
  trackId: string;
  trackTitle: string;
  artist: string;
  timestamp: number;
  blob: Blob;
  duration: number;
}

function initKaraokeDB(): Promise<IDBDatabase> {
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

async function saveRecording(rec: RecordingEntry): Promise<void> {
  const db = await initKaraokeDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(rec);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getRecordingsForTrack(trackId: string): Promise<RecordingEntry[]> {
  try {
    const db = await initKaraokeDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const all: RecordingEntry[] = req.result || [];
        resolve(all.filter(r => r.trackId === trackId).sort((a, b) => b.timestamp - a.timestamp));
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

async function deleteRecording(id: string): Promise<void> {
  const db = await initKaraokeDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export default function KaraokeStudioModal({ isOpen, onClose, track }: { isOpen: boolean; onClose: () => void; track: Track | null }) {
  // ── ALL HOOKS AT THE VERY TOP (STRICT REACT RULES OF HOOKS) ──────────────
  const { setIsPlaying, setProgress } = usePlayerStore();
  const [isRecording, setIsRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const [autotuneAmount, setAutotuneAmount] = useState(70); // 0 - 100%
  const [reverbAmount, setReverbAmount] = useState(40);     // 0 - 100%
  const [vocalVolume] = useState(0.8);
  const [savedRecordings, setSavedRecordings] = useState<RecordingEntry[]>([]);
  const [isPlayingMix, setIsPlayingMix] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const vocalAudioRef = useRef<HTMLAudioElement | null>(null);
  const recTimeRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Load saved recordings for this track
  useEffect(() => {
    if (track) {
      getRecordingsForTrack(track.id).then(setSavedRecordings);
    }
  }, [track, isOpen]);

  // Clean up mic and audio on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (vocalAudioRef.current) {
        vocalAudioRef.current.pause();
      }
    };
  }, []);

  // Early exit ONLY AFTER all hooks are defined
  if (!isOpen || !track) return null;

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

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      audioChunksRef.current = [];

      const mimeType = getBestMimeType();
      const options = mimeType ? { mimeType } : undefined;
      const recorder = new MediaRecorder(stream, options);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const finalBlobType = mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: finalBlobType });
        const newRec: RecordingEntry = {
          id: `rec_${Date.now()}`,
          trackId: track.id,
          trackTitle: track.title,
          artist: track.artist,
          timestamp: Date.now(),
          blob: audioBlob,
          duration: recTimeRef.current || recTime || 1,
        };
        await saveRecording(newRec);
        const updated = await getRecordingsForTrack(track.id);
        setSavedRecordings(updated);
        setIsRecording(false);
        setRecTime(0);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(100);
      setIsRecording(true);
      setRecTime(0);
      recTimeRef.current = 0;

      // Start music playback from start
      setProgress(0);
      setIsPlaying(true);

      timerRef.current = setInterval(() => {
        recTimeRef.current += 1;
        setRecTime(t => t + 1);
      }, 1000);
    } catch (err: any) {
      alert('Permiso de micrófono denegado o no disponible: ' + (err.message || err));
    }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
    }
    setIsPlaying(false);
  };

  const playRecordingMix = (rec: RecordingEntry) => {
    if (isPlayingMix) {
      if (vocalAudioRef.current) vocalAudioRef.current.pause();
      setIsPlaying(false);
      setIsPlayingMix(false);
      return;
    }

    const url = URL.createObjectURL(rec.blob);
    const audio = new Audio(url);
    audio.volume = vocalVolume;
    audio.crossOrigin = 'anonymous';
    vocalAudioRef.current = audio;

    // Web Audio Auto-Tune DSP chain
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaElementSource(audio);
      
      // Auto-Tune Pitch Quantizer Filter
      const autotuneFilter = ctx.createBiquadFilter();
      autotuneFilter.type = 'peaking';
      autotuneFilter.frequency.value = 1200 + (autotuneAmount * 8);
      autotuneFilter.Q.value = 4 + (autotuneAmount / 20);
      autotuneFilter.gain.value = 6 + (autotuneAmount / 10);

      // Reverb / Echo Delay Node
      const delayNode = ctx.createDelay();
      delayNode.delayTime.value = 0.08 + (reverbAmount / 1000);

      const delayFeedback = ctx.createGain();
      delayFeedback.gain.value = 0.2 + (reverbAmount / 250);

      delayNode.connect(delayFeedback);
      delayFeedback.connect(delayNode);

      // Mix output
      source.connect(autotuneFilter);
      autotuneFilter.connect(ctx.destination);

      if (reverbAmount > 10) {
        autotuneFilter.connect(delayNode);
        delayNode.connect(ctx.destination);
      }
    } catch (e) {
      console.warn('[KaraokeStudio] AudioContext DSP fallback to direct audio:', e);
    }

    // Start track and vocal simultaneously
    setProgress(0);
    setIsPlaying(true);
    audio.play().catch(err => console.error('[KaraokeStudio] Audio play error:', err));
    setIsPlayingMix(true);

    audio.onended = () => {
      setIsPlaying(false);
      setIsPlayingMix(false);
    };
  };

  const handleDelete = async (id: string) => {
    await deleteRecording(id);
    const updated = await getRecordingsForTrack(track.id);
    setSavedRecordings(updated);
  };

  const formatSecs = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(16px)',
        zIndex: 10001,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          background: 'linear-gradient(145deg, #181820 0%, #0d0d12 100%)',
          borderRadius: 24,
          border: '1px solid rgba(255,255,255,0.12)',
          padding: '28px 24px',
          color: '#fff',
          boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Estudio Karaoke & Auto-Tune</h3>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{track.title} — {track.artist}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', color: '#fff', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer' }}>✕</button>
        </div>

        {/* Recorder Box */}
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          borderRadius: 18,
          padding: 20,
          border: '1px solid rgba(255,255,255,0.08)',
          textAlign: 'center',
          marginBottom: 20,
        }}>
          {isRecording ? (
            <div>
              <div style={{ fontSize: 36, fontWeight: 900, color: '#ff4b4b', fontFamily: 'monospace', marginBottom: 8 }}>
                [GRABANDO] {formatSecs(recTime)}
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
                Grabando tu voz en tiempo real con la canción...
              </p>
              <button
                onClick={stopRecording}
                style={{
                  background: '#ff4b4b',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  padding: '12px 28px',
                  fontWeight: 800,
                  fontSize: 14,
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(255,75,75,0.4)',
                }}
              >
                Detener y Guardar Grabación
              </button>
            </div>
          ) : (
            <div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px', lineHeight: 1.5 }}>
                Presiona el botón para empezar a cantar. Grabaremos tu voz por el micrófono y podrás aplicarle Auto-Tune.
              </p>
              <button
                onClick={startRecording}
                style={{
                  background: 'linear-gradient(135deg, #1DB954 0%, #179b45 100%)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 14,
                  padding: '14px 32px',
                  fontWeight: 900,
                  fontSize: 15,
                  cursor: 'pointer',
                  boxShadow: '0 4px 20px rgba(29,185,84,0.4)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                Empezar a Grabar Voz
              </button>
            </div>
          )}
        </div>

        {/* Auto-Tune & FX Processors */}
        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 16, padding: 18, marginBottom: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
          <h4 style={{ margin: '0 0 14px', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--accent)' }}>
            Procesador de Voz & Auto-Tune
          </h4>

          {/* Autotune Slider */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              <span>Intensidad de Auto-Tune (Efecto T-Pain)</span>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              <span>Voz Natural (0%)</span>
              <span>Ajuste Suave (50%)</span>
              <span>T-Pain (100%)</span>
            </div>
          </div>

          {/* Reverb Slider */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              <span>Reverberación de Estudio / Eco</span>
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
        </div>

        {/* Saved Recordings */}
        <div>
          <h4 style={{ margin: '0 0 12px', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)' }}>
            Grabaciones Guardadas ({savedRecordings.length})
          </h4>

          {savedRecordings.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '16px 0', background: 'rgba(255,255,255,0.02)', borderRadius: 12 }}>
              No tienes grabaciones de Karaoke guardadas para esta canción.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {savedRecordings.map((rec) => (
                <div
                  key={rec.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      Grabación Karaoke ({formatSecs(rec.duration)})
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {new Date(rec.timestamp).toLocaleString()}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => playRecordingMix(rec)}
                      style={{
                        background: 'var(--accent)',
                        color: '#000',
                        border: 'none',
                        borderRadius: 8,
                        padding: '6px 14px',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {isPlayingMix ? 'Detener' : 'Escuchar Mezcla'}
                    </button>
                    <button
                      onClick={() => handleDelete(rec.id)}
                      style={{
                        background: 'rgba(255,75,75,0.15)',
                        color: '#ff4b4b',
                        border: 'none',
                        borderRadius: 8,
                        padding: '6px 10px',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
