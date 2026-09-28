import { useEffect, useState } from 'react';

export default function DesktopTitleBar() {
  const [isMax, setIsMax] = useState(false);
  const electron = typeof window !== 'undefined' ? (window as any).electronAPI : null;

  useEffect(() => {
    if (electron?.isMaximized) {
      electron.isMaximized().then((res: boolean) => setIsMax(res)).catch(() => {});
    }
    if (electron?.onMaximizedChange) {
      electron.onMaximizedChange((maximized: boolean) => {
        setIsMax(maximized);
      });
    }
  }, [electron]);

  if (!electron) return null;

  return (
    <div className="desktop-titlebar">
      <div className="titlebar-drag-region">
        <div className="titlebar-brand">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent)" style={{ display: 'block' }}>
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span className="titlebar-title">KokoMusic</span>
        </div>
      </div>

      <div className="titlebar-controls">
        <button
          className="titlebar-btn"
          onClick={() => electron.minimize()}
          title="Minimizar"
          aria-label="Minimizar"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>

        <button
          className="titlebar-btn"
          onClick={() => electron.maximize()}
          title={isMax ? 'Restaurar' : 'Maximizar'}
          aria-label={isMax ? 'Restaurar' : 'Maximizar'}
        >
          {isMax ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2.5" y="0.5" width="7" height="7" />
              <polyline points="0.5 2.5 0.5 9.5 7.5 9.5" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          )}
        </button>

        <button
          className="titlebar-btn close-btn"
          onClick={() => electron.close()}
          title="Cerrar (Minimizar a la bandeja)"
          aria-label="Cerrar"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
