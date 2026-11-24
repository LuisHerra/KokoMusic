/**
 * "Descargar vídeo" para los menús de tres puntos de las canciones.
 * Solo aparece en la app de Android (el vídeo se guarda en el móvil y se ve
 * en Biblioteca → Mis vídeos).
 */
import { canSaveVideosOnDevice } from '../../lib/androidApp';
import { saveTrackVideoToDevice } from '../../lib/deviceDownload';
import { notify } from '../../lib/notice';

let downloading = false;

/**
 * Lanza la descarga del videoclip. Avisa con el toast informativo (no el rojo
 * de errores) y el progreso se ve en Biblioteca → Mis vídeos.
 */
export async function startVideoDownload(track: { id: string; title: string; artist: string }) {
  if (downloading) { notify('Ya se está descargando un vídeo; mira el progreso en Mis vídeos'); return; }
  downloading = true;
  notify(`Descargando el vídeo de "${track.title}". Sigue el progreso en Biblioteca → Mis vídeos`);
  try {
    notify(await saveTrackVideoToDevice(track.id, { title: track.title, artist: track.artist }), 'success');
  } catch (err: any) {
    notify(err?.message || 'No se pudo guardar el vídeo', 'error');
  } finally {
    downloading = false;
  }
}

export default function DownloadVideoAction({ track, onDone }: {
  track: { id: string; title: string; artist: string };
  onDone?: () => void;
}) {
  if (!canSaveVideosOnDevice()) return null;
  return (
    <button
      className="track-action-sheet-btn"
      onClick={() => { onDone?.(); void startVideoDownload(track); }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="2" y="5" width="15" height="14" rx="2" /><path d="m17 10 5-3v10l-5-3" />
      </svg>
      <span>Descargar vídeo</span>
    </button>
  );
}
