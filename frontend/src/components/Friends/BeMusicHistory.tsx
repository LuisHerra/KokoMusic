/**
 * BeMusicHistory — historial de BeMusic como calendario mensual: cada día
 * muestra la portada de la canción publicada. Permite reproducirla y crear
 * una playlist con todas las canciones subidas (o solo las del mes).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { createPlaylist } from '../../lib/api';

export interface HistoryDrop {
  id: string;
  track_id: string;
  title: string;
  artist: string;
  cover?: string;
  start_s?: number;
  drop_date: string; // YYYY-MM-DD
}

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export default function BeMusicHistory({
  drops,
  streak,
  onPlay,
  onClose,
}: {
  drops: HistoryDrop[];
  streak: number;
  onPlay: (d: HistoryDrop) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const now = new Date();
  const todayKey = keyOf(now.getFullYear(), now.getMonth(), now.getDate());

  const byDate = useMemo(() => Object.fromEntries(drops.map((d) => [d.drop_date.slice(0, 10), d])), [drops]);
  const firstDate = useMemo(() => {
    const dates = drops.map((d) => d.drop_date).sort();
    return dates[0] ? new Date(`${dates[0]}T00:00:00`) : now;
  }, [drops]);

  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState<HistoryDrop | null>(byDate[todayKey] ?? null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const canPrev = view.y > firstDate.getFullYear() || (view.y === firstDate.getFullYear() && view.m > firstDate.getMonth());
  const canNext = view.y < now.getFullYear() || (view.y === now.getFullYear() && view.m < now.getMonth());
  const move = (delta: number) => {
    const d = new Date(view.y, view.m + delta, 1);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  };

  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const offset = (new Date(view.y, view.m, 1).getDay() + 6) % 7; // lunes primero
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const monthDrops = drops.filter((d) => d.drop_date.startsWith(`${view.y}-${pad(view.m + 1)}`));
  const monthLabel = new Date(view.y, view.m, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const makePlaylist = async (scope: 'all' | 'month') => {
    const source = scope === 'all' ? drops : monthDrops;
    if (source.length === 0 || creating) return;
    setCreating(true);
    setError('');
    try {
      // Orden cronológico y sin repetir canción
      const ordered = [...source].sort((a, b) => a.drop_date.localeCompare(b.drop_date));
      const ids = [...new Set(ordered.map((d) => d.track_id))];
      const pl = await createPlaylist({
        name: scope === 'all' ? 'Mis BeMusic' : `BeMusic · ${monthLabel}`,
        description: 'Mis canciones del día en BeMusic',
        cover: ordered[ordered.length - 1]?.cover || '',
        tracks: ids,
      });
      qc.invalidateQueries({ queryKey: ['playlists'] });
      onClose();
      navigate(`/playlist/${pl.id}`);
    } catch (e: any) {
      setError(e?.message || 'No se pudo crear la playlist');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="bm-modal-backdrop" onClick={onClose}>
      <div className="bm-modal bmh" onClick={(e) => e.stopPropagation()}>
        <div className="bm-modal-head">
          <div>
            <h3>Tu historial</h3>
            <p className="bmh-stats">
              {drops.length} {drops.length === 1 ? 'canción' : 'canciones'} · 🔥 {streak} {streak === 1 ? 'día' : 'días'} de racha
            </p>
          </div>
          <button className="bm-icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="bmh-nav">
          <button className="bm-icon-btn" onClick={() => move(-1)} disabled={!canPrev} aria-label="Mes anterior">‹</button>
          <span className="bmh-month">{monthLabel}</span>
          <button className="bm-icon-btn" onClick={() => move(1)} disabled={!canNext} aria-label="Mes siguiente">›</button>
        </div>

        <div className="bmh-grid">
          {WEEKDAYS.map((w) => <span key={w} className="bmh-weekday">{w}</span>)}
          {cells.map((day, i) => {
            if (day === null) return <span key={`e${i}`} />;
            const k = keyOf(view.y, view.m, day);
            const drop = byDate[k];
            const isFuture = k > todayKey;
            return (
              <button
                key={k}
                className={`bmh-day ${drop ? 'bmh-day--drop' : ''} ${k === todayKey ? 'bmh-day--today' : ''} ${selected?.id === drop?.id && drop ? 'bmh-day--sel' : ''}`}
                disabled={!drop}
                onClick={() => drop && setSelected(drop)}
                style={drop?.cover ? { backgroundImage: `url("${drop.cover}")` } : undefined}
                title={drop ? `${drop.title} — ${drop.artist}` : undefined}
              >
                <span className={`bmh-num ${isFuture ? 'bmh-num--future' : ''}`}>{day}</span>
              </button>
            );
          })}
        </div>

        {selected ? (
          <div className="bmh-detail">
            <img src={selected.cover} alt="" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="bmh-detail-date">
                {new Date(`${selected.drop_date.slice(0, 10)}T00:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
              </div>
              <div className="bmh-detail-title">{selected.title}</div>
              <div className="bmh-detail-artist">{selected.artist}</div>
            </div>
            <button className="bm-play bmh-play" onClick={() => onPlay(selected)} aria-label="Reproducir">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
          </div>
        ) : (
          <p className="bmh-hint">{monthDrops.length ? 'Toca un día para ver su canción.' : 'No publicaste ninguna canción este mes.'}</p>
        )}

        <div className="bmh-actions">
          <button className="bmh-btn" onClick={() => makePlaylist('all')} disabled={creating || drops.length === 0}>
            {creating ? 'Creando…' : 'Crear playlist con todas'}
          </button>
          <button className="bmh-btn bmh-btn--ghost" onClick={() => makePlaylist('month')} disabled={creating || monthDrops.length === 0}>
            Solo este mes
          </button>
        </div>
        {error && <p className="bm-error" style={{ textAlign: 'center' }}>{error}</p>}
      </div>
    </div>
  );
}
