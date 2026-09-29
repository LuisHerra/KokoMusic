import { useState, useEffect, useRef } from 'react';
import { useDeviceSync } from '../../hooks/useDeviceSync';
import { resolveImageUrl } from '../../lib/api';
import { IconDevices } from './PlayerIcons';

function timeAgo(iso: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 10) return 'ahora mismo';
  if (diffSec < 60) return `hace ${diffSec}s`;
  return `hace ${Math.round(diffSec / 60)} min`;
}

/** Botón "Dispositivos" del reproductor — ver y tomar el control de la reproducción en otros dispositivos de la misma cuenta (tipo Spotify Connect). */
export default function DeviceSyncButton() {
  const { otherDevices, activateHere, takenOverBanner } = useDeviceSync();
  const [isOpen, setIsOpen] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const handleActivate = async (device: typeof otherDevices[number]) => {
    setActivating(device.device_id);
    try {
      await activateHere(device);
      setIsOpen(false);
    } finally {
      setActivating(null);
    }
  };

  return (
    <div className="sleep-timer-wrap" ref={menuRef}>
      <button
        className="ctrl-btn"
        onClick={() => setIsOpen((v) => !v)}
        title="Dispositivos conectados"
        style={otherDevices.length > 0 ? { color: 'var(--accent)' } : undefined}
      >
        <IconDevices size={16} />
      </button>

      {otherDevices.length > 0 && <span className="sleep-timer-badge">{otherDevices.length}</span>}

      {takenOverBanner && (
        <div className="device-sync-toast">{takenOverBanner}</div>
      )}

      {isOpen && (
        <div className="sleep-timer-menu" style={{ width: 280 }}>
          <div className="sleep-timer-menu-header">Dispositivos</div>
          <div className="sleep-timer-menu-body">
            {otherDevices.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                No hay reproducción activa en otros dispositivos.
              </div>
            ) : (
              otherDevices.map((d) => (
                <button
                  key={d.device_id}
                  className="sleep-timer-option"
                  onClick={() => handleActivate(d)}
                  disabled={activating === d.device_id}
                  style={{ display: 'flex', alignItems: 'center', gap: 10 }}
                >
                  {d.cover ? (
                    <img src={resolveImageUrl(d.cover)} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 32, height: 32, borderRadius: 4, background: 'var(--bg-highlight)', flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                      {d.device_name || 'Dispositivo'} {d.is_playing ? '▶' : '⏸'}
                    </div>
                    <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.title} — {d.artist}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(d.updated_at)}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
