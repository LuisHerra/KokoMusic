/**
 * Descargas de vídeo en curso (app de Android), para mostrar su progreso en
 * "Mis vídeos". La APK informa con window.__kokoVideoProgress(id, %, fase).
 */
import { create } from 'zustand';

export type VideoDownloadStage = 'preparando' | 'video' | 'audio' | 'uniendo' | 'guardando';

export interface VideoDownload {
  id: string;
  title: string;
  pct: number;
  stage: VideoDownloadStage;
}

interface State {
  downloads: Record<string, VideoDownload>;
  start: (id: string, title: string) => void;
  progress: (id: string, pct: number, stage: string) => void;
  finish: (id: string) => void;
}

export const useVideoDownloads = create<State>((set) => ({
  downloads: {},
  start: (id, title) => set((s) => ({ downloads: { ...s.downloads, [id]: { id, title, pct: 0, stage: 'preparando' } } })),
  progress: (id, pct, stage) => set((s) => {
    const d = s.downloads[id];
    if (!d) return s;
    return { downloads: { ...s.downloads, [id]: { ...d, pct: Math.max(0, Math.min(100, pct)), stage: stage as VideoDownloadStage } } };
  }),
  finish: (id) => set((s) => {
    const { [id]: _done, ...rest } = s.downloads;
    return { downloads: rest };
  }),
}));

export const STAGE_LABEL: Record<VideoDownloadStage, string> = {
  preparando: 'Preparando',
  video: 'Descargando vídeo',
  audio: 'Descargando audio',
  uniendo: 'Uniendo vídeo y audio',
  guardando: 'Guardando en el móvil',
};

if (typeof window !== 'undefined') {
  window.__kokoVideoProgress = (id: string, pct: number, stage: string) => useVideoDownloads.getState().progress(id, pct, stage);
}
