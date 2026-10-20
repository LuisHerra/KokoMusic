/**
 * Importación de playlists/álbumes de Spotify por enlace.
 *
 * Flujo (pensado para gastar el mínimo de red):
 *   1. POST /import/parse         → una sola lectura de la página de Spotify.
 *   2. POST /import/resolve-batch → lotes de BATCH_SIZE canciones, en serie.
 *      El backend cachea cada canción 7 días y espacia sus búsquedas reales.
 *   3. Las coincidencias dudosas se revisan todas juntas al final (en vez de
 *      interrumpir la importación canción a canción).
 *   4. Se crea la playlist respetando el orden original de Spotify.
 *
 * El estado vive aquí (no en el modal) para que la importación siga aunque el
 * usuario cierre el modal, y la barra lateral pueda mostrar el progreso.
 */

import { create } from 'zustand';
import { apiFetch, createPlaylist } from '../lib/api';

export interface SpotifyRawTrack {
  title: string;
  artist: string;
  duration: number;
  originalId?: string;
}

export interface ImportCandidate {
  id: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  score: number;
}

type Resolution =
  | { status: 'matched'; id: string; candidates: ImportCandidate[] }
  | { status: 'ambiguous'; candidates: ImportCandidate[] }
  | { status: 'notfound' };

export interface ReviewItem {
  index: number;               // posición en la playlist de Spotify
  track: SpotifyRawTrack;
  candidates: ImportCandidate[];
  chosenId: string | null;     // null = no añadir
}

export type ImportPhase = 'input' | 'parsing' | 'resolving' | 'review' | 'saving' | 'done' | 'error';

interface ImportResult {
  playlistId: string;
  imported: number;
  failedTracks: SpotifyRawTrack[];
}

interface SpotifyImportState {
  isOpen: boolean;
  phase: ImportPhase;
  error: string | null;
  name: string;
  cover: string;
  total: number;
  current: number;
  review: ReviewItem[];
  result: ImportResult | null;

  open: () => void;
  close: () => void;
  start: (url: string) => Promise<void>;
  cancel: () => void;
  choose: (index: number, id: string | null) => void;
  confirmReview: () => Promise<void>;
  reset: () => void;
}

const BATCH_SIZE = 10;

// Datos de trabajo que no hace falta exponer a la UI.
let tracks: SpotifyRawTrack[] = [];
let slots: (string | null)[] = [];
let runId = 0;

const isRunning = (phase: ImportPhase) => phase === 'parsing' || phase === 'resolving' || phase === 'saving';

export const useSpotifyImportStore = create<SpotifyImportState>((set, get) => {
  async function save() {
    set({ phase: 'saving' });
    const ids = slots.filter((id): id is string => !!id);
    const failedTracks = tracks.filter((_, i) => !slots[i]);
    try {
      const pl = await createPlaylist({
        name: get().name,
        description: 'Importada desde Spotify',
        cover: get().cover,
        tracks: ids,
      });
      // Se reabre el modal aunque el usuario lo hubiera ocultado, para que vea
      // el resumen y el botón de abrir la playlist.
      set({ phase: 'done', isOpen: true, result: { playlistId: pl.id, imported: ids.length, failedTracks } });
    } catch (e: any) {
      set({ phase: 'error', isOpen: true, error: e?.message || 'No se pudo crear la playlist' });
    }
  }

  return {
    isOpen: false,
    phase: 'input',
    error: null,
    name: '',
    cover: '',
    total: 0,
    current: 0,
    review: [],
    result: null,

    open: () => {
      // Si la anterior ya terminó, empezar limpio; si sigue en curso, solo mostrarla.
      const { phase } = get();
      if (phase === 'done' || phase === 'error') get().reset();
      set({ isOpen: true });
    },

    close: () => set({ isOpen: false }),

    reset: () => {
      runId++;
      tracks = [];
      slots = [];
      set({ phase: 'input', error: null, name: '', cover: '', total: 0, current: 0, review: [], result: null });
    },

    cancel: () => {
      get().reset();
      set({ isOpen: false });
    },

    start: async (url: string) => {
      if (isRunning(get().phase)) return;
      const myRun = ++runId;
      set({ phase: 'parsing', error: null, review: [], result: null, current: 0, total: 0 });

      try {
        const data = await apiFetch<{ name: string; cover: string; tracks: SpotifyRawTrack[] }>('/import/parse', {
          method: 'POST',
          body: JSON.stringify({ url: url.trim() }),
        });
        if (myRun !== runId) return;
        if (!data.tracks?.length) throw new Error('El enlace no contiene canciones');

        tracks = data.tracks;
        slots = new Array(tracks.length).fill(null);
        set({ phase: 'resolving', name: data.name, cover: data.cover, total: tracks.length });

        const review: ReviewItem[] = [];
        for (let start = 0; start < tracks.length; start += BATCH_SIZE) {
          const batch = tracks.slice(start, start + BATCH_SIZE);
          let results: Resolution[];
          try {
            ({ results } = await apiFetch<{ results: Resolution[] }>('/import/resolve-batch', {
              method: 'POST',
              body: JSON.stringify({ tracks: batch.map(({ title, artist, duration }) => ({ title, artist, duration })) }),
            }));
          } catch {
            // Un lote fallido no tumba la importación: esas canciones quedan como no encontradas.
            results = batch.map(() => ({ status: 'notfound' as const }));
          }
          if (myRun !== runId) return;

          results.forEach((r, i) => {
            const index = start + i;
            if (r.status === 'matched') slots[index] = r.id;
            else if (r.status === 'ambiguous') {
              review.push({ index, track: tracks[index], candidates: r.candidates, chosenId: r.candidates[0]?.id ?? null });
            }
          });
          set({ current: Math.min(start + BATCH_SIZE, tracks.length) });
        }

        if (review.length) {
          set({ phase: 'review', review, isOpen: true });
        } else {
          await save();
        }
      } catch (e: any) {
        if (myRun !== runId) return;
        set({ phase: 'error', error: e?.message || 'No se pudo importar la playlist', isOpen: true });
      }
    },

    choose: (index, id) =>
      set((s) => ({ review: s.review.map((r) => (r.index === index ? { ...r, chosenId: id } : r)) })),

    confirmReview: async () => {
      for (const r of get().review) slots[r.index] = r.chosenId;
      await save();
    },
  };
});
