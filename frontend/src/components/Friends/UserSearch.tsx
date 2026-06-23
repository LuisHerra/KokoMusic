import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { searchUsers, sendFriendRequest, getFriendshipStatus, getProfileNames, cleanName, type KokoProfile, resolveImageUrl } from '../../lib/api';

interface Props { userId: string; }

function Avatar({ src, name, size = 44 }: { src?: string; name: string; size?: number }) {
  const resolved = resolveImageUrl(src);
  if (resolved) return <img src={resolved} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg,#1DB954,#0a7a35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 700, color: '#000', flexShrink: 0 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

function UserCard({ user, myId }: { user: KokoProfile; myId: string }) {
  const qc = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ['friendship-status', myId, user.id],
    queryFn: () => getFriendshipStatus(myId, user.id),
    enabled: !!myId && !!user.id,
  });

  const addMut = useMutation({
    mutationFn: () => sendFriendRequest(myId, user.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['friendship-status', myId, user.id] }),
  });

  const statusLabel = () => {
    if (!status || status.status === 'none') return null;
    if (status.status === 'accepted') return <span style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>✓ Amigos</span>;
    if (status.status === 'pending' && status.isSender) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Solicitud enviada</span>;
    if (status.status === 'pending' && !status.isSender) return <span style={{ color: '#f0a500', fontSize: 12 }}>Solicitud recibida</span>;
    return null;
  };

  const canAdd = !status || status.status === 'none';
  const names = getProfileNames(user, 'Usuario Koko');

  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: '14px 16px', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 14 }}>
      <Avatar src={user.avatar_url} name={cleanName(user.display_name || user.username || 'Usuario Koko')} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{names.primary}</div>
        {names.secondary && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{names.secondary}</div>}
        {user.bio && <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.bio}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        {statusLabel()}
        {canAdd && (
          <button
            onClick={() => addMut.mutate()}
            disabled={addMut.isPending}
            style={{ background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 10, padding: '7px 14px', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            + Añadir amigo
          </button>
        )}
      </div>
    </div>
  );
}

export default function UserSearch({ userId }: Props) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['user-search', submitted],
    queryFn: () => searchUsers(submitted, userId),
    enabled: submitted.length >= 2,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(query.trim());
  };

  return (
    <div>
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', display: 'flex' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
          </span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por nombre o @usuario..."
            style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff', fontSize: 14, padding: '11px 14px 11px 42px', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <button type="submit" style={{ background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 12, padding: '0 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Buscar</button>
      </form>

      {isLoading && <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>Buscando...</div>}

      {!isLoading && submitted && data?.users.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--bg-card)', borderRadius: 16 }}>
          <p style={{ color: 'var(--text-muted)' }}>No se encontraron usuarios para "{submitted}"</p>
        </div>
      )}

      {data?.users && data.users.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.users.map(u => <UserCard key={u.id} user={u} myId={userId} />)}
        </div>
      )}

      {!submitted && (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-card)', borderRadius: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="var(--text-muted)"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Busca a tus amigos por nombre de usuario o correo.</p>
        </div>
      )}
    </div>
  );
}
