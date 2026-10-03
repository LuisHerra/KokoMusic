import { createPortal } from 'react-dom';

/**
 * Pregunta dónde guardar una canción:
 * - En la app (interna): IndexedDB, para escucharla sin conexión dentro de KokoMusic.
 * - En el dispositivo (externa): un archivo de audio en las descargas del
 *   navegador, o en Música/KokoMusic en la APK.
 */
export default function DownloadChoiceSheet({
  open,
  onClose,
  track,
  internalSaved,
  onInternal,
  onExternal,
}: {
  open: boolean;
  onClose: () => void;
  track: { title: string; artist: string; cover?: string };
  /** Ya está guardada en la app: la opción interna pasa a ser "Quitar de la app". */
  internalSaved: boolean;
  onInternal: () => void;
  onExternal: () => void;
}) {
  if (!open) return null;

  const pick = (action: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
    action();
  };

  // Portal a <body>: dentro de una fila o del reproductor, otros elementos se pintaban por encima.
  return createPortal(
    <div className="bottom-sheet-overlay open" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="bottom-sheet-content open download-choice-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="bottom-sheet-drag-handle" onClick={onClose} />

        <div className="download-choice-header">
          {track.cover && <img src={track.cover} alt="" />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <h4>¿Dónde quieres guardarla?</h4>
            <p>{track.title}{track.artist ? ` · ${track.artist}` : ''}</p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button className="track-action-sheet-btn download-choice-option" onClick={pick(onInternal)}>
            {internalSaved ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--accent)' }}>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
              </svg>
            )}
            <span className="download-choice-text">
              <strong>{internalSaved ? 'Quitar de la app' : 'En la app'}</strong>
              <small>
                {internalSaved
                  ? 'Ya está guardada para escuchar sin conexión en KokoMusic'
                  : 'Para escucharla sin conexión dentro de KokoMusic'}
              </small>
            </span>
          </button>

          <button className="track-action-sheet-btn download-choice-option" onClick={pick(onExternal)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="5" y="2" width="14" height="20" rx="2" />
              <path d="M12 7v7m0 0-3-3m3 3 3-3M9 18h6" />
            </svg>
            <span className="download-choice-text">
              <strong>En mi dispositivo</strong>
              <small>Descarga el archivo de audio para tenerlo fuera de la app</small>
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
