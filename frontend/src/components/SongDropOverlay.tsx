/**
 * Canción "en vivo" de un amigo: aparece al momento con una animación
 * (disco que entra girando, ondas y confeti) y se puede escuchar con un toque.
 * La alimenta useNotifications con los avisos `song_drop` sin leer.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { getTrack, type SharedTrack, type Track } from '../lib/api';
import { usePlayerStore } from '../store/playerStore';
import { IconPlay, IconSend } from './SocialIcons';

export interface SongDrop {
  id: string;
  senderName: string;
  senderAvatar?: string | null;
  note?: string | null;
  track: SharedTrack;
}

interface SongDropState {
  queue: SongDrop[];
  push: (d: SongDrop) => void;
  dismiss: () => void;
}

export const useSongDropStore = create<SongDropState>((set) => ({
  queue: [],
  push: (d) => set((s) => (s.queue.some((q) => q.id === d.id) ? s : { queue: [...s.queue, d] })),
  dismiss: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

const SHOWN_KEY = 'koko_song_drops_shown';

/** Muestra cada aviso una sola vez por dispositivo. */
export function enqueueSongDrops(notifications: any[]) {
  let shown: string[] = [];
  try { shown = JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]'); } catch { /* vacío */ }
  const fresh = notifications.filter((n) => n.type === 'song_drop' && !n.isRead && n.payload?.track && !shown.includes(n.id));
  if (!fresh.length) return;
  // Solo las de los últimos 30 min: una canción "en vivo" de ayer ya no sorprende
  const recent = fresh.filter((n) => Date.now() - new Date(n.createdAt).getTime() < 30 * 60_000);
  recent.reverse().forEach((n) => useSongDropStore.getState().push({
    id: n.id,
    senderName: n.senderName || 'Un amigo',
    senderAvatar: n.payload.senderAvatar,
    note: n.payload.note,
    track: n.payload.track,
  }));
  try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...shown, ...fresh.map((n) => n.id)].slice(-200))); } catch { /* sin storage */ }
}

const CONFETTI = Array.from({ length: 18 }, (_, i) => i);

export default function SongDropOverlay() {
  const drop = useSongDropStore((s) => s.queue[0]);
  const dismiss = useSongDropStore((s) => s.dismiss);

  useEffect(() => {
    if (!drop) return;
    if ('vibrate' in navigator) { try { navigator.vibrate?.([60, 40, 120]); } catch { /* no soportado */ } }
    const t = setTimeout(dismiss, 15_000);
    return () => clearTimeout(t);
  }, [drop, dismiss]);

  if (!drop) return null;

  const play = async () => {
    let track: Track | null = null;
    try { track = await getTrack(drop.track.id); } catch { /* se usa lo que vino en el aviso */ }
    usePlayerStore.getState().setTrack(track ?? {
      id: drop.track.id,
      title: drop.track.title,
      artist: drop.track.artist,
      album: '',
      cover: drop.track.cover || '',
      duration: 0,
      popularity: 0,
      preview_url: null,
    });
    dismiss();
  };

  return createPortal(
    <div className="song-drop-backdrop" onClick={dismiss} role="dialog" aria-label={`${drop.senderName} te envía una canción`}>
      <div className="song-drop-card" onClick={(e) => e.stopPropagation()}>
        {CONFETTI.map((i) => (
          <span key={i} className="song-drop-confetti" style={{ ['--i' as any]: i, left: `${(i * 37) % 100}%` }} />
        ))}
        <div className="song-drop-from">
          {drop.senderAvatar ? <img src={drop.senderAvatar} alt="" /> : <span>{drop.senderName.charAt(0).toUpperCase()}</span>}
          <div><strong>{drop.senderName}</strong> te envía una canción</div>
        </div>
        <div className="song-drop-badge"><IconSend size={12} /> En vivo</div>
        <div className="song-drop-disc-wrap">
          <span className="song-drop-ring" />
          <span className="song-drop-ring" style={{ animationDelay: '0.6s' }} />
          <div className="song-drop-disc" style={drop.track.cover ? { backgroundImage: `url(${drop.track.cover})` } : undefined} />
        </div>
        <div className="song-drop-title">{drop.track.title}</div>
        <div className="song-drop-artist">{drop.track.artist}</div>
        {drop.note && <div className="song-drop-note">“{drop.note}”</div>}
        <div className="song-drop-actions">
          <button className="song-drop-play" onClick={play}><IconPlay size={16} /> Escuchar ahora</button>
          <button className="song-drop-later" onClick={dismiss}>Luego</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
