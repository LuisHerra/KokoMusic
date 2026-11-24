/**
 * Avisos breves que NO son errores (información y confirmaciones). El toast
 * de errores del reproductor (setError) es rojo con icono de advertencia y
 * hacía parecer que algo había fallado al descargar un vídeo.
 */
import { create } from 'zustand';

export type NoticeKind = 'info' | 'success' | 'error';

interface NoticeState {
  text: string | null;
  kind: NoticeKind;
  /** Cambia en cada aviso para reiniciar el temporizador aunque el texto se repita */
  seq: number;
  notify: (text: string, kind?: NoticeKind) => void;
  clear: () => void;
}

export const useNoticeStore = create<NoticeState>((set) => ({
  text: null,
  kind: 'info',
  seq: 0,
  notify: (text, kind = 'info') => set((s) => ({ text, kind, seq: s.seq + 1 })),
  clear: () => set({ text: null }),
}));

export const notify = (text: string, kind: NoticeKind = 'info') => useNoticeStore.getState().notify(text, kind);
