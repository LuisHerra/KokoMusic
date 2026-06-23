import { useState, useCallback, useEffect } from 'react';
import { startJam, getJam, joinJam, getJamQueue, addToJamQueue, removeFromJamQueue, voteJamQueueItem } from '../../lib/api';
import type { JamSession, JamMember, JamQueueItem } from '../../lib/api';
import { useJamSession } from '../../hooks/useJamSession';
import { usePlayerStore } from '../../store/playerStore';

function getUserId(): string {
  let id = localStorage.getItem('koko_device_id');
  if (!id) {
    id = `device_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem('koko_device_id', id);
  }
  return id;
}

function getUserName(): string {
  return localStorage.getItem('koko_display_name') || 'Invitado de Koko';
}

interface Props { isOpen: boolean; onClose: () => void; }

export default function JamModal({ isOpen, onClose }: Props) {
  const { 
    setIsPlaying, 
    setProgress, 
    currentTrack, 
    isSinfoniaSyncEnabled, 
    setSinfoniaSyncEnabled,
    setActiveJam,
    setJamQueue 
  } = usePlayerStore();
  
  const [userId, setUserId] = useState(getUserId());
  const [userName, setUserName] = useState(getUserName());

  const [tab, setTab] = useState<'lobby'|'session'|'queue'>('lobby');
  const [inputCode, setInputCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [jam, setJam] = useState<JamSession|null>(null);
  const [members, setMembers] = useState<JamMember[]>([]);
  const [isHost, setIsHost] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [queue, setQueue] = useState<JamQueueItem[]>([]);
  
  const updateQueueState = useCallback((newQueue: JamQueueItem[]) => {
    setQueue(newQueue);
    setJamQueue(newQueue);
  }, [setJamQueue]);

  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());

  // Sync votedIds with queue voted properties
  useEffect(() => {
    if (queue) {
      const voted = new Set(queue.filter(item => item.voted).map(item => item.id));
      setVotedIds(voted);
    }
  }, [queue]);

  const [addingTrack, setAddingTrack] = useState(false);

  // Mock online friends list
  const [onlineFriends, setOnlineFriends] = useState([
    { id: 'friend_laura', name: 'Laura Gómez', avatar: 'L', status: 'online' },
    { id: 'friend_carlos', name: 'Carlos Díaz', avatar: 'C', status: 'online' },
    { id: 'friend_sofia', name: 'Sofía Rivas', avatar: 'S', status: 'online' },
    { id: 'friend_mateo', name: 'Mateo Torres', avatar: 'M', status: 'online' }
  ]);

  // Sync state whenever modal opens
  useEffect(() => { 
    if (isOpen) { 
      setUserId(getUserId());
      setUserName(getUserName());
      setError(''); 
      setInputCode(''); 
    } 
  }, [isOpen]);

  const refreshQueue = useCallback(async (code: string) => {
    try {
      const q = await getJamQueue(code);
      updateQueueState(q);
    } catch { /* silent */ }
  }, [updateQueueState]);

  const handleStateChange = useCallback((state: any) => {
    if (!state.track_id) return;
    const store = usePlayerStore.getState();
    if (!store.isSinfoniaSyncEnabled) return;

    if (store.currentTrack?.id !== state.track_id) {
      setJam(prev => prev ? { ...prev, ...state } : prev);
    } else {
      const diff = Math.abs(store.progress - state.position_s);
      if (diff > 3) setProgress(state.position_s);
      if (state.is_playing !== store.isPlaying) setIsPlaying(state.is_playing);
    }
  }, [setProgress, setIsPlaying]);

  const handleMemberJoined = useCallback((member: JamMember) => {
    setMembers(prev => prev.find(m => m.user_id === member.user_id) ? prev : [...prev, member]);
  }, []);

  const { leaveJam } = useJamSession({
    jamCode: jam?.jam_code ?? null,
    jamId: jam?.id ?? null,
    userId,
    isHost,
    onStateChange: handleStateChange,
    onMemberJoined: handleMemberJoined,
  });

  // Poll queue and jam state
  useEffect(() => {
    if (!jam) return;
    refreshQueue(jam.jam_code);
    const iv = setInterval(async () => {
      try {
        const fresh = await getJam(jam.jam_code);
        setJam(fresh);
        
        // Merge real DB members with simulated ones
        setMembers(prev => {
          const freshMembers = fresh.members ?? [];
          const localSimulated = prev.filter(m => m.user_id.startsWith('simulated-'));
          const merged = [...freshMembers];
          localSimulated.forEach(sim => {
            if (!merged.find(m => m.user_id === sim.user_id)) {
              merged.push(sim);
            }
          });
          return merged;
        });

        if (!isHost) handleStateChange(fresh);
        refreshQueue(jam.jam_code);
      } catch { /* expired */ }
    }, 5000);
    return () => clearInterval(iv);
  }, [jam?.jam_code, isHost, handleStateChange, refreshQueue]);

  async function handleStartJam() {
    setLoading(true); setError('');
    try {
      const newJam = await startJam(userId, userName);
      await joinJam(newJam.jam_code, userId, userName);
      setJam(newJam);
      setMembers([{ user_id: userId, display_name: userName, joined_at: new Date().toISOString() }]);
      setIsHost(true);
      setTab('session');
      setActiveJam({
        code: newJam.jam_code,
        id: newJam.id,
        hostName: userName,
        isHost: true
      });
    } catch (e: any) { setError(e.message ?? 'Error al crear la Sinfonía'); }
    setLoading(false);
  }

  async function handleJoinJam() {
    const code = inputCode.trim().toUpperCase();
    if (code.length !== 4) { setError('El código debe tener 4 caracteres'); return; }
    setLoading(true); setError('');
    try {
      const { isHost: iAmHost } = await joinJam(code, userId, userName);
      const freshJam = await getJam(code);
      setJam(freshJam);
      setMembers(freshJam.members ?? []);
      setIsHost(iAmHost);
      setTab('session');
      setActiveJam({
        code: freshJam.jam_code,
        id: freshJam.id,
        hostName: freshJam.host_name,
        isHost: iAmHost
      });
      if (!iAmHost) handleStateChange(freshJam);
      refreshQueue(code);
    } catch (e: any) { setError(e.message ?? 'Código inválido o Sinfonía expirada'); }
    setLoading(false);
  }

  async function handleLeave() {
    leaveJam(); setJam(null); setMembers([]); setIsHost(false); setTab('lobby'); updateQueueState([]);
    setActiveJam(null);
  }

  function copyCode() {
    if (!jam) return;
    navigator.clipboard.writeText(jam.jam_code);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  function copyInviteLink() {
    if (!jam) return;
    const link = `${window.location.origin}/?join_jam=${jam.jam_code}`;
    navigator.clipboard.writeText(link);
    setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000);
  }

  async function handleAddCurrentTrack() {
    if (!jam || !currentTrack) return;
    setAddingTrack(true);
    try {
      await addToJamQueue(jam.jam_code, {
        track_id: currentTrack.id,
        track_title: currentTrack.title,
        track_artist: currentTrack.artist,
        track_cover: currentTrack.cover,
        added_by: userId,
        added_by_name: userName,
      });
      await refreshQueue(jam.jam_code);
    } catch (e: any) { setError(e.message ?? 'Error añadiendo canción'); }
    setAddingTrack(false);
  }

  async function handleVote(itemId: string) {
    if (!jam) return;
    try {
      const { voted } = await voteJamQueueItem(jam.jam_code, itemId, userId);
      setVotedIds(prev => {
        const next = new Set(prev);
        voted ? next.add(itemId) : next.delete(itemId);
        return next;
      });
      await refreshQueue(jam.jam_code);
    } catch { /* silent */ }
  }

  async function handleRemoveFromQueue(itemId: string) {
    if (!jam) return;
    try {
      await removeFromJamQueue(jam.jam_code, itemId, userId);
      updateQueueState(queue.filter(q => q.id !== itemId));
    } catch { /* silent */ }
  }

  const handleInviteFriendSim = (friendId: string, name: string) => {
    // Show inviting state in list
    setOnlineFriends(prev => prev.map(f => f.id === friendId ? { ...f, status: 'inviting' } : f));
    
    // Simulate accepting invite in 1 second
    setTimeout(() => {
      setOnlineFriends(prev => prev.map(f => f.id === friendId ? { ...f, status: 'joined' } : f));
      
      const newSimMember: JamMember = {
        user_id: `simulated-${friendId}-${Date.now()}`,
        display_name: name,
        joined_at: new Date().toISOString()
      };
      
      setMembers(prev => {
        if (prev.find(m => m.display_name === name)) return prev;
        return [...prev, newSimMember];
      });

      setError(`¡${name} se ha unido a la Sinfonía!`);
      setTimeout(() => setError(''), 3000);
    }, 1200);
  };

  function getAvatarColor(name: string) {
    const hues = [160, 200, 220, 260, 280, 320];
    let sum = 0;
    for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    const hue = hues[sum % hues.length];
    return `hsl(${hue}, 45%, 35%)`;
  }

  if (!isOpen) return null;

  const qrUrl = jam ? `https://api.qrserver.com/v1/create-qr-code/?size=180&data=${encodeURIComponent(window.location.origin + '/?join_jam=' + jam.jam_code)}&color=ffffff&bgcolor=121212` : '';

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 9999, background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(10px)' }}>
      <style>{`
        @keyframes bounceBar {
          0%, 100% { height: 4px; }
          50% { height: 16px; }
        }
        .wave-bar {
          width: 3px;
          background: #1DB954;
          border-radius: 2px;
          animation: bounceBar 1.2s ease-in-out infinite;
        }
        .wave-bar:nth-child(2) { animation-delay: 0.15s; }
        .wave-bar:nth-child(3) { animation-delay: 0.3s; }
        .wave-bar:nth-child(4) { animation-delay: 0.45s; }
      `}</style>

      <div 
        className="modal-content" 
        onClick={(e) => e.stopPropagation()} 
        style={{ 
          maxWidth: '460px', 
          width: '90%',
          padding: '28px', 
          backgroundColor: '#0c0c0d', 
          border: '1px solid rgba(255, 255, 255, 0.08)', 
          boxShadow: '0 24px 60px rgba(0,0,0,0.85)',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '85vh',
          overflowY: 'auto'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '22px' }}>
          <div>
            <h3 style={{ fontSize: '19px', fontWeight: 800, letterSpacing: '-0.4px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: '#fff' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#1DB954">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15.5h-2v-2h2v2zm0-4.5h-2V7h2v6z"/>
              </svg>
              Sinfonía
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
              Escucha colaborativa en tiempo real al estilo Spotify Jam
            </p>
          </div>
          <button 
            onClick={onClose} 
            style={{ 
              background: 'transparent', 
              border: 'none', 
              color: 'var(--text-secondary)', 
              fontSize: '28px', 
              cursor: 'pointer',
              lineHeight: 1,
              padding: '4px',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#fff'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
          >
            &times;
          </button>
        </div>

        {/* Tab Navigation (only in session) */}
        {tab !== 'lobby' && (
          <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '20px', gap: '16px' }}>
            <button 
              onClick={() => setTab('session')}
              style={{
                flex: 1,
                padding: '12px 0',
                background: 'transparent',
                border: 'none',
                borderBottom: tab === 'session' ? '2px solid #1DB954' : '2px solid transparent',
                color: tab === 'session' ? '#fff' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              Detalles de la sesión
            </button>
            <button 
              onClick={() => { setTab('queue'); if (jam) refreshQueue(jam.jam_code); }}
              style={{
                flex: 1,
                padding: '12px 0',
                background: 'transparent',
                border: 'none',
                borderBottom: tab === 'queue' ? '2px solid #1DB954' : '2px solid transparent',
                color: tab === 'queue' ? '#fff' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              Cola de reproducción
              {queue.length > 0 && (
                <span style={{ 
                  background: 'rgba(29, 185, 84, 0.15)', 
                  color: '#1DB954', 
                  borderRadius: '10px', 
                  padding: '2px 7px', 
                  fontSize: '10px', 
                  fontWeight: 800 
                }}>
                  {queue.length}
                </span>
              )}
            </button>
          </div>
        )}

        {/* LOBBY */}
        {tab === 'lobby' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '14px', 
              background: 'rgba(255, 255, 255, 0.03)', 
              borderRadius: '12px', 
              padding: '14px 18px',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}>
              <div style={{ 
                width: '40px', 
                height: '40px', 
                borderRadius: '50%', 
                backgroundColor: getAvatarColor(userName), 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                fontWeight: 800, 
                fontSize: '15px', 
                color: 'white' 
              }}>
                {userName.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>{userName}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Anfitrión de Sinfonía</div>
              </div>
            </div>

            <button 
              onClick={handleStartJam} 
              disabled={loading} 
              style={{ 
                width: '100%', 
                padding: '14px 0', 
                borderRadius: '24px', 
                background: '#1DB954', 
                color: 'black', 
                fontWeight: 800, 
                fontSize: '14px', 
                border: 'none', 
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: '0 4px 12px rgba(29, 185, 84, 0.2)'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1ed760'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#1DB954'}
            >
              {loading ? 'Iniciando Sinfonía...' : 'Iniciar una Sinfonía'}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '4px 0' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
                o únete a una existente
              </span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.06)' }} />
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                style={{ 
                  flex: 1, 
                  background: 'rgba(255,255,255,0.03)', 
                  border: '1px solid rgba(255,255,255,0.08)', 
                  borderRadius: '24px', 
                  padding: '12px 18px', 
                  color: 'white', 
                  fontSize: '18px', 
                  letterSpacing: '6px', 
                  fontWeight: 800, 
                  textAlign: 'center', 
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = '#1DB954'}
                onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'}
                value={inputCode}
                onChange={e => setInputCode(e.target.value.toUpperCase().slice(0, 4))}
                placeholder="CÓDIGO"
                maxLength={4}
              />
              <button 
                onClick={handleJoinJam} 
                disabled={loading || inputCode.length !== 4} 
                style={{ 
                  padding: '0 26px', 
                  borderRadius: '24px', 
                  background: inputCode.length === 4 ? '#fff' : 'rgba(255,255,255,0.08)', 
                  color: inputCode.length === 4 ? 'black' : 'var(--text-secondary)', 
                  fontWeight: 800, 
                  fontSize: '13px', 
                  border: 'none', 
                  cursor: inputCode.length === 4 ? 'pointer' : 'default',
                  transition: 'all 0.2s'
                }}
              >
                Unirse
              </button>
            </div>

            {error && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px', textAlign: 'center', fontWeight: 600 }}>{error}</div>}
          </div>
        )}

        {/* SESSION */}
        {tab === 'session' && jam && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            
            {/* Sync Switch */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              background: 'rgba(255, 255, 255, 0.03)', 
              borderRadius: '12px', 
              padding: '14px 18px',
              border: '1px solid rgba(255, 255, 255, 0.06)'
            }}>
              <div style={{ marginRight: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#fff' }}>
                  Escucha sincronizada
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: '1.4' }}>
                  Reproducir en este dispositivo al mismo tiempo. Silencia si vas a escuchar del altavoz del anfitrión.
                </div>
              </div>
              <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '42px', height: '24px', flexShrink: 0 }}>
                <input 
                  type="checkbox" 
                  checked={isSinfoniaSyncEnabled}
                  onChange={(e) => setSinfoniaSyncEnabled(e.target.checked)}
                  style={{ opacity: 0, width: 0, height: 0 }} 
                />
                <span style={{
                  position: 'absolute',
                  cursor: 'pointer',
                  top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: isSinfoniaSyncEnabled ? '#1DB954' : 'rgba(255,255,255,0.12)',
                  transition: '0.3s',
                  borderRadius: '34px'
                }}>
                  <span style={{
                    position: 'absolute',
                    content: '""',
                    height: '18px', width: '18px',
                    left: isSinfoniaSyncEnabled ? '21px' : '3px',
                    bottom: '3px',
                    backgroundColor: isSinfoniaSyncEnabled ? 'black' : '#a7a7a7',
                    transition: '0.3s',
                    borderRadius: '50%'
                  }} />
                </span>
              </label>
            </div>

            {/* Now Playing visualizer */}
            {jam.track_title && (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px', 
                background: 'rgba(29, 185, 84, 0.04)', 
                borderRadius: '12px', 
                padding: '12px 16px', 
                border: '1px solid rgba(29, 185, 84, 0.15)' 
              }}>
                {jam.track_cover ? (
                  <img 
                    src={jam.track_cover} 
                    alt="" 
                    style={{ width: '48px', height: '48px', borderRadius: '6px', objectFit: 'cover' }} 
                  />
                ) : (
                  <div style={{ width: '48px', height: '48px', borderRadius: '6px', background: '#282828', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--text-secondary)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-6h2v6zm0-8h-2V7h2v4z"/></svg>
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '10px', color: '#1DB954', fontWeight: 800, marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Sintonizado en
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {jam.track_title}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {jam.track_artist}
                  </div>
                </div>
                {/* Visual EQ Animation */}
                {isSinfoniaSyncEnabled && jam.is_playing && (
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '16px', paddingRight: '4px' }}>
                    <div className="wave-bar" />
                    <div className="wave-bar" />
                    <div className="wave-bar" />
                    <div className="wave-bar" />
                  </div>
                )}
              </div>
            )}

            {/* QR Code & Invite area */}
            <div style={{ 
              background: 'rgba(255, 255, 255, 0.02)', 
              borderRadius: '12px', 
              border: '1px solid rgba(255, 255, 255, 0.05)',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>
                {isHost ? 'CÓDIGO DE LA SINFONÍA' : `ANFITRIÓN: ${jam.host_name}`}
              </div>
              
              <div 
                onClick={copyCode}
                title="Copiar código"
                style={{ 
                  fontSize: '36px', 
                  fontWeight: 900, 
                  color: '#fff', 
                  letterSpacing: '10px', 
                  paddingLeft: '10px', // offset letter-spacing on right
                  margin: '4px 0 16px 0',
                  cursor: 'pointer',
                  transition: 'opacity 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                {jam.jam_code}
              </div>

              {/* QR Code Container */}
              <div style={{ 
                background: '#121212', 
                padding: '12px', 
                borderRadius: '8px', 
                border: '1px solid rgba(255, 255, 255, 0.08)',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '184px',
                height: '184px'
              }}>
                {qrUrl ? (
                  <img src={qrUrl} alt="QR Code para unirse" style={{ width: '160px', height: '160px', borderRadius: '4px' }} />
                ) : (
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Cargando QR...</div>
                )}
              </div>

              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '16px', maxWidth: '280px', lineHeight: '1.4' }}>
                Escanea el código QR con la cámara de tu móvil o comparte el enlace para unirse directamente.
              </div>

              {/* Copiar enlace direct button */}
              <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                <button
                  onClick={copyCode}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: '20px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
                >
                  {copied ? '✓ Copiado' : 'Copiar Código'}
                </button>
                <button
                  onClick={copyInviteLink}
                  style={{
                    flex: 1.2,
                    padding: '10px 14px',
                    borderRadius: '20px',
                    background: '#fff',
                    border: 'none',
                    color: '#000',
                    fontWeight: 700,
                    fontSize: '12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                >
                  {linkCopied ? '✓ Enlace Copiado' : 'Copiar Enlace Jam'}
                </button>
              </div>
            </div>

            {/* Participants Section */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
                Miembros activos ({members.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {members.map(m => {
                  const initials = m.display_name.charAt(0).toUpperCase();
                  const isHostUser = m.user_id === jam.host_id;
                  return (
                    <div 
                      key={m.user_id} 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '8px', 
                        background: 'rgba(255,255,255,0.03)', 
                        borderRadius: '24px', 
                        padding: '4px 12px 4px 4px',
                        border: '1px solid rgba(255,255,255,0.05)'
                      }}
                      title={m.display_name}
                    >
                      <div style={{ 
                        width: '24px', 
                        height: '24px', 
                        borderRadius: '50%', 
                        backgroundColor: getAvatarColor(m.display_name), 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        fontSize: '10px', 
                        fontWeight: 800, 
                        color: 'white' 
                      }}>
                        {initials}
                      </div>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#fff' }}>
                        {m.display_name}
                      </span>
                      {isHostUser && (
                        <span style={{ 
                          fontSize: '8px', 
                          fontWeight: 800, 
                          color: 'black', 
                          background: '#1DB954', 
                          borderRadius: '4px', 
                          padding: '1px 5px',
                          letterSpacing: '0.3px'
                        }}>
                          DIRECTOR
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Online Friends Invite list (Simulated) */}
            <div style={{ 
              background: 'rgba(255, 255, 255, 0.01)', 
              borderRadius: '12px', 
              border: '1px solid rgba(255, 255, 255, 0.04)',
              padding: '14px 16px'
            }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>
                Invitar amigos en línea
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {onlineFriends.map(friend => {
                  const inSession = members.some(m => m.display_name === friend.name);
                  return (
                    <div key={friend.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ 
                          width: '28px', 
                          height: '28px', 
                          borderRadius: '50%', 
                          background: '#282828', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          fontSize: '11px',
                          fontWeight: 700,
                          color: '#fff',
                          position: 'relative'
                        }}>
                          {friend.avatar}
                          <span style={{
                            position: 'absolute',
                            bottom: '0',
                            right: '0',
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            background: '#1DB954',
                            border: '1.5px solid #0c0c0d'
                          }} />
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>{friend.name}</span>
                      </div>

                      <button
                        onClick={() => handleInviteFriendSim(friend.id, friend.name)}
                        disabled={inSession || friend.status === 'inviting'}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '14px',
                          border: 'none',
                          background: inSession ? 'rgba(255,255,255,0.04)' : friend.status === 'inviting' ? 'rgba(255,255,255,0.08)' : '#1DB954',
                          color: inSession ? 'var(--text-secondary)' : friend.status === 'inviting' ? '#fff' : '#000',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: inSession || friend.status === 'inviting' ? 'default' : 'pointer',
                          transition: 'opacity 0.2s'
                        }}
                      >
                        {inSession ? 'En la Jam' : friend.status === 'inviting' ? 'Enviando...' : 'Invitar'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {error && <div style={{ color: '#1DB954', fontSize: '12px', textAlign: 'center', fontWeight: 600 }}>{error}</div>}

            {/* Leave button */}
            <button 
              onClick={handleLeave} 
              style={{
                width: '100%',
                padding: '12px 0',
                background: 'transparent',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#ef4444',
                borderRadius: '24px',
                fontWeight: 700,
                fontSize: '13px',
                cursor: 'pointer',
                marginTop: '6px',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.1)';
                e.currentTarget.style.borderColor = 'rgba(239,68,68,0.6)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)';
              }}
            >
              {isHost ? 'Terminar Sinfonía (Host)' : 'Salir de la Sinfonía'}
            </button>
          </div>
        )}

        {/* QUEUE */}
        {tab === 'queue' && jam && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {currentTrack && (
              <button 
                onClick={handleAddCurrentTrack} 
                disabled={addingTrack} 
                style={{ 
                  width: '100%', 
                  padding: '12px 0', 
                  borderRadius: '24px', 
                  background: 'rgba(255, 255, 255, 0.05)', 
                  border: '1px solid rgba(255, 255, 255, 0.1)', 
                  color: '#fff', 
                  fontWeight: 700, 
                  fontSize: '12px', 
                  cursor: 'pointer',
                  transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
              >
                {addingTrack ? 'Añadiendo...' : `Añadir "${currentTrack.title.slice(0, 32)}..." a la cola`}
              </button>
            )}

            {queue.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', textAlign: 'center' }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5">
                  <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                </svg>
                <div style={{ marginTop: '16px', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 600 }}>
                  La cola colaborativa está vacía
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  Cualquier participante puede añadir canciones para escucharlas juntos
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '340px', overflowY: 'auto' }}>
                {queue.map((item, i) => (
                  <div 
                    key={item.id} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '12px', 
                      background: 'rgba(255, 255, 255, 0.02)', 
                      borderRadius: '8px', 
                      padding: '8px 12px', 
                      border: '1px solid rgba(255, 255, 255, 0.04)' 
                    }}
                  >
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 800, width: '16px', textAlign: 'center' }}>
                      {i + 1}
                    </div>
                    {item.track_cover ? (
                      <img 
                        src={item.track_cover} 
                        alt="" 
                        style={{ width: '38px', height: '38px', borderRadius: '4px', objectFit: 'cover' }} 
                      />
                    ) : (
                      <div style={{ width: '38px', height: '38px', borderRadius: '4px', background: '#282828' }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '13px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.track_title}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.track_artist} &bull; por {item.added_by_name}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button 
                        onClick={() => handleVote(item.id)} 
                        style={{ 
                          background: votedIds.has(item.id) ? '#1DB954' : 'rgba(255, 255, 255, 0.05)', 
                          border: 'none', 
                          borderRadius: '6px', 
                          padding: '6px 10px', 
                          color: votedIds.has(item.id) ? 'black' : '#fff', 
                          fontSize: '11px', 
                          fontWeight: 800, 
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.2s'
                        }}
                      >
                        <span style={{ fontSize: '10px' }}>▲</span>
                        <span>{item.votes}</span>
                      </button>
                      {(isHost || item.added_by === userId) && (
                        <button 
                          onClick={() => handleRemoveFromQueue(item.id)} 
                          style={{ 
                            background: 'rgba(239, 68, 68, 0.1)', 
                            border: 'none', 
                            borderRadius: '6px', 
                            padding: '6px 10px', 
                            color: '#ef4444', 
                            fontSize: '11px', 
                            fontWeight: 700,
                            cursor: 'pointer',
                            transition: 'background 0.2s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'}
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {error && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px', textAlign: 'center', fontWeight: 600 }}>{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
