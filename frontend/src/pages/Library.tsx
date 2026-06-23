import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { 
  getPlaylists, 
  deletePlaylist, 
  getCollabPlaylists, 
  createCollabPlaylist, 
  joinCollabPlaylist, 
  deleteCollabPlaylist,
  getCustomTracks,
  uploadCustomTrack,
  deleteCustomTrack,
  addTrackToPlaylist,
  addTrackToCollabPlaylist,
  getPlaylistTrackCount,
  type Track 
} from '../lib/api';
import { usePlayerStore } from '../store/playerStore';

function getDeviceId(): string {
  const k = 'koko_device_id';
  let id = localStorage.getItem(k);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(k, id); }
  return id;
}
function getDisplayName(): string {
  return localStorage.getItem('koko_display_name') ?? 'Oyente';
}

export default function Library() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deviceId = getDeviceId();
  const displayName = getDisplayName();
  const { setTrack, addToQueue, setError } = usePlayerStore();

  const [activeTab, setActiveTab] = useState<'playlists' | 'custom'>('playlists');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Join collab playlist
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);

  // Custom Tracks / Upload states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showAliasModal, setShowAliasModal] = useState(false);
  const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState<Track | null>(null);

  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadArtist, setUploadArtist] = useState('');
  const [uploadAlbum, setUploadAlbum] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadLoading, setUploadLoading] = useState(false);
  const fileAudioRef = useRef<HTMLInputElement>(null);
  const fileCoverRef = useRef<HTMLInputElement>(null);

  const [aliasTitle, setAliasTitle] = useState('');
  const [aliasArtist, setAliasArtist] = useState('');
  const [aliasAlbum, setAliasAlbum] = useState('');
  const [aliasYoutubeUrl, setAliasYoutubeUrl] = useState('');
  const [aliasDuration, setAliasDuration] = useState('180'); // default 3 min
  const [aliasError, setAliasError] = useState('');
  const [aliasLoading, setAliasLoading] = useState(false);
  const [uploadIsPublic, setUploadIsPublic] = useState(false);
  const [aliasIsPublic, setAliasIsPublic] = useState(false);

  // Queries
  const { data: playlists = [], isLoading: localLoading } = useQuery({
    queryKey: ['playlists'],
    queryFn: getPlaylists,
  });

  const { data: collabPlaylists = [], isLoading: collabLoading } = useQuery({
    queryKey: ['collabPlaylists', deviceId],
    queryFn: () => getCollabPlaylists(deviceId),
    enabled: !!deviceId,
  });

  const { data: customTracks = [], isLoading: customLoading } = useQuery({
    queryKey: ['customTracks'],
    queryFn: getCustomTracks,
  });

  const isLoading = localLoading || collabLoading;

  const createCollabMutation = useMutation({
    mutationFn: () => createCollabPlaylist({
      name: newName.trim() || 'Nueva playlist',
      owner_id: deviceId,
      display_name: displayName,
    }),
    onSuccess: (pl) => {
      queryClient.invalidateQueries({ queryKey: ['collabPlaylists'] });
      setNewName('');
      setCreating(false);
      navigate(`/playlist/${pl.share_code}?collab=true`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deletePlaylist,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['playlists'] }),
  });

  const deleteCollabMutation = useMutation({
    mutationFn: (id: string) => deleteCollabPlaylist(id, deviceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collabPlaylists', deviceId] }),
  });

  const deleteCustomMutation = useMutation({
    mutationFn: deleteCustomTrack,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customTracks'] }),
  });

  async function handleJoin() {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) { setJoinError('El código debe tener 6 caracteres'); return; }
    setJoinLoading(true);
    setJoinError('');
    try {
      await joinCollabPlaylist(code, deviceId, displayName);
      queryClient.invalidateQueries({ queryKey: ['collabPlaylists'] });
      setJoinCode('');
      setShowJoinModal(false);
      navigate(`/playlist/${code}?collab=true`);
    } catch (e: any) {
      setJoinError(e.message ?? 'Código inválido');
    }
    setJoinLoading(false);
  }

  // Handle local file upload
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError('');
    const audioFile = fileAudioRef.current?.files?.[0];
    if (!audioFile) {
      setUploadError('Por favor selecciona un archivo de audio (.mp3)');
      return;
    }

    setUploadLoading(true);
    try {
      const formData = new FormData();
      formData.append('title', uploadTitle.trim());
      formData.append('artist', uploadArtist.trim());
      if (uploadAlbum.trim()) formData.append('album', uploadAlbum.trim());
      formData.append('sourceType', 'upload');
      formData.append('audio', audioFile);
      formData.append('isPublic', String(uploadIsPublic));

      const coverFile = fileCoverRef.current?.files?.[0];
      if (coverFile) {
        formData.append('cover', coverFile);
      }

      await uploadCustomTrack(formData);
      queryClient.invalidateQueries({ queryKey: ['customTracks'] });
      setShowUploadModal(false);
      setUploadTitle('');
      setUploadArtist('');
      setUploadAlbum('');
      setUploadIsPublic(false);
      if (fileAudioRef.current) fileAudioRef.current.value = '';
      if (fileCoverRef.current) fileCoverRef.current.value = '';
    } catch (err: any) {
      setUploadError(err.message ?? 'Error al subir archivo');
    } finally {
      setUploadLoading(false);
    }
  };

  // Handle YouTube alias creation
  const handleAliasSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAliasError('');

    let ytId = aliasYoutubeUrl.trim();
    if (ytId.includes('v=')) ytId = ytId.split('v=')[1].split('&')[0].substring(0, 11);
    else if (ytId.includes('youtu.be/')) ytId = ytId.split('youtu.be/')[1].split('?')[0].substring(0, 11);

    if (!ytId || ytId.length !== 11) {
      setAliasError('Por favor introduce una URL o ID de YouTube de 11 caracteres válido.');
      return;
    }

    setAliasLoading(true);
    try {
      const formData = new FormData();
      formData.append('title', aliasTitle.trim());
      formData.append('artist', aliasArtist.trim());
      if (aliasAlbum.trim()) formData.append('album', aliasAlbum.trim());
      formData.append('sourceType', 'youtube_alias');
      formData.append('youtubeId', ytId);
      
      const seconds = parseInt(aliasDuration, 10) || 180;
      formData.append('duration', String(seconds * 1000));
      formData.append('isPublic', String(aliasIsPublic));

      await uploadCustomTrack(formData);
      queryClient.invalidateQueries({ queryKey: ['customTracks'] });
      setShowAliasModal(false);
      setAliasTitle('');
      setAliasArtist('');
      setAliasAlbum('');
      setAliasYoutubeUrl('');
      setAliasDuration('180');
      setAliasIsPublic(false);
    } catch (err: any) {
      setAliasError(err.message ?? 'Error al crear alias');
    } finally {
      setAliasLoading(false);
    }
  };

  return (
    <div className="main-body" style={{ paddingTop: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 className="section-title" style={{ margin: 0 }}>Tu Biblioteca</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {activeTab === 'playlists' ? (
            <>
              <button
                className="btn"
                style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)', fontSize: 13, padding: '8px 14px', borderRadius: 20 }}
                onClick={() => setShowJoinModal(true)}
                title="Unirse a playlist colaborativa con código"
              >
                Unirse con código
              </button>
              <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
                {creating ? 'Cancelar' : '+ Nueva playlist'}
              </button>
            </>
          ) : (
            <>
              <button
                className="btn"
                style={{ background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)', fontSize: 13, padding: '8px 14px', borderRadius: 20 }}
                onClick={() => setShowAliasModal(true)}
              >
                + Crear Alias YouTube
              </button>
              <button className="btn btn-primary" onClick={() => setShowUploadModal(true)}>
                + Subir Audio (.mp3)
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 24, gap: 24 }}>
        <button
          onClick={() => setActiveTab('playlists')}
          style={{
            background: 'none',
            border: 'none',
            color: activeTab === 'playlists' ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontSize: 15,
            fontWeight: 700,
            padding: '12px 4px',
            cursor: 'pointer',
            borderBottom: activeTab === 'playlists' ? '2px solid var(--accent)' : '2px solid transparent',
            transition: 'all 0.2s',
          }}
        >
          Playlists
        </button>
        <button
          onClick={() => setActiveTab('custom')}
          style={{
            background: 'none',
            border: 'none',
            color: activeTab === 'custom' ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontSize: 15,
            fontWeight: 700,
            padding: '12px 4px',
            cursor: 'pointer',
            borderBottom: activeTab === 'custom' ? '2px solid var(--accent)' : '2px solid transparent',
            transition: 'all 0.2s',
          }}
        >
          Archivos y Alias YouTube
        </button>
      </div>

      {/* Playlists Tab */}
      {activeTab === 'playlists' && (
        <>
          {creating && (
            <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 24, border: '1px solid #1DB95440' }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                <input
                  type="text"
                  placeholder="Nombre de la playlist..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                  style={{ flex: 1, background: 'var(--bg-highlight)', border: '1px solid #ffffff20', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 14, padding: '10px 14px', outline: 'none' }}
                />
              </div>
              <form onSubmit={(e) => { e.preventDefault(); createCollabMutation.mutate(); }}>
                <button type="submit" className="btn btn-primary" disabled={createCollabMutation.isPending}>
                  {createCollabMutation.isPending ? 'Creando...' : 'Crear playlist'}
                </button>
              </form>
            </div>
          )}

          {isLoading ? (
            <div className="tracks-grid">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="track-card" style={{ cursor: 'default' }}>
                  <div className="skeleton" style={{ aspectRatio: '1', borderRadius: 8, marginBottom: 12 }} />
                  <div className="skeleton" style={{ height: 14, width: '70%', marginBottom: 8 }} />
                  <div className="skeleton" style={{ height: 12, width: '45%' }} />
                </div>
              ))}
            </div>
          ) : playlists.length === 0 && collabPlaylists.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.4"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg></div>
              <p>Todavía no tienes playlists</p>
              <small>Crea una y empieza a añadir canciones</small>
            </div>
          ) : (
            <div className="tracks-grid">
              {/* Local playlists */}
              {playlists.map((pl) => (
                <div key={pl.id} className="track-card" onClick={() => navigate(`/playlist/${pl.id}`)}>
                  <div className="track-card-cover-wrap" style={{ background: pl.cover ? `url(${pl.cover}) center/cover` : 'linear-gradient(135deg,#1DB95430,#121212)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                    {!pl.cover && <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>}
                  </div>
                  <div className="track-card-title">{pl.name}</div>
                  <div className="track-card-artist">{getPlaylistTrackCount(pl.id, pl.tracks)} canciones</div>
                  <button
                    className="ctrl-btn"
                    style={{ position: 'absolute', top: 12, right: 12, background: '#00000080', borderRadius: 4, padding: 6 }}
                    onClick={(e) => { e.stopPropagation(); if (confirm(`¿Eliminar "${pl.name}"?`)) deleteMutation.mutate(pl.id); }}
                    title="Eliminar"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                  </button>
                </div>
              ))}

              {/* Collaborative playlists */}
              {collabPlaylists.map((cp) => (
                <div key={cp.id} className="track-card" onClick={() => navigate(`/playlist/${cp.share_code}?collab=true`)}>
                  <div className="track-card-cover-wrap" style={{ background: cp.cover_url ? `url(${cp.cover_url}) center/cover` : 'linear-gradient(135deg,#1DB95430,#121212)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', position: 'relative' }}>
                    {!cp.cover_url && <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>}
                  </div>
                  <div className="track-card-title">{cp.name}</div>
                  <div className="track-card-artist" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>{getPlaylistTrackCount(cp.id || cp.share_code, cp.tracks)} canciones</span>
                    {cp.owner_id !== deviceId && (
                      <>
                        <span style={{ color: 'rgba(255,255,255,0.3)' }}>·</span>
                        <span style={{ color: 'var(--text-muted)' }}>Colaborador</span>
                      </>
                    )}
                  </div>
                  <button
                    className="ctrl-btn"
                    style={{ position: 'absolute', top: 12, right: 12, background: '#00000080', borderRadius: 4, padding: 6 }}
                    onClick={(e) => { e.stopPropagation(); if (confirm(cp.owner_id === deviceId ? `¿Eliminar "${cp.name}" para todos?` : `¿Dejar de colaborar en "${cp.name}"?`)) deleteCollabMutation.mutate(cp.id); }}
                    title={cp.owner_id === deviceId ? "Eliminar playlist colaborativa" : "Dejar de colaborar"}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Custom Tracks & Aliases Tab */}
      {activeTab === 'custom' && (
        <>
          {customLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="track-row">
                  <div className="skeleton" style={{ width: 40, height: 40, borderRadius: 4 }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton" style={{ width: 150, height: 14, marginBottom: 6 }} />
                    <div className="skeleton" style={{ width: 90, height: 11 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : customTracks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.4">
                  <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3zm-5.55-8h-2.9v3H8l4 4 4-4h-2.55z"/>
                </svg>
              </div>
              <p>Aún no has subido audios ni creado alias</p>
              <small>Sube un archivo .mp3 o crea una versión personalizada de YouTube</small>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 32 }}>
              {customTracks.map((track) => (
                <div 
                  key={track.id} 
                  className="track-row" 
                  onClick={() => setTrack(track, customTracks)}
                  style={{ padding: '8px 12px', borderRadius: 8, cursor: 'pointer', transition: 'background-color 0.2s' }}
                >
                  <div className="track-row-info">
                    <img className="track-row-cover" src={track.cover} alt={track.title} style={{ width: 40, height: 40, borderRadius: 4, objectFit: 'cover' }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="track-row-name" style={{ fontSize: 14, fontWeight: 600 }}>{track.title}</div>
                      <div className="track-row-artist" style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{track.artist}</span>
                        {track.album && (
                          <>
                            <span style={{ opacity: 0.4 }}>·</span>
                            <span>{track.album}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
                    {/* Source Tag */}
                    {(track as any).sourceType === 'upload' ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#60a5fa', background: 'rgba(96,165,250,0.12)', padding: '2px 8px', borderRadius: 10 }}>
                        Archivo
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#f87171', background: 'rgba(248,113,113,0.12)', padding: '2px 8px', borderRadius: 10 }}>
                        Alias YT
                      </span>
                    )}

                    {/* Actions */}
                    <button 
                      className="ctrl-btn"
                      style={{ padding: 6, opacity: 0.7 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        addToQueue(track);
                        setError(`Añadido a la cola: ${track.title}`);
                      }}
                      title="Añadir a la cola"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>

                    <button 
                      className="ctrl-btn"
                      style={{ padding: 6, opacity: 0.7 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTrackForPlaylist(track);
                      }}
                      title="Añadir a playlist"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                      </svg>
                    </button>

                    <button 
                      className="ctrl-btn"
                      style={{ padding: 6, opacity: 0.7 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`¿Eliminar definitivamente "${track.title}" de tus audios?`)) {
                          deleteCustomMutation.mutate(track.id);
                        }
                      }}
                      title="Eliminar audio"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Join Collab Playlist Modal */}
      {showJoinModal && (
        <div className="modal-overlay" onClick={() => setShowJoinModal(false)}>
          <div className="playlist-add-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Unirse a playlist colaborativa</h3>
              <button className="modal-close" onClick={() => setShowJoinModal(false)}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Introduce el código de 6 caracteres que te compartió el dueño.
            </p>
            <input
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '12px 14px', color: 'white', fontSize: 22, letterSpacing: 6, fontWeight: 800, textAlign: 'center', outline: 'none', fontFamily: 'inherit', textTransform: 'uppercase', marginBottom: 16 }}
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="ABC123"
              maxLength={6}
            />
            {joinError && <div style={{ color: '#ff6b6b', fontSize: 13, marginBottom: 12 }}>{joinError}</div>}
            <button
              className="btn btn-primary"
              onClick={handleJoin}
              disabled={joinLoading || joinCode.length !== 6}
              style={{ width: '100%' }}
            >
              {joinLoading ? 'Uniéndome…' : 'Unirse'}
            </button>
          </div>
        </div>
      )}

      {/* Upload Audio Modal */}
      {showUploadModal && (
        <div className="modal-overlay" onClick={() => setShowUploadModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 440, background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Subir archivo de audio local</h2>
              <button className="modal-close" onClick={() => setShowUploadModal(false)}>×</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 20, fontSize: 13, lineHeight: 1.5 }}>
              Sube tu propio archivo de audio (.mp3, .wav, .m4a) para reproducirlo directamente en KokoMusic o añadirlo a tus playlists.
            </p>

            <form onSubmit={handleUploadSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Título *</label>
                <input
                  type="text"
                  required
                  value={uploadTitle}
                  onChange={e => setUploadTitle(e.target.value)}
                  style={{ padding: '10px 14px', background: 'var(--bg-highlight)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', color: 'white', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Artista / Autor *</label>
                <input
                  type="text"
                  required
                  value={uploadArtist}
                  onChange={e => setUploadArtist(e.target.value)}
                  style={{ padding: '10px 14px', background: 'var(--bg-highlight)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', color: 'white', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Álbum (Opcional)</label>
                <input
                  type="text"
                  value={uploadAlbum}
                  onChange={e => setUploadAlbum(e.target.value)}
                  style={{ padding: '10px 14px', background: 'var(--bg-highlight)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', color: 'white', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Archivo de Audio (.mp3, .wav) *</label>
                <input
                  type="file"
                  required
                  accept="audio/*"
                  ref={fileAudioRef}
                  style={{ fontSize: 12, padding: '6px 0', color: 'var(--text-secondary)' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Carátula / Portada (Opcional)</label>
                <input
                  type="file"
                  accept="image/*"
                  ref={fileCoverRef}
                  style={{ fontSize: 12, padding: '6px 0', color: 'var(--text-secondary)' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <input
                  type="checkbox"
                  id="uploadIsPublic"
                  checked={uploadIsPublic}
                  onChange={e => setUploadIsPublic(e.target.checked)}
                  style={{ cursor: 'pointer', width: 16, height: 16, accentColor: 'var(--accent)' }}
                />
                <label htmlFor="uploadIsPublic" style={{ fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 500 }}>
                  Hacer público (Subir a la nube / playlists colaborativas)
                </label>
              </div>

              {uploadError && <div style={{ color: '#ff6b6b', fontSize: 13, marginTop: 4 }}>{uploadError}</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                <button type="button" className="btn" onClick={() => setShowUploadModal(false)} style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={uploadLoading}>
                  {uploadLoading ? 'Subiendo...' : 'Subir audio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* YouTube Alias Modal */}
      {showAliasModal && (
        <div className="modal-overlay" onClick={() => setShowAliasModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 440, background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Crear alias de YouTube</h2>
              <button className="modal-close" onClick={() => setShowAliasModal(false)}>×</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 20, fontSize: 13, lineHeight: 1.5 }}>
              Crea una copia o versión personalizada de cualquier video o canción de YouTube especificando su enlace e ID.
            </p>

            <form onSubmit={handleAliasSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Título del Alias *</label>
                <input
                  type="text"
                  required
                  value={aliasTitle}
                  onChange={e => setAliasTitle(e.target.value)}
                  placeholder="Ej: Bohemian Rhapsody (Directo)"
                  style={{ padding: '10px 14px', background: 'var(--bg-highlight)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', color: 'white', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Artista *</label>
                <input
                  type="text"
                  required
                  value={aliasArtist}
                  onChange={e => setAliasArtist(e.target.value)}
                  style={{ padding: '10px 14px', background: 'var(--bg-highlight)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', color: 'white', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Álbum (Opcional)</label>
                <input
                  type="text"
                  value={aliasAlbum}
                  onChange={e => setAliasAlbum(e.target.value)}
                  style={{ padding: '10px 14px', background: 'var(--bg-highlight)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', color: 'white', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Enlace de YouTube o ID *</label>
                <input
                  type="text"
                  required
                  value={aliasYoutubeUrl}
                  onChange={e => setAliasYoutubeUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  style={{ padding: '10px 14px', background: 'var(--bg-highlight)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', color: 'white', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Duración aproximada (segundos)</label>
                <input
                  type="number"
                  value={aliasDuration}
                  onChange={e => setAliasDuration(e.target.value)}
                  style={{ padding: '10px 14px', background: 'var(--bg-highlight)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 'var(--radius-md)', color: 'white', outline: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <input
                  type="checkbox"
                  id="aliasIsPublic"
                  checked={aliasIsPublic}
                  onChange={e => setAliasIsPublic(e.target.checked)}
                  style={{ cursor: 'pointer', width: 16, height: 16, accentColor: 'var(--accent)' }}
                />
                <label htmlFor="aliasIsPublic" style={{ fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 500 }}>
                  Hacer público (Compartir en playlists colaborativas)
                </label>
              </div>

              {aliasError && <div style={{ color: '#ff6b6b', fontSize: 13, marginTop: 4 }}>{aliasError}</div>}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                <button type="button" className="btn" onClick={() => setShowAliasModal(false)} style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={aliasLoading}>
                  {aliasLoading ? 'Creando...' : 'Crear Alias'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add To Playlist Modal */}
      {selectedTrackForPlaylist && (
        <div className="modal-overlay" onClick={() => setSelectedTrackForPlaylist(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 400, background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Añadir a una playlist</h3>
              <button className="modal-close" onClick={() => setSelectedTrackForPlaylist(null)}>×</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
              {playlists.map((pl) => (
                <div 
                  key={pl.id} 
                  className="track-row" 
                  style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer' }}
                  onClick={async () => {
                    try {
                      await addTrackToPlaylist(pl.id, selectedTrackForPlaylist.id);
                      queryClient.invalidateQueries({ queryKey: ['playlists'] });
                      alert(`Añadida a ${pl.name}`);
                      setSelectedTrackForPlaylist(null);
                    } catch (e: any) {
                      alert(e.message ?? 'Error al añadir track');
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 4, background: pl.cover ? `url(${pl.cover}) center/cover` : 'linear-gradient(135deg,#1DB95430,#121212)' }} />
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{pl.name}</span>
                  </div>
                </div>
              ))}

              {collabPlaylists.map((cp) => (
                <div 
                  key={cp.id} 
                  className="track-row" 
                  style={{ padding: '8px 10px', borderRadius: 6, cursor: 'pointer' }}
                  onClick={async () => {
                    try {
                      await addTrackToCollabPlaylist(cp.id, selectedTrackForPlaylist.id, deviceId);
                      queryClient.invalidateQueries({ queryKey: ['collabPlaylists'] });
                      alert(`Añadida a ${cp.name}`);
                      setSelectedTrackForPlaylist(null);
                    } catch (e: any) {
                      alert(e.message ?? 'Error al añadir track');
                    }
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 4, background: cp.cover_url ? `url(${cp.cover_url}) center/cover` : 'linear-gradient(135deg,#1DB95430,#121212)' }} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{cp.name}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Playlist colaborativa</span>
                    </div>
                  </div>
                </div>
              ))}

              {playlists.length === 0 && collabPlaylists.length === 0 && (
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
                  No tienes ninguna playlist creada todavía.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
