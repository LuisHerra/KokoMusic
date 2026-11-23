/**
 * Cápsula del tiempo: guarda canciones para que te aparezcan a ti (o a tus
 * amigos) pasado un tiempo. Hasta la fecha su contenido es sorpresa para
 * quien la recibe. Backend: /api/social/capsules.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createTimeCapsule, deleteTimeCapsule, getFriends, getTimeCapsules, getTrack, searchTracks,
  type SharedTrack, type TimeCapsule, type Track,
} from '../lib/api';
import { usePlayerStore } from '../store/playerStore';
import { IconCheck, IconClose, IconHourglass, IconLock, IconPlay, IconPlus } from '../components/SocialIcons';

const PRESETS: { label: string; days: number }[] = [
  { label: '1 semana', days: 7 },
  { label: '1 mes', days: 30 },
  { label: '6 meses', days: 182 },
  { label: '1 año', days: 365 },
];

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'Ya se puede abrir';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `Se abre en ${days} día${days === 1 ? '' : 's'}`;
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return `Se abre en ${hours} h`;
}

function toTrack(t: SharedTrack): Track {
  return { id: t.id, title: t.title, artist: t.artist, album: '', cover: t.cover || '', duration: 0, popularity: 0, preview_url: null };
}

async function playCapsule(tracks: SharedTrack[]) {
  if (!tracks.length) return;
  const full = await Promise.all(tracks.map((t) => getTrack(t.id).catch(() => null)));
  const queue = tracks.map((t, i) => full[i] ?? toTrack(t));
  usePlayerStore.getState().setQueue(queue, 0);
}

function CapsuleCard({ c, mine, onDelete }: { c: TimeCapsule; mine: boolean; onDelete?: () => void }) {
  const locked = !c.isOpen;
  return (
    <div className={`capsule-card ${locked ? 'is-locked' : 'is-open'}`}>
      <div className="capsule-card-head">
        <span className="capsule-icon">{locked ? <IconLock size={22} /> : <IconHourglass size={22} />}</span>
        <div style={{ minWidth: 0 }}>
          <div className="capsule-title">
            {mine ? (c.recipientIds.length === 1 && c.recipientIds[0] === c.ownerId ? 'Para ti' : `Para ${c.recipientIds.length} amigo${c.recipientIds.length === 1 ? '' : 's'}`)
              : `De ${c.ownerName || 'un amigo'}`}
          </div>
          <div className="capsule-sub">{locked ? `${timeLeft(c.openAt)} · ${fmtDate(c.openAt)}` : `Abierta el ${fmtDate(c.openAt)}`} · {c.trackCount} canciones</div>
        </div>
      </div>
      {c.message && <p className="capsule-message">“{c.message}”</p>}
      {c.tracks.length > 0 && (
        <ul className="capsule-tracks">
          {c.tracks.map((t) => (
            <li key={t.id}>
              {t.cover ? <img src={t.cover} alt="" /> : <span className="capsule-cover-ph" />}
              <div><div className="capsule-track-title">{t.title}</div><div className="capsule-sub">{t.artist}</div></div>
            </li>
          ))}
        </ul>
      )}
      {locked && !mine && <p className="capsule-sub" style={{ marginTop: 8 }}>Su contenido es una sorpresa hasta esa fecha.</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        {c.tracks.length > 0 && (!locked || mine) && (
          <button className="btn-primary capsule-btn" onClick={() => playCapsule(c.tracks)}><IconPlay size={14} /> Escuchar</button>
        )}
        {mine && locked && onDelete && (
          <button className="capsule-btn capsule-btn-ghost" onClick={onDelete}>Eliminar</button>
        )}
      </div>
    </div>
  );
}

function NewCapsule({ onCreated }: { onCreated: () => void }) {
  const userId = localStorage.getItem('koko_device_id') || '';
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [picked, setPicked] = useState<SharedTrack[]>([]);
  const [message, setMessage] = useState('');
  const [days, setDays] = useState(30);
  const [customDate, setCustomDate] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: friendsData } = useQuery({ queryKey: ['friends', userId], queryFn: () => getFriends(userId), enabled: !!userId });
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchTracks(q.trim(), 8, 'itunes', ctrl.signal).then((r) => setResults(r.tracks || [])).catch(() => {});
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const add = (t: Track) => {
    if (picked.some((p) => p.id === t.id) || picked.length >= 20) return;
    setPicked([...picked, { id: t.id, title: t.title, artist: t.artist, cover: t.cover }]);
  };

  const openAt = useMemo(() => {
    if (customDate) return new Date(`${customDate}T09:00:00`);
    return new Date(Date.now() + days * 86_400_000);
  }, [days, customDate]);

  const save = async () => {
    setError(null);
    if (!picked.length) return setError('Añade al menos una canción');
    if (openAt.getTime() <= Date.now() + 60_000) return setError('Elige una fecha futura');
    setSaving(true);
    try {
      await createTimeCapsule({ tracks: picked, message: message.trim() || undefined, openAt: openAt.toISOString(), recipientIds: recipients });
      setPicked([]); setMessage(''); setRecipients([]); setQ(''); setCustomDate('');
      onCreated();
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar la cápsula');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="capsule-new">
      <h2 className="capsule-h2">Nueva cápsula</h2>
      <input className="capsule-input" placeholder="Busca canciones para guardar…" value={q} onChange={(e) => setQ(e.target.value)} />
      {currentTrack && !q && (
        <button className="capsule-chip" onClick={() => add(currentTrack)}>+ Añadir la que suena: {currentTrack.title}</button>
      )}
      {results.length > 0 && (
        <ul className="capsule-results">
          {results.map((t) => (
            <li key={t.id} onClick={() => add(t)}>
              {t.cover ? <img src={t.cover} alt="" /> : <span className="capsule-cover-ph" />}
              <div style={{ minWidth: 0 }}><div className="capsule-track-title">{t.title}</div><div className="capsule-sub">{t.artist}</div></div>
              <span className="capsule-add">{picked.some((p) => p.id === t.id) ? <IconCheck size={16} /> : <IconPlus size={16} />}</span>
            </li>
          ))}
        </ul>
      )}
      {picked.length > 0 && (
        <div className="capsule-picked">
          {picked.map((p) => (
            <button key={p.id} className="capsule-chip" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} title="Quitar">
              {p.title} <IconClose size={12} />
            </button>
          ))}
        </div>
      )}
      <textarea className="capsule-input" rows={2} maxLength={500} placeholder="Un mensaje para el futuro (opcional)" value={message} onChange={(e) => setMessage(e.target.value)} />

      <div className="capsule-label">¿Cuándo se abre?</div>
      <div className="capsule-picked">
        {PRESETS.map((p) => (
          <button key={p.days} className={`capsule-chip ${!customDate && days === p.days ? 'is-active' : ''}`} onClick={() => { setDays(p.days); setCustomDate(''); }}>{p.label}</button>
        ))}
        <input type="date" className="capsule-chip" value={customDate} min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} onChange={(e) => setCustomDate(e.target.value)} />
      </div>
      <div className="capsule-sub">Se abrirá el {fmtDate(openAt.toISOString())}</div>

      <div className="capsule-label">¿Para quién?</div>
      <div className="capsule-picked">
        <button className={`capsule-chip ${recipients.length === 0 ? 'is-active' : ''}`} onClick={() => setRecipients([])}>Para mí</button>
        {(friendsData?.friends ?? []).map((f) => (
          <button key={f.id} className={`capsule-chip ${recipients.includes(f.id) ? 'is-active' : ''}`}
            onClick={() => setRecipients(recipients.includes(f.id) ? recipients.filter((r) => r !== f.id) : [...recipients, f.id])}>
            {f.display_name}
          </button>
        ))}
      </div>

      {error && <div className="capsule-error">{error}</div>}
      <button className="btn-primary capsule-btn" disabled={saving} onClick={save} style={{ marginTop: 14 }}>
        {saving ? 'Guardando…' : `Enterrar cápsula (${picked.length})`}
      </button>
    </div>
  );
}

export default function TimeCapsules() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['time-capsules'], queryFn: getTimeCapsules });
  const refresh = () => qc.invalidateQueries({ queryKey: ['time-capsules'] });
  const received = data?.received ?? [];
  const sent = (data?.sent ?? []).filter((c) => !(c.recipientIds.length === 1 && c.recipientIds[0] === c.ownerId && received.some((r) => r.id === c.id)));

  return (
    <div className="capsules-page">
      <h1 className="capsule-h1"><IconHourglass size={28} /> Cápsula del tiempo</h1>
      <p className="capsule-sub" style={{ marginBottom: 20 }}>Guarda canciones de hoy para que te aparezcan, a ti o a tus amigos, cuando llegue la fecha.</p>
      <NewCapsule onCreated={refresh} />

      {isLoading && <p className="capsule-sub">Cargando cápsulas…</p>}
      {error && <p className="capsule-error">No se pudieron cargar las cápsulas.</p>}

      {received.length > 0 && <h2 className="capsule-h2">Recibidas</h2>}
      <div className="capsule-grid">
        {received.map((c) => (
          <CapsuleCard key={c.id} c={c} mine={c.ownerId === localStorage.getItem('koko_device_id')}
            onDelete={async () => { await deleteTimeCapsule(c.id).catch(() => {}); refresh(); }} />
        ))}
      </div>
      {sent.length > 0 && <h2 className="capsule-h2">Enviadas</h2>}
      <div className="capsule-grid">
        {sent.map((c) => (
          <CapsuleCard key={c.id} c={c} mine onDelete={async () => { await deleteTimeCapsule(c.id).catch(() => {}); refresh(); }} />
        ))}
      </div>
    </div>
  );
}
