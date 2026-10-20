/**
 * "Preparar canciones sin escucharlas": sube a R2 las canciones de una
 * playlist que aún no están en el CDN, para que saltar a cualquiera suene al
 * instante (las que no están pasan por KokoMusic-lite y tardan unos segundos
 * en empezar).
 *
 * La cola la lleva el cliente, no el servidor, a propósito: en el plan
 * gratuito de Render el backend se duerme a los 15 min sin peticiones y una
 * cola en memoria del servidor se perdería. Aquí:
 *   - se manda UNA canción cada vez y se espera a que termine (~20-40 s),
 *   - con una pausa entre una y otra para no saturar la red,
 *   - sigue en segundo plano mientras la app esté abierta (cualquier página),
 *   - y se guarda en localStorage para continuar la próxima vez que se abra.
 */

import { create } from 'zustand';
import { apiFetch } from '../lib/api';
import { isGuestMode } from '../lib/guest';

export type PrecacheStatus = 'missing' | 'queued' | 'working' | 'ready' | 'failed';

type ServerOutcome = 'cached' | 'busy' | 'in_progress' | 'too_large' | 'failed' | 'disabled' | 'unsupported';

interface PrecacheState {
  statuses: Record<string, PrecacheStatus>;
  queue: string[];
  current: string | null;
  running: boolean;

  /** Aplica el resultado de /stream/cdn-status sin pisar lo que está en cola. */
  applyServerStatus: (ids: string[], cachedIds: string[]) => void;
  enqueue: (ids: string[]) => void;
  cancel: (ids: string[]) => void;
  resume: () => void;
}

const STORAGE_KEY = 'koko_precache_queue';
const SPACING_MS = 5_000;       // pausa entre canciones
const BUSY_WAIT_MS = 30_000;    // servidor ocupado con lo que se escucha ahora
const MAX_RETRIES = 3;

/** Tamaño aproximado de una canción en el CDN (Opus 96k, ~3,5 min). */
export const APPROX_MB_PER_TRACK = 2.5;

const retries = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadQueue(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: string[]) {
  try {
    if (queue.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* almacenamiento no disponible: la cola solo vive en esta sesión */ }
}

export const usePrecacheStore = create<PrecacheState>((set, get) => {
  const initialQueue = loadQueue();

  const setStatus = (id: string, status: PrecacheStatus) =>
    set((s) => ({ statuses: { ...s.statuses, [id]: status } }));

  const setQueue = (queue: string[]) => {
    saveQueue(queue);
    set({ queue });
  };

  async function work() {
    if (get().running) return;
    set({ running: true });

    while (get().queue.length && !isGuestMode()) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await sleep(BUSY_WAIT_MS);
        continue;
      }

      const id = get().queue[0];
      set({ current: id });
      setStatus(id, 'working');

      let outcome: ServerOutcome | 'error';
      try {
        ({ status: outcome } = await apiFetch<{ status: ServerOutcome }>(`/stream/${encodeURIComponent(id)}/precache`, { method: 'POST' }));
      } catch {
        outcome = 'error';
      }

      // Puede que la hayan cancelado mientras se preparaba.
      const stillQueued = get().queue[0] === id;
      let wait = SPACING_MS;

      if (outcome === 'cached') {
        setStatus(id, 'ready');
        if (stillQueued) setQueue(get().queue.slice(1));
      } else if (outcome === 'busy' || outcome === 'in_progress' || outcome === 'error') {
        // Reintentable: al final de la cola y con una espera más larga.
        const n = (retries.get(id) ?? 0) + 1;
        retries.set(id, n);
        if (n > MAX_RETRIES) {
          setStatus(id, 'failed');
          if (stillQueued) setQueue(get().queue.slice(1));
        } else {
          setStatus(id, 'queued');
          if (stillQueued) setQueue([...get().queue.slice(1), id]);
          wait = BUSY_WAIT_MS;
        }
      } else {
        // failed / too_large / disabled / unsupported: no tiene sentido reintentar.
        setStatus(id, 'failed');
        if (stillQueued) setQueue(get().queue.slice(1));
      }

      set({ current: null });
      if (get().queue.length) await sleep(wait);
    }

    set({ running: false, current: null });
  }

  return {
    statuses: Object.fromEntries(initialQueue.map((id) => [id, 'queued' as PrecacheStatus])),
    queue: initialQueue,
    current: null,
    running: false,

    applyServerStatus: (ids, cachedIds) => {
      const cached = new Set(cachedIds);
      set((s) => {
        const statuses = { ...s.statuses };
        for (const id of ids) {
          if (cached.has(id)) statuses[id] = 'ready';
          else if (!statuses[id] || statuses[id] === 'ready') statuses[id] = 'missing';
        }
        return { statuses };
      });
      // Lo que ya está listo no hace falta prepararlo.
      const queue = get().queue.filter((id) => !cached.has(id));
      if (queue.length !== get().queue.length) setQueue(queue);
    },

    enqueue: (ids) => {
      const { queue, statuses } = get();
      const inQueue = new Set(queue);
      const add = ids.filter((id) => !inQueue.has(id) && statuses[id] !== 'ready' && !id.startsWith('custom_'));
      if (!add.length) return;
      add.forEach((id) => retries.delete(id));
      set((s) => ({ statuses: { ...s.statuses, ...Object.fromEntries(add.map((id) => [id, 'queued' as PrecacheStatus])) } }));
      setQueue([...queue, ...add]);
      void work();
    },

    cancel: (ids) => {
      const drop = new Set(ids.filter((id) => id !== get().current));
      setQueue(get().queue.filter((id) => !drop.has(id)));
      set((s) => {
        const statuses = { ...s.statuses };
        drop.forEach((id) => { if (statuses[id] === 'queued') statuses[id] = 'missing'; });
        return { statuses };
      });
    },

    resume: () => {
      if (get().queue.length) void work();
    },
  };
});
