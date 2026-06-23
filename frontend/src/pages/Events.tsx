import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

const TM_KEY = import.meta.env.VITE_TICKETMASTER_KEY || '';
const OFFICIAL_SEGMENTS = ['Music']; // Solo segmento Music de TM

// Detecta si un evento es legítimo (artista actúa en persona, no tributo/streaming)
function isOfficialEvent(ev: any): boolean {
  const name = (ev.name || '').toLowerCase();
  const BAD_KEYWORDS = ['tribute', 'homenaje', 'karaoke', 'open mic', 'jam session', 'virtual', 'online', 'streaming', 'cover', 'night of'];
  if (BAD_KEYWORDS.some(k => name.includes(k))) return false;
  const classification = ev.classifications?.[0];
  if (classification?.segment?.name && !OFFICIAL_SEGMENTS.includes(classification.segment.name)) return false;
  return true;
}

function formatDate(dateStr: string) {
  if (!dateStr) return { day: '--', month: '--', year: '' };
  const d = new Date(dateStr + 'T12:00:00');
  return {
    day: d.toLocaleString('es-ES', { day: '2-digit' }),
    month: d.toLocaleString('es-ES', { month: 'short' }).toUpperCase(),
    year: String(d.getFullYear()),
    full: d.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  };
}

async function fetchEvents(params: Record<string, string>) {
  if (!TM_KEY) throw new Error('No Ticketmaster key configured');
  const qs = new URLSearchParams({ apikey: TM_KEY, classificationName: 'Music', size: '20', sort: 'date,asc', ...params }).toString();
  const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${qs}`);
  if (!res.ok) throw new Error('Ticketmaster error');
  const data = await res.json();
  return (data._embedded?.events || [])
    .filter(isOfficialEvent)
    .filter((ev: any) => ev.dates?.status?.code !== 'offsale' && ev.dates?.status?.code !== 'cancelled')
    .map((ev: any) => ({
    id: ev.id,
    name: ev.name || '',
    date: ev.dates?.start?.localDate || '',
    time: ev.dates?.start?.localTime || '',
    city: ev._embedded?.venues?.[0]?.city?.name || '',
    venue: ev._embedded?.venues?.[0]?.name || '',
    country: ev._embedded?.venues?.[0]?.country?.name || '',
    countryCode: ev._embedded?.venues?.[0]?.country?.countryCode || '',
    url: ev.url || '',
    soldOut: ev.dates?.status?.code === 'offsale' || ev.dates?.status?.code === 'cancelled',
    status: ev.dates?.status?.code || 'onsale',
    image: ev.images?.find((img: any) => img.ratio === '16_9' && img.width > 800)?.url || ev.images?.[0]?.url || '',
    genre: ev.classifications?.[0]?.genre?.name || '',
    artist: ev._embedded?.attractions?.[0]?.name || ev.name,
    artistId: ev._embedded?.attractions?.[0]?.id || '',
  }));
}

const GENRES = ['Todos', 'Pop', 'Rock', 'Electronic', 'Hip-Hop', 'R&B', 'Latin', 'Alternative', 'Country', 'Classical'];
const COUNTRIES = [
  { label: 'Todo el mundo', code: '' },
  { label: 'España', code: 'ES' },
  { label: 'Estados Unidos', code: 'US' },
  { label: 'México', code: 'MX' },
  { label: 'Argentina', code: 'AR' },
  { label: 'Reino Unido', code: 'GB' },
  { label: 'Francia', code: 'FR' },
  { label: 'Alemania', code: 'DE' },
  { label: 'Colombia', code: 'CO' },
];

export default function Events() {
  const [genre, setGenre] = useState('Todos');
  const [countryCode, setCountryCode] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [userCountry, setUserCountry] = useState('');

  // Geolocalización para "cerca de ti"
  useEffect(() => {
    fetch('https://ipapi.co/json/').then(r => r.json()).then(d => {
      if (d.country_code) setUserCountry(d.country_code);
    }).catch(() => {});
  }, []);

  const params: Record<string, string> = {};
  if (genre !== 'Todos') params.genreId = genre;
  if (countryCode) params.countryCode = countryCode;
  if (searchQ) params.keyword = searchQ;

  const { data: events = [], isLoading, error } = useQuery({
    queryKey: ['tm-events', genre, countryCode, searchQ],
    queryFn: () => fetchEvents(params),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const { data: nearbyEvents = [] } = useQuery({
    queryKey: ['tm-events-nearby', userCountry],
    queryFn: () => userCountry ? fetchEvents({ countryCode: userCountry, size: '6' }) : Promise.resolve([]),
    enabled: !!userCountry && !searchQ && !countryCode,
    staleTime: 10 * 60 * 1000,
  });

  const featured = events.filter((e: any) => e.image).slice(0, 5);
  const mainList = searchQ ? events : events.slice(0, 20);

  return (
    <div style={{ paddingBottom: 120, color: 'var(--text-primary)' }}>
      <style>{`
        .event-card { transition: background 0.2s; }
        .event-card:hover { background: rgba(255,255,255,0.08) !important; }
        .ev-filter-btn { transition: all 0.2s; }
        .ev-filter-btn:hover { background: rgba(255,255,255,0.12) !important; }
        .featured-slide { flex-shrink: 0; scroll-snap-align: start; transition: transform 0.3s; }
        .featured-slide:hover { transform: scale(1.01); }
      `}</style>

      {/* Header */}
      <div style={{ padding: '32px 32px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 36, fontWeight: 900, margin: 0, background: 'linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.6) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Eventos
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 14 }}>Conciertos y eventos en vivo via Ticketmaster</p>
          </div>
        </div>

        {/* Search + Filters */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
          {/* Buscador */}
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} width="16" height="16" viewBox="0 0 24 24" fill="var(--text-muted)">
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && setSearchQ(searchInput)}
              placeholder="Buscar artista o evento..."
              style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, padding: '10px 16px 10px 40px', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
            />
            {searchInput && (
              <button onClick={() => { setSearchQ(''); setSearchInput(''); }} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            )}
          </div>

          {/* País */}
          <select
            value={countryCode}
            onChange={e => setCountryCode(e.target.value)}
            style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, padding: '10px 16px', color: 'var(--text-primary)', fontSize: 14, cursor: 'pointer' }}
          >
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>

          {/* Buscar btn */}
          <button
            onClick={() => setSearchQ(searchInput)}
            style={{ background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 24, padding: '10px 20px', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}
          >
            Buscar
          </button>
        </div>

        {/* Filtros de género */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8 }}>
          {GENRES.map(g => (
            <button
              key={g}
              onClick={() => setGenre(g)}
              className="ev-filter-btn"
              style={{ padding: '6px 16px', borderRadius: 20, background: genre === g ? 'var(--accent)' : 'rgba(255,255,255,0.08)', color: genre === g ? '#000' : 'var(--text-primary)', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, flexShrink: 0 }}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      {!TM_KEY ? (
        <div style={{ padding: '40px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}><svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor" opacity="0.4"><path d="M22 10V6c0-1.11-.9-2-2-2H4c-1.1 0-1.99.89-1.99 2v4c1.1 0 1.99.9 1.99 2s-.89 2-2 2v4c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-4c-1.1 0-2-.9-2-2s.9-2 2-2zm-2-1.46c-1.19.69-2 1.99-2 3.46s.81 2.77 2 3.46V18H4v-2.54c1.19-.69 2-1.99 2-3.46 0-1.48-.8-2.77-1.99-3.46L4 6h16v2.54z"/></svg></div>
          <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Configura tu clave de Ticketmaster</h3>
          <p style={{ color: 'var(--text-muted)', maxWidth: 400, margin: '0 auto 20px' }}>
            Añade <code style={{ background: 'var(--bg-card)', padding: '2px 6px', borderRadius: 4 }}>VITE_TICKETMASTER_KEY=tu_key</code> en el archivo <code style={{ background: 'var(--bg-card)', padding: '2px 6px', borderRadius: 4 }}>frontend/.env</code>
          </p>
          <a href="https://developer.ticketmaster.com" target="_blank" rel="noopener noreferrer" style={{ background: 'var(--accent)', color: '#000', padding: '10px 24px', borderRadius: 24, textDecoration: 'none', fontWeight: 700 }}>
            Obtener clave gratis →
          </a>
        </div>
      ) : isLoading ? (
        <div style={{ padding: '60px 32px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}><svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" opacity="0.4"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></div>
          Cargando eventos...
        </div>
      ) : error ? (
        <div style={{ padding: '40px 32px', textAlign: 'center', color: 'var(--text-muted)' }}>No se pudieron cargar los eventos. Inténtalo de nuevo.</div>
      ) : (
        <>
          {/* Featured Carousel */}
          {!searchQ && featured.length > 0 && (
            <div style={{ padding: '24px 32px 0' }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>Destacados</h2>
              <div style={{ display: 'flex', gap: 20, overflowX: 'auto', paddingBottom: 16, scrollSnapType: 'x mandatory' }}>
                {featured.map((ev: any) => {
                  const { day, month, year } = formatDate(ev.date);
                  return (
                    <div key={ev.id} className="featured-slide" onClick={() => ev.url && window.open(ev.url, '_blank')}
                      style={{ width: 340, borderRadius: 16, overflow: 'hidden', cursor: 'pointer', background: 'var(--bg-card)', position: 'relative', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                      <div style={{ height: 200, position: 'relative' }}>
                        <img src={ev.image} alt={ev.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 60%)' }} />
                        {ev.soldOut && (
                          <div style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(255,60,60,0.9)', color: '#fff', padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>SOLD OUT</div>
                        )}
                        <div style={{ position: 'absolute', bottom: 12, left: 16, right: 16 }}>
                          <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.name}</div>
                          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{ev.city} · {day} {month} {year}</div>
                        </div>
                      </div>
                      <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.venue}</div>
                        {!ev.soldOut && <button style={{ background: 'var(--accent)', color: '#000', border: 'none', padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>Entradas</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Cerca de ti */}
          {!searchQ && !countryCode && nearbyEvents.length > 0 && (
            <div style={{ padding: '24px 32px 0' }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg> Cerca de ti</h2>
              <EventList events={nearbyEvents.slice(0, 5)} />
            </div>
          )}

          {/* Lista principal */}
          <div style={{ padding: '24px 32px 0' }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 16 }}>
              {searchQ ? `Resultados para "${searchQ}"` : countryCode ? `Eventos en ${COUNTRIES.find(c => c.code === countryCode)?.label}` : 'Próximos conciertos'}
            </h2>
            {mainList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>No se encontraron eventos oficiales con estos filtros.</div>
            ) : (
              <EventList events={mainList} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EventList({ events }: { events: any[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {events.map((ev: any, i: number) => {
        const { day, month, year } = formatDate(ev.date);
        return (
          <div key={ev.id || i} className="event-card" onClick={() => ev.url && !ev.soldOut && window.open(ev.url, '_blank')}
            style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-card)', padding: 16, borderRadius: 12, cursor: ev.url && !ev.soldOut ? 'pointer' : 'default', opacity: ev.soldOut ? 0.65 : 1, gap: 16 }}>

            {/* Imagen miniatura */}
            {ev.image && (
              <div style={{ width: 64, height: 64, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}>
                <img src={ev.image} alt={ev.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}

            {/* Fecha */}
            <div style={{ width: 56, textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.08)', paddingRight: 16, flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: ev.soldOut ? 'var(--text-muted)' : 'var(--accent)', letterSpacing: 1 }}>{month}</div>
              <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.1 }}>{day}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{year}</div>
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ev.venue} · {ev.city}{ev.country ? `, ${ev.country}` : ''}</div>
              {ev.genre && ev.genre !== 'Undefined' && (
                <span style={{ fontSize: 11, fontWeight: 600, background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 10, marginTop: 4, display: 'inline-block', color: 'var(--text-muted)' }}>{ev.genre}</span>
              )}
            </div>

            {/* Acción */}
            {ev.soldOut ? (
              <div style={{ background: 'rgba(255,60,60,0.1)', border: '1px solid rgba(255,60,60,0.35)', color: '#ff6b6b', padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 800, flexShrink: 0 }}>SOLD OUT</div>
            ) : ev.url ? (
              <button style={{ background: 'var(--accent)', color: '#000', border: 'none', padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>Entradas</button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
