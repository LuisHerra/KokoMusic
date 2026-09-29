import { useState } from 'react';
import { resolveImageUrl, type PlaybackDeviceState } from '../../lib/api';
import { usePlayerStore } from '../../store/playerStore';
import { useDeviceSyncStore } from '../../store/deviceSyncStore';
import { THIS_DEVICE_ID, connectTo, disconnect, playHere } from '../../lib/deviceSync';

function timeAgo(iso: string): string {
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 10) return 'ahora mismo';
  if (diffSec < 60) return `hace ${diffSec}s`;
  return `hace ${Math.round(diffSec / 60)} min`;
}

/**
 * Lista de dispositivos + flujo de conexión, compartida entre el popover de
 * escritorio (DeviceSyncButton) y la vista de móvil (MobileFullPlayer) para
 * que el comportamiento no diverja entre ambos.
 */
export default function DeviceList() {
  const otherDevices = useDeviceSyncStore((s) => s.otherDevices);
  const remoteDeviceId = usePlayerStore((s) => s.remoteDeviceId);
  const remoteDeviceName = usePlayerStore((s) => s.remoteDeviceName);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const [pendingConfirm, setPendingConfirm] = useState<PlaybackDeviceState | null>(null);

  const connectable = otherDevices.filter((d) => d.track_id);
  const controllingMe = otherDevices.filter((d) => d.controlling_device_id === THIS_DEVICE_ID);

  if (remoteDeviceId) {
    const name = remoteDeviceName || 'otro dispositivo';
    return (
      <div className="device-list-connected">
        <div className="device-list-connected-label">Conectado a {name}</div>
        <p className="device-list-hint">
          La música suena en {name}. Todo lo que hagas aquí (play, saltar, elegir canción…) se aplica allí.
        </p>
        {currentTrack && (
          <div className="device-list-row">
            {currentTrack.cover ? <img src={resolveImageUrl(currentTrack.cover)} alt="" /> : <div className="device-list-cover-placeholder" />}
            <div className="device-list-info">
              <span className="device-list-title">{currentTrack.title}</span>
              <span className="device-list-artist">{currentTrack.artist}</span>
              <span className="device-list-status">{isPlaying ? '▶ Reproduciendo' : '⏸ En pausa'}</span>
            </div>
          </div>
        )}
        <div className="device-list-confirm-actions" style={{ marginTop: 12 }}>
          <button className="device-list-btn-no" onClick={disconnect}>Desconectar</button>
          <button className="device-list-btn-yes" onClick={playHere}>Escuchar aquí</button>
        </div>
      </div>
    );
  }

  if (pendingConfirm) {
    const name = pendingConfirm.device_name || 'este dispositivo';
    return (
      <div className="device-list-confirm">
        <p>
          ¿Conectarte a <strong>{name}</strong>? Verás y controlarás desde aquí lo que suena allí, y la música seguirá sonando solo en {name}.
        </p>
        <div className="device-list-confirm-actions">
          <button className="device-list-btn-no" onClick={() => setPendingConfirm(null)}>No</button>
          <button className="device-list-btn-yes" onClick={() => { connectTo(pendingConfirm); setPendingConfirm(null); }}>
            Sí, conectar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="device-list-items">
      {controllingMe.map((d) => (
        <div key={d.device_id} className="device-list-hint" style={{ padding: '6px 10px' }}>
          📱 {d.device_name || 'Otro dispositivo'} está conectado y controla este dispositivo.
        </div>
      ))}
      {connectable.length === 0 ? (
        controllingMe.length === 0 && <div className="device-list-empty">No hay reproducción activa en otros dispositivos.</div>
      ) : (
        connectable.map((d) => (
          <button key={d.device_id} className="device-list-row device-list-row-clickable" onClick={() => setPendingConfirm(d)}>
            {d.cover ? <img src={resolveImageUrl(d.cover)} alt="" /> : <div className="device-list-cover-placeholder" />}
            <div className="device-list-info">
              <span className="device-list-title">{d.device_name || 'Dispositivo'} {d.is_playing ? '▶' : '⏸'}</span>
              <span className="device-list-artist">{d.title} — {d.artist}</span>
              <span className="device-list-status">{timeAgo(d.updated_at)}</span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
