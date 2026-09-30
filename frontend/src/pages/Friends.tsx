import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import FriendsList from '../components/Friends/FriendsList';
import FriendRequests from '../components/Friends/FriendRequests';
import UserSearch from '../components/Friends/UserSearch';
import ChatPanel from '../components/Friends/ChatPanel';
import BeMusicFeed from '../components/Friends/BeMusicFeed';
import { getFriendRequests, type Friendship } from '../lib/api';
import { useScreenTour } from '../components/GuidedTour';

export type FriendsSection = 'bemusic' | 'amigos';
type SubTab = 'friends' | 'requests' | 'search';

/** Selector principal BeMusic | Amigos. Se usa dentro de la página (escritorio)
 *  y en la cabecera global en móvil, en lugar del buscador. La sección vive en
 *  la URL (?s=amigos) para que ambos sitios estén sincronizados. */
export function FriendsSectionSwitch({ compact = false }: { compact?: boolean }) {
  const [params, setParams] = useSearchParams();
  const section: FriendsSection = params.get('s') === 'amigos' ? 'amigos' : 'bemusic';
  const go = (s: FriendsSection) => {
    const next = new URLSearchParams(params);
    if (s === 'bemusic') next.delete('s'); else next.set('s', s);
    setParams(next, { replace: true });
  };
  return (
    <div className={`friends-switch ${compact ? 'friends-switch--compact' : ''}`} role="tablist">
      <span className="friends-switch-pill" style={{ transform: section === 'amigos' ? 'translateX(100%)' : 'none' }} />
      <button role="tab" aria-selected={section === 'bemusic'} className={section === 'bemusic' ? 'active' : ''} onClick={() => go('bemusic')}>BeMusic</button>
      <button role="tab" aria-selected={section === 'amigos'} className={section === 'amigos' ? 'active' : ''} onClick={() => go('amigos')}>Amigos</button>
    </div>
  );
}

// UUID validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isKokoUUID(s: string) {
  return UUID_RE.test(s);
}

function AccountSetup({ onSet }: { onSet: (id: string) => void }) {
  const [input, setInput] = useState('');
  const [err, setErr] = useState('');

  const handleSave = () => {
    const v = input.trim();
    if (!isKokoUUID(v)) {
      setErr('Introduce un UUID de Koko Account válido (ej: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)');
      return;
    }
    localStorage.setItem('koko_device_id', v);
    onSet(v);
  };

  return (
    <div style={{ maxWidth: 480, margin: '60px auto', textAlign: 'center', padding: 32, background: 'var(--bg-card)', borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(29,185,84,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="var(--accent)"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>
      </div>
      <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>Vincula tu Koko Account</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24, lineHeight: 1.6 }}>
        Para usar Amigos necesitas introducir tu UUID de Koko Account (el ID de usuario de Supabase).
        Puedes encontrarlo en los ajustes de tu cuenta.
      </p>
      <input
        value={input}
        onChange={e => { setInput(e.target.value); setErr(''); }}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: `1px solid ${err ? '#ff6b6b' : 'rgba(255,255,255,0.12)'}`, borderRadius: 12, color: '#fff', fontSize: 14, padding: '11px 14px', outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace', marginBottom: 8 }}
      />
      {err && <p style={{ color: '#ff6b6b', fontSize: 12, margin: '0 0 12px' }}>{err}</p>}
      <button onClick={handleSave} style={{ background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 12, padding: '11px 28px', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginTop: err ? 0 : 8 }}>
        Vincular cuenta
      </button>
    </div>
  );
}

export default function Friends() {
  const [params] = useSearchParams();
  const section: FriendsSection = params.get('s') === 'amigos' ? 'amigos' : 'bemusic';
  const [subTab, setSubTab] = useState<SubTab>('friends');
  useScreenTour('friends');
  const [chatFriend, setChatFriend] = useState<Friendship | null>(null);
  const [userId, setUserId] = useState(() => localStorage.getItem('koko_device_id') ?? '');

  const { data: reqData } = useQuery({
    queryKey: ['friend-requests', userId],
    queryFn: () => getFriendRequests(userId),
    enabled: isKokoUUID(userId),
    staleTime: 60000,
    refetchInterval: 15000,
  });
  const pendingCount = reqData?.requests?.length ?? 0;

  if (!isKokoUUID(userId)) {
    return (
      <div className="main-body" style={{ paddingTop: 24, paddingBottom: 140 }}>
        <AccountSetup onSet={setUserId} />
      </div>
    );
  }

  return (
    <div className="main-body friends-page" style={{ display: 'flex', gap: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* En móvil el selector va en la cabecera global (App.tsx) */}
        <div className="friends-page-head hide-on-mobile" data-tour="friends-tabs">
          <FriendsSectionSwitch />
        </div>

        {section === 'bemusic' ? (
          <BeMusicFeed userId={userId} />
        ) : (
          <>
            <div className="friends-subtabs">
              {([
                { key: 'friends', label: 'Mis amigos' },
                { key: 'requests', label: 'Solicitudes' },
                { key: 'search', label: 'Buscar' },
              ] as const).map(t => (
                <button
                  key={t.key}
                  className={`tab-btn ${subTab === t.key ? 'active' : ''}`}
                  onClick={() => setSubTab(t.key)}
                >
                  {t.label}
                  {t.key === 'requests' && pendingCount > 0 && <span className="friends-badge">{pendingCount}</span>}
                </button>
              ))}
            </div>
            {subTab === 'friends' && <FriendsList userId={userId} onChat={setChatFriend} />}
            {subTab === 'requests' && <FriendRequests userId={userId} />}
            {subTab === 'search' && <UserSearch userId={userId} />}
          </>
        )}
      </div>

      {chatFriend && (
        <ChatPanel
          userId={userId}
          friend={chatFriend}
          onClose={() => setChatFriend(null)}
        />
      )}
    </div>
  );
}
