import { useState, useEffect, useRef } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useDeviceSyncStore } from '../../store/deviceSyncStore';
import { IconDevices } from './PlayerIcons';
import DeviceList from './DeviceList';

/** Botón "Dispositivos" del reproductor de escritorio (tipo Spotify Connect). */
export default function DeviceSyncButton() {
  const otherDevices = useDeviceSyncStore((s) => s.otherDevices);
  const banner = useDeviceSyncStore((s) => s.banner);
  const remoteDeviceId = usePlayerStore((s) => s.remoteDeviceId);
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const connectableCount = otherDevices.filter((d) => d.track_id).length;

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      // Los clics en la guía (portal fuera de este árbol) no cuentan como "fuera".
      if ((e.target as HTMLElement).closest?.('.guided-tour')) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  return (
    <div className="sleep-timer-wrap" ref={menuRef}>
      <button
        className="ctrl-btn"
        onClick={() => setIsOpen((v) => !v)}
        title="Dispositivos"
        data-tour="devices"
        style={remoteDeviceId || connectableCount > 0 ? { color: 'var(--accent)' } : undefined}
      >
        <IconDevices size={16} />
      </button>

      {!remoteDeviceId && connectableCount > 0 && <span className="sleep-timer-badge">{connectableCount}</span>}

      {banner && <div className="device-sync-toast">{banner}</div>}

      {isOpen && (
        <div className="sleep-timer-menu" data-tour="devices-list" style={{ width: 290 }}>
          <div className="sleep-timer-menu-header">Dispositivos</div>
          <DeviceList />
        </div>
      )}
    </div>
  );
}
