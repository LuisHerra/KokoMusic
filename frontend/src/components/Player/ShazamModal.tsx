/**
 * EurekaModal (formerly ShazamModal) — Mobile-Responsive Audio Fingerprint & Song Identification
 *
 * Captures real-time audio input from microphone via Web Audio API,
 * displays a circular pulsing spectrum visualizer, cuts microphone stream
 * immediately after recognition, renders high-precision track cards,
 * and clears state between sessions to avoid stale cached results.
 */

import { useState, useEffect, useRef } from 'react';
import { apiFetch, type Track } from '../../lib/api';
import { usePlayerStore } from '../../store/playerStore';
import ParticleBurst from '../Common/ParticleBurst';

export default function ShazamModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [isListening, setIsListening] = useState(false);
  const [isMicActive, setIsMicActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [query, setQuery] = useState('');
  const [matchedTrack, setMatchedTrack] = useState<Track | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [sparkTrigger, setSparkTrigger] = useState(0);
  const { setTrack, addToQueue } = usePlayerStore();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);

  useEffect(() => {
    if (isOpen) {
      // Clear ALL cached state immediately upon opening modal
      setMatchedTrack(null);
      setError('');
      setQuery('');
      setTranscript('');
      setLoading(false);
      startListeningWithMic();
    } else {
      stopMic();
      setIsListening(false);
      setIsMicActive(false);
      setMatchedTrack(null);
      setError('');
      setQuery('');
      setTranscript('');
      setLoading(false);
    }
    return () => {
      stopMic();
    };
  }, [isOpen]);

  const stopMic = () => {
    setIsMicActive(false);
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (scriptProcessorRef.current) {
      try { scriptProcessorRef.current.disconnect(); } catch {}
      scriptProcessorRef.current = null;
    }
    pcmChunksRef.current = [];
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
  };

  const startListeningWithMic = async () => {
    stopMic(); // Clear any pre-existing audio contexts or tracks
    setIsListening(true);
    setIsMicActive(true);
    setError('');
    setMatchedTrack(null); // Never display stale cached results
    setLoading(false);
    setTranscript('');

    try {
      // 1. Request microphone stream — 44100Hz mono required by Shazam API
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 44100, channelCount: 1, echoCancellation: false, noiseSuppression: false },
      });
      streamRef.current = stream;

      // 2. Set up Web Audio API AnalyserNode for spectrum visualizer
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
      audioCtxRef.current = audioCtx;
      // Resume the AudioContext — browsers auto-suspend it until explicitly resumed
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const source = audioCtx.createMediaStreamSource(stream);

      // Mic gain boost — amplify input 3x to detect low-volume audio (e.g. from a phone speaker)
      const micGain = audioCtx.createGain();
      micGain.gain.value = 3;
      source.connect(micGain);

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      micGain.connect(analyser);

      // Reset PCM chunks for a fresh recording
      pcmChunksRef.current = [];

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      // Render live circular audio spectrum on canvas
      const drawCanvas = () => {
        if (!canvasRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        analyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        const radius = 45;

        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(0, 210, 255, 0.25)';
        ctx.lineWidth = 2;
        ctx.stroke();

        for (let i = 0; i < bufferLength; i++) {
          const value = dataArray[i] / 255;
          const barHeight = value * 25;
          const angle = (i / bufferLength) * 2 * Math.PI;

          const x1 = centerX + Math.cos(angle) * radius;
          const y1 = centerY + Math.sin(angle) * radius;
          const x2 = centerX + Math.cos(angle) * (radius + barHeight);
          const y2 = centerY + Math.sin(angle) * (radius + barHeight);

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = '#00d2ff';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.stroke();
        }

        animFrameRef.current = requestAnimationFrame(drawCanvas);
      };
      drawCanvas();

      // 3. ScriptProcessorNode — capture raw Float32 PCM samples (Shazam requires raw PCM)
      // 44100Hz mono 16-bit little endian is the exact format Shazam API expects
      const BUFFER_SIZE = 4096;
      const scriptProcessor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      scriptProcessorRef.current = scriptProcessor;

      scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
        // Capture mono channel Float32 PCM samples from boosted mic input
        const inputData = event.inputBuffer.getChannelData(0);
        pcmChunksRef.current.push(new Float32Array(inputData));
      };

      // Use a muted GainNode as output — keeps ScriptProcessorNode alive without playing audio through speakers
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      micGain.connect(scriptProcessor);
      scriptProcessor.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      // 4. After 4.8s, read chunks FIRST, then stop mic, then convert & send
      setTimeout(() => {
        // ── IMPORTANT: capture chunks BEFORE calling stopMic (which resets the ref) ──
        const chunks = [...pcmChunksRef.current];
        console.log(`[Eureka] Recording done. Chunks captured: ${chunks.length}`);

        // Now safe to stop mic and disconnect everything
        try { scriptProcessor.disconnect(); } catch {}
        try { silentGain.disconnect(); } catch {}
        scriptProcessorRef.current = null;
        stopMic();

        if (chunks.length === 0) {
          setError('No se capturo audio del micrófono. Inténtalo de nuevo.');
          setIsListening(false);
          return;
        }

        // Show "¡Lo tengo!" while we process and send to Shazam
        setIsListening(false);
        setIsProcessing(true);

        // Merge all Float32 chunks into one array
        const totalSamples = chunks.reduce((acc, c) => acc + c.length, 0);
        const merged = new Float32Array(totalSamples);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }

        // Limit to 4 seconds (44100 * 4 samples) to stay under Shazam's 500KB limit
        const maxSamples = 44100 * 4;
        const trimmed = merged.length > maxSamples ? merged.slice(0, maxSamples) : merged;

        // Convert Float32 → Int16 Little Endian (required by Shazam API)
        const int16 = new Int16Array(trimmed.length);
        for (let i = 0; i < trimmed.length; i++) {
          int16[i] = Math.max(-32768, Math.min(32767, Math.round(trimmed[i] * 32767)));
        }

        // Convert Int16Array → Base64 string
        const uint8 = new Uint8Array(int16.buffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8.length; i += chunkSize) {
          binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
        }
        const base64Audio = btoa(binary);
        console.log(`[Eureka] Sending ${trimmed.length} PCM samples (${base64Audio.length} base64 chars) to Shazam...`);

        setIsProcessing(false);
        handleIdentify('', base64Audio);
      }, 4800);

    } catch (err: any) {
      console.warn('[Eureka] Mic error:', err);
      stopMic();
      setIsListening(false);
      setError('Permiso de micrófono denegado. Introduce la canción manualmente.');
    }
  };

  const handleIdentify = async (searchTerm?: string, audioBase64?: string) => {
    stopMic(); // Guarantee mic stream is completely closed!
    const finalQuery = (searchTerm || query || transcript).trim();
    if (!finalQuery && !audioBase64) {
      setError('No se detectó audio en el micrófono. Acerca el dispositivo al altavoz.');
      return;
    }

    setLoading(true);
    setError('');
    setMatchedTrack(null); // Clear previous result before issuing request
    try {
      const res = await apiFetch<{ success: boolean; track: Track; error?: string }>(`/eureka/identify`, {
        method: 'POST',
        headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: finalQuery, audioBase64: audioBase64 || '' }),
      });
      if (res.success && res.track) {
        setMatchedTrack(res.track);
        setSparkTrigger((prev) => prev + 1); // Trigger celebratory particle explosion
      } else {
        setMatchedTrack(null);
        setError(res.error || 'No se pudo reconocer el audio. Inténtalo de nuevo.');
      }
    } catch {
      setMatchedTrack(null);
      setError('No se encontró ninguna coincidencia.');
    } finally {
      setIsListening(false);
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        zIndex: 10005,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        animation: 'fadeIn 0.2s ease-out',
      }}
      onClick={() => {
        stopMic();
        onClose();
      }}
    >
      <style>{`
        @keyframes eurekaPulse {
          0% { transform: scale(0.95); boxShadow: 0 0 0 0 rgba(0, 210, 255, 0.6); }
          70% { transform: scale(1.05); boxShadow: 0 0 0 35px rgba(0, 210, 255, 0); }
          100% { transform: scale(0.95); boxShadow: 0 0 0 0 rgba(0, 210, 255, 0); }
        }
        @keyframes eurekaSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      <div
        style={{
          background: 'linear-gradient(165deg, rgba(20, 24, 40, 0.95) 0%, rgba(10, 12, 20, 0.98) 100%)',
          border: '1px solid rgba(0, 210, 255, 0.3)',
          borderRadius: 28,
          padding: '28px 24px',
          width: '100%',
          maxWidth: 420,
          textAlign: 'center',
          boxShadow: '0 25px 60px rgba(0, 150, 255, 0.25)',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Eureka Glowing Lightbulb / Star Logo SVG */}
            <div style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #00c8ff 0%, #0077ff 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 16px rgba(0, 210, 255, 0.6)',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#ffffff">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.87-3.13-7-7-7zm-3 17h6v1H9v-1zm1-15.5c0-.28.22-.5.5-.5s.5.22.5.5v1c0 .28-.22.5-.5.5s-.5-.22-.5-.5v-1z"/>
              </svg>
            </div>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#ffffff', letterSpacing: '0.4px' }}>
              Eureka! Mode
            </span>
          </div>

          {/* Mic Status Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: 12,
              background: isMicActive ? 'rgba(0, 210, 255, 0.15)' : 'rgba(255,255,255,0.06)',
              color: isMicActive ? '#00d2ff' : '#94a3b8',
              border: isMicActive ? '1px solid rgba(0, 210, 255, 0.4)' : '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isMicActive ? '#00d2ff' : '#64748b',
                boxShadow: isMicActive ? '0 0 8px #00d2ff' : 'none',
              }} />
              {isMicActive ? 'Micrófono Activo' : 'Micrófono Apagado'}
            </span>

            <button
              onClick={() => {
                stopMic();
                onClose();
              }}
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: 'none',
                borderRadius: '50%',
                width: 32,
                height: 32,
                color: '#ffffff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Dynamic Eureka Orb & Radar Screen */}
        {isListening ? (
          <div style={{ padding: '16px 0' }}>
            <div
              style={{
                position: 'relative',
                width: 140,
                height: 140,
                margin: '0 auto 20px auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* Circular Equalizer Spectrum Canvas */}
              <canvas
                ref={canvasRef}
                width={140}
                height={140}
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              />

              {/* Pulsing Central Eureka Orb */}
              <div
                style={{
                  width: 86,
                  height: 86,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #0077ff 0%, #00d2ff 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  animation: 'eurekaPulse 1.8s infinite cubic-bezier(0.4, 0, 0.6, 1)',
                  cursor: 'pointer',
                  zIndex: 2,
                }}
              >
                <svg width="42" height="42" viewBox="0 0 24 24" fill="#ffffff">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                </svg>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#ffffff', margin: '0 0 6px 0' }}>
              Escuchando audio ambiental...
            </h3>
            {transcript ? (
              <p style={{ fontSize: 13, color: '#00d2ff', margin: 0, fontStyle: 'italic' }}>
                "{transcript}"
              </p>
            ) : (
              <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
                Escuchando el sonido para identificar la canción...
              </p>
            )}
          </div>
        ) : isProcessing ? (
          <div style={{ padding: '36px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            {/* Checkmark pulse animation */}
            <div style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #00c853 0%, #00e676 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: 'eurekaPulse 1.2s infinite cubic-bezier(0.4, 0, 0.6, 1)',
              boxShadow: '0 0 24px rgba(0, 200, 83, 0.5)',
            }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="white">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#00e676', margin: 0, letterSpacing: '0.5px' }}>
              ¡Lo tengo!
            </h3>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
              Buscando la canción...
            </p>
          </div>
        ) : loading ? (
          <div style={{ padding: '36px 0' }}>
            <div style={{
              width: 48,
              height: 48,
              border: '3px solid rgba(0, 210, 255, 0.2)',
              borderTopColor: '#00d2ff',
              borderRadius: '50%',
              margin: '0 auto 16px auto',
              animation: 'eurekaSpin 0.8s linear infinite',
            }} />
            <p style={{ fontSize: 14, color: '#94a3b8', margin: 0 }}>Identificando en Eureka...</p>
          </div>
        ) : matchedTrack ? (
          <ParticleBurst type="star" count={12} triggerKey={sparkTrigger}>
            <div style={{ padding: '12px 0', width: '100%' }}>
              <img
                src={matchedTrack.cover}
                alt={matchedTrack.title}
                style={{
                  width: 140,
                  height: 140,
                  borderRadius: 20,
                  objectFit: 'cover',
                  margin: '0 auto 16px auto',
                  boxShadow: '0 15px 35px rgba(0, 180, 255, 0.35)',
                }}
              />
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#ffffff', margin: '0 0 4px 0' }}>
                {matchedTrack.title}
              </h2>
              <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 20px 0' }}>
                {matchedTrack.artist}
              </p>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setTrack(matchedTrack, [matchedTrack]);
                    onClose();
                  }}
                  style={{
                    padding: '10px 20px',
                    fontSize: 14,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    background: 'linear-gradient(135deg, #0088ff 0%, #00c8ff 100%)',
                    border: 'none',
                    borderRadius: 14,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Reproducir
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    addToQueue(matchedTrack);
                    onClose();
                  }}
                  style={{
                    padding: '10px 16px',
                    fontSize: 14,
                    background: 'rgba(255,255,255,0.08)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 14,
                  }}
                >
                  + Encolar
                </button>
              </div>
            </div>
          </ParticleBurst>
        ) : (
          <div style={{ padding: '16px 0' }}>
            {error && <p style={{ color: '#f87171', fontSize: 13, marginBottom: 16 }}>{error}</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleIdentify(query);
              }}
              style={{ display: 'flex', gap: 8, marginBottom: 16 }}
            >
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nombre o letra de la canción..."
                style={{
                  flex: 1,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 14,
                  padding: '10px 14px',
                  color: '#fff',
                  fontSize: 14,
                }}
              />
              <button
                className="btn btn-primary"
                type="submit"
                style={{
                  fontSize: 13,
                  padding: '0 16px',
                  background: 'linear-gradient(135deg, #0088ff 0%, #00c8ff 100%)',
                  border: 'none',
                  borderRadius: 14,
                }}
              >
                Buscar
              </button>
            </form>

            <button
              className="btn"
              onClick={startListeningWithMic}
              style={{
                fontSize: 13,
                fontWeight: 700,
                padding: '10px 20px',
                background: 'rgba(0, 180, 255, 0.12)',
                color: '#00d2ff',
                border: '1px solid rgba(0, 180, 255, 0.3)',
                borderRadius: 14,
                width: '100%',
              }}
            >
              🎤 Escuchar de nuevo con micrófono
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
