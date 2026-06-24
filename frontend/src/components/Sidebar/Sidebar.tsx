import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPlaylists, createPlaylist, getCollabPlaylists, deletePlaylist, getPlaylistTrackCount, BASE } from '../../lib/api';
import { resolveImageUrl } from '../../lib/api';
import { usePlayerStore } from '../../store/playerStore';
import { useNotificationStore } from '../../store/notificationStore';
import { useResizableSidebar } from '../../hooks/useResizable';

function IconHome() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
    </svg>
  );
}

function IconLibrary() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/>
    </svg>
  );
}

function IconAdd() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
    </svg>
  );
}

function IconImport() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
    </svg>
  );
}

function IconNote() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
    </svg>
  );
}

function IconStats() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/>
    </svg>
  );
}

function IconFollowing() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
    </svg>
  );
}

function IconFriends() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
    </svg>
  );
}

function IconDj() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-12c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
    </svg>
  );
}

export default function Sidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const [eventsHidden, setEventsHidden] = useState(() => localStorage.getItem('hideEvents') === 'true');
  const { startResize, isResizing, width } = useResizableSidebar();
  const isCollapsed = width < 120;

  // Sync events visibility when changed from Profile page
  useEffect(() => {
    const handler = () => setEventsHidden(localStorage.getItem('hideEvents') === 'true');
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const deviceId = localStorage.getItem('koko_device_id') || '';




  const { data: localPlaylists = [] } = useQuery({
    queryKey: ['playlists'],
    queryFn: getPlaylists,
  });

  const { data: collabPlaylists = [] } = useQuery({
    queryKey: ['collabPlaylists', deviceId],
    queryFn: () => getCollabPlaylists(deviceId),
    enabled: !!deviceId,
  });

  const playlists = [
    ...localPlaylists.map(p => ({ ...p, isCollab: false })),
    ...collabPlaylists.map(cp => ({
      id: cp.share_code,
      name: cp.name,
      cover: resolveImageUrl(cp.cover_url) ?? null,
      tracks: cp.tracks || [],
      isCollab: true,
      updatedAt: cp.updated_at,
    }))
  ];

  const createMutation = useMutation({
    mutationFn: () => createPlaylist({ name: 'Nueva playlist', description: '' }),
    onSuccess: (pl) => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      navigate(`/playlist/${pl.id}`);
    },
  });

  const location = useLocation();
  const activePlaylistId = location.pathname.startsWith('/playlist/')
    ? location.pathname.split('/')[2]
    : null;

  // Auto-delete empty playlists on mount/change to prevent orphan accumulation
  useEffect(() => {
    if (!localPlaylists || localPlaylists.length === 0) return;
    
    // Find empty playlists that are named 'Nueva playlist' and are NOT active
    const emptyNonActive = localPlaylists.filter(
      p => p.id !== 'liked-songs' && 
           p.tracks.length === 0 && 
           p.name === 'Nueva playlist' && 
           p.id !== activePlaylistId
    );

    if (emptyNonActive.length > 0) {
      Promise.all(
        emptyNonActive.map(pl => deletePlaylist(pl.id).catch(() => {}))
      ).then(() => {
        queryClient.invalidateQueries({ queryKey: ['playlists'] });
      });
    }
  }, [localPlaylists, activePlaylistId, queryClient]);

  const handleCreate = () => {
    createMutation.mutate();
  };

  const [importState, setImportState] = useState<{ active: boolean; current: number; total: number; name: string } | null>(null);
  const [disambiguation, setDisambiguation] = useState<{ track: any, candidates: any[], resolve: (id: string | null) => void } | null>(null);
  const [askAlways, setAskAlways] = useState(true);
  const askAlwaysRef = useRef(askAlways);
  useEffect(() => { askAlwaysRef.current = askAlways; }, [askAlways]);

  const handleImport = async () => {
    const url = window.prompt('Pega aquí el enlace de tu playlist de Spotify:');
    if (!url) return;
    
    try {
      setImportState({ active: true, current: 0, total: 0, name: 'Analizando...' });
      
      // 1. Obtener metadatos crudos de Spotify
      const parseRes = await fetch(`${BASE}/import/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (!parseRes.ok) throw new Error('Error al parsear la URL');
      const data = await parseRes.json();
      
      const tracksToResolve = data.tracks || [];
      setImportState({ active: true, current: 0, total: tracksToResolve.length, name: data.name });

      // 2. Resolver track a track de manera secuencial (Batch = 1) y con pausa para no saturar iTunes (Rate limit 429)
      const tracksIds: string[] = [];
      const failedTracks: any[] = [];
      
      for (let i = 0; i < tracksToResolve.length; i++) {
        const track = tracksToResolve[i];
        try {
          const res = await fetch(`${BASE}/import/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ track })
          });
          
          if (res.ok) {
            const data = await res.json();
            if (data.exactMatch || !askAlwaysRef.current) {
              tracksIds.push(data.results[0].id);
            } else {
              // Pause loop and ask user
              const chosenId = await new Promise<string | null>((resolve) => {
                setDisambiguation({ track, candidates: data.results, resolve });
              });
              setDisambiguation(null);
              if (chosenId) {
                tracksIds.push(chosenId);
              } else {
                failedTracks.push(track);
              }
            }
          } else {
            failedTracks.push(track);
          }
        } catch (e) {
          failedTracks.push(track);
        }
        
        setImportState(prev => prev ? { ...prev, current: i + 1 } : null);
        
        // Pausa de 300ms entre peticiones para respetar rate limits de iTunes/YouTube
        await new Promise(r => setTimeout(r, 300));
      }
      
      // 3. Crear Playlist local
      const newPl = await createPlaylist({ 
        name: data.name, 
        description: 'Importada desde Spotify', 
        cover: data.cover,
        tracks: tracksIds
      });
      
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      navigate(`/playlist/${newPl.id}`, { state: { failedTracks } });
    } catch (err) {
      alert('Hubo un error al importar la playlist. Revisa la consola.');
      console.error(err);
    } finally {
      setImportState(null);
    }
  };

  return (
    <nav className="sidebar">
      {/* Logo */}
      <NavLink to="/" className="sidebar-logo" style={isCollapsed ? { justifyContent: 'center', padding: '16px 0' } : undefined}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="#1DB954">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
        </svg>
        {!isCollapsed && <span className="sidebar-logo-text">Koko<span>Music</span></span>}
      </NavLink>

      {/* Main nav */}
      <ul className="sidebar-nav">
        <li className="sidebar-nav-item">
          <NavLink to="/" end style={isCollapsed ? { justifyContent: 'center', padding: '10px 0' } : undefined} title={isCollapsed ? "Inicio" : undefined}>
            <IconHome /> {!isCollapsed && "Inicio"}
          </NavLink>
        </li>
        <li className="sidebar-nav-item">
          <NavLink to="/search" style={isCollapsed ? { justifyContent: 'center', padding: '10px 0' } : undefined} title={isCollapsed ? "Buscar" : undefined}>
            <IconSearch /> {!isCollapsed && "Buscar"}
          </NavLink>
        </li>
        <li className="sidebar-nav-item">
          <NavLink to="/library" style={isCollapsed ? { justifyContent: 'center', padding: '10px 0' } : undefined} title={isCollapsed ? "Biblioteca" : undefined}>
            <IconLibrary /> {!isCollapsed && "Biblioteca"}
          </NavLink>
        </li>
        <li className="sidebar-nav-item">
          <NavLink to="/stats" style={isCollapsed ? { justifyContent: 'center', padding: '10px 0' } : undefined} title={isCollapsed ? "Estadísticas" : undefined}>
            <IconStats /> {!isCollapsed && "Estadísticas"}
          </NavLink>
        </li>
        <li className="sidebar-nav-item">
          <NavLink to="/friends" style={isCollapsed ? { justifyContent: 'center', padding: '10px 0' } : undefined} title={isCollapsed ? "Amigos" : undefined}>
            <IconFriends /> {!isCollapsed && "Amigos"}
          </NavLink>
        </li>
        <li className="sidebar-nav-item">
          <NavLink to="/dj" style={isCollapsed ? { justifyContent: 'center', padding: '10px 0' } : undefined} title={isCollapsed ? "Modo DJ" : undefined}>
            <IconDj /> {!isCollapsed && "Modo DJ"}
          </NavLink>
        </li>
        <li className="sidebar-nav-item">
          <NavLink 
            to="/following" 
            style={isCollapsed ? { justifyContent: 'center', padding: '10px 0' } : { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 12 }}
            title={isCollapsed ? "Siguiendo" : undefined}
          >
            <span style={isCollapsed ? { display: 'flex', justifyContent: 'center' } : { display: 'flex', alignItems: 'center', gap: 12 }}>
              <IconFollowing /> {!isCollapsed && "Siguiendo"}
            </span>
            {!isCollapsed && unreadCount > 0 && (
              <span
                style={{
                  background: '#25D366',
                  color: '#000',
                  fontSize: 10,
                  fontWeight: 900,
                  borderRadius: 10,
                  padding: '2px 6px',
                  minWidth: 16,
                  height: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 8px rgba(37,211,102,0.4)',
                  animation: 'pulseBadge 2s infinite',
                }}
              >
                {unreadCount}
              </span>
            )}
          </NavLink>
          <style>{`
            @keyframes pulseBadge {
              0% { transform: scale(1); }
              50% { transform: scale(1.1); box-shadow: 0 0 10px rgba(37, 211, 102, 0.7); }
              100% { transform: scale(1); }
            }
          `}</style>
        </li>
        {!eventsHidden && (
          <li className="sidebar-nav-item">
            <NavLink to="/events" style={isCollapsed ? { justifyContent: 'center', padding: '10px 0' } : undefined} title={isCollapsed ? "Eventos" : undefined}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
              {!isCollapsed && "Eventos"}
            </NavLink>
          </li>
        )}
      </ul>


      {/* Playlists section */}
      {!isCollapsed ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
          <span className="sidebar-section-label" style={{ padding: '16px 8px 8px' }}>
            Playlists
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="ctrl-btn"
              onClick={handleImport}
              title="Importar desde Spotify"
              style={{ marginTop: 4, opacity: importState?.active ? 0.5 : 1 }}
              disabled={importState?.active}
            >
              <IconImport />
            </button>
            <button
              className="ctrl-btn"
              onClick={handleCreate}
              title="Nueva playlist"
              style={{ marginTop: 4 }}
            >
              <IconAdd />
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '12px 0 6px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            className="ctrl-btn"
            onClick={handleCreate}
            title="Nueva playlist"
            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', border: 'none', cursor: 'pointer' }}
          >
            <IconAdd />
          </button>
        </div>
      )}

      <div className="sidebar-playlists">
        {importState?.active && !isCollapsed && (
          <div style={{ padding: '12px', background: 'rgba(255,255,255,0.05)', margin: '0 12px 12px', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-primary)' }}>
              Importando: {importState.name}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
              {importState.total > 0 ? `Buscando ${importState.current} de ${importState.total} canciones...` : 'Obteniendo metadata de Spotify...'}
            </div>
            <div style={{ height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
              <div 
                style={{ 
                  height: '100%', 
                  background: 'var(--accent)', 
                  width: importState.total > 0 ? `${(importState.current / importState.total) * 100}%` : '10%',
                  transition: 'width 0.3s ease'
                }} 
              />
            </div>
          </div>
        )}
        {playlists.length === 0 && !isCollapsed && (
          <p style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
            Crea tu primera playlist &rarr;
          </p>
        )}
        {[...playlists].sort((a, b) => {
          if (a.id === 'liked-songs') return -1;
          if (b.id === 'liked-songs') return 1;
          return 0;
        }).map((pl) => {
          // Count tracks properly for both local and collab
          const trackCount = getPlaylistTrackCount(pl.id, pl.tracks);
          const isCurrentlyPlaying = currentTrack && Array.isArray(pl.tracks) && pl.tracks.some(
            (t: any) => (t.trackId || t.track_id || t) === currentTrack.id
          );
          return (
          <NavLink
            key={pl.id}
            to={pl.isCollab ? `/playlist/${pl.id}?collab=true` : `/playlist/${pl.id}`}
            style={{ textDecoration: 'none' }}
          >
            <div
              className="sidebar-playlist-item"
              style={{
                ...(isCurrentlyPlaying ? { color: 'var(--accent)' } : {}),
                ...(isCollapsed ? { justifyContent: 'center', padding: '8px 0' } : {})
              }}
              title={isCollapsed ? pl.name : undefined}
            >
              <div 
                className={`sidebar-playlist-cover ${!pl.cover ? 'empty' : ''}`}
                style={{
                  ...(pl.cover ? { backgroundImage: `url("${pl.cover}")`, backgroundSize: 'cover', border: 'none' } : {}),
                  ...(isCollapsed ? { width: '32px', height: '32px', minWidth: '32px' } : {})
                }}
              >
                {!pl.cover && <IconNote />}
              </div>
              {!isCollapsed && (
                <div className="sidebar-playlist-info">
                  <div className="sidebar-playlist-name" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {pl.name}
                    {pl.isCollab && (
                      <span style={{
                        fontSize: 9, fontWeight: 800, color: '#a78bfa',
                        background: 'rgba(139,92,246,0.15)', borderRadius: 4,
                        padding: '1px 4px', letterSpacing: 0.3, flexShrink: 0
                      }}>COLLAB</span>
                    )}
                  </div>
                  <div className="sidebar-playlist-meta">
                    {pl.isCollab ? 'Colaborativa' : 'Playlist'} &middot; {trackCount} {trackCount === 1 ? 'canción' : 'canciones'}
                  </div>
                </div>
              )}
            </div>
          </NavLink>
          );
        })}
      </div>



      {/* Modal de Disambiguación */}
      {disambiguation && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: 24
        }}>
          <div style={{
            background: 'var(--bg-card)', padding: 24, borderRadius: 12, width: '100%', maxWidth: 500,
            border: '1px solid rgba(255,255,255,0.1)', color: 'white'
          }}>
            <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 18 }}>Confirmar Canción</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 20 }}>
              No hemos encontrado una coincidencia exacta para <strong>{disambiguation.track.title}</strong> de <strong>{disambiguation.track.artist}</strong>. Selecciona la opción correcta o descártala.
            </p>

            <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {disambiguation.candidates.map((c) => (
                <div key={c.id} style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: 8, borderRadius: 8 }}>
                  <img src={c.cover} alt="cover" style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover' }} />
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{c.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.artist}</div>
                  </div>
                  <button 
                    onClick={() => disambiguation.resolve(c.id)}
                    style={{ background: 'var(--accent)', border: 'none', padding: '6px 12px', borderRadius: 16, color: 'black', fontWeight: 600, cursor: 'pointer', fontSize: 12 }}
                  >
                    Elegir
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={!askAlways} 
                  onChange={(e) => setAskAlways(!e.target.checked)} 
                />
                Aceptar siempre el primer resultado
              </label>
              
              <button 
                onClick={() => disambiguation.resolve(null)}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'white', padding: '8px 16px', borderRadius: 20, cursor: 'pointer', fontSize: 13 }}
              >
                Descartar esta
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Sidebar resizer handle */}
      <div 
        className="resize-handle sidebar-resizer"
        onMouseDown={startResize}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '4px',
          height: '100%',
          cursor: 'col-resize',
          zIndex: 100,
          backgroundColor: isResizing ? 'var(--accent)' : 'transparent',
          transition: 'background-color 0.2s',
        }}
        onMouseEnter={(e) => {
          if (!isResizing) e.currentTarget.style.backgroundColor = 'var(--accent)';
        }}
        onMouseLeave={(e) => {
          if (!isResizing) e.currentTarget.style.backgroundColor = 'transparent';
        }}
      />
    </nav>
  );
}
