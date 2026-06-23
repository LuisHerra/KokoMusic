import { useState, useEffect, useRef } from 'react';
import { usePlayerStore } from '../../store/playerStore';

const TIMER_OPTIONS = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '1 hora', value: 60 },
  { label: 'Al acabar la canción', value: -1 },
];

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function SleepTimer() {
  const { sleepTimerMinutes, sleepTimerEndTime, setSleepTimer, clearSleepTimer } = usePlayerStore();
  const [isOpen, setIsOpen] = useState(false);
  const [remaining, setRemaining] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isActive = sleepTimerMinutes !== null;

  // Actualizar countdown cada segundo
  useEffect(() => {
    if (!sleepTimerEndTime) {
      setRemaining(null);
      return;
    }

    const update = () => {
      const diff = sleepTimerEndTime - Date.now();
      setRemaining(diff > 0 ? formatRemaining(diff) : '0:00');
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [sleepTimerEndTime]);

  // Cerrar menú al hacer clic fuera
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  return (
    <div className="sleep-timer-wrap" ref={menuRef}>
      <button
        className="ctrl-btn"
        onClick={() => setIsOpen((v) => !v)}
        title={isActive ? `Sleep timer activo` : 'Sleep timer'}
        style={isActive ? { color: 'var(--accent)' } : undefined}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
        </svg>
      </button>

      {/* Indicador de tiempo restante */}
      {isActive && remaining && sleepTimerMinutes !== -1 && (
        <span className="sleep-timer-badge">{remaining}</span>
      )}
      {isActive && sleepTimerMinutes === -1 && (
        <span className="sleep-timer-badge"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h12v12H6z"/></svg></span>
      )}

      {/* Dropdown menú */}
      {isOpen && (
        <div className="sleep-timer-menu">
          <div className="sleep-timer-menu-header">
            Sleep Timer
          </div>

          {isActive ? (
            <div className="sleep-timer-menu-body">
              <div style={{ textAlign: 'center', padding: '8px 0', color: 'var(--text-secondary)', fontSize: 13 }}>
                {sleepTimerMinutes === -1
                  ? 'Se pausará al acabar la canción actual'
                  : `Se pausará en ${remaining}`
                }
              </div>
              <button
                className="sleep-timer-option sleep-timer-cancel"
                onClick={() => { clearSleepTimer(); setIsOpen(false); }}
              >
                Cancelar timer
              </button>
            </div>
          ) : (
            <div className="sleep-timer-menu-body">
              {TIMER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className="sleep-timer-option"
                  onClick={() => { setSleepTimer(opt.value); setIsOpen(false); }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
