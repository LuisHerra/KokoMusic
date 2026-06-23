import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFriendProfile, getFriendArtists, getFriendshipStatus, sendFriendRequest, removeFriend, getProfileNames, cleanName, resolveImageUrl } from '../lib/api';


export default function FriendProfile() {
  const { userId: targetId } = useParams<{ userId: string }>();
  const myId = localStorage.getItem('koko_device_id') ?? '';
  const qc = useQueryClient();

  const { data: profileData, isLoading } = useQuery({
    queryKey: ['friend-profile', targetId, myId],
    queryFn: () => getFriendProfile(targetId!, myId),
    enabled: !!targetId,
  });

  const { data: artistsData } = useQuery({
    queryKey: ['friend-artists', targetId],
    queryFn: () => getFriendArtists(targetId!),
    enabled: !!targetId,
  });

  const { data: statusData } = useQuery({
    queryKey: ['friendship-status', myId, targetId],
    queryFn: () => getFriendshipStatus(myId, targetId!),
    enabled: !!myId && !!targetId,
  });

  const addMut = useMutation({
    mutationFn: () => sendFriendRequest(myId, targetId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friendship-status', myId, targetId] }),
  });

  const removeMut = useMutation({
    mutationFn: () => removeFriend(myId, targetId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friendship-status', myId, targetId] });
      qc.invalidateQueries({ queryKey: ['friends', myId] });
    },
  });

  if (isLoading) return (
    <div className="main-body" style={{ paddingTop: 24 }}>
      <div className="skeleton" style={{ height: 180, borderRadius: 20, marginBottom: 24 }} />
      <div className="skeleton" style={{ height: 40, width: 200, borderRadius: 10 }} />
    </div>
  );

  const profile = profileData?.profile;
  const artists = artistsData?.artists ?? [];
  const status = statusData?.status ?? 'none';

  if (!profile) return (
    <div className="main-body" style={{ paddingTop: 24, textAlign: 'center' }}>
      <p style={{ color: 'var(--text-muted)' }}>Perfil no encontrado.</p>
    </div>
  );

  const names = getProfileNames(profile, 'Usuario Koko');

  return (
    <div className="main-body" style={{ paddingTop: 24, paddingBottom: 140 }}>
      {/* Back */}
      <Link to="/friends" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', marginBottom: 24 }}>
        ← Volver a amigos
      </Link>

      {/* Hero card */}
      <div style={{ background: 'linear-gradient(135deg, rgba(29,185,84,0.15), rgba(0,0,0,0) 70%), var(--bg-card)', borderRadius: 20, padding: '32px 28px', border: '1px solid rgba(255,255,255,0.07)', marginBottom: 28, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        {profile.avatar_url
          ? <img src={resolveImageUrl(profile.avatar_url)} alt={cleanName(profile.display_name || profile.username || 'Usuario Koko')} style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', border: '3px solid rgba(29,185,84,0.4)' }} />
          : <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'linear-gradient(135deg,#1DB954,#0a7a35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, fontWeight: 700, color: '#000' }}>{cleanName(profile.display_name || profile.username || 'Usuario Koko').charAt(0).toUpperCase()}</div>
        }
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: '0 0 4px', fontSize: 28, fontWeight: 800 }}>{names.primary}</h1>
          {names.secondary && <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 8 }}>{names.secondary}</div>}
          {profile.bio && <p style={{ color: 'var(--text-secondary)', fontSize: 14, margin: '0 0 12px', lineHeight: 1.5 }}>{profile.bio}</p>}
          <div style={{ display: 'flex', gap: 20 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: 22, color: 'var(--accent)' }}>{artists.length}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Artistas</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: 22 }}>{new Date(profile.created_at ?? '').getFullYear() || '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Miembro desde</div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {myId !== targetId && (
            <>
              {status === 'none' && (
                <button onClick={() => addMut.mutate()} disabled={addMut.isPending} style={{ background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 12, padding: '10px 22px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                  + Añadir amigo
                </button>
              )}
              {status === 'pending' && statusData?.isSender && (
                <span style={{ color: 'var(--text-muted)', fontSize: 13, padding: '10px 22px', background: 'rgba(255,255,255,0.05)', borderRadius: 12 }}>Solicitud enviada</span>
              )}
              {status === 'accepted' && (
                <button onClick={() => removeMut.mutate()} disabled={removeMut.isPending} style={{ background: 'rgba(255,60,60,0.15)', color: '#ff6b6b', border: 'none', borderRadius: 12, padding: '10px 22px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                  Eliminar amigo
                </button>
              )}
            </>
          )}
        </div>
      </div>


      {/* Listening Stats */}
      <div style={{ marginBottom: 36 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Estadísticas de escucha</h2>

        {!profileData?.stats?.listeningStats ? (
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '28px 24px', borderRadius: 16, textAlign: 'center', border: '1px dashed rgba(255,255,255,0.08)' }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ marginBottom: 12, opacity: 0.5 }}>
              <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
            </svg>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
              Este usuario aún no tiene estadísticas de escucha registradas.
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 11, margin: '6px 0 0', opacity: 0.6 }}>
              Las estadísticas se acumulan en tiempo real mientras escucha música.
            </p>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 20 }}>
              <div style={{ background: 'rgba(29,185,84,0.06)', padding: '16px 20px', borderRadius: 16, border: '1px solid rgba(29,185,84,0.2)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 600 }}>Reproducciones</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>
                  {profileData.stats.listeningStats.totalPlays.toLocaleString()}
                </div>
              </div>
              <div style={{ background: 'rgba(214,158,46,0.06)', padding: '16px 20px', borderRadius: 16, border: '1px solid rgba(214,158,46,0.2)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 600 }}>Tiempo escuchado</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#D69E2E', lineHeight: 1 }}>
                  {profileData.stats.listeningStats.totalMinutes >= 60
                    ? `${Math.floor(profileData.stats.listeningStats.totalMinutes / 60)}h ${profileData.stats.listeningStats.totalMinutes % 60}m`
                    : `${profileData.stats.listeningStats.totalMinutes} min`}
                </div>
              </div>
              <div style={{ background: 'rgba(91,134,229,0.06)', padding: '16px 20px', borderRadius: 16, border: '1px solid rgba(91,134,229,0.2)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 600 }}>Género favorito</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#5B86E5', lineHeight: 1.2, wordBreak: 'break-word' }}>
                  {profileData.stats.listeningStats.favoriteGenre}
                </div>
              </div>
            </div>

            {profileData.stats.listeningStats.topTracks?.length > 0 && (
              <div style={{ background: 'var(--bg-card)', padding: 20, borderRadius: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Canciones más escuchadas
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {profileData.stats.listeningStats.topTracks.map((t: any, idx: number) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 22, textAlign: 'center', fontWeight: 800, color: idx < 3 ? 'var(--accent)' : 'var(--text-muted)', fontSize: 13 }}>
                        {idx + 1}
                      </div>
                      {t.cover ? (
                        <img src={resolveImageUrl(t.cover)} alt={t.title} style={{ width: 42, height: 42, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                      ) : (
                        <div style={{ width: 42, height: 42, borderRadius: 8, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--text-muted)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{t.artist}</div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>
                        {t.playCount} {t.playCount === 1 ? 'repro' : 'repros'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Playlists en Común */}
      <div style={{ marginBottom: 36 }}>
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Playlists en común</h2>
        {!profileData?.stats?.commonPlaylists || profileData.stats.commonPlaylists.length === 0 ? (
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '24px 20px', borderRadius: 16, textAlign: 'center', border: '1px dashed rgba(255,255,255,0.08)' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
              No compartes ninguna playlist colaborativa con este usuario actualmente.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            {profileData.stats.commonPlaylists.map((p: any) => (
              <Link key={p.id} to={`/playlist/${p.share_code}?collab=true`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div 
                  style={{ 
                    background: 'var(--bg-card)', 
                    borderRadius: 16, 
                    padding: 16, 
                    border: '1px solid rgba(255,255,255,0.05)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 12, 
                    transition: 'transform 0.2s, background-color 0.2s' 
                  }}
                  onMouseOver={e => {
                    e.currentTarget.style.transform = 'scale(1.02)';
                    e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)';
                  }}
                  onMouseOut={e => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                  }}
                >
                  {p.cover_url ? (
                    <img src={resolveImageUrl(p.cover_url)} alt={p.name} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: 48, height: 48, borderRadius: 8, background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--text-muted)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z"/></svg>
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>{p.description || 'Playlist colaborativa'}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Followed Artists */}
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Artistas que sigue</h2>
      {artists.length === 0
        ? <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No sigue a ningún artista todavía.</p>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 16 }}>
            {artists.map((a: any) => (
              <Link key={a.artist_id} to={(a.artist_id && a.artist_id !== '0' && a.artist_id !== 0) ? `/artist/${a.artist_id}` : `/artist/${encodeURIComponent(a.artist_name)}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 14, textAlign: 'center', border: '1px solid rgba(255,255,255,0.05)', transition: 'transform 0.2s' }}
                  onMouseOver={e => (e.currentTarget.style.transform = 'scale(1.03)')}
                  onMouseOut={e => (e.currentTarget.style.transform = 'scale(1)')}>
                  {a.artist_image
                    ? <img src={a.artist_image} alt={a.artist_name} style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', marginBottom: 10 }} />
                    : <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', margin: '0 auto 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="var(--text-muted)"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                </div>
                  }
                  <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.artist_name}</div>
                </div>
              </Link>
            ))}
          </div>
        )
      }
    </div>
  );
}
