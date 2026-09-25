import { useState, useMemo, useEffect, useRef, type ChangeEvent, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  getMyProfile,
  updateProfile,
  getMyArtistTracks,
  uploadArtistTrack,
  deleteArtistTrack,
  updateArtistTrack,
  resolveImageUrl,
  getStreamUrl,
  type ArtistTrack,
} from '../lib/api';

const GENRES = ['Urbano/Latino', 'Reggaetón', 'Trap', 'Phonk', 'R&B', 'Pop', 'Hip-Hop', 'Electronic', 'Rock', 'Otros'];

function formatDuration(ms: number | null): string {
  if (!ms) return '--:--';
  const secs = Math.round(ms / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const cardStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.025)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  borderRadius: 18,
  border: '1px solid rgba(255,255,255,0.07)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  padding: '22px 24px',
  marginBottom: 20,
};

const inputStyle: React.CSSProperties = {
  backgroundColor: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: '#fff',
  borderRadius: 12,
  padding: '11px 14px',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s ease',
};

export default function ArtistStudio() {
  const navigate = useNavigate();
  const savedId = localStorage.getItem('koko_device_id') ?? '';

  const { data: profileData, refetch: refetchProfile } = useQuery({
    queryKey: ['my-profile', savedId],
    queryFn: () => getMyProfile(savedId),
    enabled: !!savedId,
  });
  const profile = profileData?.profile;
  const [showPreview, setShowPreview] = useState(false);

  const { data: artistTracksData, refetch: refetchArtistTracks } = useQuery({
    queryKey: ['my-artist-tracks', savedId],
    queryFn: () => getMyArtistTracks(),
    enabled: !!savedId && !!profile?.is_artist,
  });
  const artistTracks: ArtistTrack[] = artistTracksData?.tracks ?? [];

  useEffect(() => {
    if (profileData && !profile?.is_artist) {
      navigate('/profile', { replace: true });
    }
  }, [profileData, profile?.is_artist, navigate]);

  // ── Descripción de artista (mismo campo `bio` que Perfil) ────────────────────
  const [bio, setBio] = useState('');
  const [bioSaving, setBioSaving] = useState(false);
  const [bioSaved, setBioSaved] = useState(false);
  const [bioFocused, setBioFocused] = useState(false);
  useEffect(() => {
    if (profile?.bio !== undefined) setBio(profile.bio ?? '');
  }, [profile?.bio]);

  const handleSaveBio = async () => {
    if (!savedId) return;
    setBioSaving(true);
    setBioSaved(false);
    try {
      await updateProfile(savedId, { bio });
      await refetchProfile();
      setBioSaved(true);
      setTimeout(() => setBioSaved(false), 2000);
    } catch (e) {
      console.error('Error al guardar la descripción:', e);
    } finally {
      setBioSaving(false);
    }
  };

  // ── Subida de canciones ───────────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [album, setAlbum] = useState('');
  const [genre, setGenre] = useState('Otros');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [audioDragOver, setAudioDragOver] = useState(false);
  const [coverDragOver, setCoverDragOver] = useState(false);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!coverFile) { setCoverPreviewUrl(null); return; }
    const url = URL.createObjectURL(coverFile);
    setCoverPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const pickAudioFile = (files: FileList | null) => {
    const f = files?.[0];
    if (f && f.type.startsWith('audio/')) setAudioFile(f);
  };
  const pickCoverFile = (files: FileList | null) => {
    const f = files?.[0];
    if (f && f.type.startsWith('image/')) setCoverFile(f);
  };

  const handleUpload = async () => {
    if (!audioFile || !title.trim()) {
      setUploadError('Título y archivo de audio son obligatorios');
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const durationMs = await new Promise<number>((resolve) => {
        const audioEl = document.createElement('audio');
        audioEl.preload = 'metadata';
        audioEl.onloadedmetadata = () => resolve(Math.round((audioEl.duration || 0) * 1000));
        audioEl.onerror = () => resolve(0);
        audioEl.src = URL.createObjectURL(audioFile);
      });

      const formData = new FormData();
      formData.append('title', title.trim());
      if (album.trim()) formData.append('album', album.trim());
      formData.append('genre', genre);
      formData.append('durationMs', String(durationMs));
      formData.append('audio', audioFile);
      if (coverFile) formData.append('cover', coverFile);

      await uploadArtistTrack(formData);
      setTitle('');
      setAlbum('');
      setGenre('Otros');
      setAudioFile(null);
      setCoverFile(null);
      await refetchArtistTracks();
    } catch (e: any) {
      setUploadError(e?.message ?? 'Error al subir la canción');
    } finally {
      setUploading(false);
    }
  };

  // ── Creación de álbum (varias canciones en una tanda) ────────────────────────
  const [uploadMode, setUploadMode] = useState<'single' | 'album'>('single');
  const [albumTitle, setAlbumTitle] = useState('');
  const [albumGenre, setAlbumGenre] = useState('Otros');
  const [albumCoverFile, setAlbumCoverFile] = useState<File | null>(null);
  const [albumCoverPreviewUrl, setAlbumCoverPreviewUrl] = useState<string | null>(null);
  const [albumCoverDragOver, setAlbumCoverDragOver] = useState(false);
  const albumCoverInputRef = useRef<HTMLInputElement>(null);
  const [albumSongs, setAlbumSongs] = useState<{ id: string; title: string; audioFile: File | null }[]>([
    { id: crypto.randomUUID(), title: '', audioFile: null },
    { id: crypto.randomUUID(), title: '', audioFile: null },
  ]);
  const [albumUploading, setAlbumUploading] = useState(false);
  const [albumUploadError, setAlbumUploadError] = useState('');
  const [albumUploadProgress, setAlbumUploadProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (!albumCoverFile) { setAlbumCoverPreviewUrl(null); return; }
    const url = URL.createObjectURL(albumCoverFile);
    setAlbumCoverPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [albumCoverFile]);

  const pickAlbumCoverFile = (files: FileList | null) => {
    const f = files?.[0];
    if (f && f.type.startsWith('image/')) setAlbumCoverFile(f);
  };

  const addAlbumSongSlot = () => {
    setAlbumSongs((prev) => [...prev, { id: crypto.randomUUID(), title: '', audioFile: null }]);
  };
  const removeAlbumSongSlot = (id: string) => {
    setAlbumSongs((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));
  };
  const updateAlbumSongTitle = (id: string, title: string) => {
    setAlbumSongs((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  };
  const pickAlbumSongFile = (id: string, files: FileList | null) => {
    const f = files?.[0];
    if (f && f.type.startsWith('audio/')) {
      setAlbumSongs((prev) => prev.map((s) => (s.id === id ? { ...s, audioFile: f } : s)));
    }
  };

  const handlePublishAlbum = async () => {
    const validSongs = albumSongs.filter((s) => s.audioFile && s.title.trim());
    if (!albumTitle.trim()) {
      setAlbumUploadError('El nombre del álbum es obligatorio');
      return;
    }
    if (validSongs.length < 1) {
      setAlbumUploadError('Añade al menos una canción con título y archivo de audio');
      return;
    }
    setAlbumUploading(true);
    setAlbumUploadError('');
    setAlbumUploadProgress({ done: 0, total: validSongs.length });
    try {
      for (let i = 0; i < validSongs.length; i++) {
        const song = validSongs[i];
        const durationMs = await new Promise<number>((resolve) => {
          const audioEl = document.createElement('audio');
          audioEl.preload = 'metadata';
          audioEl.onloadedmetadata = () => resolve(Math.round((audioEl.duration || 0) * 1000));
          audioEl.onerror = () => resolve(0);
          audioEl.src = URL.createObjectURL(song.audioFile as File);
        });
        const formData = new FormData();
        formData.append('title', song.title.trim());
        formData.append('album', albumTitle.trim());
        formData.append('genre', albumGenre);
        formData.append('durationMs', String(durationMs));
        formData.append('audio', song.audioFile as File);
        if (albumCoverFile) formData.append('cover', albumCoverFile);
        await uploadArtistTrack(formData);
        setAlbumUploadProgress({ done: i + 1, total: validSongs.length });
      }
      setAlbumTitle('');
      setAlbumGenre('Otros');
      setAlbumCoverFile(null);
      setAlbumSongs([
        { id: crypto.randomUUID(), title: '', audioFile: null },
        { id: crypto.randomUUID(), title: '', audioFile: null },
      ]);
      await refetchArtistTracks();
      setUploadMode('single');
    } catch (e: any) {
      setAlbumUploadError(e?.message ?? 'Error al publicar el álbum');
    } finally {
      setAlbumUploading(false);
      setAlbumUploadProgress(null);
    }
  };

  const [editingTrack, setEditingTrack] = useState<ArtistTrack | null>(null);

  const handleDelete = async (itunesId: number) => {
    await deleteArtistTrack(itunesId);
    await refetchArtistTracks();
    if (nowPreviewing === itunesId) stopPreview();
  };

  // ── Preview de audio (un solo reproductor local, no toca el player global) ──
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [nowPreviewing, setNowPreviewing] = useState<number | null>(null);

  const stopPreview = () => {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    setNowPreviewing(null);
  };

  const togglePreview = (track: ArtistTrack) => {
    if (nowPreviewing === track.itunes_id) {
      stopPreview();
      return;
    }
    stopPreview();
    const audio = new Audio(getStreamUrl(String(track.itunes_id)));
    audio.addEventListener('ended', () => setNowPreviewing(null));
    audio.play().catch(() => setNowPreviewing(null));
    previewAudioRef.current = audio;
    setNowPreviewing(track.itunes_id);
  };

  useEffect(() => () => { previewAudioRef.current?.pause(); }, []);

  // ── Agrupar por álbum ─────────────────────────────────────────────────────────
  const { albums, singles } = useMemo(() => {
    const albumMap = new Map<string, ArtistTrack[]>();
    const singlesList: ArtistTrack[] = [];
    for (const t of artistTracks) {
      const key = (t.album || '').trim();
      if (!key) { singlesList.push(t); continue; }
      if (!albumMap.has(key)) albumMap.set(key, []);
      albumMap.get(key)!.push(t);
    }
    return { albums: Array.from(albumMap.entries()), singles: singlesList };
  }, [artistTracks]);

  if (!profile?.is_artist) {
    return <div className="main-body" style={{ paddingTop: 16 }} />;
  }

  return (
    <div className="main-body" style={{ paddingTop: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        {profile.avatar_url ? (
          <img src={resolveImageUrl(profile.avatar_url)} alt="" style={{ width: 64, height: 64, borderRadius: 18, objectFit: 'cover', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }} />
        ) : (
          <div style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg, var(--accent), var(--accent-dim))' }} />
        )}
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 className="section-title" style={{ marginBottom: 2 }}>{profile.display_name || 'Panel de Artista'}</h1>
          <p className="section-subtitle" style={{ margin: 0 }}>Sube canciones, cuenta quién eres, y organiza tu catálogo en álbumes.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <StatPill value={artistTracks.length} label="canciones" />
          <StatPill value={albums.length} label={albums.length === 1 ? 'álbum' : 'álbumes'} />
          <button
            onClick={() => setShowPreview(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff',
              borderRadius: 'var(--radius-full)', padding: '9px 16px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <IconEye /> Vista pública
          </button>
        </div>
      </div>

      <div className="artist-studio-layout">
        {/* Columna izquierda */}
        <div>
          <div style={cardStyle}>
            <SectionHeading title="Descripción de artista" subtitle="Es la misma descripción de tu perfil — cámbiala aquí o en Perfil, es el mismo campo." />
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              onFocus={() => setBioFocused(true)}
              onBlur={() => setBioFocused(false)}
              rows={5}
              placeholder="Cuéntale a la gente sobre tu música..."
              style={{
                ...inputStyle,
                resize: 'vertical',
                borderColor: bioFocused ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
                marginTop: 14,
              }}
            />
            <button
              onClick={handleSaveBio}
              disabled={bioSaving}
              style={pillButtonStyle(bioSaving, bioSaved)}
            >
              {bioSaving ? 'Guardando…' : bioSaved ? '✓ Guardado' : 'Guardar descripción'}
            </button>
          </div>
        </div>

        {/* Columna derecha */}
        <div>
      {/* Subida */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <SectionHeading
            title={uploadMode === 'single' ? 'Subir canción' : 'Crear álbum'}
            subtitle={uploadMode === 'single' ? 'Arrastra un archivo o haz clic para elegirlo.' : 'Sube varias canciones a la vez bajo un mismo álbum.'}
          />
          <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-full)', padding: 3, flexShrink: 0 }}>
            <button
              onClick={() => setUploadMode('single')}
              style={{
                border: 'none', borderRadius: 'var(--radius-full)', padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: uploadMode === 'single' ? 'var(--accent)' : 'transparent',
                color: uploadMode === 'single' ? '#000' : 'var(--text-muted)',
              }}
            >
              Canción suelta
            </button>
            <button
              onClick={() => setUploadMode('album')}
              style={{
                border: 'none', borderRadius: 'var(--radius-full)', padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                background: uploadMode === 'album' ? 'var(--accent)' : 'transparent',
                color: uploadMode === 'album' ? '#000' : 'var(--text-muted)',
              }}
            >
              Álbum
            </button>
          </div>
        </div>

        {uploadMode === 'single' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: coverFile ? '1fr 96px' : '1fr', gap: 14, marginTop: 14, alignItems: 'start' }}>
              <Dropzone
                active={audioDragOver}
                hasFile={!!audioFile}
                onClick={() => audioInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setAudioDragOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); setAudioDragOver(false); }}
                onDrop={(e) => { e.preventDefault(); setAudioDragOver(false); pickAudioFile(e.dataTransfer.files); }}
                icon={<IconAudioWave />}
                label={audioFile ? audioFile.name : 'Arrastra tu canción aquí'}
                sublabel={audioFile ? formatBytes(audioFile.size) : 'MP3, WAV, FLAC… · obligatorio'}
              >
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => pickAudioFile(e.target.files)}
                  style={{ display: 'none' }}
                />
              </Dropzone>

              {coverFile && coverPreviewUrl && (
                <div
                  onClick={() => coverInputRef.current?.click()}
                  style={{
                    width: 96, height: 96, borderRadius: 14, cursor: 'pointer', position: 'relative',
                    backgroundImage: `url(${coverPreviewUrl})`, backgroundSize: 'cover', backgroundPosition: 'center',
                    border: '1px solid rgba(255,255,255,0.15)', flexShrink: 0,
                  }}
                  title="Cambiar portada"
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); setCoverFile(null); }}
                    style={{
                      position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%',
                      background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff',
                      fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >×</button>
                </div>
              )}
            </div>

            {!coverFile && (
              <Dropzone
                active={coverDragOver}
                hasFile={false}
                compact
                onClick={() => coverInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setCoverDragOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); setCoverDragOver(false); }}
                onDrop={(e) => { e.preventDefault(); setCoverDragOver(false); pickCoverFile(e.dataTransfer.files); }}
                icon={<IconImage />}
                label="Portada (opcional)"
                sublabel="Si no eliges una, se usa tu foto de perfil"
                style={{ marginTop: 10 }}
              >
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => pickCoverFile(e.target.files)}
                  style={{ display: 'none' }}
                />
              </Dropzone>
            )}
            {coverFile && (
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                onChange={(e: ChangeEvent<HTMLInputElement>) => pickCoverFile(e.target.files)}
                style={{ display: 'none' }}
              />
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              <input type="text" placeholder="Título *" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <input
                  type="text"
                  placeholder="Álbum (opcional)"
                  value={album}
                  onChange={(e) => setAlbum(e.target.value)}
                  style={inputStyle}
                />
                <select value={genre} onChange={(e) => setGenre(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {GENRES.map((g) => (
                    <option key={g} value={g} style={{ background: '#181818' }}>{g}</option>
                  ))}
                </select>
              </div>

              {uploadError && (
                <div style={{ background: 'rgba(255,80,80,0.12)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff7b7b', padding: '8px 12px', borderRadius: 10, fontSize: 12 }}>
                  {uploadError}
                </div>
              )}

              <button onClick={handleUpload} disabled={uploading} style={{ ...pillButtonStyle(uploading, false), alignSelf: 'flex-start', padding: '11px 24px' }}>
                {uploading ? 'Subiendo…' : 'Publicar canción'}
              </button>
            </div>
          </>
        ) : (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: albumCoverFile ? '1fr 96px' : '1fr', gap: 14, alignItems: 'start' }}>
              <input
                type="text"
                placeholder="Nombre del álbum *"
                value={albumTitle}
                onChange={(e) => setAlbumTitle(e.target.value)}
                style={inputStyle}
              />
              {albumCoverFile && albumCoverPreviewUrl && (
                <div
                  onClick={() => albumCoverInputRef.current?.click()}
                  style={{
                    width: 96, height: 96, borderRadius: 14, cursor: 'pointer', position: 'relative',
                    backgroundImage: `url(${albumCoverPreviewUrl})`, backgroundSize: 'cover', backgroundPosition: 'center',
                    border: '1px solid rgba(255,255,255,0.15)', flexShrink: 0,
                  }}
                  title="Cambiar portada"
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); setAlbumCoverFile(null); }}
                    style={{
                      position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%',
                      background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff',
                      fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >×</button>
                </div>
              )}
            </div>

            {!albumCoverFile && (
              <Dropzone
                active={albumCoverDragOver}
                hasFile={false}
                compact
                onClick={() => albumCoverInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setAlbumCoverDragOver(true); }}
                onDragLeave={(e) => { e.preventDefault(); setAlbumCoverDragOver(false); }}
                onDrop={(e) => { e.preventDefault(); setAlbumCoverDragOver(false); pickAlbumCoverFile(e.dataTransfer.files); }}
                icon={<IconImage />}
                label="Portada del álbum (opcional)"
                sublabel="Se usa para todas las canciones del álbum — si no eliges una, se usa tu foto de perfil"
                style={{ marginTop: 10 }}
              >
                <input
                  ref={albumCoverInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => pickAlbumCoverFile(e.target.files)}
                  style={{ display: 'none' }}
                />
              </Dropzone>
            )}
            {albumCoverFile && (
              <input
                ref={albumCoverInputRef}
                type="file"
                accept="image/*"
                onChange={(e: ChangeEvent<HTMLInputElement>) => pickAlbumCoverFile(e.target.files)}
                style={{ display: 'none' }}
              />
            )}

            <select value={albumGenre} onChange={(e) => setAlbumGenre(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', marginTop: 10 }}>
              {GENRES.map((g) => (
                <option key={g} value={g} style={{ background: '#181818' }}>{g}</option>
              ))}
            </select>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              {albumSongs.map((song, idx) => (
                <AlbumSongSlot
                  key={song.id}
                  index={idx}
                  title={song.title}
                  audioFile={song.audioFile}
                  canRemove={albumSongs.length > 1}
                  onTitleChange={(v) => updateAlbumSongTitle(song.id, v)}
                  onFileChange={(files) => pickAlbumSongFile(song.id, files)}
                  onRemove={() => removeAlbumSongSlot(song.id)}
                />
              ))}
            </div>

            <button
              onClick={addAlbumSongSlot}
              style={{
                marginTop: 10, background: 'transparent', border: '1px dashed rgba(255,255,255,0.2)', color: 'var(--text-muted)',
                borderRadius: 12, padding: '9px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%',
              }}
            >
              + Añadir otra canción
            </button>

            {albumUploadError && (
              <div style={{ marginTop: 12, background: 'rgba(255,80,80,0.12)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff7b7b', padding: '8px 12px', borderRadius: 10, fontSize: 12 }}>
                {albumUploadError}
              </div>
            )}

            <button
              onClick={handlePublishAlbum}
              disabled={albumUploading}
              style={{ ...pillButtonStyle(albumUploading, false), marginTop: 14, padding: '11px 24px' }}
            >
              {albumUploading
                ? `Publicando… ${albumUploadProgress ? `(${albumUploadProgress.done}/${albumUploadProgress.total})` : ''}`
                : 'Publicar álbum'}
            </button>
          </div>
        )}
      </div>

      {/* Álbumes */}
      {albums.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h2 className="section-title" style={{ fontSize: 15, marginBottom: 14 }}>Álbumes</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
            {albums.map(([albumName, tracks]) => (
              <AlbumCard
                key={albumName}
                name={albumName}
                tracks={tracks}
                nowPreviewing={nowPreviewing}
                onTogglePreview={togglePreview}
                onDelete={handleDelete}
                onEdit={setEditingTrack}
              />
            ))}
          </div>
        </div>
      )}

      {/* Sencillos */}
      <div>
        <h2 className="section-title" style={{ fontSize: 15, marginBottom: 14 }}>
          Sencillos {singles.length > 0 && `(${singles.length})`}
        </h2>
        {singles.length === 0 && albums.length === 0 ? (
          <EmptyState />
        ) : singles.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Todo lo que has subido está agrupado en álbumes.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {singles.map((t) => (
              <TrackRow key={t.itunes_id} track={t} isPreviewing={nowPreviewing === t.itunes_id} onTogglePreview={() => togglePreview(t)} onDelete={() => handleDelete(t.itunes_id)} onEdit={() => setEditingTrack(t)} />
            ))}
          </div>
        )}
      </div>
        </div>
      </div>

      {editingTrack && (
        <EditTrackModal
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
          onSaved={async () => {
            setEditingTrack(null);
            await refetchArtistTracks();
          }}
        />
      )}

      {showPreview && (
        <PublicPreviewModal
          profile={profile}
          albums={albums}
          singles={singles}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}

function pillButtonStyle(busy: boolean, done: boolean): React.CSSProperties {
  return {
    marginTop: 14,
    background: done ? 'var(--accent-dim)' : 'var(--accent)',
    color: '#000',
    border: 'none',
    borderRadius: 'var(--radius-full)',
    padding: '9px 20px',
    fontSize: 12,
    fontWeight: 700,
    cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.6 : 1,
    transition: 'all 0.2s ease',
  };
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 style={{ fontSize: 13, fontWeight: 700, margin: 0, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 0.8 }}>{title}</h2>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>{subtitle}</p>
    </div>
  );
}

function StatPill({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Dropzone({
  active, hasFile, compact, onClick, onDragOver, onDragLeave, onDrop, icon, label, sublabel, children, style,
}: {
  active: boolean;
  hasFile: boolean;
  compact?: boolean;
  onClick: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        border: `2px dashed ${active ? 'var(--accent)' : hasFile ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.15)'}`,
        borderRadius: 14,
        padding: compact ? '12px 16px' : '22px 16px',
        textAlign: 'center',
        cursor: 'pointer',
        background: active ? 'var(--accent-glow)' : 'rgba(255,255,255,0.02)',
        transition: 'all 0.2s ease',
        display: 'flex',
        flexDirection: compact ? 'row' : 'column',
        alignItems: 'center',
        justifyContent: compact ? 'flex-start' : 'center',
        gap: compact ? 10 : 6,
        ...style,
      }}
    >
      {children}
      <div style={{ color: active ? 'var(--accent)' : 'var(--text-muted)', display: 'flex' }}>{icon}</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: compact ? 0 : 2 }}>{sublabel}</div>
      </div>
    </div>
  );
}

function AlbumSongSlot({
  index, title, audioFile, canRemove, onTitleChange, onFileChange, onRemove,
}: {
  index: number;
  title: string;
  audioFile: File | null;
  canRemove: boolean;
  onTitleChange: (v: string) => void;
  onFileChange: (files: FileList | null) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12, padding: '8px 10px',
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 18, flexShrink: 0, textAlign: 'center' }}>{index + 1}</span>
      <input
        type="text"
        placeholder={`Título de la canción ${index + 1} *`}
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        style={{ ...inputStyle, flex: 1, padding: '8px 10px' }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        title={audioFile ? audioFile.name : 'Elegir audio'}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          background: audioFile ? 'rgba(120,255,180,0.1)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${audioFile ? 'rgba(120,255,180,0.3)' : 'rgba(255,255,255,0.12)'}`,
          color: audioFile ? '#8effc1' : 'var(--text-muted)',
          borderRadius: 10, padding: '7px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
          maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        <IconAudioWave size={13} />
        {audioFile ? audioFile.name : 'Audio *'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        onChange={(e: ChangeEvent<HTMLInputElement>) => onFileChange(e.target.files)}
        style={{ display: 'none' }}
      />
      {canRemove && (
        <button
          onClick={onRemove}
          title="Quitar canción"
          style={{
            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff',
            fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >×</button>
      )}
    </div>
  );
}

function AlbumCard({
  name, tracks, nowPreviewing, onTogglePreview, onDelete, onEdit,
}: {
  name: string;
  tracks: ArtistTrack[];
  nowPreviewing: number | null;
  onTogglePreview: (t: ArtistTrack) => void;
  onDelete: (itunesId: number) => void;
  onEdit: (t: ArtistTrack) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setExpanded((v) => !v)}>
        {tracks[0].cover_url ? (
          <img src={resolveImageUrl(tracks[0].cover_url)} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', flexShrink: 0, boxShadow: '0 6px 16px rgba(0,0,0,0.35)' }} />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: 10, background: 'var(--bg-highlight)', flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tracks.length} canción{tracks.length !== 1 ? 'es' : ''}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.3" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {tracks.map((t) => (
            <TrackRow key={t.itunes_id} track={t} isPreviewing={nowPreviewing === t.itunes_id} onTogglePreview={() => onTogglePreview(t)} onDelete={() => onDelete(t.itunes_id)} onEdit={() => onEdit(t)} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function TrackRow({
  track, isPreviewing, onTogglePreview, onDelete, onEdit, compact,
}: {
  track: ArtistTrack;
  isPreviewing: boolean;
  onTogglePreview: () => void;
  onDelete: () => void;
  onEdit: () => void;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: compact ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.025)',
        border: compact ? 'none' : '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10, padding: '8px 10px',
      }}
    >
      <button
        onClick={onTogglePreview}
        title={isPreviewing ? 'Pausar' : 'Escuchar'}
        style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0, border: 'none', cursor: 'pointer',
          background: isPreviewing ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
          color: isPreviewing ? '#000' : 'var(--text-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {isPreviewing ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 1 }}><path d="M8 5v14l11-7z" /></svg>
        )}
      </button>
      {!compact && (
        track.cover_url ? (
          <img src={resolveImageUrl(track.cover_url)} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
        ) : (
          <div style={{ width: 36, height: 36, borderRadius: 6, background: 'var(--bg-highlight)', flexShrink: 0 }} />
        )
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{track.genre || 'Otros'}</div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{formatDuration(track.duration_ms)}</span>
      <button onClick={onEdit} title="Editar nombre y portada" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, flexShrink: 0, display: 'flex' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
      <button onClick={onDelete} title="Borrar" style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 17, padding: 4, flexShrink: 0 }}>×</button>
    </div>
  );
}

/** Editar título y portada de una canción ya publicada. */
function EditTrackModal({
  track, onClose, onSaved,
}: {
  track: ArtistTrack;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [title, setTitle] = useState(track.title);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!coverFile) { setCoverPreview(null); return; }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const trimmed = title.trim();
  const titleChanged = trimmed !== track.title;
  const canSave = !saving && trimmed.length > 0 && (titleChanged || !!coverFile);
  const shownCover = coverPreview || (track.cover_url ? resolveImageUrl(track.cover_url) : null);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await updateArtistTrack(track.itunes_id, {
        title: titleChanged ? trimmed : undefined,
        cover: coverFile,
      });
      await onSaved();
    } catch (e: any) {
      setError(e?.message ?? 'Error al guardar los cambios');
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(5,7,12,0.75)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 400, background: 'var(--bg-elevated)', borderRadius: 20,
          border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 30px 80px rgba(0,0,0,0.6)', padding: 20,
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Editar canción</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <button
            onClick={() => inputRef.current?.click()}
            title="Cambiar portada"
            style={{
              width: 96, height: 96, borderRadius: 12, flexShrink: 0, padding: 0, cursor: 'pointer', overflow: 'hidden',
              border: '1px dashed rgba(255,255,255,0.25)', background: 'var(--bg-highlight)', position: 'relative',
            }}
          >
            {shownCover && <img src={shownCover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
            <span style={{
              position: 'absolute', inset: 'auto 0 0 0', padding: '4px 0', fontSize: 10, fontWeight: 700,
              background: 'rgba(0,0,0,0.6)', color: '#fff',
            }}>
              Cambiar
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={(e: ChangeEvent<HTMLInputElement>) => setCoverFile(e.target.files?.[0] ?? null)}
            style={{ display: 'none' }}
          />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Título</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              autoFocus
              style={{ ...inputStyle, width: '100%' }}
            />
            {coverFile && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Nueva portada: {coverFile.name}
              </span>
            )}
          </div>
        </div>

        {error && <p style={{ fontSize: 12, color: '#ff6b6b', margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'var(--text-primary)',
              borderRadius: 'var(--radius-full)', padding: '9px 18px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button onClick={handleSave} disabled={!canSave} style={{ ...pillButtonStyle(saving, false), marginTop: 0, opacity: canSave ? 1 : 0.5 }}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 14, padding: '32px 20px',
      textAlign: 'center', color: 'var(--text-muted)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, opacity: 0.5 }}><IconAudioWave size={28} /></div>
      <p style={{ fontSize: 13, margin: 0 }}>Todavía no has subido ninguna canción.</p>
      <p style={{ fontSize: 11, margin: '4px 0 0' }}>Usa el formulario de arriba para publicar tu primera.</p>
    </div>
  );
}

function IconAudioWave({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="10" x2="4" y2="14" />
      <line x1="8" y1="6" x2="8" y2="18" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="16" y1="6" x2="16" y2="18" />
      <line x1="20" y1="10" x2="20" y2="14" />
    </svg>
  );
}

function IconImage({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}

function IconEye({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/**
 * Vista de solo lectura que imita cómo vería un visitante este perfil de
 * artista — usa los mismos datos ya cargados en el panel (no hace ninguna
 * llamada nueva), sin controles de edición/borrado.
 */
function PublicPreviewModal({
  profile, albums, singles, onClose,
}: {
  profile: { display_name: string; avatar_url?: string; bio?: string };
  albums: [string, ArtistTrack[]][];
  singles: ArtistTrack[];
  onClose: () => void;
}) {
  const totalTracks = albums.reduce((sum, [, tracks]) => sum + tracks.length, 0) + singles.length;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(5,7,12,0.75)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 20px', overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, background: 'var(--bg-elevated)', borderRadius: 24,
          border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 30px 80px rgba(0,0,0,0.6)', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Así te ven los demás
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            {profile.avatar_url ? (
              <img src={resolveImageUrl(profile.avatar_url)} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }} />
            ) : (
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), var(--accent-dim))' }} />
            )}
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>{profile.display_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{totalTracks} canción{totalTracks !== 1 ? 'es' : ''} · {albums.length} álbum{albums.length !== 1 ? 'es' : ''}</div>
            </div>
          </div>

          {profile.bio && (
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 20px' }}>{profile.bio}</p>
          )}

          {albums.map(([name, tracks]) => (
            <div key={name} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{name}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tracks.map((t) => <PreviewTrackRow key={t.itunes_id} track={t} />)}
              </div>
            </div>
          ))}

          {singles.length > 0 && (
            <div>
              {albums.length > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Sencillos</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {singles.map((t) => <PreviewTrackRow key={t.itunes_id} track={t} />)}
              </div>
            </div>
          )}

          {totalTracks === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>Todavía no hay canciones publicadas.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewTrackRow({ track }: { track: ArtistTrack }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '7px 10px' }}>
      {track.cover_url ? (
        <img src={resolveImageUrl(track.cover_url)} alt="" style={{ width: 32, height: 32, borderRadius: 6, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--bg-highlight)', flexShrink: 0 }} />
      )}
      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.title}</span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatDuration(track.duration_ms)}</span>
    </div>
  );
}
