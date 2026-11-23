/**
 * Cápsula del tiempo: guarda canciones para que te aparezcan a ti (o a tus
 * amigos) pasado un tiempo. Hasta la fecha su contenido es sorpresa para
 * quien la recibe. Backend: /api/social/capsules.
 *
 * Diseño centrado en las portadas: mosaico de portadas en la cabecera,
 * cápsulas con sus portadas en abanico sobre su propio color difuminado y
 * canciones en carrusel de portadas.
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

function countdown(iso: string): { value: string; unit: string } | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return { value: String(days), unit: days === 1 ? 'día' : 'días' };
  const hours = Math.max(1, Math.round(ms / 3_600_000));
  return { value: String(hours), unit: hours === 1 ? 'hora' : 'horas' };
}

/** Portadas de iTunes a mayor resolución (las de 100x100 se ven borrosas a tamaño grande). */
const big = (url?: string | null) => (url ? url.replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/, '/600x600bb.$2') : '');

function toTrack(t: SharedTrack): Track {
  return { id: t.id, title: t.title, artist: t.artist, album: '', cover: t.cover || '', duration: 0, popularity: 0, preview_url: null };
}

async function playCapsule(tracks: SharedTrack[], startIndex = 0) {
  if (!tracks.length) return;
  const full = await Promise.all(tracks.map((t) => getTrack(t.id).catch(() => null)));
  const queue = tracks.map((t, i) => full[i] ?? toTrack(t));
  usePlayerStore.getState().setQueue(queue, startIndex);
}

/** Portadas en abanico (hasta 4). */
function CoverFan({ covers, size = 96 }: { covers: string[]; size?: number }) {
  const shown = covers.slice(0, 4);
  if (!shown.length) return <div className="cap-fan-empty" style={{ width: size, height: size }}><IconHourglass size={size * 0.35} /></div>;
  const mid = (shown.length - 1) / 2;
  return (
    <div className="cap-fan" style={{ width: size + (shown.length - 1) * size * 0.28, height: size * 1.08 }}>
      {shown.map((c, i) => (
        <img
          key={`${c}-${i}`}
          src={big(c)}
          alt=""
          loading="lazy"
          style={{
            width: size, height: size,
            left: i * size * 0.28,
            transform: `rotate(${(i - mid) * 7}deg) translateY(${Math.abs(i - mid) * 4}px)`,
            zIndex: 10 - Math.round(Math.abs(i - mid) * 2),
          }}
        />
      ))}
    </div>
  );
}

/** Carrusel horizontal de portadas; al tocar una, suena la cápsula desde esa canción. */
function CoverRail({ tracks, onPlay }: { tracks: SharedTrack[]; onPlay?: (i: number) => void }) {
  return (
    <div className="cap-rail">
      {tracks.map((t, i) => (
        <button key={`${t.id}-${i}`} className="cap-rail-item" onClick={() => onPlay?.(i)} disabled={!onPlay}>
          <span className="cap-rail-cover">
            {t.cover ? <img src={big(t.cover)} alt="" loading="lazy" /> : <span className="cap-cover-ph" />}
            {onPlay && <span className="cap-rail-play"><IconPlay size={16} /></span>}
          </span>
          <span className="cap-rail-title">{t.title}</span>
          <span className="cap-rail-artist">{t.artist}</span>
        </button>
      ))}
    </div>
  );
}

function CapsuleCard({ c, mine, onDelete }: { c: TimeCapsule; mine: boolean; onDelete?: () => void }) {
  const locked = !c.isOpen;
  const covers = c.tracks.map((t) => t.cover).filter(Boolean) as string[];
  const bg = covers[0] || c.teaserCover || '';
  const sealed = locked && !mine; // cerrada y recibida: sorpresa
  const left = countdown(c.openAt);
  const who = mine
    ? (c.recipientIds.length === 1 && c.recipientIds[0] === c.ownerId ? 'Para ti' : `Para ${c.recipientIds.length} amigo${c.recipientIds.length === 1 ? '' : 's'}`)
    : `De ${c.ownerName || 'un amigo'}`;

  return (
    <article className={`cap-card ${locked ? 'is-locked' : 'is-open'} ${sealed ? 'is-sealed' : ''}`}>
      {bg && <div className="cap-card-bg" style={{ backgroundImage: `url(${big(bg)})` }} />}
      <div className="cap-card-top">
        {sealed ? (
          <div className="cap-seal">
            {c.teaserCover && <img src={big(c.teaserCover)} alt="" />}
            <span className="cap-seal-lock"><IconLock size={26} /></span>
          </div>
        ) : (
          <CoverFan covers={covers} size={88} />
        )}
        <div className="cap-card-meta">
          <span className="cap-eyebrow">{who}</span>
          {left ? (
            <div className="cap-count"><strong>{left.value}</strong> {left.unit}<small>para abrirse · {fmtDate(c.openAt)}</small></div>
          ) : (
            <div className="cap-count is-open"><strong>Abierta</strong><small>{fmtDate(c.openAt)}</small></div>
          )}
          <span className="cap-tracks-n">{c.trackCount} canci{c.trackCount === 1 ? 'ón' : 'ones'}</span>
        </div>
      </div>

      {c.message && <p className="cap-message">“{c.message}”</p>}
      {sealed && <p className="cap-hint">Su contenido es una sorpresa hasta esa fecha.</p>}

      {c.tracks.length > 0 && (
        <CoverRail tracks={c.tracks} onPlay={!locked || mine ? (i) => playCapsule(c.tracks, i) : undefined} />
      )}

      {(c.tracks.length > 0 && (!locked || mine)) || (mine && locked && onDelete) ? (
        <div className="cap-actions">
          {c.tracks.length > 0 && (!locked || mine) && (
            <button className="cap-btn cap-btn-primary" onClick={() => playCapsule(c.tracks)}><IconPlay size={14} /> Escuchar cápsula</button>
          )}
          {mine && locked && onDelete && (
            <button className="cap-btn cap-btn-ghost" onClick={onDelete}>Eliminar</button>
          )}
        </div>
      ) : null}
    </article>
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
  const [justSaved, setJustSaved] = useState(false);
  const { data: friendsData } = useQuery({ queryKey: ['friends', userId], queryFn: () => getFriends(userId), enabled: !!userId });
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchTracks(q.trim(), 12, 'itunes', ctrl.signal).then((r) => setResults(r.tracks || [])).catch(() => {});
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const toggle = (t: Track | SharedTrack) => {
    if (picked.some((p) => p.id === t.id)) return setPicked(picked.filter((p) => p.id !== t.id));
    if (picked.length >= 20) return;
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
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
      onCreated();
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar la cápsula');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="cap-new">
      {picked[0]?.cover && <div className="cap-new-bg" style={{ backgroundImage: `url(${big(picked[picked.length - 1].cover)})` }} />}
      <div className="cap-new-head">
        <CoverFan covers={picked.map((p) => p.cover).filter(Boolean).reverse() as string[]} size={72} />
        <div style={{ minWidth: 0 }}>
          <h2 className="cap-h2">{justSaved ? 'Cápsula enterrada' : 'Nueva cápsula'}</h2>
          <p className="cap-sub">
            {justSaved ? 'Aparecerá cuando llegue la fecha.'
              : picked.length ? `${picked.length} canci${picked.length === 1 ? 'ón' : 'ones'} · se abre el ${fmtDate(openAt.toISOString())}`
              : 'Elige las canciones que quieres guardar para el futuro.'}
          </p>
        </div>
      </div>

      {picked.length > 0 && (
        <div className="cap-picked">
          {picked.map((p) => (
            <button key={p.id} className="cap-picked-item" onClick={() => toggle(p)} title={`Quitar ${p.title}`}>
              {p.cover ? <img src={big(p.cover)} alt="" /> : <span className="cap-cover-ph" />}
              <span className="cap-picked-x"><IconClose size={12} /></span>
            </button>
          ))}
        </div>
      )}

      <input className="cap-input" placeholder="Busca canciones para guardar" value={q} onChange={(e) => setQ(e.target.value)} />
      {currentTrack && !q && !picked.some((p) => p.id === currentTrack.id) && (
        <button className="cap-now" onClick={() => toggle(currentTrack)}>
          {currentTrack.cover ? <img src={big(currentTrack.cover)} alt="" /> : <span className="cap-cover-ph" />}
          <span style={{ minWidth: 0 }}>
            <small>Añadir la que suena</small>
            <strong>{currentTrack.title}</strong>
          </span>
          <IconPlus size={18} />
        </button>
      )}
      {results.length > 0 && (
        <div className="cap-results">
          {results.map((t) => {
            const on = picked.some((p) => p.id === t.id);
            return (
              <button key={t.id} className={`cap-result ${on ? 'is-on' : ''}`} onClick={() => toggle(t)}>
                <span className="cap-result-cover">
                  {t.cover ? <img src={big(t.cover)} alt="" loading="lazy" /> : <span className="cap-cover-ph" />}
                  <span className="cap-result-mark">{on ? <IconCheck size={18} /> : <IconPlus size={18} />}</span>
                </span>
                <span className="cap-rail-title">{t.title}</span>
                <span className="cap-rail-artist">{t.artist}</span>
              </button>
            );
          })}
        </div>
      )}

      <textarea className="cap-input" rows={2} maxLength={500} placeholder="Un mensaje para el futuro (opcional)" value={message} onChange={(e) => setMessage(e.target.value)} />

      <div className="cap-label">Se abre en</div>
      <div className="cap-chips">
        {PRESETS.map((p) => (
          <button key={p.days} className={`cap-chip ${!customDate && days === p.days ? 'is-active' : ''}`} onClick={() => { setDays(p.days); setCustomDate(''); }}>{p.label}</button>
        ))}
        <input type="date" className={`cap-chip ${customDate ? 'is-active' : ''}`} value={customDate} min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} onChange={(e) => setCustomDate(e.target.value)} aria-label="Otra fecha" />
      </div>

      <div className="cap-label">Para</div>
      <div className="cap-chips">
        <button className={`cap-chip ${recipients.length === 0 ? 'is-active' : ''}`} onClick={() => setRecipients([])}>Para mí</button>
        {(friendsData?.friends ?? []).map((f) => (
          <button key={f.id} className={`cap-chip cap-chip-person ${recipients.includes(f.id) ? 'is-active' : ''}`}
            onClick={() => setRecipients(recipients.includes(f.id) ? recipients.filter((r) => r !== f.id) : [...recipients, f.id])}>
            {f.avatar_url ? <img src={f.avatar_url} alt="" /> : <span>{(f.display_name || '?').charAt(0).toUpperCase()}</span>}
            {f.display_name}
          </button>
        ))}
      </div>

      {error && <div className="cap-error">{error}</div>}
      <button className="cap-btn cap-btn-primary cap-save" disabled={saving || !picked.length} onClick={save}>
        <IconHourglass size={16} /> {saving ? 'Guardando' : 'Enterrar cápsula'}
      </button>
    </section>
  );
}

export default function TimeCapsules() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['time-capsules'], queryFn: getTimeCapsules });
  const refresh = () => qc.invalidateQueries({ queryKey: ['time-capsules'] });
  const me = localStorage.getItem('koko_device_id');
  const received = data?.received ?? [];
  const sent = (data?.sent ?? []).filter((c) => !(c.recipientIds.length === 1 && c.recipientIds[0] === c.ownerId && received.some((r) => r.id === c.id)));
  const queue = usePlayerStore((s) => s.queue);

  // Mosaico de la cabecera: portadas de tus cápsulas y de lo que estás escuchando
  const wall = useMemo(() => {
    const all = [
      ...[...received, ...sent].flatMap((c) => c.tracks.map((t) => t.cover)),
      ...queue.map((t) => t.cover),
    ].filter(Boolean) as string[];
    const unique = [...new Set(all)].slice(0, 24);
    while (unique.length && unique.length < 12) unique.push(...unique.slice(0, 12 - unique.length));
    return unique;
  }, [received, sent, queue]);

  return (
    <div className="cap-page">
      <header className="cap-hero">
        {wall.length > 0 && (
          <div className="cap-wall" aria-hidden>
            {wall.map((c, i) => <img key={i} src={big(c)} alt="" loading="lazy" />)}
          </div>
        )}
        <div className="cap-hero-text">
          <span className="cap-eyebrow"><IconHourglass size={14} /> Cápsula del tiempo</span>
          <h1>Canciones para tu yo del futuro</h1>
          <p>Guarda la música de hoy y vuelve a encontrarla, o regálasela a un amigo, cuando llegue la fecha.</p>
        </div>
      </header>

      <NewCapsule onCreated={refresh} />

      {isLoading && <p className="cap-sub" style={{ padding: '0 4px' }}>Cargando cápsulas</p>}
      {error && <p className="cap-error">No se pudieron cargar las cápsulas.</p>}

      {received.length > 0 && <h2 className="cap-h2 cap-section">Recibidas</h2>}
      <div className="cap-grid">
        {received.map((c) => (
          <CapsuleCard key={c.id} c={c} mine={c.ownerId === me}
            onDelete={async () => { await deleteTimeCapsule(c.id).catch(() => {}); refresh(); }} />
        ))}
      </div>
      {sent.length > 0 && <h2 className="cap-h2 cap-section">Enviadas</h2>}
      <div className="cap-grid">
        {sent.map((c) => (
          <CapsuleCard key={c.id} c={c} mine onDelete={async () => { await deleteTimeCapsule(c.id).catch(() => {}); refresh(); }} />
        ))}
      </div>
    </div>
  );
}
