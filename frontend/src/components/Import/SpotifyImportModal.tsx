import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSpotifyImportStore } from '../../store/spotifyImportStore';

const SPOTIFY_GREEN = '#1DB954';

export function SpotifyLogo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={SPOTIFY_GREEN} aria-hidden="true">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.52 17.34c-.24.36-.66.48-1.02.24-2.82-1.74-6.36-2.1-10.56-1.14-.42.12-.78-.18-.9-.54-.12-.42.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.48.66.3 1.02zm1.44-3.3c-.3.42-.84.6-1.26.3-3.24-1.98-8.16-2.58-11.94-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.14C9.6 9.9 15 10.56 18.72 12.84c.36.18.54.78.24 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.3c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.62.54.3.72 1.02.42 1.56-.3.42-1.02.6-1.56.3z" />
    </svg>
  );
}

/** Modal global de importación desde Spotify. Se monta una vez en App.tsx. */
export default function SpotifyImportModal() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const s = useSpotifyImportStore();
  const [url, setUrl] = useState('');

  // Refrescar la lista de playlists en cuanto se crea la importada.
  useEffect(() => {
    if (s.phase === 'done') queryClient.invalidateQueries({ queryKey: ['playlists'] });
  }, [s.phase, queryClient]);

  if (!s.isOpen) return null;

  const running = s.phase === 'parsing' || s.phase === 'resolving' || s.phase === 'saving';
  const pct = s.total > 0 ? Math.round((s.current / s.total) * 100) : 0;
  const chosenCount = s.review.filter((r) => r.chosenId).length;

  const openPlaylist = () => {
    if (!s.result) return;
    const { playlistId, failedTracks } = s.result;
    s.reset();
    s.close();
    setUrl('');
    navigate(`/playlist/${playlistId}`, { state: { failedTracks } });
  };

  const muted: React.CSSProperties = { color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 };

  return (
    <div className="modal-overlay" style={{ zIndex: 9999 }} onClick={() => { if (s.phase !== 'review') s.close(); }}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: s.phase === 'review' ? 600 : 480, maxHeight: '90dvh', display: 'flex', flexDirection: 'column', padding: 24 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="spotify-import-title"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <SpotifyLogo size={24} />
          <h3 id="spotify-import-title" style={{ margin: 0, fontSize: 18, flex: 1 }}>
            {s.phase === 'review' ? 'Revisa las canciones dudosas' : 'Importar desde Spotify'}
          </h3>
          {s.phase !== 'review' && (
            <button className="ctrl-btn" onClick={s.close} title={running ? 'Ocultar (la importación sigue)' : 'Cerrar'} aria-label="Cerrar">✕</button>
          )}
        </div>

        {/* 1. Pegar enlace */}
        {s.phase === 'input' && (
          <form onSubmit={(e) => { e.preventDefault(); if (url.trim()) s.start(url); }}>
            <p style={{ ...muted, marginTop: 0 }}>
              Pega el enlace de una <strong>playlist</strong> o un <strong>álbum</strong> de Spotify y la recrearemos aquí con las mismas canciones y en el mismo orden.
            </p>
            <input
              type="url"
              inputMode="url"
              autoFocus
              placeholder="https://open.spotify.com/playlist/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-highlight)', border: '1px solid #ffffff20', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 14, padding: '10px 14px', outline: 'none', marginBottom: 10 }}
            />
            <p style={{ ...muted, fontSize: 12, margin: '0 0 16px' }}>
              En Spotify: <em>⋯ → Compartir → Copiar enlace</em>. La playlist tiene que ser pública; se importan hasta 100 canciones por enlace.
            </p>
            <button type="submit" className="btn btn-primary" disabled={!url.trim()} style={{ width: '100%' }}>
              Importar
            </button>
          </form>
        )}

        {/* 2. Progreso */}
        {running && (
          <div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
              {s.cover
                ? <img src={s.cover} alt="" style={{ width: 56, height: 56, borderRadius: 6, objectFit: 'cover' }} />
                : <div className="skeleton" style={{ width: 56, height: 56, borderRadius: 6 }} />}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.name || 'Leyendo el enlace…'}
                </div>
                <div style={muted}>
                  {s.phase === 'parsing' && 'Obteniendo las canciones de Spotify…'}
                  {s.phase === 'resolving' && `Buscando ${s.current} de ${s.total} canciones…`}
                  {s.phase === 'saving' && 'Creando la playlist…'}
                </div>
              </div>
            </div>
            <div style={{ height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ height: '100%', width: `${s.phase === 'parsing' ? 8 : pct}%`, background: 'var(--accent)', transition: 'width 0.3s ease' }} />
            </div>
            <p style={{ ...muted, fontSize: 12, marginTop: 0 }}>Puedes cerrar esta ventana: la importación sigue y verás el progreso en la barra lateral.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={s.cancel} style={{ background: 'rgba(255,255,255,0.08)' }}>Cancelar importación</button>
              <button className="btn btn-primary" onClick={s.close}>Seguir navegando</button>
            </div>
          </div>
        )}

        {/* 3. Revisión de coincidencias dudosas */}
        {s.phase === 'review' && (
          <>
            <p style={{ ...muted, marginTop: 0 }}>
              {s.review.length === 1 ? 'Hay 1 canción' : `Hay ${s.review.length} canciones`} sin coincidencia exacta. Hemos marcado la opción más probable; cámbiala o elige «No añadir».
            </p>
            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16, paddingRight: 4 }}>
              {s.review.map((item) => (
                <div key={item.index} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 13, marginBottom: 8 }}>
                    <strong>{item.track.title}</strong> <span style={{ color: 'var(--text-muted)' }}>· {item.track.artist}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {item.candidates.map((c) => {
                      const selected = item.chosenId === c.id;
                      return (
                        <button
                          key={c.id}
                          onClick={() => s.choose(item.index, c.id)}
                          aria-pressed={selected}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: selected ? 'rgba(29,185,84,0.15)' : 'transparent', border: `1px solid ${selected ? SPOTIFY_GREEN : 'transparent'}`, borderRadius: 6, padding: 6, color: 'inherit', cursor: 'pointer', fontFamily: 'inherit' }}
                        >
                          {c.cover && <img src={c.cover} alt="" style={{ width: 34, height: 34, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />}
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ display: 'block', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.title}</span>
                            <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.artist}{c.album ? ` · ${c.album}` : ''}</span>
                          </span>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => s.choose(item.index, null)}
                      aria-pressed={item.chosenId === null}
                      style={{ alignSelf: 'flex-start', background: 'transparent', border: `1px solid ${item.chosenId === null ? '#ff6b6b' : 'rgba(255,255,255,0.15)'}`, color: item.chosenId === null ? '#ff6b6b' : 'var(--text-muted)', borderRadius: 14, padding: '4px 10px', fontSize: 12, cursor: 'pointer', marginTop: 2 }}
                    >
                      No añadir
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={s.cancel} style={{ background: 'rgba(255,255,255,0.08)' }}>Cancelar</button>
              <button className="btn btn-primary" onClick={s.confirmReview}>
                Crear playlist{chosenCount ? ` (+${chosenCount} revisadas)` : ''}
              </button>
            </div>
          </>
        )}

        {/* 4. Resultado */}
        {s.phase === 'done' && s.result && (
          <div>
            <p style={{ marginTop: 0 }}>
              <strong>{s.name}</strong> ya está en tu biblioteca con {s.result.imported} {s.result.imported === 1 ? 'canción' : 'canciones'}.
            </p>
            {s.result.failedTracks.length > 0 && (
              <p style={muted}>
                {s.result.failedTracks.length} no se encontraron; las verás listadas dentro de la playlist para buscarlas a mano.
              </p>
            )}
            <button className="btn btn-primary" onClick={openPlaylist} style={{ width: '100%' }}>Abrir playlist</button>
          </div>
        )}

        {/* Error */}
        {s.phase === 'error' && (
          <div>
            <p style={{ color: '#ff6b6b', marginTop: 0 }}>{s.error}</p>
            <button className="btn btn-primary" onClick={s.reset} style={{ width: '100%' }}>Probar con otro enlace</button>
          </div>
        )}
      </div>
    </div>
  );
}
