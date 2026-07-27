import { useState, useEffect } from 'react';
import type { Track } from '../lib/api';
import { getFriends, sendMessage, type Friendship } from '../lib/api';

interface ShareTrackModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: Track | null;
  userId: string;
}

export default function ShareTrackModal({ isOpen, onClose, track, userId }: ShareTrackModalProps) {
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentMap, setSentMap] = useState<Record<string, boolean>>({});

  const effectiveUserId = userId || (typeof window !== 'undefined' ? localStorage.getItem('koko_device_id') ?? '' : '');

  useEffect(() => {
    if (!isOpen || !effectiveUserId) return;
    setLoading(true);
    getFriends(effectiveUserId)
      .then((res: any) => {
        setFriends(res.friends || []);
      })
      .catch((err: any) => console.error('Error loading friends for sharing:', err))
      .finally(() => setLoading(false));
  }, [isOpen, effectiveUserId]);

  if (!isOpen || !track) return null;

  const handleSendToFriend = async (friendId: string) => {
    if (!effectiveUserId || sendingId) return;
    setSendingId(friendId);
    try {
      const payload = JSON.stringify({
        type: 'song_share',
        id: track.id,
        title: track.title,
        artist: track.artist,
        cover: track.cover,
      });

      await sendMessage(effectiveUserId, friendId, `[SONG_SHARE]${payload}`);
      setSentMap((prev) => ({ ...prev, [friendId]: true }));
    } catch (err) {
      console.error('Error sending song:', err);
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(12px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'rgba(18, 18, 22, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 16,
          padding: 20,
          color: '#fff',
          boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
          animation: 'fadeIn var(--duration-fast) ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Compartir canción</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: 20,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Track info card */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: 'rgba(255, 255, 255, 0.05)',
            padding: 10,
            borderRadius: 10,
            marginBottom: 16,
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <img
            src={track.cover}
            alt={track.title}
            style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover' }}
          />
          <div style={{ overflow: 'hidden', flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {track.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {track.artist}
            </div>
          </div>
        </div>

        {/* Friends list */}
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
          TUS AMIGOS
        </div>

        {loading ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            Cargando amigos...
          </div>
        ) : friends.length === 0 ? (
          <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            No tienes amigos añadidos aún
          </div>
        ) : (
          <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {friends.map((friend) => {
              const isSent = sentMap[friend.id];
              const isSending = sendingId === friend.id;

              return (
                <div
                  key={friend.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: 10,
                    background: 'rgba(255, 255, 255, 0.03)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        background: 'var(--accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                        fontWeight: 700,
                        color: '#000',
                        overflow: 'hidden',
                      }}
                    >
                      {friend.avatar_url ? (
                        <img src={friend.avatar_url} alt={friend.display_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        friend.display_name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>{friend.display_name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>@{friend.username}</div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleSendToFriend(friend.id)}
                    disabled={isSent || isSending}
                    style={{
                      background: isSent ? 'rgba(255, 255, 255, 0.1)' : 'var(--accent)',
                      color: isSent ? 'var(--text-secondary)' : '#000',
                      border: 'none',
                      padding: '5px 12px',
                      borderRadius: 'var(--radius-full)',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: isSent ? 'default' : 'pointer',
                    }}
                  >
                    {isSending ? 'Enviando...' : isSent ? 'Enviado ✓' : 'Enviar'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
