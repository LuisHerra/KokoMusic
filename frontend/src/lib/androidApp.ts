/**
 * App Android (APK). La construye .github/workflows/android.yml en cada push a
 * master y la publica en la release fija "android-latest", así esta URL
 * siempre apunta a la última versión.
 */
export const ANDROID_APK_URL = 'https://github.com/LuisHerra/KokoMusic/releases/download/android-latest/KokoMusic.apk';

/** Dentro de la APK la web la sirve el servidor embebido en 127.0.0.1:3001. */
export const isInsideAndroidApp = () =>
  typeof window !== 'undefined' && window.location.hostname === '127.0.0.1' && window.location.port === '3001';

/** Solo tiene sentido ofrecer la APK fuera de la app y en Android o escritorio (no en iPhone). */
export const canOfferAndroidApp = () =>
  typeof navigator !== 'undefined' && !isInsideAndroidApp() && !/iPhone|iPad|iPod/i.test(navigator.userAgent);
