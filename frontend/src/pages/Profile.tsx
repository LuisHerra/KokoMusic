import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMyProfile, updateProfile, getAvailableAccounts, deleteAccount, getProfileNames, cleanName, uploadAvatar, resolveImageUrl, type KokoProfile } from '../lib/api';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
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
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
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
      padding: '16px 0',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
      <div style={{ paddingRight: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        {description && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>{description}</div>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', padding: 0,
          background: checked ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
          position: 'relative', transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: checked ? 23 : 3,
          width: 18, height: 18, borderRadius: '50%',
          background: '#fff', transition: 'left 0.2s',
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        }} />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.02)',
      backdropFilter: 'blur(8px)',
      borderRadius: 16,
      padding: '24px 28px',
      border: '1px solid rgba(255,255,255,0.06)',
      marginBottom: 24,
      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
    }}>
      <h2 style={{
        margin: '0 0 20px',
        fontSize: 13,
        fontWeight: 700,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: 1.2,
      }}>{title}</h2>
      {children}
    </div>
  );
}

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const rawId = localStorage.getItem('koko_device_id') ?? '';
  const isUUID = UUID_RE.test(rawId);

  // Preferences stored in localStorage
  const [eventsHidden, setEventsHidden] = useState(() => localStorage.getItem('hideEvents') === 'true');
  const [autoDownloadYt, setAutoDownloadYt] = useState(() => localStorage.getItem('autoDownloadYt') !== 'false');
  const [playsNeededForOffline, setPlaysNeededForOffline] = useState<number>(() => {
    const saved = localStorage.getItem('koko_plays_needed_for_offline');
    return saved ? parseInt(saved) : 3;
  });
  const [useYtPlayer, setUseYtPlayer] = useState(() => localStorage.getItem('koko_use_youtube_player') === 'true');
  const [savedId, setSavedId] = useState(rawId);
  const [uuidInput, setUuidInput] = useState(rawId);
  const [uuidError, setUuidError] = useState('');
  const [saved, setSaved] = useState(false);

  // Profile editing
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  // Delete account state
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteAceptarText, setDeleteAceptarText] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const { data: profileData, refetch } = useQuery({
    queryKey: ['my-profile', savedId],
    queryFn: () => getMyProfile(savedId),
    enabled: isUUID && !!savedId,
  });

  const { data: accountsData } = useQuery({
    queryKey: ['available-accounts'],
    queryFn: getAvailableAccounts,
  });

  const profile: KokoProfile | undefined = profileData?.profile;
  const availableAccounts = accountsData?.accounts ?? [];

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name ?? '');
      setUsername(profile.username ?? '');
      setBio(profile.bio ?? '');
      setAvatarUrl(profile.avatar_url ?? '');
    } else {
      setDisplayName('');
      setUsername('');
      setBio('');
      setAvatarUrl('');
    }
  }, [profile, savedId]);

  const updateMut = useMutation({
    mutationFn: () => updateProfile(savedId, { display_name: displayName, username: username || undefined, bio, avatar_url: avatarUrl }),
    onSuccess: () => {
      setEditing(false);
      refetch();
      queryClient.invalidateQueries({ queryKey: ['my-profile', savedId] });
      // Notify sidebar of user profile update
      window.dispatchEvent(new Event('storage'));
    },
  });

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

  const handleLinkAccount = (id: string) => {
    const v = id.trim();
    if (!UUID_RE.test(v)) {
      setUuidError('Formato de UUID inválido (debe ser xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).');
      return;
    }
    localStorage.setItem('koko_device_id', v);
    setSavedId(v);
    setUuidInput(v);
    setUuidError('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);

    // Trigger storage event so that Sidebar registers the update
    window.dispatchEvent(new Event('storage'));
  };

  const handleDeleteAccount = async () => {
    if (!isUUID) return;
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
        setSavedId('');
        setUuidInput('');
        setDeleteConfirmText('');
        setDeleteAceptarText('');
        setDeleteError('');
        window.dispatchEvent(new Event('storage'));
        alert('Cuenta eliminada con éxito.');
        window.location.reload();
      } else {
        setDeleteError(res.message || 'Error al eliminar la cuenta');
      }
    } catch (err: any) {
      console.error(err);
      setDeleteError(err.message || 'Error al eliminar la cuenta');
    }
  };

  const names = getProfileNames(profile, isUUID ? 'Kokoer' : 'Sin cuenta vinculada');
  const displayedName = names.primary;

  return (
    <div style={{
      padding: '32px 40px',
      boxSizing: 'border-box',
      width: '100%',
      minHeight: '100vh',
      background: 'linear-gradient(180deg, rgba(29,185,84,0.03) 0%, rgba(0,0,0,0) 300px)',
    }}>
      {/* ── Hero Banner ── */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(29,185,84,0.16) 0%, rgba(29,185,84,0.02) 100%)',
        borderRadius: 20,
        padding: '40px 36px',
        border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: 32,
        marginBottom: 32,
        flexWrap: 'wrap',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}>
        <Avatar src={profile?.avatar_url} name={cleanName(profile?.display_name || profile?.username || 'Kokoer')} size={96} />
        <div style={{ flex: 1, minWidth: 280 }}>
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 500 }}>
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Nombre completo"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 10,
                  color: '#fff',
                  fontSize: 15,
                  padding: '10px 14px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  transition: 'border 0.2s',
                }}
              />
              <input
                value={username}
                onChange={e => setUsername(e.target.value.replace(/\s/g, ''))}
                placeholder="Nombre de usuario (@handle)"
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 10,
                  color: '#fff',
                  fontSize: 14,
                  padding: '10px 14px',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  value={avatarUrl}
                  onChange={e => setAvatarUrl(e.target.value)}
                  placeholder="URL de foto de perfil (avatar)"
                  style={{
                    background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10,
                    color: '#fff',
                    fontSize: 14,
                    padding: '10px 14px',
                    outline: 'none',
                    fontFamily: 'inherit',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label
                    style={{
                      background: 'rgba(255,255,255,0.08)',
                      color: 'var(--text-primary)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 10,
                      padding: '8px 16px',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'all 0.2s',
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg>
                    Subir foto
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
                            alert(err.message || 'Error al subir la imagen');
                          }
                        }
                      }}
                      style={{ display: 'none' }}
                    />
                  </label>
                  {avatarUrl && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                      Imagen seleccionada
                    </span>
                  )}
                </div>
              </div>
              <textarea
                value={bio}
                onChange={e => setBio(e.target.value)}
                placeholder="Cuéntale al mundo sobre ti..."
                rows={3}
                style={{
                  background: 'rgba(255,255,255,0.07)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 10,
                  color: '#fff',
                  fontSize: 13,
                  padding: '10px 14px',
                  outline: 'none',
                  fontFamily: 'inherit',
                  resize: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 10 }}>
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
                    transition: 'transform 0.1s',
                  }}
                  onMouseDown={e => e.currentTarget.style.transform = 'scale(0.97)'}
                  onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                >
                  {updateMut.isPending ? 'Guardando...' : 'Guardar'}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  style={{
                    background: 'rgba(255,255,255,0.07)',
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
              <div style={{ textTransform: 'uppercase', fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: 'var(--accent)', marginBottom: 6 }}>
                Tu Cuenta Koko
              </div>
              <h1 style={{ margin: '0 0 6px', fontSize: 36, fontWeight: 800, letterSpacing: -1 }}>
                {displayedName}
              </h1>
              {names.secondary && (
                <div style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 10 }}>
                  {names.secondary}
                </div>
              )}
              {profile?.bio && (
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 18px', lineHeight: 1.6, maxWidth: 640 }}>
                  {profile.bio}
                </p>
              )}
              {isUUID && (
                <button
                  onClick={() => setEditing(true)}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    color: 'var(--text-primary)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10,
                    padding: '8px 20px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.14)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                >
                  Editar perfil
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Grid Layout spanning the full width of page */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: 28,
        alignItems: 'start',
      }}>
        
        {/* Left Side: Connection & Accounts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          <Section title="Vincular Cuenta Koko">
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, fontWeight: 600 }}>
                ID de cuenta (UUID de Supabase)
              </label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input
                  value={uuidInput}
                  onChange={e => { setUuidInput(e.target.value); setUuidError(''); setSaved(false); }}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  style={{
                    flex: 1,
                    background: 'rgba(255,255,255,0.06)',
                    border: `1px solid ${uuidError ? 'rgba(255,107,107,0.4)' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius: 10,
                    color: '#fff',
                    fontSize: 13,
                    padding: '10px 14px',
                    outline: 'none',
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  onClick={() => handleLinkAccount(uuidInput)}
                  style={{
                    background: saved ? 'rgba(29,185,84,0.2)' : 'rgba(255,255,255,0.08)',
                    color: saved ? 'var(--accent)' : 'var(--text-primary)',
                    border: 'none',
                    borderRadius: 10,
                    padding: '10px 22px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s',
                  }}
                >
                  {saved ? 'Guardado' : 'Vincular'}
                </button>
              </div>
              {uuidError && <p style={{ color: '#ff6b6b', fontSize: 12, marginTop: 8 }}>{uuidError}</p>}
            </div>

            {isUUID ? (
              <div style={{
                background: 'rgba(29,185,84,0.08)',
                border: '1px solid rgba(29,185,84,0.2)',
                borderRadius: 12,
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, lineHeight: 1.4 }}>
                  Sesión vinculada correctamente a Supabase.
                </div>
              </div>
            ) : (
              <div style={{
                background: 'rgba(255,193,7,0.08)',
                border: '1px solid rgba(255,193,7,0.2)',
                borderRadius: 12,
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="#ffc107"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
                <div style={{ fontSize: 13, color: '#ffc107', fontWeight: 600, lineHeight: 1.4 }}>
                  Sin vincular. Selecciona una cuenta de Supabase abajo para activar las funciones sociales.
                </div>
              </div>
            )}
          </Section>

          <Section title="Cuentas Registradas en Supabase">
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
              Para facilitar la navegación y pruebas en desarrollo, aquí están las cuentas activas en tu base de datos de Supabase. Haz clic en una para vincularte al instante:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {availableAccounts.length === 0 ? (
                <div style={{
                  fontSize: 13,
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                  padding: '20px 0',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 12,
                }}>
                  No se encontraron cuentas registradas.
                </div>
              ) : (
                availableAccounts.map(acc => {
                  const isCurrent = savedId === acc.id;
                  const accNames = getProfileNames(acc, 'Usuario Koko');
                  return (
                    <div
                      key={acc.id}
                      onClick={() => !isCurrent && handleLinkAccount(acc.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '14px 16px',
                        background: isCurrent ? 'rgba(29,185,84,0.08)' : 'rgba(255,255,255,0.03)',
                        borderRadius: 12,
                        border: isCurrent ? '1px solid rgba(29,185,84,0.3)' : '1px solid rgba(255,255,255,0.05)',
                        cursor: isCurrent ? 'default' : 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => {
                        if (!isCurrent) {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                        }
                      }}
                      onMouseLeave={e => {
                        if (!isCurrent) {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                        <Avatar src={acc.avatar_url} name={cleanName(acc.display_name || acc.username || 'Kokoer')} size={40} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {accNames.primary}
                          </div>
                          {accNames.secondary && (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{accNames.secondary}</div>
                          )}
                          {acc.email && (
                            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace', marginTop: 2, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                              {acc.email}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        color: isCurrent ? 'var(--accent)' : 'var(--text-muted)',
                        background: isCurrent ? 'rgba(29,185,84,0.1)' : 'rgba(255,255,255,0.05)',
                        padding: '6px 12px',
                        borderRadius: 6,
                      }}>
                        {isCurrent ? 'Actual' : 'Vincular'}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Section>

        </div>

        {/* Right Side: Options & Customization */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          <Section title="Preferencia de Interfaz">
            <ToggleRow
              label="Mostrar pestaña de Eventos"
              description="Activa esta opción para mostrar la sección de conciertos y eventos en la barra de navegación lateral."
              checked={!eventsHidden}
              onChange={handleToggleEvents}
            />
            <ToggleRow
              label="Autodescargar audio de YouTube"
              description="Descarga y transcodifica automáticamente en segundo plano el audio de YouTube para guardarlo localmente. Si el archivo pesa menos de 30 MB, también se sube al CDN para acelerar futuras reproducciones desde cualquier dispositivo."
              checked={autoDownloadYt}
              onChange={handleToggleAutoDownloadYt}
            />
            <ToggleRow
              label="Reproductor Oficial de YouTube (Anti-Bloqueos)"
              description="Evita bloqueos de servidor reproduciendo la música desde el iframe oficial de YouTube usando tu propia conexión. (Desactiva el Crossfade y el Ecualizador)."
              checked={useYtPlayer}
              onChange={handleToggleYtPlayer}
            />
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 0',
              borderTop: '1px solid rgba(255,255,255,0.05)',
            }}>
              <div style={{ paddingRight: 16, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Escuchas para guardar offline</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                  Número de veces que debes escuchar una canción para que se guarde automáticamente en tu base de datos local y puedas reproducirla sin conexión.
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
                  padding: '10px 14px',
                  fontSize: '13px',
                  outline: 'none',
                  cursor: 'pointer',
                  width: '140px',
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

          <Section title="Privacidad y Visibilidad">
            <ToggleRow
              label="Perfil público"
              description="Permite que otros usuarios busquen tu perfil por tu nombre o @handle en la pestaña de Amigos."
              checked={profile?.is_public ?? true}
              onChange={async (val) => {
                if (!isUUID) return;
                await updateProfile(savedId, { is_public: val });
                refetch();
              }}
            />
            <p style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 14, lineHeight: 1.5 }}>
              Desactiva esta opción si quieres ocultar tu perfil del motor de búsqueda. Tus amigos existentes seguirán chateando contigo normalmente.
            </p>
          </Section>

          <Section title="Seguridad de Base de Datos">
            <div style={{ background: 'rgba(255,75,75,0.06)', border: '1px solid rgba(255,75,75,0.2)', borderRadius: 12, padding: '16px', display: 'flex', gap: 14 }}>
              <div style={{ marginTop: 2 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#ff4b4b"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
              </div>
              <div>
                <h4 style={{ margin: '0 0 6px', fontSize: 13, color: '#ff4b4b', fontWeight: 700 }}>Seguridad (Row Level Security)</h4>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Las tablas de chat, perfiles y amistades de KokoWorks tienen RLS (Row Level Security) desactivado por defecto en la base de datos de desarrollo.
                </p>
                <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Para producción, puedes activarlo ejecutando en el SQL Editor de Supabase:
                </p>
                <pre style={{ margin: '8px 0 0', background: 'rgba(0,0,0,0.4)', padding: 10, borderRadius: 6, fontSize: 10, overflowX: 'auto', fontFamily: 'monospace', color: 'var(--accent)' }}>
{`ALTER TABLE kokomusic.koko_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE kokomusic.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE kokomusic.messages ENABLE ROW LEVEL SECURITY;`}
                </pre>
              </div>
            </div>
          </Section>

          {isUUID && (
            <Section title="Zona de Peligro">
              <div style={{
                background: 'rgba(255, 75, 75, 0.04)',
                border: '1px solid rgba(255, 75, 75, 0.2)',
                borderRadius: 12,
                padding: '20px',
              }}>
                <h4 style={{ margin: '0 0 8px', fontSize: 14, color: '#ff4b4b', fontWeight: 700 }}>
                  Eliminar Cuenta Koko
                </h4>
                <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Esta acción es definitiva. Se borrarán permanentemente tu perfil, fotos, chats, amistades y tu usuario de autenticación en Supabase.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      Para confirmar, escribe tu nombre de usuario exacto: <strong style={{ color: '#fff', fontSize: 12 }}>{profile?.username || profile?.display_name || 'Kokoer'}</strong>
                    </label>
                    <input
                      value={deleteConfirmText}
                      onChange={e => { setDeleteConfirmText(e.target.value); setDeleteError(''); }}
                      placeholder="Escribe tu nombre para confirmar"
                      style={{
                        width: '100%',
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid rgba(255, 75, 75, 0.3)',
                        borderRadius: 8,
                        color: '#fff',
                        fontSize: 13,
                        padding: '10px 12px',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      Para confirmar que estás seguro, escribe <strong style={{ color: '#fff', fontSize: 12 }}>aceptar</strong>:
                    </label>
                    <input
                      value={deleteAceptarText}
                      onChange={e => { setDeleteAceptarText(e.target.value); setDeleteError(''); }}
                      placeholder="Escribe 'aceptar' para confirmar"
                      style={{
                        width: '100%',
                        background: 'rgba(0,0,0,0.2)',
                        border: '1px solid rgba(255, 75, 75, 0.3)',
                        borderRadius: 8,
                        color: '#fff',
                        fontSize: 13,
                        padding: '10px 12px',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {deleteError && (
                    <p style={{ color: '#ff4b4b', fontSize: 12, margin: '4px 0 0' }}>
                      {deleteError}
                    </p>
                  )}

                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleteAceptarText.trim().toLowerCase() !== 'aceptar' || deleteConfirmText.trim() !== (profile?.username || profile?.display_name || '').trim()}
                    style={{
                      background: '#ff4b4b',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 10,
                      padding: '10px 20px',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      opacity: (deleteAceptarText.trim().toLowerCase() === 'aceptar' && deleteConfirmText.trim() === (profile?.username || profile?.display_name || '').trim()) ? 1 : 0.5,
                    }}
                  >
                    Eliminar mi cuenta permanentemente
                  </button>
                </div>
              </div>
            </Section>
          )}

        </div>

      </div>
    </div>
  );
}
