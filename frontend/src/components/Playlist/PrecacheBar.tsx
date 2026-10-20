import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api';
import { usePrecacheStore, APPROX_MB_PER_TRACK, type PrecacheStatus } from '../../store/precacheStore';

/**
 * Aviso en la cabecera de una playlist: cuántas canciones aún no están en el
 * servidor (CDN) y botón para prepararlas sin escucharlas. Las que no están
 * tardan unos segundos en empezar si se salta a ellas.
 */
export function PrecacheBar({ trackIds }: { trackIds: string[] }) {
  const ids = useMemo(() => [...new Set(trackIds.filter((id) => id && !id.startsWith('custom_')))], [trackIds]);
  const statuses = usePrecacheStore((s) => s.statuses);
  const applyServerStatus = usePrecacheStore((s) => s.applyServerStatus);
  const enqueue = usePrecacheStore((s) => s.enqueue);
  const cancel = usePrecacheStore((s) => s.cancel);

  const { data } = useQuery({
    queryKey: ['cdn-status', ids],
    queryFn: () => apiFetch<{ enabled: boolean; cached: string[] }>('/stream/cdn-status', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
    enabled: ids.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (data?.enabled) applyServerStatus(ids, data.cached);
  }, [data, ids, applyServerStatus]);

  if (!data?.enabled || !ids.length) return null;

  const count = (st: PrecacheStatus) => ids.filter((id) => statuses[id] === st).length;
  const ready = count('ready');
  const pending = count('queued') + count('working');
  const missing = count('missing');
  const failed = count('failed');
  const total = ids.length;

  const box: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13,
  };

  if (pending > 0) {
    const pct = Math.round((ready / total) * 100);
    return (
      <div style={box} role="status">
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ marginBottom: 6 }}>
            Preparando canciones en el servidor: <strong>{ready} de {total}</strong> listas
            <span style={{ color: 'var(--text-muted)' }}> · sigue en segundo plano mientras uses la app</span>
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', transition: 'width 0.4s ease' }} />
          </div>
        </div>
        <button className="btn" onClick={() => cancel(ids)} style={{ background: 'rgba(255,255,255,0.08)', fontSize: 12, padding: '6px 12px' }}>
          Pausar
        </button>
      </div>
    );
  }

  const toPrepare = missing + failed;
  if (toPrepare === 0) {
    return (
      <div style={{ ...box, background: 'transparent', border: 'none', padding: '0 2px', color: 'var(--text-muted)', fontSize: 12 }}>
        <PrecacheIcon status="ready" /> Todas las canciones están listas para sonar al instante.
      </div>
    );
  }

  return (
    <div style={box}>
      <PrecacheIcon status="missing" />
      <div style={{ flex: 1, minWidth: 200, lineHeight: 1.4 }}>
        <strong>{toPrepare} de {total}</strong> canciones aún no están en el servidor: si saltas a ellas pueden tardar unos segundos en empezar.
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Se preparan de una en una, poco a poco, para no saturar la red (≈ {Math.round(toPrepare * APPROX_MB_PER_TRACK)} MB en total).
        </div>
      </div>
      <button className="btn btn-primary" onClick={() => enqueue(ids.filter((id) => statuses[id] !== 'ready'))} style={{ fontSize: 13 }}>
        Preparar {toPrepare === 1 ? 'la canción' : `las ${toPrepare}`}
      </button>
    </div>
  );
}

const ICON_TITLES: Record<PrecacheStatus, string> = {
  missing: 'Aún no está en el servidor: puede tardar unos segundos en empezar',
  queued: 'En cola para prepararse en el servidor',
  working: 'Preparándose en el servidor…',
  ready: 'Lista en el servidor: suena al instante',
  failed: 'No se pudo preparar; sonará igualmente, con algo de espera',
};

/** Indicador pequeño del estado de una canción en el servidor. */
export function PrecacheIcon({ status }: { status: PrecacheStatus }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', 'aria-label': ICON_TITLES[status], role: 'img' as const, style: { flexShrink: 0 } };
  const title = <title>{ICON_TITLES[status]}</title>;
  switch (status) {
    case 'ready':
      return <svg {...common} fill="var(--accent)">{title}<path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM10 17l-3.5-3.5 1.41-1.41L10 14.17 15.18 9l1.41 1.41L10 17z" /></svg>;
    case 'working':
      return <svg {...common} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round">{title}<path d="M12 3a9 9 0 1 0 9 9"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" /></path></svg>;
    case 'queued':
      return <svg {...common} fill="var(--text-muted)">{title}<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.41V7h-2v6.59l4.29 4.29 1.42-1.42L13 12.41z" /></svg>;
    case 'failed':
      return <svg {...common} fill="#ff6b6b">{title}<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" /></svg>;
    default:
      return <svg {...common} fill="var(--text-muted)" opacity={0.6}>{title}<path d="M19.35 10.04A7.49 7.49 0 0 0 12 4c-1.48 0-2.85.43-4.01 1.17l1.46 1.46A5.497 5.497 0 0 1 17.5 11v.5H19c1.66 0 3 1.34 3 3 0 1.13-.64 2.11-1.56 2.62l1.45 1.45A4.99 4.99 0 0 0 24 15c0-2.64-2.05-4.78-4.65-4.96zM3 5.27l2.75 2.74C2.56 8.15 0 10.77 0 14c0 3.31 2.69 6 6 6h11.73l2 2L21 20.73 4.27 4 3 5.27zM7.73 10l8 8H6c-2.21 0-4-1.79-4-4s1.79-4 4-4h1.73z" /></svg>;
  }
}

/** Indicador para una fila de canción (no pinta nada si aún no se sabe su estado). */
export function TrackPrecacheIndicator({ trackId }: { trackId: string }) {
  const status = usePrecacheStore((s) => s.statuses[trackId]);
  if (!status || status === 'ready') return null;
  return <PrecacheIcon status={status} />;
}
