import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMyProfile, updateProfile, createAccount, deleteAccount, getProfileNames, cleanName, uploadAvatar, resolveImageUrl, isDesktopApp, type KokoProfile } from '../lib/api';
import { usePlayerStore } from '../store/playerStore';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── SVG Vector Icons (No Emojis) ────────────────────────────────────────────────
function IconUser({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconHeadphones({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
    </svg>
  );
}

function IconSliders({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  );
}

function IconAlertTriangle({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function Avatar({ src, name, size = 88 }: { src?: string; name: string; size?: number }) {
  if (src) {
    return (
      <img
        src={resolveImageUrl(src)}
        alt={name}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          border: '2px solid rgba(29,185,84,0.4)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg, #1DB954 0%, #0a7a35 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, color: '#000',
      border: '2px solid rgba(29,185,84,0.4)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
      flexShrink: 0,
    }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 0',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      gap: 12,
    }}>
      <div style={{ paddingRight: 8, flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>{description}</div>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          width: 46, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', padding: 0,
          background: checked ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
          position: 'relative', transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? 23 : 3,
          width: 20, height: 20, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        }} />
      </button>
    </div>
  );
}

function Section({ id, title, icon, children }: { id?: string; title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      id={id}
      style={{
        background: 'rgba(255, 255, 255, 0.025)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRadius: 18,
        padding: '20px 22px',
        border: '1px solid rgba(255,255,255,0.07)',
        marginBottom: 20,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        boxSizing: 'border-box',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        {icon}
        <h2 style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: 1.2,
        }}>{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const { isGamerMode, toggleGamerMode } = usePlayerStore();
  const rawId = localStorage.getItem('koko_device_id') ?? '';
  const isUUID = UUID_RE.test(rawId);

  const [activeFilter, setActiveFilter] = useState<'all' | 'algorithm' | 'playback' | 'profile'>('all');

  // Preferences stored in localStorage
  const [eventsHidden, setEventsHidden] = useState(() => localStorage.getItem('hideEvents') === 'true');
  const [autoDownloadYt, setAutoDownloadYt] = useState(() => localStorage.getItem('autoDownloadYt') !== 'false');
  const [playsNeededForOffline, setPlaysNeededForOffline] = useState<number>(() => {
    const saved = localStorage.getItem('koko_plays_needed_for_offline');
    return saved ? parseInt(saved) : 3;
  });
  const [useYtPlayer, setUseYtPlayer] = useState(() => localStorage.getItem('koko_use_youtube_player') === 'true');

  // Recommendation Algorithm Settings
  const [explorationRatio, setExplorationRatio] = useState(() => localStorage.getItem('koko_algo_exploration_ratio') ?? '0.4');
  const [maxArtistTracks, setMaxArtistTracks] = useState(() => localStorage.getItem('koko_algo_max_artist_tracks') ?? '2');
  const [cultureStrictness, setCultureStrictness] = useState(() => localStorage.getItem('koko_algo_culture_strictness') ?? 'strict');
  const [popularityWeight, setPopularityWeight] = useState(() => localStorage.getItem('koko_algo_popularity_weight') ?? 'balanced');

  const [savedId, setSavedId] = useState(rawId);
  const [copiedId, setCopiedId] = useState(false);

  // Profile editing
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  // Register New Account State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newBio, setNewBio] = useState('');
  const [newAvatarUrl, setNewAvatarUrl] = useState('');
  const [createError, setCreateError] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  // Delete account state
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteAceptarText, setDeleteAceptarText] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const { data: profileData, refetch } = useQuery({
    queryKey: ['my-profile', savedId],
    queryFn: () => getMyProfile(savedId),
    enabled: !!savedId,
  });

  const profile: KokoProfile | undefined = profileData?.profile;

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name ?? '');
      setUsername(profile.username ?? '');
      setBio(profile.bio ?? '');
      setAvatarUrl(profile.avatar_url ?? '');
    }
  }, [profile, savedId]);

  const updateMut = useMutation({
    mutationFn: () => updateProfile(savedId, { display_name: displayName, username: username || undefined, bio, avatar_url: avatarUrl }),
    onSuccess: () => {
      setEditing(false);
      refetch();
      queryClient.invalidateQueries({ queryKey: ['my-profile', savedId] });
      window.dispatchEvent(new Event('storage'));
    },
  });

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDisplayName.trim()) {
      setCreateError('El nombre visible es obligatorio.');
      return;
    }
    setCreateLoading(true);
    setCreateError('');
    try {
      const res = await createAccount({
        display_name: newDisplayName.trim(),
        username: newUsername.trim() || undefined,
        email: newEmail.trim() || undefined,
        password: newPassword || undefined,
        bio: newBio.trim() || undefined,
        avatar_url: newAvatarUrl || undefined,
      });

      if (res.success && res.userId) {
        // Assign clean isolated session
        localStorage.setItem('koko_device_id', res.userId);
        // Clear local history to avoid biasing the new account
        localStorage.removeItem('koko_play_history');
        localStorage.removeItem('koko_recent_searches');

        setSavedId(res.userId);
        setShowCreateModal(false);
        setNewDisplayName('');
        setNewUsername('');
        setNewEmail('');
        setNewPassword('');
        setNewBio('');
        setNewAvatarUrl('');

        window.dispatchEvent(new Event('storage'));
        queryClient.invalidateQueries();
        refetch();
      } else {
        setCreateError('No se pudo completar el registro de la cuenta.');
      }
    } catch (err: any) {
      console.error(err);
      setCreateError(err.message || 'Error al registrar la cuenta.');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleToggleEvents = (val: boolean) => {
    setEventsHidden(!val);
    localStorage.setItem('hideEvents', String(!val));
    window.dispatchEvent(new Event('storage'));
  };

  const handleToggleAutoDownloadYt = (val: boolean) => {
    setAutoDownloadYt(val);
    localStorage.setItem('autoDownloadYt', String(val));
    window.dispatchEvent(new Event('storage'));
  };

  const handlePlaysNeededChange = (val: number) => {
    setPlaysNeededForOffline(val);
    localStorage.setItem('koko_plays_needed_for_offline', String(val));
    window.dispatchEvent(new Event('storage'));
  };

  const handleToggleYtPlayer = (val: boolean) => {
    setUseYtPlayer(val);
    localStorage.setItem('koko_use_youtube_player', String(val));
    window.dispatchEvent(new Event('storage'));
  };

  const handleDeleteAccount = async () => {
    if (!savedId) return;
    const expected = (profile?.username || profile?.display_name || '').trim();
    if (deleteConfirmText.trim() !== expected) {
      setDeleteError('El nombre ingresado no coincide.');
      return;
    }
    if (deleteAceptarText.trim().toLowerCase() !== 'aceptar') {
      setDeleteError('Debes escribir "aceptar" para continuar.');
      return;
    }
    try {
      const res = await deleteAccount(savedId, deleteConfirmText.trim());
      if (res.success) {
        localStorage.removeItem('koko_device_id');
        localStorage.removeItem('koko_play_history');
        localStorage.removeItem('koko_recent_searches');
        setSavedId('');
        setDeleteConfirmText('');
        setDeleteAceptarText('');
        setDeleteError('');
        window.dispatchEvent(new Event('storage'));
        window.location.reload();
      } else {
        setDeleteError(res.message || 'Error al eliminar la cuenta');
      }
    } catch (err: any) {
      console.error(err);
      setDeleteError(err.message || 'Error al eliminar la cuenta');
    }
  };

  const names = getProfileNames(profile, isUUID ? 'Kokoer' : 'Perfil Local');
  const displayedName = names.primary;

  const handleCopyId = () => {
    if (!savedId) return;
    navigator.clipboard.writeText(savedId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const scrollToSection = (sectionId: string, filter: 'all' | 'algorithm' | 'playback' | 'profile') => {
    setActiveFilter(filter);
    if (filter === 'all') {
      const el = document.getElementById(sectionId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  return (
    <div style={{
      padding: '24px 18px 180px 18px',
      boxSizing: 'border-box',
      width: '100%',
      maxWidth: '100vw',
      overflowX: 'hidden',
      minHeight: '100vh',
      background: 'linear-gradient(180deg, rgba(29,185,84,0.04) 0%, rgba(0,0,0,0) 320px)',
    }}>
      {/* ── Hero Profile Header ── */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(29,185,84,0.14) 0%, rgba(20,20,20,0.85) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 20,
        padding: '24px 20px',
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        marginBottom: 20,
        flexWrap: 'wrap',
        boxShadow: '0 12px 40px rgba(0,0,0,0.3)',
        boxSizing: 'border-box',
        width: '100%',
      }}>
        <Avatar src={profile?.avatar_url} name={cleanName(profile?.display_name || profile?.username || 'Kokoer')} size={80} />
        
        <div style={{ flex: 1, minWidth: 220, width: '100%' }}>
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: '100%' }}>
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Nombre visible"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 10,
                  color: '#fff',
                  fontSize: 14,
                  padding: '10px 14px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                  width: '100%',
                }}
              />
              <input
                value={username}
                onChange={e => setUsername(e.target.value.replace(/\s/g, ''))}
                placeholder="Nombre de usuario (@handle)"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 10,
                  color: '#fff',
                  fontSize: 13,
                  padding: '10px 14px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                  width: '100%',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <input
                  value={avatarUrl}
                  onChange={e => setAvatarUrl(e.target.value)}
                  placeholder="URL de foto de perfil"
                  style={{
                    flex: 1,
                    minWidth: 160,
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 10,
                    color: '#fff',
                    fontSize: 13,
                    padding: '10px 14px',
                    outline: 'none',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
                <label style={{
                  background: 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 10,
                  padding: '10px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}>
                  Subir Foto
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        try {
                          const { avatarUrl: uploadedUrl } = await uploadAvatar(file);
                          setAvatarUrl(uploadedUrl);
                        } catch (err: any) {
                          alert(err.message || 'Error al subir imagen');
                        }
                      }
                    }}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
              <textarea
                value={bio}
                onChange={e => setBio(e.target.value)}
                placeholder="Escribe una breve biografía..."
                rows={3}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 10,
                  color: '#fff',
                  fontSize: 13,
                  padding: '10px 14px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  resize: 'none',
                  boxSizing: 'border-box',
                  width: '100%',
                }}
              />
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button
                  onClick={() => updateMut.mutate()}
                  disabled={updateMut.isPending || !displayName.trim()}
                  style={{
                    background: 'var(--accent)',
                    color: '#000',
                    border: 'none',
                    borderRadius: 10,
                    padding: '10px 22px',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {updateMut.isPending ? 'Guardando...' : 'Guardar Cambios'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    color: 'var(--text-secondary)',
                    border: 'none',
                    borderRadius: 10,
                    padding: '10px 18px',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 1.2,
                  color: isUUID ? '#1DB954' : '#ffc107',
                  background: isUUID ? 'rgba(29,185,84,0.12)' : 'rgba(255,193,7,0.12)',
                  padding: '4px 10px',
                  borderRadius: 20,
                  border: isUUID ? '1px solid rgba(29,185,84,0.3)' : '1px solid rgba(255,193,7,0.3)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: isUUID ? '#1DB954' : '#ffc107',
                  }} />
                  {isUUID ? 'Cuenta Supabase' : 'Perfil Local Aislado'}
                </span>
              </div>
              
              <h1 style={{ margin: '0 0 4px', fontSize: 'clamp(22px, 5vw, 30px)', fontWeight: 800, letterSpacing: -0.5 }}>
                {displayedName}
              </h1>
              {names.secondary && (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 10, fontWeight: 500 }}>
                  {names.secondary}
                </div>
              )}
              {profile?.bio && (
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 16px', lineHeight: 1.5, maxWidth: 640 }}>
                  {profile.bio}
                </p>
              )}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={() => setEditing(true)}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    color: 'var(--text-primary)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    borderRadius: 12,
                    padding: '8px 16px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Editar Perfil
                </button>

                <button
                  onClick={() => setShowCreateModal(true)}
                  style={{
                    background: 'linear-gradient(135deg, #1DB954 0%, #179b45 100%)',
                    color: '#000',
                    border: 'none',
                    borderRadius: 12,
                    padding: '8px 16px',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 4px 14px rgba(29,185,84,0.3)',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                  Crear Nueva Cuenta
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── 4-Button Segmented Navigation Bar (100% Full Width Equal Grid on Mobile) ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 6,
        marginBottom: 24,
        background: 'rgba(255,255,255,0.03)',
        padding: 4,
        borderRadius: 14,
        border: '1px solid rgba(255,255,255,0.06)',
        width: '100%',
        boxSizing: 'border-box',
      }}>
        <button
          onClick={() => scrollToSection('sec-all', 'all')}
          style={{
            background: activeFilter === 'all' ? 'var(--accent)' : 'transparent',
            color: activeFilter === 'all' ? '#000' : 'var(--text-muted)',
            border: 'none',
            borderRadius: 10,
            padding: '8px 4px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          Todo
        </button>
        <button
          onClick={() => scrollToSection('sec-algorithm', 'algorithm')}
          style={{
            background: activeFilter === 'algorithm' ? 'var(--accent)' : 'transparent',
            color: activeFilter === 'algorithm' ? '#000' : 'var(--text-muted)',
            border: 'none',
            borderRadius: 10,
            padding: '8px 4px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <IconSliders size={13} color={activeFilter === 'algorithm' ? '#000' : 'var(--text-muted)'} />
          Algoritmo
        </button>
        <button
          onClick={() => scrollToSection('sec-playback', 'playback')}
          style={{
            background: activeFilter === 'playback' ? 'var(--accent)' : 'transparent',
            color: activeFilter === 'playback' ? '#000' : 'var(--text-muted)',
            border: 'none',
            borderRadius: 10,
            padding: '8px 4px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <IconHeadphones size={13} color={activeFilter === 'playback' ? '#000' : 'var(--text-muted)'} />
          Sistema
        </button>
        <button
          onClick={() => scrollToSection('sec-profile', 'profile')}
          style={{
            background: activeFilter === 'profile' ? 'var(--accent)' : 'transparent',
            color: activeFilter === 'profile' ? '#000' : 'var(--text-muted)',
            border: 'none',
            borderRadius: 10,
            padding: '8px 4px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'all 0.2s',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <IconUser size={13} color={activeFilter === 'profile' ? '#000' : 'var(--text-muted)'} />
          Perfil
        </button>
      </div>

      {/* ── Content Disposal: Clean Stacked Vertical Sections ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', boxSizing: 'border-box' }}>
        
        {/* SECTION: Personalización del Algoritmo (Visible when 'all' or 'algorithm') */}
        {(activeFilter === 'all' || activeFilter === 'algorithm') && (
          <Section id="sec-algorithm" title="Personalización del Algoritmo" icon={<IconSliders size={16} color="var(--accent)" />}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              gap: 12,
              flexWrap: 'wrap',
            }}>
              <div style={{ paddingRight: 8, flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Equilibrio de Descubrimiento</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                  Proporción entre canciones recomendadas totalmente nuevas y tus artistas habituales.
                </div>
              </div>
              <select
                value={explorationRatio}
                onChange={(e) => {
                  setExplorationRatio(e.target.value);
                  localStorage.setItem('koko_algo_exploration_ratio', e.target.value);
                }}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  fontSize: '12px',
                  outline: 'none',
                  cursor: 'pointer',
                  width: '150px',
                  maxWidth: '100%',
                }}
              >
                <option value="0.2" style={{ background: '#181818' }}>20% (Mis Favoritos)</option>
                <option value="0.4" style={{ background: '#181818' }}>40% (Equilibrado)</option>
                <option value="0.6" style={{ background: '#181818' }}>60% (Explorador)</option>
                <option value="0.8" style={{ background: '#181818' }}>80% (Solo Nuevos)</option>
              </select>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              gap: 12,
              flexWrap: 'wrap',
            }}>
              <div style={{ paddingRight: 8, flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Variedad por Artista</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                  Número máximo de canciones consecutivas del mismo artista en recomendaciones.
                </div>
              </div>
              <select
                value={maxArtistTracks}
                onChange={(e) => {
                  setMaxArtistTracks(e.target.value);
                  localStorage.setItem('koko_algo_max_artist_tracks', e.target.value);
                }}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  fontSize: '12px',
                  outline: 'none',
                  cursor: 'pointer',
                  width: '150px',
                  maxWidth: '100%',
                }}
              >
                <option value="1" style={{ background: '#181818' }}>Máx 1 por artista</option>
                <option value="2" style={{ background: '#181818' }}>Máx 2 por artista</option>
                <option value="3" style={{ background: '#181818' }}>Máx 3 por artista</option>
                <option value="99" style={{ background: '#181818' }}>Sin límite</option>
              </select>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              gap: 12,
              flexWrap: 'wrap',
            }}>
              <div style={{ paddingRight: 8, flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Filtro de Idioma y Cultura</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                  Evita cambios repentinos de idioma o región en tus recomendaciones.
                </div>
              </div>
              <select
                value={cultureStrictness}
                onChange={(e) => {
                  setCultureStrictness(e.target.value);
                  localStorage.setItem('koko_algo_culture_strictness', e.target.value);
                }}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  fontSize: '12px',
                  outline: 'none',
                  cursor: 'pointer',
                  width: '150px',
                  maxWidth: '100%',
                }}
              >
                <option value="strict" style={{ background: '#181818' }}>Estricto (Recomendado)</option>
                <option value="flexible" style={{ background: '#181818' }}>Flexible</option>
                <option value="off" style={{ background: '#181818' }}>Sin filtro</option>
              </select>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 0',
              gap: 12,
              flexWrap: 'wrap',
            }}>
              <div style={{ paddingRight: 8, flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Peso de Hits & Tendencias</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                  Ajusta la presencia de éxitos mundiales en comparación con tu nicho personal.
                </div>
              </div>
              <select
                value={popularityWeight}
                onChange={(e) => {
                  setPopularityWeight(e.target.value);
                  localStorage.setItem('koko_algo_popularity_weight', e.target.value);
                }}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  fontSize: '12px',
                  outline: 'none',
                  cursor: 'pointer',
                  width: '150px',
                  maxWidth: '100%',
                }}
              >
                <option value="low" style={{ background: '#181818' }}>Primar Nicho</option>
                <option value="balanced" style={{ background: '#181818' }}>Equilibrado</option>
                <option value="high" style={{ background: '#181818' }}>Primar Éxitos</option>
              </select>
            </div>
          </Section>
        )}

        {/* SECTION: Reproducción & Sistema (Visible when 'all' or 'playback') */}
        {(activeFilter === 'all' || activeFilter === 'playback') && (
          <Section id="sec-playback" title="Preferencia de Reproducción & Sistema" icon={<IconHeadphones size={16} color="var(--accent)" />}>
            {isDesktopApp() && (
              <ToggleRow
                label="Modo Gamer (Bajo Consumo CPU/GPU)"
                description="Desactiva ecualizadores visuales y efectos pesados para asegurar el 100% del rendimiento en juegos 3D."
                checked={isGamerMode}
                onChange={toggleGamerMode}
              />
            )}
            <ToggleRow
              label="Mostrar pestaña de Eventos"
              description="Muestra u oculta la sección de conciertos en la barra de navegación."
              checked={!eventsHidden}
              onChange={handleToggleEvents}
            />
            <ToggleRow
              label="Autodescargar audio de YouTube"
              description="Descarga y transcodifica automáticamente el audio de YouTube para escuchas locales."
              checked={autoDownloadYt}
              onChange={handleToggleAutoDownloadYt}
            />
            <ToggleRow
              label="Reproductor Oficial de YouTube (Anti-Bloqueos)"
              description="Reproduce música a través del reproductor iframe oficial si tu proveedor bloquea streams directos."
              checked={useYtPlayer}
              onChange={handleToggleYtPlayer}
            />
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 0',
              borderTop: '1px solid rgba(255,255,255,0.05)',
              gap: 12,
              flexWrap: 'wrap',
            }}>
              <div style={{ paddingRight: 8, flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Escuchas para guardar sin conexión</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                  Número de reproducciones para auto-guardar una canción offline.
                </div>
              </div>
              <select
                value={playsNeededForOffline}
                onChange={(e) => handlePlaysNeededChange(parseInt(e.target.value))}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff',
                  borderRadius: '10px',
                  padding: '8px 12px',
                  fontSize: '12px',
                  outline: 'none',
                  cursor: 'pointer',
                  width: '130px',
                  maxWidth: '100%',
                }}
              >
                <option value="1" style={{ background: '#181818' }}>1 vez</option>
                <option value="2" style={{ background: '#181818' }}>2 veces</option>
                <option value="3" style={{ background: '#181818' }}>3 veces</option>
                <option value="5" style={{ background: '#181818' }}>5 veces</option>
                <option value="10" style={{ background: '#181818' }}>10 veces</option>
                <option value="999999" style={{ background: '#181818' }}>Nunca</option>
              </select>
            </div>
          </Section>
        )}

        {/* SECTION: Perfil, Identificador & Seguridad (Visible when 'all' or 'profile') */}
        {(activeFilter === 'all' || activeFilter === 'profile') && (
          <Section id="sec-profile" title="Identificador de Cuenta & Seguridad" icon={<IconUser size={16} color="var(--accent)" />}>
            <div style={{ marginBottom: 12 }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 0, marginBottom: 12, lineHeight: 1.5 }}>
                Tu cuenta posee una clave única (`koko_device_id`). Tu historial de escucha y recomendaciones están aislados.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  value={savedId}
                  readOnly
                  style={{
                    flex: 1,
                    minWidth: 160,
                    background: 'rgba(0,0,0,0.3)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 10,
                    color: 'var(--accent)',
                    fontSize: 11,
                    padding: '8px 12px',
                    outline: 'none',
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                  }}
                />
                <button
                  onClick={handleCopyId}
                  style={{
                    background: copiedId ? 'rgba(29,185,84,0.2)' : 'rgba(255,255,255,0.08)',
                    color: copiedId ? 'var(--accent)' : 'var(--text-primary)',
                    border: 'none',
                    borderRadius: 10,
                    padding: '8px 14px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {copiedId ? 'Copiado' : 'Copiar ID'}
                </button>
              </div>
            </div>

            <ToggleRow
              label="Perfil Público"
              description="Permite que otros usuarios encuentren tu perfil por tu nombre o handle."
              checked={profile?.is_public ?? true}
              onChange={async (val) => {
                if (!savedId) return;
                await updateProfile(savedId, { is_public: val });
                refetch();
              }}
            />
          </Section>
        )}

        {/* SECTION: Zona de Peligro (Always accessible at bottom of stack) */}
        {(activeFilter === 'all' || activeFilter === 'profile') && (
          <Section title="Zona de Peligro" icon={<IconAlertTriangle size={16} color="#ff4b4b" />}>
            <div style={{
              background: 'rgba(255, 75, 75, 0.04)',
              border: '1px solid rgba(255, 75, 75, 0.2)',
              borderRadius: 14,
              padding: '16px',
              boxSizing: 'border-box',
            }}>
              <h4 style={{ margin: '0 0 6px', fontSize: 13, color: '#ff4b4b', fontWeight: 700 }}>
                Eliminar Cuenta Permanente
              </h4>
              <p style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Esta acción borra permanentemente tu perfil, listas e historial en Supabase de forma irreversible.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Escribe tu nombre exacto: <strong style={{ color: '#fff', fontSize: 11 }}>{profile?.username || profile?.display_name || 'Kokoer'}</strong>
                  </label>
                  <input
                    value={deleteConfirmText}
                    onChange={e => { setDeleteConfirmText(e.target.value); setDeleteError(''); }}
                    placeholder="Nombre exacto"
                    style={{
                      width: '100%',
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(255, 75, 75, 0.3)',
                      borderRadius: 8,
                      color: '#fff',
                      fontSize: 12,
                      padding: '8px 10px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    Escribe <strong style={{ color: '#fff', fontSize: 11 }}>aceptar</strong> para continuar:
                  </label>
                  <input
                    value={deleteAceptarText}
                    onChange={e => { setDeleteAceptarText(e.target.value); setDeleteError(''); }}
                    placeholder="Escribe 'aceptar'"
                    style={{
                      width: '100%',
                      background: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(255, 75, 75, 0.3)',
                      borderRadius: 8,
                      color: '#fff',
                      fontSize: 12,
                      padding: '8px 10px',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {deleteError && (
                  <p style={{ color: '#ff4b4b', fontSize: 11, margin: '2px 0 0' }}>{deleteError}</p>
                )}

                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteAceptarText.trim().toLowerCase() !== 'aceptar' || deleteConfirmText.trim() !== (profile?.username || profile?.display_name || '').trim()}
                  style={{
                    background: '#ff4b4b',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    padding: '10px 16px',
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                    opacity: (deleteAceptarText.trim().toLowerCase() === 'aceptar' && deleteConfirmText.trim() === (profile?.username || profile?.display_name || '').trim()) ? 1 : 0.4,
                    width: '100%',
                  }}
                >
                  Eliminar Cuenta Permanentemente
                </button>
              </div>
            </div>
          </Section>
        )}

      </div>

      {/* ── Modal for Creating a New Isolated Account ── */}
      {showCreateModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          boxSizing: 'border-box',
        }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(28,28,28,0.98) 0%, rgba(14,14,14,0.99) 100%)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 20,
            padding: '24px 20px',
            width: '100%',
            maxWidth: 440,
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            boxSizing: 'border-box',
          }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 800 }}>Crear Nueva Cuenta Koko</h2>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Registra un perfil 100% independiente con tu propio espacio, historial y recomendaciones sin interferencias.
            </p>

            <form onSubmit={handleCreateAccount} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                  Nombre visible *
                </label>
                <input
                  required
                  value={newDisplayName}
                  onChange={e => setNewDisplayName(e.target.value)}
                  placeholder="Ej: Alex Koko"
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10,
                    color: '#fff',
                    fontSize: 13,
                    padding: '9px 12px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                  Nombre de usuario (@handle)
                </label>
                <input
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value.replace(/\s/g, ''))}
                  placeholder="Ej: alexkoko"
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10,
                    color: '#fff',
                    fontSize: 13,
                    padding: '9px 12px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                  Email (Opcional)
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="usuario@ejemplo.com"
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10,
                    color: '#fff',
                    fontSize: 13,
                    padding: '9px 12px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                  Contraseña (Opcional)
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10,
                    color: '#fff',
                    fontSize: 13,
                    padding: '9px 12px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {createError && (
                <div style={{ color: '#ff6b6b', fontSize: 12, background: 'rgba(255,107,107,0.1)', padding: '9px 12px', borderRadius: 8 }}>
                  {createError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button
                  type="submit"
                  disabled={createLoading || !newDisplayName.trim()}
                  style={{
                    flex: 1,
                    background: 'var(--accent)',
                    color: '#000',
                    border: 'none',
                    borderRadius: 10,
                    padding: '11px 18px',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {createLoading ? 'Creando...' : 'Crear Cuenta'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    color: 'var(--text-secondary)',
                    border: 'none',
                    borderRadius: 10,
                    padding: '11px 18px',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
