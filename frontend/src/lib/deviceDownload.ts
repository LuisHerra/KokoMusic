/**
 * Descarga "externa": guarda la canción como archivo de audio en el propio
 * dispositivo (carpeta de descargas del navegador, o Música/KokoMusic en la
 * APK), fuera de la app. A diferencia de saveTrackOffline (IndexedDB, que se
 * limpia sola tras 2 días sin escuchar), el archivo es del usuario: lo ven el
 * explorador de archivos y cualquier reproductor de música.
 */

import { isInsideAndroidApp } from './androidApp';
import { trackAudioUrl } from './offlineAudio';

/** Puente nativo que expone MainActivity.kt en la APK (ver AudioExportBridge). */
interface KokoAndroidBridge {
  saveAudioToMusic(requestId: string, url: string, baseName: string): void;
}

declare global {
  interface Window {
    KokoAndroid?: KokoAndroidBridge;
    __kokoAudioSaved?: (requestId: string, ok: boolean, message: string) => void;
  }
}

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'video/mp4': 'm4a',
  'video/webm': 'webm',
};

function extensionFor(mime: string): string {
  return EXTENSION_BY_MIME[mime.split(';')[0].trim().toLowerCase()] ?? 'm4a';
}

/** "Artista - Título" sin caracteres que Windows/Android no aceptan en un nombre de archivo. */
function fileBaseName(meta: { title: string; artist: string }): string {
  const raw = [meta.artist, meta.title].filter(Boolean).join(' - ') || 'KokoMusic';
  const clean = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return (clean || 'KokoMusic').slice(0, 120);
}

const pendingAndroidSaves = new Map<string, { resolve: (msg: string) => void; reject: (err: Error) => void }>();

/**
 * En la APK un `blob:` no se puede pasar al gestor de descargas del WebView:
 * la descarga la hace el lado nativo y la guarda en Música/KokoMusic
 * (MediaStore), y avisa al terminar llamando a window.__kokoAudioSaved.
 */
function saveViaAndroid(bridge: KokoAndroidBridge, url: string, baseName: string): Promise<string> {
  window.__kokoAudioSaved ??= (requestId, ok, message) => {
    const pending = pendingAndroidSaves.get(requestId);
    if (!pending) return;
    pendingAndroidSaves.delete(requestId);
    if (ok) pending.resolve(message);
    else pending.reject(new Error(message || 'No se pudo guardar el audio'));
  };
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    pendingAndroidSaves.set(requestId, { resolve, reject });
    try {
      bridge.saveAudioToMusic(requestId, url, baseName);
    } catch (err) {
      pendingAndroidSaves.delete(requestId);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Guarda el audio del track como archivo en el dispositivo. Devuelve un texto
 * corto para mostrar al usuario dónde ha quedado.
 */
export async function saveTrackToDevice(
  trackId: string,
  meta: { title: string; artist: string }
): Promise<string> {
  if (!trackId) throw new Error('No hay canción que descargar');
  const url = await trackAudioUrl(trackId);
  const baseName = fileBaseName(meta);

  const bridge = isInsideAndroidApp() ? window.KokoAndroid : undefined;
  if (bridge) {
    await saveViaAndroid(bridge, url, baseName);
    return 'Guardada en Música/KokoMusic';
  }
  if (isInsideAndroidApp()) {
    throw new Error('Actualiza la app de Android para descargar canciones a tu dispositivo');
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Error al descargar el audio: ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo obtener el archivo de audio para esta canción.');
  }
  const blob = await res.blob();
  if (blob.size === 0) throw new Error('El archivo de audio descargado está vacío');

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `${baseName}.${extensionFor(contentType || blob.type)}`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Margen para que el navegador termine de leer el blob antes de liberarlo.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return 'Descargada en tu dispositivo';
}
