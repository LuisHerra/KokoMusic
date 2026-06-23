import { useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNotificationStore } from '../store/notificationStore';
import { getMyProfile, respondCollabInvitation } from '../lib/api';

export default function NotificationBell() {
  const navigate = useNavigate();
  const { notifications, unreadCount, isOpen, toggleOpen, setOpen, setNotifications } = useNotificationStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const deviceId = localStorage.getItem('koko_device_id') || '';
  const { data: profileData } = useQuery({
    queryKey: ['my-profile', deviceId],
    queryFn: () => getMyProfile(deviceId),
    enabled: !!deviceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId),
  });
  const displayName = profileData?.profile?.display_name || profileData?.profile?.username || 'Kokoer';

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, setOpen]);

  const handleRespondInvite = async (notificationId: string, action: 'accept' | 'reject') => {
    try {
      await respondCollabInvitation(notificationId, action, deviceId, displayName);
      
      // Update local store state immediately
      const updated = notifications.map(n => 
        n.id === notificationId ? { ...n, status: action === 'accept' ? 'accepted' : 'rejected', isRead: true } : n
      );
      setNotifications(updated);

      // Invalidate collaborative playlists and friends info if necessary
      queryClient.invalidateQueries({ queryKey: ['collabPlaylists'] });
      queryClient.invalidateQueries({ queryKey: ['playlists'] });

      // Automatically navigate to the collab playlist on acceptance
      if (action === 'accept') {
        const invite = notifications.find(n => n.id === notificationId);
        if (invite?.playlistCode) {
          setOpen(false);
          navigate(`/playlist/${invite.playlistCode}?collab=true`);
        }
      }
    } catch (err) {
      console.error('[NotificationBell] Error responding to invite:', err);
    }
  };

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      {/* Bell button */}
      <button
        id="notification-bell-btn"
        onClick={toggleOpen}
        title="Notificaciones"
        style={{
          position: 'relative',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '8px',
          borderRadius: '50%',
          color: unreadCount > 0 ? 'var(--accent)' : 'var(--text-secondary)',
          transition: 'color 0.2s, background 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        className="ctrl-btn"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
        </svg>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: 'var(--accent)',
              color: '#000',
              fontSize: 10,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
              boxShadow: '0 0 0 2px var(--bg-elevated)',
              animation: 'pulse-dot 1.5s ease-in-out infinite',
            }}
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification panel */}
      {isOpen && (
        <div
          id="notification-panel"
          style={{
            position: 'absolute',
            top: 'calc(100% + 12px)',
            right: 0,
            width: 340,
            background: 'var(--bg-elevated)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            zIndex: 1000,
            overflow: 'hidden',
            animation: 'slideDown 0.2s ease-out',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '16px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 15 }}>Notificaciones</span>
            {notifications.length > 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {notifications.length} total
              </span>
            )}
          </div>

          {/* List */}
          <div
            className="custom-scrollbar"
            style={{ maxHeight: 380, overflowY: 'auto' }}
          >
            {notifications.length === 0 ? (
              <div
                style={{
                  padding: '40px 20px',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 14,
                }}
              >
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  style={{ opacity: 0.3, marginBottom: 12 }}
                >
                  <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
                </svg>
                <p style={{ margin: 0 }}>Sin notificaciones</p>
                <p style={{ margin: '4px 0 0', fontSize: 12 }}>
                  Sigue artistas para recibir alertas de nuevos lanzamientos
                </p>
              </div>
            ) : (
              notifications.map((n) => {
                if (n.type === 'collab_invite') {
                  return (
                    <div
                      key={n.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        padding: '14px 20px',
                        background: n.isRead
                          ? 'transparent'
                          : 'rgba(var(--accent-rgb, 29, 185, 84), 0.06)',
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        transition: 'background 0.2s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {/* Cover Image */}
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 8,
                            overflow: 'hidden',
                            flexShrink: 0,
                            background: 'var(--bg-card)',
                          }}
                        >
                          {n.coverUrl ? (
                            <img
                              src={n.coverUrl}
                              alt="Playlist"
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(255,255,255,0.05)',
                              }}
                            >
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--text-muted)">
                                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                              </svg>
                            </div>
                          )}
                        </div>
                        {/* Message content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: n.isRead ? 400 : 700,
                              lineHeight: 1.4,
                              color: '#fff',
                            }}
                          >
                            {n.message}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            {new Date(n.createdAt).toLocaleDateString('es-ES', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Action buttons or status */}
                      <div style={{ display: 'flex', gap: 8, paddingLeft: 52 }}>
                        {n.status === 'pending' ? (
                          <>
                            <button
                              onClick={() => handleRespondInvite(n.id, 'accept')}
                              style={{
                                flex: 1,
                                background: 'var(--accent)',
                                color: '#000',
                                border: 'none',
                                borderRadius: 8,
                                padding: '6px 0',
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: 'pointer',
                                transition: 'transform 0.1s',
                              }}
                              className="hover-scale"
                            >
                              Aceptar
                            </button>
                            <button
                              onClick={() => handleRespondInvite(n.id, 'reject')}
                              style={{
                                flex: 1,
                                background: 'rgba(255,255,255,0.08)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 8,
                                padding: '6px 0',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'transform 0.1s',
                              }}
                              className="hover-scale"
                            >
                              Rechazar
                            </button>
                          </>
                        ) : n.status === 'accepted' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                            <span style={{ fontSize: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4 }}>
                              ✓ Aceptada
                            </span>
                            {n.playlistCode && (
                              <Link
                                to={`/playlist/${n.playlistCode}?collab=true`}
                                onClick={() => setOpen(false)}
                                style={{
                                  background: 'rgba(255,255,255,0.08)',
                                  color: '#fff',
                                  textDecoration: 'none',
                                  borderRadius: 8,
                                  padding: '4px 12px',
                                  fontSize: 11,
                                  fontWeight: 600,
                                  marginLeft: 'auto'
                                }}
                              >
                                Ver playlist
                              </Link>
                            )}
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Rechazada
                          </span>
                        )}
                      </div>
                    </div>
                  );
                }

                // Default artist release notification
                return (
                  <Link
                    key={n.id}
                    to={(n.artistId && n.artistId.toString() !== '0') ? `/artist/${n.artistId}` : `/artist/${encodeURIComponent(n.artistName || '')}`}
                    onClick={() => setOpen(false)}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '14px 20px',
                        background: n.isRead
                          ? 'transparent'
                          : 'rgba(var(--accent-rgb, 29, 185, 84), 0.06)',
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        transition: 'background 0.2s',
                        cursor: 'pointer',
                      }}
                      className="hover-card"
                    >
                      {/* Cover / Artist image */}
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 8,
                          overflow: 'hidden',
                          flexShrink: 0,
                          background: 'var(--bg-card)',
                        }}
                      >
                        {n.coverUrl ? (
                          <img
                            src={n.coverUrl}
                            alt={n.artistName || 'Artist'}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="var(--text-muted)">
                              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                            </svg>
                          </div>
                        )}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: n.isRead ? 400 : 700,
                            lineHeight: 1.4,
                            marginBottom: 2,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {n.message}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {new Date(n.createdAt).toLocaleDateString('es-ES', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </div>
                      </div>

                      {!n.isRead && (
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: 'var(--accent)',
                            flexShrink: 0,
                        }}
                      />
                    )}
                  </div>
                </Link>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
