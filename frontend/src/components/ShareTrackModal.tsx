import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Track } from '../lib/api';
import { getFriends, sendMessage, sendSongDrop, type Friendship } from '../lib/api';
import { IconCheck, IconClose, IconSend } from './SocialIcons';

interface ShareTrackModalProps {
  isOpen: boolean;
  onClose: () => void;
  track: Track | null;
  userId: string;
}

type LiveState = 'ok' | 'off' | 'error' | undefined;

/**
 * Compartir una canción con amigos:
 *  - "En vivo": le aparece al momento con animación (SongDropOverlay).
 *  - "Al chat": se envía como mensaje en la conversación.
 */
export default function ShareTrackModal({ isOpen, onClose, track, userId }: ShareTrackModalProps) {
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sentMap, setSentMap] = useState<Record<string, boolean>>({});
  const [liveSendingId, setLiveSendingId] = useState<string | null>(null);
  const [liveMap, setLiveMap] = useState<Record<string, LiveState>>({});
  const [filter, setFilter] = useState('');

  const effectiveUserId = userId || (typeof window !== 'undefined' ? localStorage.getItem('koko_device_id') ?? '' : '');

  useEffect(() => {
    if (!isOpen || !effectiveUserId) return;
    setLoading(true);
    getFriends(effectiveUserId)
      .then((res: any) => setFriends(res.friends || []))
      .catch((err: any) => console.error('Error loading friends for sharing:', err))
      .finally(() => setLoading(false));
  }, [isOpen, effectiveUserId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !track) return null;

  const handleLiveDrop = async (friendId: string) => {
    if (liveSendingId) return;
    setLiveSendingId(friendId);
    try {
      await sendSongDrop(friendId, { id: track.id, title: track.title, artist: track.artist, cover: track.cover });
      setLiveMap((prev) => ({ ...prev, [friendId]: 'ok' }));
    } catch (err: any) {
      setLiveMap((prev) => ({ ...prev, [friendId]: /desactivado/i.test(err?.message || '') ? 'off' : 'error' }));
    } finally {
      setLiveSendingId(null);
    }
  };

  const handleSendToFriend = async (friendId: string) => {
    if (!effectiveUserId || sendingId) return;
    setSendingId(friendId);
    try {
      const payload = JSON.stringify({ type: 'song_share', id: track.id, title: track.title, artist: track.artist, cover: track.cover });
      await sendMessage(effectiveUserId, friendId, `[SONG_SHARE]${payload}`);
      setSentMap((prev) => ({ ...prev, [friendId]: true }));
    } catch (err) {
      console.error('Error sending song:', err);
    } finally {
      setSendingId(null);
    }
  };

  const q = filter.trim().toLowerCase();
  const visible = q
    ? friends.filter((f) => `${f.display_name} ${f.username ?? ''}`.toLowerCase().includes(q))
    : friends;

  return createPortal(
    <div className="share-sheet-backdrop" onClick={onClose}>
      <div className="share-sheet" role="dialog" aria-label="Enviar canción" onClick={(e) => e.stopPropagation()}>
        <div className="share-sheet-hero">
          {track.cover && <div className="share-sheet-hero-bg" style={{ backgroundImage: `url(${track.cover})` }} />}
          <button className="share-sheet-close" onClick={onClose} aria-label="Cerrar"><IconClose size={18} /></button>
          <div className="share-sheet-eyebrow">Enviar canción</div>
          <div className="share-sheet-track">
            {track.cover
              ? <img src={track.cover} alt="" className="share-sheet-cover" />
              : <div className="share-sheet-cover" />}
            <div style={{ minWidth: 0 }}>
              <div className="share-sheet-title">{track.title}</div>
              <div className="share-sheet-artist">{track.artist}</div>
            </div>
          </div>
          <p className="share-sheet-hint">
            <strong>En vivo</strong> le aparece al instante con una animación. <strong>Al chat</strong> la deja en vuestra conversación.
          </p>
        </div>

        {friends.length > 6 && (
          <input
            className="share-sheet-search"
            placeholder="Buscar amigo"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}

        <div className="share-sheet-list">
          {loading ? (
            [0, 1, 2].map((i) => <div key={i} className="share-friend share-friend-skeleton" />)
          ) : friends.length === 0 ? (
            <div className="share-sheet-empty">Aún no tienes amigos añadidos. Añádelos desde la sección Amigos.</div>
          ) : visible.length === 0 ? (
            <div className="share-sheet-empty">Ningún amigo coincide con “{filter}”.</div>
          ) : (
            visible.map((friend) => {
              const live = liveMap[friend.id];
              const liveBusy = liveSendingId === friend.id;
              const chatSent = sentMap[friend.id];
              const chatBusy = sendingId === friend.id;
              return (
                <div key={friend.id} className={`share-friend ${live === 'ok' ? 'is-sent' : ''}`}>
                  <div className="share-friend-avatar">
                    {friend.avatar_url
                      ? <img src={friend.avatar_url} alt="" />
                      : (friend.display_name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="share-friend-name">
                    <div>{friend.display_name}</div>
                    <small>
                      {live === 'off' ? 'Tiene desactivadas las canciones en vivo'
                        : live === 'error' ? 'No se pudo enviar, inténtalo de nuevo'
                        : friend.username ? `@${friend.username}` : ''}
                    </small>
                  </div>
                  <button
                    className="share-btn-chat"
                    onClick={() => handleSendToFriend(friend.id)}
                    disabled={chatSent || chatBusy}
                    title="Enviar al chat"
                  >
                    {chatSent ? <IconCheck size={14} /> : null}
                    {chatBusy ? 'Enviando' : chatSent ? 'En el chat' : 'Al chat'}
                  </button>
                  <button
                    className={`share-btn-live ${live === 'ok' ? 'is-done' : ''} ${liveBusy ? 'is-busy' : ''}`}
                    onClick={() => handleLiveDrop(friend.id)}
                    disabled={live === 'ok' || live === 'off' || liveBusy}
                    title="Le aparece al momento con una animación"
                  >
                    {live === 'ok' ? <IconCheck size={15} /> : <IconSend size={15} />}
                    <span>{liveBusy ? 'Enviando' : live === 'ok' ? 'Enviada' : 'En vivo'}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
