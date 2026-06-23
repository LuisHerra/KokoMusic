import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getMessages, sendMessage, getProfileNames, cleanName, type Friendship, type KokoMessage, resolveImageUrl } from '../../lib/api';

interface Props {
  userId: string;
  friend: Friendship;
  onClose: () => void;
}

function Avatar({ src, name, size = 36 }: { src?: string; name: string; size?: number }) {
  const resolved = resolveImageUrl(src);
  if (resolved) return <img src={resolved} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg,#1DB954,#0a7a35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.38, fontWeight: 700, color: '#000', flexShrink: 0 }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export default function ChatPanel({ userId, friend, onClose }: Props) {
  const [text, setText] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
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
      qc.invalidateQueries({ queryKey: ['messages', userId, friend.id] });
      qc.invalidateQueries({ queryKey: ['friends', userId] });
    },
  });

  const messages: KokoMessage[] = data?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
      e.preventDefault();
      sendMut.mutate();
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  const names = getProfileNames(friend, 'Amigo Koko');

  return (
    <div style={{ width: 340, display: 'flex', flexDirection: 'column', background: 'var(--bg-card)', borderLeft: '1px solid rgba(255,255,255,0.07)', height: 'calc(100vh - 200px)', position: 'sticky', top: 0, borderRadius: '0 16px 16px 0', overflow: 'hidden', flexShrink: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.2)' }}>
        <Avatar src={friend.avatar_url} name={cleanName(friend.display_name || friend.username || 'Amigo Koko')} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{names.primary}</div>
          {names.secondary && <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{names.secondary}</div>}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', gap: 6, alignItems: 'flex-end' }}>
              {!isMe && <Avatar src={friend.avatar_url} name={cleanName(friend.display_name || friend.username || 'Amigo Koko')} size={24} />}
              <div style={{ maxWidth: '78%' }}>
                <div style={{ background: isMe ? 'var(--accent)' : 'rgba(255,255,255,0.09)', color: isMe ? '#000' : '#fff', borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px', padding: '8px 12px', fontSize: 13, lineHeight: 1.4, wordBreak: 'break-word' }}>
                  {m.content}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3, textAlign: isMe ? 'right' : 'left', paddingInline: 4 }}>{fmt(m.created_at)}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Escribe un mensaje..."
          rows={1}
          style={{ flex: 1, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff', fontSize: 13, padding: '9px 12px', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.4, maxHeight: 100, overflowY: 'auto' }}
        />
        <button
          onClick={() => text.trim() && sendMut.mutate()}
          disabled={!text.trim() || sendMut.isPending}
          style={{ background: text.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.1)', color: text.trim() ? '#000' : 'var(--text-muted)', border: 'none', borderRadius: 12, padding: '9px 14px', fontWeight: 700, fontSize: 13, cursor: text.trim() ? 'pointer' : 'default', transition: 'all 0.2s', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  );
}
