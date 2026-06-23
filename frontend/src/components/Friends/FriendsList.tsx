import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFriends, removeFriend, getProfileNames, cleanName, type Friendship, resolveImageUrl } from '../../lib/api';
import { Link } from 'react-router-dom';

interface Props {
  userId: string;
  onChat: (f: Friendship) => void;
}

function Avatar({ src, name, size = 48 }: { src?: string; name: string; size?: number }) {
  const resolved = resolveImageUrl(src);
  if (resolved) return <img src={resolved} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg,#1DB954,#0a7a35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 700, color: '#000', flexShrink: 0 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function FriendsList({ userId, onChat }: Props) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['friends', userId],
    queryFn: () => getFriends(userId),
    enabled: !!userId,
    refetchInterval: 30000,
  });
  const removeMut = useMutation({
    mutationFn: (friendId: string) => removeFriend(userId, friendId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friends', userId] }),
  });

  const friends = data?.friends ?? [];

  if (isLoading) return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 16 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 90, borderRadius: 16 }} />
      ))}
    </div>
  );

  if (!friends.length) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-card)', borderRadius: 16 }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="var(--text-muted)"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
      </div>
      <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Sin amigos aún</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Busca usuarios y envíales una solicitud de amistad.</p>
    </div>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 16 }}>
      {friends.map(f => {
        const names = getProfileNames(f, 'Amigo Koko');
        return (
          <div key={f.id} style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 16, border: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Link to={`/friends/profile/${f.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                <Avatar src={f.avatar_url} name={cleanName(f.display_name || f.username || 'Amigo Koko')} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {names.primary}
                  </div>
                  {names.secondary && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {names.secondary}
                    </div>
                  )}
                  <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>Amigos desde {new Date(f.since).toLocaleDateString('es-ES', { month: 'short', year: 'numeric' })}</div>
                </div>
              </Link>
            {(f.unreadCount ?? 0) > 0 && (
              <span style={{ background: 'var(--accent)', color: '#000', borderRadius: 10, padding: '2px 7px', fontSize: 11, fontWeight: 800 }}>{f.unreadCount}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onChat(f)} style={{ flex: 1, background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 10, padding: '8px 0', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
              Mensaje
            </button>
            <Link to={`/friends/profile/${f.id}`} style={{ flex: 1, background: 'rgba(255,255,255,0.07)', color: '#fff', borderRadius: 10, padding: '8px 0', fontWeight: 600, fontSize: 13, textDecoration: 'none', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              Ver perfil
            </Link>
            <button onClick={() => removeMut.mutate(f.id)} title="Eliminar amigo" style={{ background: 'rgba(255,60,60,0.12)', color: '#ff6b6b', border: 'none', borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
        </div>
      );
    })}
    </div>
  );
}
