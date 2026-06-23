import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPlaylists, addTrackToPlaylist, createPlaylist, getCollabPlaylists, addTrackToCollabPlaylist, getPlaylistTrackCount, type Playlist } from '../../lib/api';

interface PlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  trackId: string;
}

export default function PlaylistModal({ isOpen, onClose, trackId }: PlaylistModalProps) {
  const queryClient = useQueryClient();

  // Cargar playlists locales
  const { data: localPlaylists = [], isLoading: localLoading } = useQuery<Playlist[]>({
    queryKey: ['playlists'],
    queryFn: getPlaylists,
    enabled: isOpen,
  });

  const deviceId = localStorage.getItem('koko_device_id') || '';
  const { data: collabPlaylists = [], isLoading: collabLoading } = useQuery<any[]>({
    queryKey: ['collabPlaylists', deviceId],
    queryFn: () => getCollabPlaylists(deviceId),
    enabled: isOpen && !!deviceId,
  });

  const playlistsLoading = localLoading || collabLoading;
  
  const playlists = [
    ...localPlaylists.map(p => ({ ...p, isCollab: false })),
    ...collabPlaylists.map(cp => ({
      id: cp.id,
      name: cp.name,
      cover: cp.cover_url,
      tracks: (cp.tracks || []).map((t: any) => ({ trackId: t.track_id })),
      isCollab: true,
      shareCode: cp.share_code
    }))
  ];

  // Mutación para añadir canción a playlist
  const addTrackMutation = useMutation({
    mutationFn: async ({ playlistId, trackId, isCollab }: { playlistId: string; trackId: string; isCollab?: boolean }) => {
      if (isCollab) {
        return addTrackToCollabPlaylist(playlistId, trackId, deviceId);
      } else {
        return addTrackToPlaylist(playlistId, trackId);
      }
    },
    onSuccess: (_, vars) => {
      if (vars.isCollab) {
        queryClient.invalidateQueries({ queryKey: ['collabPlaylists'] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['playlists'] });
        queryClient.invalidateQueries({ queryKey: ['playlist', vars.playlistId] });
      }
      onClose();
    },
  });

  // Mutación para crear playlist y añadir la canción actual de forma automática
  const createPlaylistMutation = useMutation({
    mutationFn: () => createPlaylist({ name: 'Nueva playlist', description: '' }),
    onSuccess: (newPlaylist) => {
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      addTrackMutation.mutate({ playlistId: newPlaylist.id, trackId, isCollab: false });
    },
  });

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
      <div className="playlist-add-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Añadir a playlist</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-playlist-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
          {playlistsLoading ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>Cargando playlists...</div>
          ) : playlists?.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)' }}>No tienes playlists.</div>
          ) : (
            playlists?.map((pl) => {
              const alreadyAdded = pl.tracks.some((t: any) => (t.trackId || t.track_id) === trackId);
              return (
                <div 
                  key={pl.id} 
                  className={`modal-playlist-item ${alreadyAdded ? 'already-added' : ''}`}
                  onClick={() => {
                    if (!alreadyAdded) {
                      addTrackMutation.mutate({ playlistId: pl.id, trackId, isCollab: pl.isCollab });
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px',
                    borderRadius: '8px',
                    cursor: alreadyAdded ? 'default' : 'pointer',
                    background: 'rgba(255,255,255,0.03)',
                    marginBottom: '8px',
                    transition: 'background 0.2s',
                    opacity: alreadyAdded ? 0.6 : 1
                  }}
                >
                  <div className="modal-playlist-info" style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    {pl.cover ? (
                      <img src={pl.cover} alt="" className="modal-playlist-cover" style={{ width: '40px', height: '40px', borderRadius: '4px', objectFit: 'cover' }} />
                    ) : (
                      <div className="modal-playlist-cover empty" style={{ width: '40px', height: '40px', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                        </svg>
                      </div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div className="modal-playlist-name" title={pl.name} style={{ fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{pl.name}</div>
                      <div className="modal-playlist-count" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {getPlaylistTrackCount(pl.id, pl.tracks)} {getPlaylistTrackCount(pl.id, pl.tracks) === 1 ? 'canción' : 'canciones'}
                      </div>
                    </div>
                  </div>
                  
                  {alreadyAdded && (
                    <div className="modal-playlist-add-status" style={{ color: 'var(--accent)' }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                      </svg>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        
        <button 
          className="playlist-create-btn"
          onClick={() => createPlaylistMutation.mutate()}
          disabled={createPlaylistMutation.isPending}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '8px',
            background: 'var(--accent)',
            color: 'black',
            fontWeight: 'bold',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            marginTop: '16px'
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 13h-6v6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          Crear nueva playlist
        </button>
      </div>
    </div>
  );
}
