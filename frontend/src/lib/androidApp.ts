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
}

declare global {
  interface Window {
    KokoAndroid?: KokoAndroidBridge;
    __kokoAudioSaved?: (requestId: string, ok: boolean, message: string) => void;
    /** La APK llama aquí con los botones de la notificación, auriculares o Bluetooth. */
    __kokoMediaAction?: (action: string) => void;
  }
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
