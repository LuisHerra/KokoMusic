/**
 * App Android (APK). La construye .github/workflows/android.yml en cada push a
 * master y la publica en la release fija "android-latest", así esta URL
 * siempre apunta a la última versión.
 */
export const ANDROID_APK_URL = 'https://github.com/LuisHerra/KokoMusic/releases/download/android-latest/KokoMusic.apk';

/** Puente nativo que expone la APK como `window.KokoAndroid` (ver MainActivity.kt). */
export interface KokoAndroidBridge {
  saveAudioToMusic(requestId: string, url: string, baseName: string): void;
  /** Estado para la notificación multimedia y la pantalla de bloqueo (APK sin servidor interno). */
  updatePlayback?(json: string): void;
  /** Icono del lanzador según el acento (uno de los predefinidos). */
  setAppIcon?(accent: string): void;
  /** Backend y usuario para que la APK publique notificaciones nativas (amigos, avisos). */
  setNotificationSource?(apiBase: string, userId: string): void;
  /** Guarda un vídeo en Películas/KokoMusic (solo en el dispositivo). */
  saveVideoToDevice?(requestId: string, url: string, baseName: string): void;
  /** JSON con los vídeos guardados: [{id, name, size, durationMs, addedAt}] */
  listVideos?(): string;
  deleteVideo?(id: string): boolean;
}

export interface LocalVideo { id: number; name: string; size: number; durationMs: number; addedAt: number }

/** La APK con soporte de vídeos locales. */
export const canSaveVideosOnDevice = () => !!window.KokoAndroid?.saveVideoToDevice;

/** Descarga un vídeo al dispositivo (solo APK). Resuelve con el nombre del archivo. */
export function saveVideoToDevice(url: string, baseName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const bridge = window.KokoAndroid;
    if (!bridge?.saveVideoToDevice) return reject(new Error('Solo disponible en la app de Android'));
    const requestId = `v${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const prev = window.__kokoVideoSaved;
    window.__kokoVideoSaved = (id, ok, message) => {
      if (id !== requestId) return prev?.(id, ok, message);
      window.__kokoVideoSaved = prev;
      ok ? resolve(message) : reject(new Error(message));
    };
    bridge.saveVideoToDevice(requestId, url, baseName);
  });
}

export function listLocalVideos(): LocalVideo[] {
  try { return JSON.parse(window.KokoAndroid?.listVideos?.() || '[]'); } catch { return []; }
}

export const deleteLocalVideo = (id: number) => !!window.KokoAndroid?.deleteVideo?.(String(id));

/** URL que la APK sirve desde el almacenamiento del dispositivo. */
export const localVideoUrl = (id: number) => `${window.location.origin}/__koko_local_video/${id}`;

declare global {
  interface Window {
    KokoAndroid?: KokoAndroidBridge;
    __kokoAudioSaved?: (requestId: string, ok: boolean, message: string) => void;
    /** La APK llama aquí con los botones de la notificación, auriculares o Bluetooth. */
    __kokoMediaAction?: (action: string) => void;
    /** La APK llama aquí al tocar una notificación social: abre la campana. */
    __kokoOpenNotifications?: () => void;
    __kokoVideoSaved?: (requestId: string, ok: boolean, message: string) => void;
  }
}

/** Indica a la APK a qué backend y usuario preguntar por avisos. Fuera de la APK no hace nada. */
export function syncAndroidNotificationSource(apiBase: string, userId: string) {
  try {
    window.KokoAndroid?.setNotificationSource?.(apiBase, userId);
  } catch { /* APK antigua sin este método */ }
}

/**
 * Dentro de la APK. La actual carga la web publicada y se reconoce por su
 * puente nativo; las antiguas la servían desde un servidor en 127.0.0.1:3001.
 */
export const isInsideAndroidApp = () =>
  typeof window !== 'undefined' && (
    !!window.KokoAndroid ||
    (window.location.hostname === '127.0.0.1' && window.location.port === '3001')
  );

export interface AndroidPlaybackState {
  title: string;
  artist: string;
  cover: string | null;
  isPlaying: boolean;
  /** Resolviendo/cargando la siguiente canción: la APK no debe congelarse. */
  isLoading?: boolean;
  positionS: number;
  durationS: number;
}

/** Envía a la APK lo que suena; null quita la notificación. Fuera de la APK no hace nada. */
export function syncAndroidPlayback(state: AndroidPlaybackState | null) {
  try {
    window.KokoAndroid?.updatePlayback?.(JSON.stringify(state));
  } catch { /* APK antigua sin este método */ }
}

/** Solo tiene sentido ofrecer la APK fuera de la app y en Android o escritorio (no en iPhone). */
export const canOfferAndroidApp = () =>
  typeof navigator !== 'undefined' && !isInsideAndroidApp() && !/iPhone|iPad|iPod/i.test(navigator.userAgent);

/** Pide a la APK el icono del acento `accent` (clave predefinida de themeStore). */
export function syncAndroidAppIcon(accent: string) {
  try {
    window.KokoAndroid?.setAppIcon?.(accent);
  } catch { /* APK antigua sin este método */ }
}
