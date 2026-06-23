import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFriendRequests, respondFriendRequest, getProfileNames, cleanName, resolveImageUrl } from '../../lib/api';


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

export default function FriendRequests({ userId }: Props) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['friend-requests', userId],
    queryFn: () => getFriendRequests(userId),
    enabled: !!userId,
    refetchInterval: 15000,
  });

  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) =>
      respondFriendRequest(id, userId, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['friend-requests', userId] });
      qc.invalidateQueries({ queryKey: ['friends', userId] });
    },
  });

  const requests = data?.requests ?? [];

  if (isLoading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 72, borderRadius: 16 }} />)}
    </div>
  );

  if (!requests.length) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--bg-card)', borderRadius: 16 }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="var(--text-muted)"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
      </div>
      <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Sin solicitudes pendientes</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Cuando alguien te envíe una solicitud, aparecerá aquí.</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {requests.map((r: any) => {
        const names = getProfileNames(r, 'Usuario Koko');
        return (
          <div key={r.requestId} style={{ background: 'var(--bg-card)', borderRadius: 16, padding: '14px 16px', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <Avatar src={r.avatar_url} name={cleanName(r.display_name || r.username || 'Usuario Koko')} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{names.primary}</div>
              {names.secondary && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{names.secondary}</div>}
              <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                Solicitud enviada el {new Date(r.sentAt).toLocaleDateString('es-ES')}
              </div>
            </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => respond.mutate({ id: r.requestId, action: 'accept' })}
              disabled={respond.isPending}
              style={{ background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 10, padding: '8px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
            >
              Aceptar
            </button>
            <button
              onClick={() => respond.mutate({ id: r.requestId, action: 'reject' })}
              disabled={respond.isPending}
              style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--text-secondary)', border: 'none', borderRadius: 10, padding: '8px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
            >
              Rechazar
            </button>
          </div>
        </div>
      );
    })}
    </div>
  );
}
