// IndexedDB Client-Side Cache for Large Audio Files (>8MB)
// Auto-cleans files after 2 days of inactivity (not listened to).

const DB_NAME = 'koko_local_audio';
const STORE_NAME = 'audios';
const DB_VERSION = 1;

export interface LocalAudioRecord {
  id: string;
  blob: Blob;
  lastListened: number; // timestamp
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveLocalAudio(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const record: LocalAudioRecord = {
      id,
      blob,
      lastListened: Date.now()
    };
    const request = store.put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getLocalAudio(id: string): Promise<string | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      const record = request.result as LocalAudioRecord | undefined;
      if (!record) {
        resolve(null);
        return;
      }
      // Actualizar último acceso (inactividad se mide desde aquí)
      record.lastListened = Date.now();
      store.put(record);
      
      const objectUrl = URL.createObjectURL(record.blob);
      resolve(objectUrl);
    };

    request.onerror = () => reject(request.error);
  });
}

export async function hasLocalAudio(id: string): Promise<boolean> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getKey(id);
    request.onsuccess = () => resolve(request.result !== undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteLocalAudio(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Limpieza de audios locales no escuchados hace más de 2 días.
 */
export async function cleanupOldLocalAudios(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const records = request.result as LocalAudioRecord[];
      const now = Date.now();
      const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
      let count = 0;

      for (const record of records) {
        if (now - record.lastListened > twoDaysMs) {
          store.delete(record.id);
          count++;
        }
      }
      resolve(count);
    };

    request.onerror = () => reject(request.error);
  });
}
