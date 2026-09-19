/**
 * spotifyAuth.ts — Orquestador de autenticación y sincronización con Spotify OAuth
 * Maneja ventanas emergentes (popup), eventos postMessage, persistencia de perfil y gustos musicales.
 */

import { BASE } from './api';

export interface SpotifyAuthPayload {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number;
  userId: string;
  profile: {
    id: string;
    display_name: string;
    username: string;
    avatar_url?: string | null;
    bio?: string;
  };
  topArtists?: string[];
  topArtistsDetails?: Array<{ name: string; genres: string[]; image?: string }>;
  topGenres?: string[];
  topTracks?: Array<{ title: string; artist: string; cover?: string }>;
}

export interface SpotifyAuthOptions {
  origin?: string;
  onSuccess?: (payload: SpotifyAuthPayload) => void;
  onError?: (error: string) => void;
  onClose?: () => void;
}

/**
 * Aplica los datos de autenticación de Spotify a localStorage y despacha el evento storage.
 */
export function applySpotifyAuthSuccess(payload: SpotifyAuthPayload) {
  if (!payload.userId) return;

  localStorage.setItem('koko_device_id', payload.userId);
  if (payload.profile.display_name) {
    localStorage.setItem('koko_display_name', payload.profile.display_name);
  }
  if (payload.profile.avatar_url) {
    localStorage.setItem('koko_avatar_url', payload.profile.avatar_url);
  }
  if (payload.accessToken) {
    localStorage.setItem('koko_spotify_token', payload.accessToken);
  }
  if (payload.refreshToken) {
    localStorage.setItem('koko_spotify_refresh', payload.refreshToken);
  }

  // Guardar artistas favoritos para el algoritmo
  if (Array.isArray(payload.topArtists) && payload.topArtists.length > 0) {
    localStorage.setItem('koko_favorite_artists', JSON.stringify(payload.topArtists));

    // Mezclar con artistas escuchados existentes sin duplicar
    try {
      const existing = JSON.parse(localStorage.getItem('koko_listened_artists') || '[]');
      const combined = Array.from(new Set([...payload.topArtists, ...existing]));
      localStorage.setItem('koko_listened_artists', JSON.stringify(combined));
    } catch {
      localStorage.setItem('koko_listened_artists', JSON.stringify(payload.topArtists));
    }
  }

  if (Array.isArray(payload.topGenres) && payload.topGenres.length > 0) {
    localStorage.setItem('koko_onboarding_genres', JSON.stringify(payload.topGenres));
  }

  localStorage.setItem('koko_spotify_connected', 'true');
  localStorage.setItem('koko_onboarding_completed', 'true');

  window.dispatchEvent(new Event('storage'));
}

/**
 * Abre el popup de inicio de sesión de Spotify y captura el resultado mediante postMessage.
 */
export async function startSpotifyAuth(options: SpotifyAuthOptions = {}): Promise<void> {
  const { origin = 'profile', onSuccess, onError, onClose } = options;

  const width = 480;
  const height = 660;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;

  const loginUrl = `${BASE}/spotify/login?mode=popup&origin=${encodeURIComponent(origin)}`;

  const popup = window.open(
    loginUrl,
    'spotify_oauth',
    `width=${width},height=${height},left=${left},top=${top},status=0,toolbar=0,menubar=0,location=0`
  );

  if (!popup || popup.closed || typeof popup.closed === 'undefined') {
    // Popup bloqueado por el navegador
    if (onError) onError('La ventana emergente fue bloqueada por el navegador. Permite las ventanas emergentes para continuar con Spotify.');
    return;
  }

  let cleanupDone = false;

  const cleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    window.removeEventListener('message', messageListener);
    clearInterval(pollTimer);
  };

  const messageListener = (event: MessageEvent) => {
    if (!event.data || typeof event.data !== 'object') return;

    if (event.data.type === 'SPOTIFY_AUTH_SUCCESS') {
      cleanup();
      applySpotifyAuthSuccess(event.data);
      if (onSuccess) onSuccess(event.data);
    } else if (event.data.type === 'SPOTIFY_AUTH_ERROR') {
      cleanup();
      if (onError) onError(event.data.error || 'Error de autorización en Spotify');
    }
  };

  window.addEventListener('message', messageListener);

  // Monitorizar si el usuario cerró el popup manualmente
  const pollTimer = setInterval(() => {
    if (popup.closed) {
      cleanup();
      if (onClose) onClose();
    }
  }, 500);
}

/**
 * Devuelve si la cuenta actual tiene Spotify vinculado en localStorage
 */
export function isSpotifyConnected(): boolean {
  return localStorage.getItem('koko_spotify_connected') === 'true' && !!localStorage.getItem('koko_spotify_token');
}

/**
 * Desvincula la sesión de Spotify de la cuenta local
 */
export function disconnectSpotify(): void {
  localStorage.removeItem('koko_spotify_token');
  localStorage.removeItem('koko_spotify_refresh');
  localStorage.removeItem('koko_spotify_connected');
  window.dispatchEvent(new Event('storage'));
}
