import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../store/playerStore';
import { searchTracks } from '../lib/api';
import { useLikedSongs } from './useLikedSongs';

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

export type VoiceActionId =
  | 'play'
  | 'pause'
  | 'next'
  | 'prev'
  | 'vol_up'
  | 'vol_down'
  | 'like'
  | 'lyrics'
  | 'queue'
  | 'shuffle'
  | 'repeat';

export const DEFAULT_VOICE_COMMANDS: Record<VoiceActionId, string[]> = {
  play: ['reproducir', 'play', 'reanudar', 'continuar', 'reproduce', 'empieza'],
  pause: ['pausar', 'pausa', 'pause', 'detener', 'parar', 'stop', 'para'],
  next: ['siguiente', 'next', 'saltar', 'pasar', 'paso', 'pasa', 'avanzar'],
  prev: ['anterior', 'previous', 'atras', 'atrás', 'volver', 'retroceder'],
  vol_up: ['subir volumen', 'mas volumen', 'más volumen', 'volume up', 'sube el volumen'],
  vol_down: ['bajar volumen', 'menos volumen', 'volume down', 'baja el volumen'],
  like: ['me gusta', 'favorito', 'like', 'guardar', 'megusta'],
  lyrics: ['letras', 'letra', 'lyrics'],
  queue: ['cola', 'queue', 'lista de reproduccion'],
  shuffle: ['aleatorio', 'shuffle', 'mezclar'],
  repeat: ['repetir', 'repeat', 'bucle'],
};

export interface VoiceControlState {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  lastCommand: string | null;
  feedback: string | null;
  error: string | null;
  isSupported: boolean;
  customCommands: Record<VoiceActionId, string[]>;
  toggleListening: () => void;
  startListening: () => void;
  stopListening: () => void;
  updateCustomCommand: (action: VoiceActionId, phrases: string[]) => void;
  resetCustomCommands: () => void;
}

export function useVoiceControl(): VoiceControlState {
  const navigate = useNavigate();
  const recognitionRef = useRef<any>(null);

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  // Custom Voice Commands stored in localStorage
  const [customCommands, setCustomCommands] = useState<Record<VoiceActionId, string[]>>(() => {
    try {
      const saved = localStorage.getItem('koko_custom_voice_commands');
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_VOICE_COMMANDS;
  });

  const updateCustomCommand = useCallback((action: VoiceActionId, phrases: string[]) => {
    setCustomCommands((prev) => {
      const updated = { ...prev, [action]: phrases.map((p) => p.trim().toLowerCase()).filter(Boolean) };
      localStorage.setItem('koko_custom_voice_commands', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const resetCustomCommands = useCallback(() => {
    setCustomCommands(DEFAULT_VOICE_COMMANDS);
    localStorage.setItem('koko_custom_voice_commands', JSON.stringify(DEFAULT_VOICE_COMMANDS));
  }, []);

  const { toggleLike, isLiked } = useLikedSongs();

  const {
    currentTrack,
    volume,
    isMuted,
    setIsPlaying,
    nextTrack,
    prevTrack,
    setVolume,
    toggleMute,
    toggleLyrics,
    toggleQueue,
    toggleShuffle,
    cycleRepeat,
    setTrack,
  } = usePlayerStore();

  const isCommandMatch = (action: VoiceActionId, text: string): boolean => {
    const phrases = customCommands[action] || DEFAULT_VOICE_COMMANDS[action] || [];
    return phrases.some((p) => text.includes(p.toLowerCase()));
  };

  const executedRef = useRef(false);

  const processCommand = useCallback(
    async (rawText: string) => {
      const text = rawText.trim().toLowerCase();
      if (!text) return;

      setLastCommand(rawText);
      setError(null);

      // ── 1. Controles de Reproducción ────────────────────────
      if (isCommandMatch('pause', text)) {
        setIsPlaying(false);
        setFeedback('Reproducción pausada');
        return;
      }

      if (isCommandMatch('play', text) && !text.match(/^(?:reproducir|play|escuchar|poner|pone)\s+.+/i)) {
        setIsPlaying(true);
        setFeedback('Reproduciendo música');
        return;
      }

      // ── 2. Siguiente / Anterior ─────────────────────────────
      if (isCommandMatch('next', text)) {
        nextTrack();
        setFeedback('Siguiente canción');
        return;
      }

      if (isCommandMatch('prev', text)) {
        prevTrack();
        setFeedback('Canción anterior');
        return;
      }

      // ── 3. Controles de Volumen ──────────────────────────────
      if (isCommandMatch('vol_up', text)) {
        const newVol = Math.min(1, volume + 0.2);
        setVolume(newVol);
        setFeedback(`Volumen al ${Math.round(newVol * 100)}%`);
        return;
      }

      if (isCommandMatch('vol_down', text)) {
        const newVol = Math.max(0, volume - 0.2);
        setVolume(newVol);
        setFeedback(`Volumen al ${Math.round(newVol * 100)}%`);
        return;
      }

      const matchVolNum = text.match(/volumen\s+(?:al\s+)?([0-9]+)%?/i);
      if (matchVolNum) {
        const val = parseInt(matchVolNum[1], 10);
        if (!isNaN(val)) {
          const clamped = Math.max(0, Math.min(100, val)) / 100;
          setVolume(clamped);
          setFeedback(`Volumen al ${val}%`);
          return;
        }
      }

      if (/(mutear|silenciar|mute)/i.test(text) && !isMuted) {
        toggleMute();
        setFeedback('Sonido silenciado');
        return;
      }

      if (/(desmutear|unmute|activar sonido)/i.test(text) && isMuted) {
        toggleMute();
        setFeedback('Sonido activado');
        return;
      }

      // ── 4. Toggles de Interfaz ──────────────────────────────
      if (isCommandMatch('lyrics', text)) {
        toggleLyrics();
        setFeedback('Pantalla de letras alternada');
        return;
      }

      if (isCommandMatch('queue', text)) {
        toggleQueue();
        setFeedback('Cola de reproducción alternada');
        return;
      }

      if (isCommandMatch('shuffle', text)) {
        toggleShuffle();
        setFeedback('Modo aleatorio alternado');
        return;
      }

      if (isCommandMatch('repeat', text)) {
        cycleRepeat();
        setFeedback('Modo repetición cambiado');
        return;
      }

      if (isCommandMatch('like', text)) {
        if (currentTrack) {
          const currentlyLiked = isLiked(currentTrack.id);
          toggleLike(currentTrack.id);
          setFeedback(currentlyLiked ? 'Eliminado de Me Gusta' : 'Añadido a Me Gusta');
        } else {
          setFeedback('No hay canción en reproducción');
        }
        return;
      }

      // ── 5. Búsqueda Directa ──────────────────────────────────
      const matchSearch = text.match(/^(?:buscar|search)\s+(.+)/i);
      if (matchSearch) {
        const query = matchSearch[1].trim();
        navigate(`/search?q=${encodeURIComponent(query)}`);
        setFeedback(`Buscando "${query}"`);
        return;
      }

      // ── 6. Reproducción de Canción/Artista con Fallback a YouTube ──
      const matchPlayQuery = text.match(/^(?:reproducir|escuchar|poner|pone|play)\s+(.+)/i);
      if (matchPlayQuery) {
        const query = matchPlayQuery[1].trim();
        setFeedback(`Buscando "${query}"...`);

        try {
          // Intentar primero en iTunes / catálogo central de KokoMusic
          let searchRes = await searchTracks(query, 10, 'itunes').catch(() => null);
          let tracks = searchRes?.tracks || [];

          // Si da 404 o no devuelve nada en iTunes → buscar inmediatamente en YouTube
          if (tracks.length === 0) {
            console.log('[VoiceControl] No tracks in iTunes/Koko DB. Fallback to YouTube...');
            searchRes = await searchTracks(query, 10, 'youtube').catch(() => null);
            tracks = searchRes?.tracks || [];
          }

          if (tracks.length > 0) {
            setTrack(tracks[0], tracks);
            navigate(`/search?q=${encodeURIComponent(query)}`);
            setFeedback(`Reproduciendo "${tracks[0].title}" - ${tracks[0].artist}`);
            return;
          }
        } catch (err) {
          console.error('[VoiceControl] Error in fast track search:', err);
        }

        // Si tampoco hay en YouTube, ir a la página de búsqueda
        navigate(`/search?q=${encodeURIComponent(query)}`);
        setFeedback(`Buscando "${query}"`);
        return;
      }

      setFeedback(`Comando no reconocido: "${rawText}"`);
    },
    [
      customCommands,
      setIsPlaying,
      nextTrack,
      prevTrack,
      volume,
      setVolume,
      isMuted,
      toggleMute,
      toggleLyrics,
      toggleQueue,
      toggleShuffle,
      cycleRepeat,
      currentTrack,
      isLiked,
      toggleLike,
      navigate,
      setTrack,
    ]
  );

  // Initialize SpeechRecognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'es-ES';

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
      setTranscript('');
      setInterimTranscript('');
      executedRef.current = false;
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let currentInterim = '';
      let finalScript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          finalScript += res[0].transcript;
        } else {
          currentInterim += res[0].transcript;
        }
      }

      const activeText = finalScript || currentInterim;
      if (currentInterim) {
        setInterimTranscript(currentInterim);
      }

      if (activeText && !executedRef.current) {
        // Chequear si ya coincide con un comando de control rápido (play/pause/next/prev/volumen)
        const lower = activeText.trim().toLowerCase();
        const isQuickControl =
          lower.includes('siguiente') ||
          lower.includes('next') ||
          lower.includes('anterior') ||
          lower.includes('previous') ||
          lower.includes('pausar') ||
          lower.includes('pausa') ||
          lower.includes('stop') ||
          lower.includes('subir volumen') ||
          lower.includes('bajar volumen') ||
          lower.includes('me gusta') ||
          finalScript.length > 0;

        if (isQuickControl) {
          executedRef.current = true;
          setTranscript(activeText);
          setInterimTranscript('');
          processCommand(activeText);
          try {
            recognition.stop();
          } catch {}
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn('[VoiceControl] Speech recognition error:', event.error);
      setIsListening(false);
      if (event.error === 'no-speech') {
        setError('No se detectó voz. Intenta de nuevo.');
      } else if (event.error === 'not-allowed') {
        setError('Permiso de micrófono denegado en el navegador.');
      } else {
        setError(`Error de voz: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  }, [processCommand]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) {
      setError('El reconocimiento de voz no está soportado en este navegador.');
      return;
    }
    try {
      setTranscript('');
      setInterimTranscript('');
      setFeedback(null);
      setError(null);
      executedRef.current = false;
      recognitionRef.current.start();
    } catch (e: any) {
      try {
        recognitionRef.current.stop();
        recognitionRef.current.start();
      } catch {}
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Global Keyboard Shortcuts: Alt + V & Simultaneous Vol Up + Vol Down
  useEffect(() => {
    const activeKeys = new Set<string>();
    let lastVolUpTime = 0;
    let lastVolDownTime = 0;
    let triggeredCombo = false;

    const isVolUp = (e: KeyboardEvent) =>
      e.key === 'AudioVolumeUp' || e.code === 'VolumeUp';

    const isVolDown = (e: KeyboardEvent) =>
      e.key === 'AudioVolumeDown' || e.code === 'VolumeDown';

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      const now = Date.now();

      if (isVolUp(e)) {
        activeKeys.add('vol_up');
        lastVolUpTime = now;
      } else if (isVolDown(e)) {
        activeKeys.add('vol_down');
        lastVolDownTime = now;
      }

      // Check if both volume up and volume down were pressed simultaneously or within 400ms
      const bothActive = activeKeys.has('vol_up') && activeKeys.has('vol_down');
      const withinWindow =
        lastVolUpTime > 0 &&
        lastVolDownTime > 0 &&
        Math.abs(lastVolUpTime - lastVolDownTime) < 400 &&
        Math.abs(now - Math.min(lastVolUpTime, lastVolDownTime)) < 600;

      if ((bothActive || withinWindow) && !triggeredCombo) {
        triggeredCombo = true;
        e.preventDefault();
        toggleListening();
        return;
      }

      // Shortcut: Alt + V
      if (e.altKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        toggleListening();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isVolUp(e)) {
        activeKeys.delete('vol_up');
      }
      if (isVolDown(e)) {
        activeKeys.delete('vol_down');
      }
      if (activeKeys.size === 0) {
        triggeredCombo = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [toggleListening]);

  return {
    isListening,
    transcript,
    interimTranscript,
    lastCommand,
    feedback,
    error,
    isSupported,
    customCommands,
    toggleListening,
    startListening,
    stopListening,
    updateCustomCommand,
    resetCustomCommands,
  };
}
