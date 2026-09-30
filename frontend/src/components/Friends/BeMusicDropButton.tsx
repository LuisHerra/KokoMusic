import { useState } from 'react';
import { postDailyDrop, type Track } from '../../lib/api';
import { usePlayerStore } from '../../store/playerStore';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Acción del menú de tres puntos del reproductor móvil: publica la canción como "canción del día" de BeMusic. */
export default function BeMusicDropButton({ track, onClose }: { track: Track; onClose: () => void }) {
  const setError = usePlayerStore((s) => s.setError);
  const [busy, setBusy] = useState(false);
  const userId = localStorage.getItem('koko_device_id') || '';
  if (!UUID_RE.test(userId)) return null;

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Se publica desde el momento que está sonando ahora mismo
      await postDailyDrop(userId, track, '', usePlayerStore.getState().progress);
      const p = Math.floor(usePlayerStore.getState().progress);
      setError(`🎧 "${track.title}" es tu canción del día en BeMusic (desde ${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')})`);
    } catch (e: any) {
      setError(e?.message || 'No se pudo publicar en BeMusic');
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={busy}
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14, borderRadius: 12, background: 'linear-gradient(135deg, rgba(241,7,163,0.14), rgba(123,47,247,0.14))', border: '1px solid rgba(241,7,163,0.3)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f107a3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
      </svg>
      <span>{busy ? 'Publicando en BeMusic…' : 'Subir a BeMusic como canción del día'}</span>
    </button>
  );
}
