import { useState } from 'react';
import { resolveImageUrl, type PlaybackDeviceState } from '../../lib/api';

function timeAgo(iso: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 10) return 'ahora mismo';
  if (diffSec < 60) return `hace ${diffSec}s`;
  return `hace ${Math.round(diffSec / 60)} min`;
}

/**
 * Lista de "otros dispositivos" + flujo de conexión, compartida entre el
 * popover de escritorio (DeviceSyncButton) y la vista de móvil
 * (MobileFullPlayer) para que el comportamiento no diverja entre ambos.
 */
export default function DeviceList({
  otherDevices, connectedDeviceId, connectedDevice, onConnect, onDisconnect,
}: {
  otherDevices: PlaybackDeviceState[];
  connectedDeviceId: string | null;
  connectedDevice: PlaybackDeviceState | null;
  onConnect: (device: PlaybackDeviceState) => void;
  onDisconnect: () => void;
}) {
  const [pendingConfirm, setPendingConfirm] = useState<PlaybackDeviceState | null>(null);

  if (connectedDeviceId) {
    return (
      <div className="device-list-connected">
        <div className="device-list-connected-label">
          Conectado a {connectedDevice?.device_name || 'otro dispositivo'}
        </div>
        {connectedDevice ? (
          <div className="device-list-row">
            {connectedDevice.cover ? (
              <img src={resolveImageUrl(connectedDevice.cover)} alt="" />
            ) : (
              <div className="device-list-cover-placeholder" />
            )}
            <div className="device-list-info">
              <span className="device-list-title">{connectedDevice.title || 'Sin reproducir'}</span>
              <span className="device-list-artist">{connectedDevice.artist}</span>
              <span className="device-list-status">{connectedDevice.is_playing ? '▶ Reproduciendo' : '⏸ En pausa'}</span>
            </div>
          </div>
        ) : (
          <div className="device-list-empty">Esperando datos del otro dispositivo…</div>
        )}
        <button className="device-list-disconnect" onClick={onDisconnect}>Desconectar</button>
      </div>
    );
  }

  if (pendingConfirm) {
    return (
      <div className="device-list-confirm">
        <p>
          ¿Conectarte a <strong>{pendingConfirm.device_name || 'este dispositivo'}</strong>?
          Este dispositivo se silenciará y solo sonará en el otro.
        </p>
        <div className="device-list-confirm-actions">
          <button className="device-list-btn-no" onClick={() => setPendingConfirm(null)}>No</button>
          <button className="device-list-btn-yes" onClick={() => { onConnect(pendingConfirm); setPendingConfirm(null); }}>
            Sí, conectar
          </button>
        </div>
      </div>
    );
  }

  if (otherDevices.length === 0) {
    return <div className="device-list-empty">No hay reproducción activa en otros dispositivos.</div>;
  }

  return (
    <div className="device-list-items">
      {otherDevices.map((d) => (
        <button key={d.device_id} className="device-list-row device-list-row-clickable" onClick={() => setPendingConfirm(d)}>
          {d.cover ? (
            <img src={resolveImageUrl(d.cover)} alt="" />
          ) : (
            <div className="device-list-cover-placeholder" />
          )}
          <div className="device-list-info">
            <span className="device-list-title">{d.device_name || 'Dispositivo'} {d.is_playing ? '▶' : '⏸'}</span>
            <span className="device-list-artist">{d.title} — {d.artist}</span>
            <span className="device-list-status">{timeAgo(d.updated_at)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
