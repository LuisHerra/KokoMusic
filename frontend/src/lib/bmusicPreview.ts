/**
 * Reproductor aparte para escuchar un B-Music sin tocar el reproductor
 * principal: pausa lo que suena pero NO cambia la canción ni la cola, así que
 * al volver a darle al play sigue la que estabas escuchando.
 */
import { create } from 'zustand';
import { getStreamUrl } from './api';
import { usePlayerStore } from '../store/playerStore';

interface PreviewState {
  trackId: string | null;
  playing: boolean;
}

export const useBMusicPreview = create<PreviewState>(() => ({ trackId: null, playing: false }));

let audio: HTMLAudioElement | null = null;

function el(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('playing', () => useBMusicPreview.setState({ playing: true }));
  audio.addEventListener('pause', () => useBMusicPreview.setState({ playing: false }));
  audio.addEventListener('ended', () => useBMusicPreview.setState({ playing: false }));
  return audio;
}

export function stopBMusicPreview() {
  if (!audio) return;
  audio.pause();
  useBMusicPreview.setState({ trackId: null, playing: false });
}

/** Reproduce (o para, si ya suena) el B-Music `trackId` desde `startS`. */
export function toggleBMusicPreview(trackId: string, startS = 0) {
  const a = el();
  const state = useBMusicPreview.getState();
  if (state.trackId === trackId && state.playing) {
    a.pause();
    return;
  }
  // Pausar el reproductor principal sin cambiar su canción
  const player = usePlayerStore.getState();
  if (player.isPlaying) player.setIsPlaying(false);

  if (state.trackId !== trackId) {
    a.src = getStreamUrl(trackId);
    const seek = () => { if (startS > 0) try { a.currentTime = startS; } catch { /* sin seek */ } };
    a.addEventListener('loadedmetadata', seek, { once: true });
    useBMusicPreview.setState({ trackId, playing: false });
  }
  a.play().catch(() => useBMusicPreview.setState({ playing: false }));
}

// Si el usuario vuelve a darle al play del reproductor principal, se para el B-Music
usePlayerStore.subscribe((s, prev) => {
  if (s.isPlaying && !prev.isPlaying && useBMusicPreview.getState().playing) audio?.pause();
});
