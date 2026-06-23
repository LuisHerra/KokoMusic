import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { usePlayerStore } from '../store/playerStore';

const COUNTRIES = [
  { code: 'global', name: 'Global' },
  { code: 'spain', name: 'España' },
  { code: 'united states', name: 'Estados Unidos' },
  { code: 'mexico', name: 'México' },
  { code: 'argentina', name: 'Argentina' },
  { code: 'colombia', name: 'Colombia' },
  { code: 'chile', name: 'Chile' },
  { code: 'peru', name: 'Perú' },
  { code: 'japan', name: 'Japón' },
  { code: 'south korea', name: 'Corea del Sur' },
];

export default function TopArtists() {
  const [searchParams, setSearchParams] = useSearchParams();
  const country = searchParams.get('country') || 'global';
  const type = searchParams.get('type') || 'artists';
  const sort = searchParams.get('sort') || 'mensual';

  const setTrack = usePlayerStore((s) => s.setTrack);

  const { data, isLoading, error } = useQuery({
    queryKey: ['top', type, country, sort],
    queryFn: async () => {
      const endpoint = type === 'artists' ? 'top-artists' : 'top-tracks';
      const res = await fetch(`http://localhost:3001/api/${endpoint}?country=${country}&sort=${sort}`);
      if (!res.ok) throw new Error(`Error al cargar ${type}`);
      return res.json();
    }
  });

  const handleCountryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSearchParams({ country: e.target.value, type, sort });
  };
  const handleTypeChange = (newType: string) => {
    setSearchParams({ country, type: newType, sort });
  };
  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSearchParams({ country, type, sort: e.target.value });
  };

  const handlePlayTrack = async (_track: any, index: number) => {
    const queue = (data?.tracks || []).map((t: any) => ({
      id: t.id,
      title: t.title,
      artist: t.artistName,
      album: t.albumName,
      duration: t.duration || 0,
      cover: t.image,
      trackId: t.id,
    }));
    setTrack(queue[index], queue);
  };

  return (
    <div className="main-body" style={{ paddingTop: 40, paddingBottom: 100 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <h1 className="section-title" style={{ margin: 0, fontSize: 32 }}>Top Global</h1>
          <span style={{ color: 'var(--text-secondary)', fontSize: 16 }}>
            {COUNTRIES.find(c => c.code === country)?.name}
          </span>
        </div>
        
        <div style={{ display: 'flex', gap: 12 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', background: 'var(--bg-card)', borderRadius: 24, padding: 4 }}>
            <button
              onClick={() => handleTypeChange('artists')}
              style={{
                background: type === 'artists' ? 'var(--accent)' : 'transparent',
                color: type === 'artists' ? '#000' : 'var(--text-primary)',
                border: 'none', padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s'
              }}
            >
              Artistas
            </button>
            <button
              onClick={() => handleTypeChange('tracks')}
              style={{
                background: type === 'tracks' ? 'var(--accent)' : 'transparent',
                color: type === 'tracks' ? '#000' : 'var(--text-primary)',
                border: 'none', padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s'
              }}
            >
              Canciones
            </button>
          </div>

          <select 
            value={sort} 
            onChange={handleSortChange}
            style={{
              padding: '8px 16px', borderRadius: '24px', background: 'var(--bg-card)', color: '#fff',
              border: '1px solid rgba(255,255,255,0.1)', outline: 'none', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <option value="mensual">Mensuales (Tendencia)</option>
            <option value="total">Totales (Histórico)</option>
          </select>

          <select 
            value={country} 
            onChange={handleCountryChange}
            style={{
              padding: '8px 16px',
              borderRadius: '24px',
              background: 'var(--bg-card)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.1)',
              outline: 'none',
              fontSize: 14,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {COUNTRIES.map(c => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 24 }}>
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              <div className="skeleton" style={{ width: 160, height: 160, borderRadius: type === 'artists' ? '50%' : 8 }} />
              <div className="skeleton" style={{ width: 120, height: 16, borderRadius: 4 }} />
              <div className="skeleton" style={{ width: 80, height: 12, borderRadius: 4 }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div style={{ color: 'red' }}>Error cargando los datos</div>
      ) : (
        <>
          {type === 'artists' && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: '32px 24px',
            }}>
              {(data?.artists || []).map((artist: any, index: number) => (
                <Link
                  key={`${artist.name}-${index}`}
                  to={`/artist/${encodeURIComponent(artist.name)}`}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', textDecoration: 'none',
                    padding: 16, background: 'var(--bg-card)', borderRadius: 12, transition: 'background 0.2s', position: 'relative',
                  }}
                  className="hover-card"
                >
                  <div style={{
                    position: 'absolute', top: -8, left: -8, background: 'var(--accent)', color: '#000',
                    fontWeight: 800, fontSize: 14, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '50%', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', zIndex: 2,
                  }}>
                    #{artist.position}
                  </div>
                  <img 
                    src={artist.image} 
                    alt={artist.name} 
                    style={{ width: 160, height: 160, borderRadius: '50%', objectFit: 'cover', marginBottom: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
                  />
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: 0, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>
                    {artist.name}
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 4, gap: 2 }}>
                    <span style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>
                      {new Intl.NumberFormat('es-ES').format(artist.playcount || 0)} reproducciones
                    </span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                      {new Intl.NumberFormat('es-ES').format(artist.listeners || 0)} oyentes {sort === 'mensual' ? 'mensuales' : 'totales'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {type === 'tracks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {(data?.tracks || []).map((track: any, index: number) => (
                <div 
                  key={`${track.id}-${index}`} 
                  onClick={() => handlePlayTrack(track, index)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16, padding: '8px 16px', background: 'var(--bg-card)', borderRadius: 8, cursor: 'pointer', transition: 'background 0.2s'
                  }}
                  className="hover-card"
                >
                  <div style={{ width: 32, fontSize: 16, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'center' }}>
                    {track.position}
                  </div>
                  <img 
                    src={track.image || 'https://via.placeholder.com/48'} 
                    alt={track.title} 
                    style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {track.title}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <Link to={`/artist/${encodeURIComponent(track.artistName)}`} onClick={(e) => e.stopPropagation()} style={{ color: 'inherit', textDecoration: 'none' }} className="hover-underline">
                        {track.artistName}
                      </Link>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <span style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>
                      {new Intl.NumberFormat('es-ES').format(track.playcount || 0)} plays
                    </span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                      {new Intl.NumberFormat('es-ES').format(track.listeners || 0)} oyentes {sort === 'mensual' ? 'mensuales' : 'totales'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
