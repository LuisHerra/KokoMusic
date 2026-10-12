/**
 * Inicio del modo invitado: el catálogo que ya está en el CDN (lo único que
 * un invitado puede escuchar), paginado de lo más reciente a lo más antiguo.
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { getAvailableCDNTracks, type Track } from '../lib/api';
import { TrackCard } from '../components/TrackCard/TrackGrid';
import { usePlayerStore } from '../store/playerStore';

const PAGE_SIZE = 30;

export default function GuestHome() {
  const { currentTrack, isPlaying, setTrack, addToQueue } = usePlayerStore();

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['guest-cdn-catalog'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => getAvailableCDNTracks(pageParam, PAGE_SIZE),
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    staleTime: 5 * 60 * 1000,
  });

  const tracks: Track[] = data?.pages.flatMap((p) => p.tracks) ?? [];
  const total = data?.pages[0]?.totalCount ?? 0;

  const openAuth = () => window.dispatchEvent(new Event('koko-open-auth'));

  return (
    <div className="main-body" style={{ paddingTop: 16 }}>
      <section
        style={{
          padding: '24px 20px',
          borderRadius: 16,
          marginBottom: 28,
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, transparent), rgba(18,18,18,0.6))',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 26 }}>Modo invitado</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '8px 0 16px', maxWidth: 560, lineHeight: 1.5 }}>
          Estás escuchando una muestra de KokoMusic: solo las canciones que ya están disponibles en nuestro catálogo.
          Con una cuenta puedes escuchar cualquier canción, crear playlists y tener tus mixes personalizados.
        </p>
        <button className="btn btn-primary" onClick={openAuth}>Iniciar sesión</button>
      </section>

      <h2 className="section-title">
        Catálogo disponible{total > 0 ? ` · ${total} canciones` : ''}
      </h2>

      {isLoading ? (
        <div className="tracks-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="track-card" style={{ cursor: 'default' }}>
              <div className="skeleton" style={{ aspectRatio: '1', borderRadius: 8, marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 14, width: '70%', marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 12, width: '45%' }} />
            </div>
          ))}
        </div>
      ) : isError ? (
        <p style={{ color: 'var(--text-secondary)' }}>No se pudo cargar el catálogo. Inténtalo de nuevo en un momento.</p>
      ) : tracks.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>Todavía no hay canciones disponibles para invitados.</p>
      ) : (
        <>
          <div className="tracks-grid">
            {tracks.map((t) => (
              <TrackCard
                key={t.id}
                track={t}
                isPlaying={currentTrack?.id === t.id && isPlaying}
                onClick={() => setTrack(t, tracks)}
                onAddToQueue={(e) => { e.stopPropagation(); addToQueue(t); }}
              />
            ))}
          </div>
          {hasNextPage && (
            <div style={{ display: 'flex', justifyContent: 'center', margin: '24px 0' }}>
              <button className="btn" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? 'Cargando…' : 'Ver más'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
