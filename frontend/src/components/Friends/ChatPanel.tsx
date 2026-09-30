import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMessages, sendMessage, getProfileNames, cleanName, type Friendship, type KokoMessage, resolveImageUrl, type Track } from '../../lib/api';
import { usePlayerStore } from '../../store/playerStore';
import './ChatPanel.css';

import { IconX, IconMusicNote } from '../Common/UiIcons';
interface Props {
  userId: string;
  friend: Friendship;
  onClose: () => void;
}

function Avatar({ src, name, size = 36 }: { src?: string; name: string; size?: number }) {
  const resolved = resolveImageUrl(src);
  if (resolved) return <img src={resolved} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg,var(--accent),var(--accent-dim))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.38, fontWeight: 700, color: '#000', flexShrink: 0 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function ChatPanel({ userId, friend, onClose }: Props) {
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['messages', userId, friend.id],
    queryFn: () => getMessages(userId, friend.id),
    refetchInterval: 5000,
  });

  const sendMut = useMutation({
    mutationFn: () => sendMessage(userId, friend.id, text.trim()),
    onSuccess: () => {
      setText('');
      if (inputRef.current) inputRef.current.style.height = 'auto';
      qc.invalidateQueries({ queryKey: ['messages', userId, friend.id] });
      qc.invalidateQueries({ queryKey: ['friends', userId] });
    },
  });

  const messages: KokoMessage[] = data?.messages ?? [];

  const panelRef = useRef<HTMLDivElement>(null);
  const firstScroll = useRef(true);

  useEffect(() => {
    // Al abrir, salto directo al último mensaje; después, desplazamiento suave
    bottomRef.current?.scrollIntoView({ behavior: firstScroll.current ? 'auto' : 'smooth', block: 'end' });
    if (messages.length) firstScroll.current = false;
  }, [messages.length]);

  // Móvil: el chat ocupa la pantalla y se ajusta al teclado usando el
  // viewport visual (el layout viewport no encoge al abrir el teclado).
  useEffect(() => {
    const vv = window.visualViewport;
    const el = panelRef.current;
    if (!vv || !el) return;
    const sync = () => {
      el.style.setProperty('--chat-h', `${vv.height}px`);
      el.style.setProperty('--chat-top', `${vv.offsetTop}px`);
      bottomRef.current?.scrollIntoView({ block: 'end' });
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

  // Móvil: bloquea el scroll de la página de detrás mientras el chat está abierto
  useEffect(() => {
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
      e.preventDefault();
      sendMut.mutate();
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  const names = getProfileNames(friend, 'Amigo Koko');

  return (
    <div ref={panelRef} className="chat-panel" role="dialog" aria-label={`Chat con ${names.primary}`}>
      {/* Header */}
      <div className="chat-header">
        <button onClick={onClose} className="chat-back" aria-label="Volver">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 16.59 10.83 12l4.58-4.59L14 6l-6 6 6 6z"/></svg>
        </button>
        <Avatar src={friend.avatar_url} name={cleanName(friend.display_name || friend.username || 'Amigo Koko')} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{names.primary}</div>
          {names.secondary && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{names.secondary}</div>}
        </div>
        <button onClick={onClose} className="chat-close" aria-label="Cerrar chat"><IconX size={18} /></button>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, marginTop: 'auto', paddingBottom: 20 }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="var(--text-muted)"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
            </div>
            <p style={{ margin: 0 }}>Di hola a {names.primary}</p>
          </div>
        )}
        {messages.map(m => {
          const isMe = m.sender_id === userId;
          const isSongShare = m.content.startsWith('[SONG_SHARE]');
          let songData: any = null;

          if (isSongShare) {
            try {
              songData = JSON.parse(m.content.replace('[SONG_SHARE]', ''));
            } catch (e) {
              console.error('Error parsing shared song:', e);
            }
          }

          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', gap: 6, alignItems: 'flex-end' }}>
              {!isMe && <Avatar src={friend.avatar_url} name={cleanName(friend.display_name || friend.username || 'Amigo Koko')} size={24} />}
              <div className="chat-bubble-wrap">
                {isSongShare && songData ? (
                  <div style={{
                    background: isMe ? 'var(--accent-glow)' : 'rgba(255,255,255,0.08)',
                    border: '1px solid var(--accent)',
                    borderRadius: 14,
                    padding: 10,
                    color: '#fff',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <IconMusicNote size={11} /> Canción recomendada
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <img src={songData.cover} alt={songData.title} style={{ width: 42, height: 42, borderRadius: 6, objectFit: 'cover' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{songData.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{songData.artist}</div>
                      </div>
                      <button
                        onClick={() => {
                          const { setTrack } = usePlayerStore.getState();
                          const t: Track = {
                            id: songData.id,
                            title: songData.title,
                            artist: songData.artist,
                            album: 'Sencillo',
                            cover: songData.cover,
                            duration: 180,
                            popularity: 80,
                            preview_url: null,
                          };
                          setTrack(t, [t]);
                        }}
                        style={{
                          background: 'var(--accent)',
                          color: '#000',
                          border: 'none',
                          borderRadius: '50%',
                          width: 32,
                          height: 32,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ background: isMe ? 'var(--accent)' : 'rgba(255,255,255,0.09)', color: isMe ? '#000' : '#fff', borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px', padding: '8px 12px', fontSize: 13, lineHeight: 1.4, wordBreak: 'break-word' }}>
                    {m.content}
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, textAlign: isMe ? 'right' : 'left', paddingInline: 4 }}>{fmt(m.created_at)}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="chat-input-bar">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={text}
          onChange={e => {
            setText(e.target.value);
            // Crece con el texto hasta un máximo
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
          onKeyDown={handleKey}
          placeholder="Escribe un mensaje..."
          rows={1}
          enterKeyHint="send"
        />
        <button
          onClick={() => text.trim() && sendMut.mutate()}
          disabled={!text.trim() || sendMut.isPending}
          className={`chat-send ${text.trim() ? 'chat-send--on' : ''}`}
          aria-label="Enviar"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  );
}
