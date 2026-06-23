/**
 * Offline Audio Storage using IndexedDB (KokoMusic)
 * Permite descargar pistas de audio directamente al dispositivo del usuario y
 * reproducirlas sin latencia de red. Elimina automáticamente archivos no escuchados tras 2 días.
 */

const DB_NAME = 'KokoOfflineDB';
const STORE_NAME = 'tracks';
const DB_VERSION = 1;

export interface OfflineTrack {
  id: string;
  blob: Blob;
  lastAccessed: number;
  title: string;
  artist: string;
  cover: string;
  duration: number;
  createdAt: number;
}

export function initOfflineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB no está soportado en este navegador'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

export async function isTrackOffline(trackId: string): Promise<boolean> {
  try {
    const db = await initOfflineDB();
    return new Promise((resolve) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(trackId);

      request.onsuccess = () => {
        resolve(!!request.result);
      };

      request.onerror = () => {
        resolve(false);
      };
    });
  } catch {
    return false;
  }
}

export async function saveTrackOffline(
  trackId: string,
  metadata: { title: string; artist: string; cover: string; duration: number }
): Promise<void> {
  const db = await initOfflineDB();
  const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api';
  
  // 1. Descargar el stream desde el backend forzando la transmisión (evitando embedMode) y desactivando la descarga en background para el CDN
  const res = await fetch(`${API_BASE}/stream/${trackId}?forceStream=true&autoDownload=false`);
  if (!res.ok) {
    throw new Error(`Error al descargar el track de audio: ${res.status}`);
  }

  // Si a pesar de todo la respuesta es un JSON (por ejemplo, error devuelto del backend en json)
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    throw new Error(data.error || 'No se pudo obtener el archivo de audio para este track.');
  }

  const blob = await res.blob();
  if (blob.size === 0) {
    throw new Error('El archivo de audio descargado está vacío');
  }

  // 2. Guardar en IndexedDB
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const record: OfflineTrack = {
      id: trackId,
      blob,
      lastAccessed: Date.now(),
      title: metadata.title,
      artist: metadata.artist,
      cover: metadata.cover,
      duration: metadata.duration,
      createdAt: Date.now(),
    };

    const request = store.put(record);

    request.onsuccess = () => {
      console.log(`[OfflineDB] Track ${trackId} guardado localmente (${(blob.size / (1024 * 1024)).toFixed(2)} MB)`);
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function getOfflineTrack(trackId: string): Promise<OfflineTrack | null> {
  try {
    const db = await initOfflineDB();
    const track = await new Promise<OfflineTrack | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(trackId);

      request.onsuccess = () => {
        resolve(request.result || null);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });

    if (track) {
      // Actualizar la fecha de último acceso de forma asíncrona (re-tocar)
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      track.lastAccessed = Date.now();
      store.put(track);
    }

    return track;
  } catch (err) {
    console.error('[OfflineDB] Error al obtener track:', err);
    return null;
  }
}

export async function deleteOfflineTrack(trackId: string): Promise<void> {
  const db = await initOfflineDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(trackId);

    request.onsuccess = () => {
      console.log(`[OfflineDB] Track ${trackId} eliminado de IndexedDB`);
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Elimina las descargas de tracks que no hayan sido escuchados en los últimos 2 días.
 */
export async function cleanupOldOfflineTracks(): Promise<number> {
  try {
    const db = await initOfflineDB();
    const now = Date.now();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    const expirationLimit = now - twoDaysMs;

    // Obtener todos los tracks
    const tracks = await new Promise<OfflineTrack[]>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });

    let deletedCount = 0;
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    for (const track of tracks) {
      if (track.lastAccessed < expirationLimit) {
        store.delete(track.id);
        deletedCount++;
        console.log(`[OfflineDB] 🗑️ Eliminando por inactividad: "${track.title}" (última escucha hace ${((now - track.lastAccessed) / (3600 * 1000)).toFixed(1)}h)`);
      }
    }

    return deletedCount;
  } catch (err) {
    console.error('[OfflineDB] Error en limpieza de IndexedDB:', err);
    return 0;
  }
}
