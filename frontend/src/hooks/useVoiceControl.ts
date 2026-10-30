import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../store/playerStore';
import { searchTracks, apiFetch, getTrackRadio } from '../lib/api';
import { pickRecommendations } from '../lib/recommendationPicker';
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

// Se comparan con la frase ENTERA (normalizada: sin tildes ni signos), no como
// subcadena: antes "pon Stop This Train" pausaba y "Para siempre" también.
export const DEFAULT_VOICE_COMMANDS: Record<VoiceActionId, string[]> = {
  play: ['reproducir', 'play', 'reanudar', 'continuar', 'reproduce', 'empieza', 'dale', 'resume', 'reprendre', 'lecture'],
  pause: ['pausar', 'pausa', 'pause', 'detener', 'parar', 'stop', 'para', 'arrete', 'mets en pause'],
  next: ['siguiente', 'next', 'saltar', 'salta', 'pasar', 'pasa', 'avanzar', 'skip', 'suivant', 'suivante'],
  prev: ['anterior', 'previous', 'atras', 'volver', 'retroceder', 'back', 'precedent', 'precedente'],
  vol_up: ['subir volumen', 'sube el volumen', 'mas volumen', 'sube', 'volume up', 'louder', 'monte le son', 'plus fort'],
  vol_down: ['bajar volumen', 'baja el volumen', 'menos volumen', 'baja', 'volume down', 'quieter', 'baisse le son', 'moins fort'],
  like: ['me gusta', 'favorito', 'like', 'guardar', 'megusta', 'me encanta', 'j aime'],
  lyrics: ['letras', 'letra', 'lyrics', 'paroles'],
  queue: ['cola', 'queue', 'lista de reproduccion', 'file d attente'],
  shuffle: ['aleatorio', 'shuffle', 'mezclar', 'aleatoire'],
  repeat: ['repetir', 'repeat', 'bucle', 'repeter'],
};

// Versión de los comandos por defecto: al subirla, las frases nuevas se añaden
// a las personalizadas que el usuario ya tenía guardadas.
const COMMANDS_VERSION = 2;
const COMMANDS_KEY = 'koko_custom_voice_commands';
const COMMANDS_VERSION_KEY = 'koko_custom_voice_commands_v';

/** Idiomas del reconocimiento del navegador (solo entiende uno a la vez). */
export const BROWSER_VOICE_LANGS = [
  { code: 'es-ES', label: 'ES' },
  { code: 'en-US', label: 'EN' },
  { code: 'fr-FR', label: 'FR' },
] as const;
const BROWSER_LANG_KEY = 'koko_voice_lang';

/** 'whisper': graba y transcribe en el servidor, detecta el idioma solo. */
export type VoiceEngine = 'whisper' | 'browser' | 'none';

export interface VoiceControlState {
  isListening: boolean;
  isTranscribing: boolean;
  transcript: string;
  interimTranscript: string;
  lastCommand: string | null;
  feedback: string | null;
  error: string | null;
  isSupported: boolean;
  engine: VoiceEngine;
  browserLang: string;
  setBrowserLang: (lang: string) => void;
  customCommands: Record<VoiceActionId, string[]>;
  toggleListening: () => void;
  startListening: () => void;
  stopListening: () => void;
  updateCustomCommand: (action: VoiceActionId, phrases: string[]) => void;
  resetCustomCommands: () => void;
}

// ── Texto ────────────────────────────────────────────────────────────────────

/** Minúsculas, sin signos de puntuación y espacios colapsados (conserva tildes). */
function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’'`]/g, ' ')
    .replace(/[.,;:!?¡¿"«»()[\]{}…-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Como clean() y además sin tildes: para comparar con las frases de comando. */
function normalize(text: string): string {
  return clean(text).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Solo con "koko" delante: "Hey Jude" o "Please Please Me" son títulos.
const FILLER = /^(?:(?:oye|hey|ok|okay|vale)\s+)?koko\s+|\s+(?:por favor|please|s il te plait|s il vous plait)$/g;

// Verbos para pedir una canción en español, inglés y francés (normalizados).
const PLAY_VERBS = /^(?:pon(?:me|nos)?|ponga|reproduce(?:me)?|reproducir|escuchar|quiero escuchar|toca|play|put on|i want to hear|joue|jouer|mets(?: moi)?|lance|ecouter|je veux ecouter)\s+(?:la cancion\s+|el tema\s+|the song\s+|la chanson\s+)?/;
const SEARCH_VERBS = /^(?:busca(?:r|me)?|search(?: for)?|cherche(?:r)?|recherche(?:r)?)\s+/;

// Lo que Whisper "oye" en un audio casi vacío: no son peticiones reales.
const HALLUCINATIONS = ['gracias', 'muchas gracias', 'thank you', 'thanks for watching', 'subtitulos', 'sous titres', 'merci', 'you'];

/** Quita el prefijo `prefixNormalized` (medido en palabras) del texto original limpio. */
function stripWords(cleanText: string, prefixNormalized: string): string {
  const n = prefixNormalized.trim().split(' ').filter(Boolean).length;
  return cleanText.split(' ').slice(n).join(' ').trim();
}

/** Pitido corto al empezar/terminar de escuchar: dentro de un juego no se ve el modal. */
function beep(frequency: number) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => { ctx.close().catch(() => {}); };
  } catch { /* sin audio: no pasa nada */ }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Detección de silencio de la grabación
const SPEECH_RMS = 0.02;
const END_SILENCE_MS = 1100;
const NO_SPEECH_TIMEOUT_MS = 6000;
const MAX_RECORDING_MS = 12000;
// Mantener Alt+V más de esto = pulsar para hablar (se envía al soltar)
const PUSH_TO_TALK_MS = 400;

export function useVoiceControl(): VoiceControlState {
  const navigate = useNavigate();
  const recognitionRef = useRef<any>(null);

  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasBrowserSpeech = typeof window !== 'undefined'
    && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const canRecord = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  const [engine, setEngine] = useState<VoiceEngine>(hasBrowserSpeech ? 'browser' : 'none');
  const [browserLang, setBrowserLangState] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(BROWSER_LANG_KEY);
      if (saved) return saved;
      const prefix = (navigator.language || 'es').slice(0, 2).toLowerCase();
      return BROWSER_VOICE_LANGS.find((l) => l.code.startsWith(prefix))?.code ?? 'es-ES';
    } catch { return 'es-ES'; }
  });

  const setBrowserLang = useCallback((lang: string) => {
    setBrowserLangState(lang);
    try { localStorage.setItem(BROWSER_LANG_KEY, lang); } catch { /* noop */ }
  }, []);

  // Custom Voice Commands stored in localStorage
  const [customCommands, setCustomCommands] = useState<Record<VoiceActionId, string[]>>(() => {
    try {
      const saved = localStorage.getItem(COMMANDS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<VoiceActionId, string[]>;
        if (Number(localStorage.getItem(COMMANDS_VERSION_KEY) || 1) >= COMMANDS_VERSION) return parsed;
        const merged = { ...DEFAULT_VOICE_COMMANDS };
        for (const action of Object.keys(DEFAULT_VOICE_COMMANDS) as VoiceActionId[]) {
          merged[action] = Array.from(new Set([...(parsed[action] || []), ...DEFAULT_VOICE_COMMANDS[action]]));
        }
        localStorage.setItem(COMMANDS_KEY, JSON.stringify(merged));
        localStorage.setItem(COMMANDS_VERSION_KEY, String(COMMANDS_VERSION));
        return merged;
      }
    } catch {}
    return DEFAULT_VOICE_COMMANDS;
  });

  const updateCustomCommand = useCallback((action: VoiceActionId, phrases: string[]) => {
    setCustomCommands((prev) => {
      const updated = { ...prev, [action]: phrases.map((p) => p.trim().toLowerCase()).filter(Boolean) };
      localStorage.setItem(COMMANDS_KEY, JSON.stringify(updated));
      localStorage.setItem(COMMANDS_VERSION_KEY, String(COMMANDS_VERSION));
      return updated;
    });
  }, []);

  const resetCustomCommands = useCallback(() => {
    setCustomCommands(DEFAULT_VOICE_COMMANDS);
    localStorage.setItem(COMMANDS_KEY, JSON.stringify(DEFAULT_VOICE_COMMANDS));
    localStorage.setItem(COMMANDS_VERSION_KEY, String(COMMANDS_VERSION));
  }, []);

  // Whisper si el servidor tiene clave; si no, el reconocimiento del navegador.
  useEffect(() => {
    if (!canRecord) return;
    let cancelled = false;
    apiFetch<{ available: boolean }>('/voice/status')
      .then((s) => { if (!cancelled && s.available) setEngine('whisper'); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [canRecord]);

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

  /**
   * Acción cuya frase coincide con la petición entera ("la siguiente canción"
   * también vale). Sin `strict` admite además 1-2 palabras de relleno.
   */
  const matchAction = useCallback((norm: string, strict = false): VoiceActionId | null => {
    const core = norm
      .replace(/^(?:la|el|lo|the|le)\s+/, '')
      .replace(/\s+(?:cancion|tema|song|track|chanson|morceau)$/, '');
    const words = norm.split(' ').length;
    for (const action of Object.keys(DEFAULT_VOICE_COMMANDS) as VoiceActionId[]) {
      const phrases = customCommands[action] || DEFAULT_VOICE_COMMANDS[action] || [];
      for (const raw of phrases) {
        const p = normalize(raw);
        if (!p) continue;
        if (norm === p || core === p) return action;
        if (strict) continue;
        const extra = words - p.split(' ').length;
        if (extra > 0 && extra <= 2 && (norm.startsWith(p + ' ') || norm.endsWith(' ' + p))) return action;
      }
    }
    return null;
  }, [customCommands]);

  const playQuery = useCallback(async (query: string) => {
    setFeedback(`Buscando "${query}"...`);
    try {
      // Intentar primero en iTunes / catálogo central de KokoMusic
      let searchRes = await searchTracks(query, 10, 'itunes').catch(() => null);
      let tracks = searchRes?.tracks || [];

      // Si no devuelve nada en iTunes → buscar inmediatamente en YouTube
      if (tracks.length === 0) {
        searchRes = await searchTracks(query, 10, 'youtube').catch(() => null);
        tracks = searchRes?.tracks || [];
      }

      if (tracks.length > 0) {
        // Solo la canción pedida: el resto de resultados son homónimos, no lo
        // que quieres oír después. La cola sigue con su radio (recomendaciones).
        const picked = tracks[0];
        setTrack(picked, [picked]);
        setFeedback(`Reproduciendo "${picked.title}" - ${picked.artist}`);
        getTrackRadio(picked.id)
          .then((radio) => {
            const { queue, currentTrack: playing, sessionPlayedTrackIds } = usePlayerStore.getState();
            if (playing?.id !== picked.id || !radio?.tracks?.length) return;
            const existing = new Set([...queue.map((t) => t.id), ...(sessionPlayedTrackIds || [])]);
            const fresh = pickRecommendations(radio.tracks, 10, existing);
            if (fresh.length > 0) usePlayerStore.getState().appendQueue(fresh);
          })
          .catch(() => { /* la cola se rellena sola al terminar la canción */ });
        return;
      }
    } catch (err) {
      console.error('[VoiceControl] Error in fast track search:', err);
    }

    // Si tampoco hay en YouTube, ir a la página de búsqueda
    navigate(`/search?q=${encodeURIComponent(query)}`);
    setFeedback(`Buscando "${query}"`);
  }, [navigate, setTrack]);

  const runAction = useCallback((action: VoiceActionId) => {
    switch (action) {
      case 'pause':
        setIsPlaying(false);
        setFeedback('Reproducción pausada');
        break;
      case 'play':
        setIsPlaying(true);
        setFeedback('Reproduciendo música');
        break;
      case 'next':
        nextTrack();
        setFeedback('Siguiente canción');
        break;
      case 'prev':
        prevTrack();
        setFeedback('Canción anterior');
        break;
      case 'vol_up': {
        const newVol = Math.min(1, volume + 0.2);
        setVolume(newVol);
        setFeedback(`Volumen al ${Math.round(newVol * 100)}%`);
        break;
      }
      case 'vol_down': {
        const newVol = Math.max(0, volume - 0.2);
        setVolume(newVol);
        setFeedback(`Volumen al ${Math.round(newVol * 100)}%`);
        break;
      }
      case 'lyrics':
        toggleLyrics();
        setFeedback('Pantalla de letras alternada');
        break;
      case 'queue':
        toggleQueue();
        setFeedback('Cola de reproducción alternada');
        break;
      case 'shuffle':
        toggleShuffle();
        setFeedback('Modo aleatorio alternado');
        break;
      case 'repeat':
        cycleRepeat();
        setFeedback('Modo repetición cambiado');
        break;
      case 'like':
        if (currentTrack) {
          const currentlyLiked = isLiked(currentTrack.id);
          toggleLike(currentTrack.id);
          setFeedback(currentlyLiked ? 'Eliminado de Me Gusta' : 'Añadido a Me Gusta');
        } else {
          setFeedback('No hay canción en reproducción');
        }
        break;
    }
  }, [setIsPlaying, nextTrack, prevTrack, volume, setVolume, toggleLyrics, toggleQueue, toggleShuffle, cycleRepeat, currentTrack, isLiked, toggleLike]);

  const processCommand = useCallback(
    async (rawText: string) => {
      const cleaned = clean(rawText);
      const full = normalize(rawText);
      const norm = full.replace(FILLER, '').trim();
      if (!norm) return;

      setLastCommand(rawText);
      setError(null);

      if (HALLUCINATIONS.includes(norm)) {
        setFeedback('No te he entendido, prueba otra vez');
        return;
      }
      // Lo mismo que `norm` pero con tildes y sin el relleno: es lo que se busca.
      const skip = full.slice(0, full.indexOf(norm)).split(' ').filter(Boolean).length;
      const body = cleaned.split(' ').slice(skip, skip + norm.split(' ').length).join(' ');

      // ── 1. Pedir una canción ("pon …", "play …", "mets …") ──
      // Va primero: el título puede contener palabras de comando.
      const playMatch = norm.match(PLAY_VERBS);
      if (playMatch) {
        const rest = norm.slice(playMatch[0].length).trim();
        const restAction = matchAction(rest, true);
        // "pon la siguiente" es un comando, no una canción
        if (restAction && restAction !== 'play') {
          runAction(restAction);
          return;
        }
        await playQuery(stripWords(body, playMatch[0]) || rest);
        return;
      }

      // ── 2. Búsqueda ──
      const searchMatch = norm.match(SEARCH_VERBS);
      if (searchMatch) {
        const query = stripWords(body, searchMatch[0]);
        navigate(`/search?q=${encodeURIComponent(query)}`);
        setFeedback(`Buscando "${query}"`);
        return;
      }

      // ── 3. Volumen exacto ("volumen al 40", "volume 40") ──
      const matchVolNum = norm.match(/^(?:pon el\s+|set\s+|mets le\s+)?(?:volumen|volume)\s+(?:al\s+|a\s+|to\s+|at\s+|a\s+)?([0-9]+)(?:\s*%|\s+por ciento|\s+percent|\s+pour cent)?$/);
      if (matchVolNum) {
        const val = Math.max(0, Math.min(100, parseInt(matchVolNum[1], 10)));
        setVolume(val / 100);
        setFeedback(`Volumen al ${val}%`);
        return;
      }

      if (/^(?:mutear|silenciar|silencio|mute|couper le son)$/.test(norm)) {
        if (!isMuted) toggleMute();
        setFeedback('Sonido silenciado');
        return;
      }
      if (/^(?:desmutear|unmute|activar sonido|quitar silencio|remettre le son)$/.test(norm)) {
        if (isMuted) toggleMute();
        setFeedback('Sonido activado');
        return;
      }

      // ── 4. Comandos de control ──
      const action = matchAction(norm);
      if (action) {
        runAction(action);
        return;
      }

      // ── 5. Cualquier otra cosa: es el nombre de una canción/artista ──
      await playQuery(body || cleaned);
    },
    [matchAction, runAction, playQuery, navigate, setVolume, isMuted, toggleMute]
  );

  // processCommand cambia con el estado del reproductor; los manejadores de
  // grabación/reconocimiento son de larga vida y leen siempre la última versión.
  const processRef = useRef(processCommand);
  useEffect(() => { processRef.current = processCommand; }, [processCommand]);

  // ── Motor del navegador (Web Speech: un solo idioma) ─────────────────────────
  useEffect(() => {
    if (engine !== 'browser') return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = browserLang;
    let executed = false;

    recognition.onstart = () => {
      beep(880);
      executed = false;
      setIsListening(true);
      setError(null);
      setTranscript('');
      setInterimTranscript('');
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      if (interim) setInterimTranscript(interim);
      if (executed || !final) return;
      executed = true;
      setTranscript(final);
      setInterimTranscript('');
      processRef.current(final);
      try { recognition.stop(); } catch {}
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn('[VoiceControl] Speech recognition error:', event.error);
      setIsListening(false);
      if (event.error === 'no-speech') setError('No se detectó voz. Intenta de nuevo.');
      else if (event.error === 'not-allowed') setError('Permiso de micrófono denegado.');
      else if (event.error !== 'aborted') setError(`Error de voz: ${event.error}`);
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    return () => {
      try { recognition.abort(); } catch {}
      if (recognitionRef.current === recognition) recognitionRef.current = null;
    };
  }, [engine, browserLang]);

  // ── Motor Whisper (graba → servidor; detecta el idioma solo) ─────────────────
  const recorderRef = useRef<{ stop: (send: boolean) => void } | null>(null);
  // true mientras se mantiene Alt+V: no cortar por silencio, se envía al soltar.
  const holdToTalkRef = useRef(false);

  const transcribe = useCallback(async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      const audioBase64 = await blobToBase64(blob);
      const { text } = await apiFetch<{ text: string }>('/voice/transcribe', {
        method: 'POST',
        body: JSON.stringify({ audioBase64, mimeType: blob.type }),
      });
      if (!text) {
        setError('No te he entendido, prueba otra vez.');
        return;
      }
      setTranscript(text);
      await processRef.current(text);
    } catch (err: any) {
      if (String(err?.message).includes('no_key')) {
        setEngine(hasBrowserSpeech ? 'browser' : 'none');
        setError('La transcripción del servidor no está disponible; usando la del navegador.');
      } else {
        setError('No se pudo transcribir. Inténtalo de nuevo.');
      }
    } finally {
      setIsTranscribing(false);
    }
  }, [hasBrowserSpeech]);

  const startRecording = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setError('Permiso de micrófono denegado.');
      return;
    }

    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
      .find((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
    const chunks: Blob[] = [];
    let send = true;
    let heardSpeech = false;

    // Bajar la música mientras hablas: se entiende mejor y el eco molesta menos.
    const player = usePlayerStore.getState();
    const duckedFrom = player.isPlaying && player.volume > 0.15 ? player.volume : null;
    if (duckedFrom !== null) player.setVolume(0.15);

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const startedAt = Date.now();
    let lastVoiceAt = startedAt;

    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += s * s;
      const now = Date.now();
      if (Math.sqrt(sum / samples.length) > SPEECH_RMS) {
        heardSpeech = true;
        lastVoiceAt = now;
      }
      const hold = holdToTalkRef.current;
      if (now - startedAt > MAX_RECORDING_MS) stop(true);
      else if (!hold && heardSpeech && now - lastVoiceAt > END_SILENCE_MS) stop(true);
      else if (!hold && !heardSpeech && now - startedAt > NO_SPEECH_TIMEOUT_MS) stop(true);
    }, 100);

    function stop(shouldSend: boolean) {
      if (recorder.state === 'inactive') return;
      send = shouldSend;
      recorder.stop();
    }

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      window.clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      if (duckedFrom !== null) usePlayerStore.getState().setVolume(duckedFrom);
      recorderRef.current = null;
      setIsListening(false);
      if (!send) return;
      beep(660);
      if (!heardSpeech) {
        setError('No se detectó voz. Intenta de nuevo.');
        return;
      }
      transcribe(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
    };

    recorderRef.current = { stop };
    recorder.start(250);
    beep(880);
    setIsListening(true);
  }, [transcribe]);

  // ── API pública ──────────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
    setFeedback(null);
    setError(null);
    if (engine === 'whisper') {
      if (!recorderRef.current) startRecording();
      return;
    }
    if (!recognitionRef.current) {
      setError('El reconocimiento de voz no está soportado aquí.');
      return;
    }
    try {
      recognitionRef.current.start();
    } catch {
      try {
        recognitionRef.current.stop();
        recognitionRef.current.start();
      } catch {}
    }
  }, [engine, startRecording]);

  /** Termina de escuchar y procesa lo dicho hasta ahora. */
  const stopListening = useCallback(() => {
    if (recorderRef.current) recorderRef.current.stop(true);
    else if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setIsListening(false);
  }, []);

  const isListeningRef = useRef(isListening);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);

  const toggleListening = useCallback(() => {
    if (isListeningRef.current) stopListening();
    else startListening();
  }, [startListening, stopListening]);

  // Atajos: Alt+V pulsado = manos libres (para solo al callar); mantenido = pulsar
  // para hablar (envía al soltar). Alt+L cambia el idioma del motor del navegador.
  // Volumen+ y Volumen- a la vez también activan la escucha (móvil).
  useEffect(() => {
    const activeKeys = new Set<string>();
    let lastVolUpTime = 0;
    let lastVolDownTime = 0;
    let triggeredCombo = false;
    let pttDownAt = 0;
    let pttTimer: number | undefined;

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

      if (e.altKey && e.code === 'KeyV') {
        e.preventDefault();
        if (e.repeat) return;
        if (isListeningRef.current) {
          stopListening();
          return;
        }
        pttDownAt = now;
        holdToTalkRef.current = false;
        startListening();
        // Si sigue pulsado pasado el umbral, pasa a pulsar-para-hablar: la
        // detección de silencio deja de cortar y se envía al soltar.
        pttTimer = window.setTimeout(() => {
          if (pttDownAt) holdToTalkRef.current = true;
        }, PUSH_TO_TALK_MS);
        return;
      }

      if (e.altKey && e.code === 'KeyL' && engine === 'browser') {
        e.preventDefault();
        const i = BROWSER_VOICE_LANGS.findIndex((l) => l.code === browserLang);
        const next = BROWSER_VOICE_LANGS[(i + 1) % BROWSER_VOICE_LANGS.length];
        setBrowserLang(next.code);
        setFeedback(`Idioma de voz: ${next.label}`);
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
      if (pttDownAt && (e.code === 'KeyV' || e.key === 'Alt')) {
        const held = Date.now() - pttDownAt;
        pttDownAt = 0;
        window.clearTimeout(pttTimer);
        holdToTalkRef.current = false;
        if (held >= PUSH_TO_TALK_MS) stopListening();
      }
    };

    const handleCustomToggle = () => {
      toggleListening();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('koko-toggle-voice', handleCustomToggle);
    return () => {
      window.clearTimeout(pttTimer);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('koko-toggle-voice', handleCustomToggle);
    };
  }, [toggleListening, startListening, stopListening, engine, browserLang, setBrowserLang]);

  return {
    isListening,
    isTranscribing,
    transcript,
    interimTranscript,
    lastCommand,
    feedback,
    error,
    isSupported: engine !== 'none',
    engine,
    browserLang,
    setBrowserLang,
    customCommands,
    toggleListening,
    startListening,
    stopListening,
    updateCustomCommand,
    resetCustomCommands,
  };
}
