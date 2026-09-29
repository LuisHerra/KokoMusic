import { useState, useEffect, useRef } from 'react';
import { useDeviceSync } from '../../hooks/useDeviceSync';
import { IconDevices } from './PlayerIcons';
import DeviceList from './DeviceList';

/** Botón "Dispositivos" del reproductor — ver y conectarte a la reproducción de otro dispositivo de la misma cuenta (tipo Spotify Connect). */
export default function DeviceSyncButton() {
  const { otherDevices, connectedDeviceId, connectedDevice, connectTo, disconnect, banner } = useDeviceSync();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
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
        title="Dispositivos conectados"
        style={connectedDeviceId || otherDevices.length > 0 ? { color: 'var(--accent)' } : undefined}
      >
        <IconDevices size={16} />
      </button>

      {!connectedDeviceId && otherDevices.length > 0 && <span className="sleep-timer-badge">{otherDevices.length}</span>}

      {banner && <div className="device-sync-toast">{banner}</div>}

      {isOpen && (
        <div className="sleep-timer-menu" style={{ width: 280 }}>
          <div className="sleep-timer-menu-header">Dispositivos</div>
          <DeviceList
            otherDevices={otherDevices}
            connectedDeviceId={connectedDeviceId}
            connectedDevice={connectedDevice}
            onConnect={connectTo}
            onDisconnect={disconnect}
          />
        </div>
      )}
    </div>
  );
}
