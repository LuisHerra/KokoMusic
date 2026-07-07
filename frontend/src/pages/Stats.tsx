import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { getStats, getTrack } from '../lib/api';
import { usePlayerStore } from '../store/playerStore';

export default function Stats() {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = searchParams.get('period') ?? 'all';
  const showShare = searchParams.get('share') === 'true';

  // State for the inner chart filter (e.g. Últimos 30 días / Últimos 7 días)
  const [evolutionPeriod, setEvolutionPeriod] = useState('30');

  // Format minutes into "Xh Ym" or "Y min"
  function formatMinutes(mins: number): string {
    if (mins <= 0) return '0 min';
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  // Compute dates based on header period dropdown
  const { start, end } = useMemo(() => {
    const end = new Date();
    let start = new Date();
    if (period === 'all') return { start: undefined, end: undefined };
    if (period === 'day') { start.setDate(start.getDate() - 1); }
    else if (period === 'week') { start.setDate(start.getDate() - 7); }
    else if (period === 'month') { start.setMonth(start.getMonth() - 1); }
    else if (period === 'year') { start.setFullYear(start.getFullYear() - 1); }
    return { start: start.toISOString(), end: end.toISOString() };
  }, [period]);

  const myId = localStorage.getItem('koko_device_id') ?? '';

  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats', period, myId],
    queryFn: () => getStats(start, end, myId),
  });

  const setTrack = usePlayerStore((s) => s.setTrack);

  const closeShareModal = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('share');
    setSearchParams(params);
  };

  if (isLoading) {
    return (
      <div className="main-body" style={{ paddingTop: 40, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div className="skeleton" style={{ height: 40, width: 250 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <div className="skeleton" style={{ height: 160, borderRadius: 'var(--radius-lg)' }} />
          <div className="skeleton" style={{ height: 160, borderRadius: 'var(--radius-lg)' }} />
          <div className="skeleton" style={{ height: 160, borderRadius: 'var(--radius-lg)' }} />
        </div>
        <div className="skeleton" style={{ height: 400, width: '100%', borderRadius: 'var(--radius-lg)' }} />
      </div>
    );
  }

  if (!stats) return <div className="main-body">No hay datos de estadísticas.</div>;

  // Donut chart calculations
  const donutRadius = 35;
  const donutCirc = 2 * Math.PI * donutRadius; // ~219.91
  let accumulatedPercent = 0;

  // Donut colors
  const donutColors = ['#1DB954', '#5B86E5', '#9F7AEA', '#D69E2E', '#E53E3E'];

  // Evolution chart mapping
  const evolution = stats.listeningEvolution || [];
  const maxVal = Math.max(...evolution.map(d => d.count), 1);
  const chartPoints = evolution.map((val, idx) => {
    const x = 50 + idx * (380 / (evolution.length - 1 || 1));
    const y = 110 - (val.count / maxVal) * 75; // Y coordinates between 35 and 110
    return { x, y };
  });

  let linePath = '';
  let areaPath = '';
  if (chartPoints.length > 0) {
    linePath = `M ${chartPoints[0].x} ${chartPoints[0].y}`;
    for (let i = 1; i < chartPoints.length; i++) {
      const cpX = (chartPoints[i - 1].x + chartPoints[i].x) / 2;
      linePath += ` C ${cpX} ${chartPoints[i - 1].y}, ${cpX} ${chartPoints[i].y}, ${chartPoints[i].x} ${chartPoints[i].y}`;
    }
    areaPath = `${linePath} L ${chartPoints[chartPoints.length - 1].x} 120 L ${chartPoints[0].x} 120 Z`;
  }

  const handlePeriodChange = (val: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('period', val);
    setSearchParams(params);
  };

  const handleShareClick = () => {
    const params = new URLSearchParams(searchParams);
    params.set('share', 'true');
    setSearchParams(params);
  };

  return (
    <div className="main-body" style={{ paddingTop: 24, paddingBottom: 64, position: 'relative' }}>
      
      {/* Page Title Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.5px' }}>
          Tus Estadísticas
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>
          Descubre qué has estado escuchando últimamente.
        </p>
      </div>

      {/* Mobile-only Header Controls */}
      <div className="show-on-mobile-flex" style={{ display: 'none', gap: 12, alignItems: 'center', marginBottom: 28, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 140 }}>
          <select
            value={period}
            onChange={(e) => handlePeriodChange(e.target.value)}
            style={{
              width: '100%',
              appearance: 'none',
              padding: '10px 36px 10px 36px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255,255,255,0.06)',
              color: 'var(--text-primary)',
              border: '1px solid rgba(255,255,255,0.1)',
              outline: 'none',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <option value="all" style={{ background: '#1f1f1f', color: '#ffffff' }}>Siempre</option>
            <option value="day" style={{ background: '#1f1f1f', color: '#ffffff' }}>Últimas 24 horas</option>
            <option value="week" style={{ background: '#1f1f1f', color: '#ffffff' }}>Última semana</option>
            <option value="month" style={{ background: '#1f1f1f', color: '#ffffff' }}>Último mes</option>
            <option value="year" style={{ background: '#1f1f1f', color: '#ffffff' }}>Último año</option>
          </select>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none', display: 'flex' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
          </span>
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none', display: 'flex' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
            </svg>
          </span>
        </div>

        <button
          onClick={handleShareClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            background: 'var(--accent)',
            color: '#000000',
            border: 'none',
            borderRadius: 'var(--radius-full)',
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            flex: 1,
            minWidth: 120,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3"></circle>
            <circle cx="6" cy="12" r="3"></circle>
            <circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
          </svg>
          Compartir
        </button>
      </div>

      {/* Row 1: Summary Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 20,
        marginBottom: 32
      }}>
        {/* Card 1: Canciones Escuchadas */}
        <div style={{
          background: 'rgba(29, 185, 84, 0.05)',
          border: '1px solid rgba(29, 185, 84, 0.25)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px 20px',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: 160
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', color: '#1DB954', textTransform: 'uppercase' }}>
              CANCIONES ESCUCHADAS
            </div>
            <div style={{ fontSize: 44, fontWeight: 800, color: '#fff', marginTop: 10, lineHeight: 1 }}>
              {stats.totalPlays}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, zIndex: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1DB954', display: 'flex', alignItems: 'center', gap: 2 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z" />
              </svg>
              {stats.trendPercentage > 0 ? `+${stats.trendPercentage}%` : `${stats.trendPercentage}%`}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>vs. periodo anterior</span>

            {/* Sparkline line */}
            <div style={{ marginLeft: 'auto', marginRight: 4, display: 'flex', alignItems: 'center' }}>
              <svg width="60" height="24" viewBox="0 0 60 24" style={{ overflow: 'visible' }}>
                <path
                  d="M0,18 Q12,2 24,15 T48,6 T60,18"
                  fill="none"
                  stroke="#1DB954"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
          
          {/* Faded Background Mask artist */}
          <div style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            top: 0,
            width: '45%',
            backgroundImage: `url(${stats.mostPlayedTrackCover})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
            maskImage: 'linear-gradient(to left, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 100%)',
            WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 100%)',
            opacity: 0.75,
            pointerEvents: 'none',
            borderRadius: '0 var(--radius-lg) var(--radius-lg) 0'
          }} />
        </div>

        {/* Card 2: Artistas Diferentes */}
        <div style={{
          position: 'relative',
          background: 'rgba(159, 122, 234, 0.05)',
          border: '1px solid rgba(159, 122, 234, 0.25)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: 160,
          overflow: 'hidden'
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', color: '#9F7AEA', textTransform: 'uppercase' }}>
              ARTISTAS DIFERENTES
            </div>
            <div style={{ fontSize: 44, fontWeight: 800, color: '#fff', marginTop: 10, lineHeight: 1 }}>
              {stats.uniqueArtists}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 1 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <span style={{ color: '#9F7AEA', fontWeight: 700 }}>
                +{stats.newArtistsCount} nuevos
              </span>{' '}
              esta semana
            </span>

            {/* Overlapping artist avatars */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {stats.artistAvatars.slice(0, 5).map((avatarUrl, idx) => (
                <img
                  key={idx}
                  src={avatarUrl}
                  alt="Artist"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    border: '2px solid #121212',
                    marginLeft: idx === 0 ? 0 : -8,
                    zIndex: 10 - idx,
                    objectFit: 'cover'
                  }}
                />
              ))}
              {stats.artistAvatarsExtra > 0 && (
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.08)',
                  border: '2px solid #121212',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginLeft: -8,
                  zIndex: 0
                }}>
                  +{stats.artistAvatarsExtra}
                </div>
              )}
            </div>
          </div>

          {/* Faded Background Mask revelation artist */}
          <div style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            top: 0,
            width: '45%',
            backgroundImage: `url(${stats.revelationArtistImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
            maskImage: 'linear-gradient(to left, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 100%)',
            WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 100%)',
            opacity: 0.75,
            pointerEvents: 'none',
            borderRadius: '0 var(--radius-lg) var(--radius-lg) 0'
          }} />
        </div>

        {/* Card 3: Género Favorito */}
        <div style={{
          background: 'rgba(91, 134, 229, 0.05)',
          border: '1px solid rgba(91, 134, 229, 0.25)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px 20px',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: 160
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', color: '#5B86E5', textTransform: 'uppercase' }}>
              GÉNERO FAVORITO
            </div>
            <div style={{ fontSize: 30, fontWeight: 800, color: '#5B86E5', marginTop: 14, lineHeight: 1.1, maxWidth: '65%' }}>
              {stats.topGenre}
            </div>
          </div>
          <div>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <span style={{ color: '#5B86E5', fontWeight: 700 }}>
                {stats.topGenrePercentage}%
              </span>{' '}
              de tus reproducciones
            </span>
          </div>

          {/* Faded Background Mask artist */}
          <div style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            top: 0,
            width: '45%',
            backgroundImage: `url(${stats.topGenreCover})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
            maskImage: 'linear-gradient(to left, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 100%)',
            WebkitMaskImage: 'linear-gradient(to left, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 100%)',
            opacity: 0.75,
            pointerEvents: 'none',
            borderRadius: '0 var(--radius-lg) var(--radius-lg) 0'
          }} />
        </div>

        {/* Card 4: Tiempo Escuchando */}
        <div style={{
          background: 'rgba(214, 158, 46, 0.05)',
          border: '1px solid rgba(214, 158, 46, 0.25)',
          borderRadius: 'var(--radius-lg)',
          padding: '24px 20px',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: 160
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.8px', color: '#D69E2E', textTransform: 'uppercase' }}>
              TIEMPO ESCUCHANDO
            </div>
            <div style={{ fontSize: 44, fontWeight: 800, color: '#fff', marginTop: 10, lineHeight: 1 }}>
              {formatMinutes(stats.totalMinutes)}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              <span style={{ color: '#D69E2E', fontWeight: 700 }}>{stats.totalPlays}</span>{' '}
              canciones en este periodo
            </span>
            <div style={{ marginLeft: 'auto', color: '#D69E2E', opacity: 0.7 }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Tu Perfil Musical (Left) & Estado de ánimo (Right) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: 24,
        marginBottom: 40,
      }} className="stats-row-responsive">
        
        {/* Left Box: Tu Perfil Musical */}
        <div style={{
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          border: '1px solid rgba(255,255,255,0.05)',
        }} className="stats-card-responsive">
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>Tu Perfil Musical</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4, marginBottom: 24 }}>
            Análisis de géneros y estilos basado en tu historial de reproducción
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: 32 }} className="profile-grid-responsive">
            
            {/* Column 1: Donut Chart */}
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 16 }}>
                Distribución por género
              </h3>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
                {/* Donut graphic */}
                <div style={{ position: 'relative', width: 110, height: 110, flexShrink: 0 }}>
                  <svg width="110" height="110" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
                    <circle
                      cx="50"
                      cy="50"
                      r={donutRadius}
                      fill="none"
                      stroke="#ffffff0a"
                      strokeWidth="10"
                    />
                    {stats.genreDistribution.map((genre, idx) => {
                      const strokeDasharray = `${(genre.percentage / 100) * donutCirc} ${donutCirc}`;
                      const strokeDashoffset = -((accumulatedPercent / 100) * donutCirc);
                      accumulatedPercent += genre.percentage;
                      return (
                        <circle
                          key={genre.name}
                          cx="50"
                          cy="50"
                          r={donutRadius}
                          fill="none"
                          stroke={donutColors[idx % donutColors.length]}
                          strokeWidth="10"
                          strokeDasharray={strokeDasharray}
                          strokeDashoffset={strokeDashoffset}
                          strokeLinecap="round"
                          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
                        />
                      );
                    })}
                  </svg>
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1
                  }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{stats.topGenrePercentage}%</span>
                    <span style={{ fontSize: 8, color: 'var(--text-secondary)', marginTop: 4, textAlign: 'center', maxWidth: 65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {stats.topGenre}
                    </span>
                  </div>
                </div>

                {/* Donut Legend */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {stats.genreDistribution.slice(0, 3).map((genre, idx) => (
                    <div key={genre.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: donutColors[idx % donutColors.length],
                        flexShrink: 0
                      }} />
                      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{genre.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{genre.percentage}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Column 2: Listening Evolution Line Chart */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', margin: 0 }}>
                  Evolución de escucha
                </h3>
                <select
                  value={evolutionPeriod}
                  onChange={(e) => setEvolutionPeriod(e.target.value)}
                  style={{
                    padding: '4px 24px 4px 10px',
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--text-secondary)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                >
                  <option value="30" style={{ background: '#1f1f1f', color: '#ffffff' }}>Últimos 30 días</option>
                  <option value="7" style={{ background: '#1f1f1f', color: '#ffffff' }}>Últimos 7 días</option>
                </select>
              </div>

              {/* Chart SVG */}
              <div style={{ position: 'relative', width: '100%', height: 130 }}>
                <svg width="100%" height="100%" viewBox="0 0 450 135" style={{ overflow: 'visible' }}>
                  {/* Grid Lines */}
                  {[0, 25, 50, 75, 100].map((label) => {
                    const y = 110 - (label / 100) * 75;
                    return (
                      <g key={label}>
                        <text x="25" y={y + 4} fill="var(--text-muted)" fontSize="9" textAnchor="end">{label}</text>
                        <line x1="35" y1={y} x2="430" y2={y} stroke="rgba(255,255,255,0.04)" strokeWidth="1" strokeDasharray="4 4" />
                      </g>
                    );
                  })}

                  {/* Gradient definition */}
                  <defs>
                    <linearGradient id="chart-glow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1DB954" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#1DB954" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Shaded Area */}
                  {areaPath && <path d={areaPath} fill="url(#chart-glow)" />}

                  {/* Line Curve */}
                  {linePath && (
                    <path
                      d={linePath}
                      fill="none"
                      stroke="#1DB954"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  )}

                  {/* Interactive Nodes */}
                  {chartPoints.map((pt, idx) => (
                    <circle
                      key={idx}
                      cx={pt.x}
                      cy={pt.y}
                      r="4.5"
                      fill="#121212"
                      stroke="#1DB954"
                      strokeWidth="2"
                    />
                  ))}

                  {/* X Axis Labels */}
                  {evolution.map((val, idx) => {
                    const x = 50 + idx * (380 / (evolution.length - 1 || 1));
                    return (
                      <text
                        key={idx}
                        x={x}
                        y="130"
                        fill="var(--text-muted)"
                        fontSize="9"
                        textAnchor="middle"
                      >
                        {val.date}
                      </text>
                    );
                  })}
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Right Box: Estado de ánimo */}
        <div style={{
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          border: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          flexDirection: 'column'
        }} className="stats-card-responsive">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>Estado de ánimo</h2>
            <a href="#more-moods" style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
              Ver más
            </a>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4, marginBottom: 20 }}>
            Basado en tus reproducciones
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, justifyContent: 'center' }}>
            {stats.moods.map((mood) => (
              <div
                key={mood.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '12px 16px',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 'var(--radius-md)',
                  borderLeft: `4px solid ${mood.color}`,
                  transition: 'background var(--duration-fast)',
                }}
                className="mood-row-hover"
              >
                <div style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: `${mood.color}15`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {mood.name === 'Enérgico' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={mood.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                  )}
                  {mood.name === 'Urban' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={mood.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                      <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
                      <line x1="12" y1="19" x2="12" y2="22"></line>
                    </svg>
                  )}
                  {mood.name === 'Emocional' && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={mood.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                    </svg>
                  )}
                  {!['Enérgico', 'Urban', 'Emocional'].includes(mood.name) && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={mood.color} strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10"></circle>
                    </svg>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{mood.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                    {mood.percentage}% de tus reproducciones
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3: Canciones más escuchadas (Left) & Artistas Top (Right) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: 24,
        marginBottom: 40,
      }} className="stats-row-responsive">
        
        {/* Left Box: Canciones más escuchadas */}
        <div style={{
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          border: '1px solid rgba(255,255,255,0.05)',
          overflow: 'hidden'
        }} className="stats-card-responsive">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>Canciones más escuchadas</h2>
            <a href="#all-songs" style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
              Ver todas
            </a>
          </div>

          <div style={{
            display: 'flex',
            gap: 16,
            overflowX: 'auto',
            paddingBottom: 10,
            scrollSnapType: 'x mandatory'
          }} className="custom-scrollbar">
            {stats.topTracks.slice(0, 10).map((track) => (
              <div
                key={track.trackId}
                onClick={async () => {
                  const trackData = await getTrack(track.trackId);
                  if (trackData) setTrack(trackData);
                }}
                style={{
                  width: 130,
                  flexShrink: 0,
                  scrollSnapAlign: 'start',
                  cursor: 'pointer'
                }}
                className="track-card-mini"
              >
                <div style={{
                  position: 'relative',
                  width: '100%',
                  aspectRatio: 1,
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  marginBottom: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                }} className="cover-wrap">
                  <img
                    src={track.cover}
                    alt={track.title}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0,
                    transition: 'opacity 0.2s'
                  }} className="play-overlay">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#fff',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.2
                }}>
                  {track.title}
                </div>
                <div style={{
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginTop: 2
                }}>
                  {track.artist}
                </div>
                <div style={{
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  fontWeight: 600,
                  marginTop: 4
                }}>
                  {track.playCount} reproducciones
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Box: Artistas Top */}
        <div style={{
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          border: '1px solid rgba(255,255,255,0.05)',
        }} className="stats-card-responsive">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>Artistas Top</h2>
            <a href="#all-artists" style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
              Ver todos
            </a>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {stats.topArtists.slice(0, 5).map((artist, idx) => (
              <div
                key={artist.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 12px',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer'
                }}
                className="artist-row-hover"
              >
                <div style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: idx < 3 ? 'var(--accent)' : 'var(--text-muted)',
                  width: 24,
                  textAlign: 'center'
                }}>
                  #{idx + 1}
                </div>
                <img
                  src={artist.image}
                  alt={artist.name}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    objectFit: 'cover'
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: '#fff',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}>
                    {artist.name}
                    {idx === 2 && <span style={{ color: '#f1c40f', fontSize: 11 }}>★</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {artist.count} reproducciones
                  </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 4: Momentos destacados (Left) & Actividad reciente (Right) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: 24,
        marginBottom: 40,
      }} className="stats-row-responsive">
        
        {/* Left Box: Momentos destacados */}
        <div style={{
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          border: '1px solid rgba(255,255,255,0.05)',
        }} className="stats-card-responsive">
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0, marginBottom: 20 }}>
            Momentos destacados
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 16
          }}>
            {/* Highlights Card 1: Día Favorito */}
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              borderRadius: 'var(--radius-md)',
              padding: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Día favorito</span>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 4 }}>
                  {stats.highlights.favoriteDay}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                  {stats.highlights.favoriteDayPercentage}% de tu escucha semanal
                </span>
              </div>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(91, 134, 229, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#5B86E5',
                flexShrink: 0
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
              </div>
            </div>

            {/* Highlights Card 2: Hora Favorita */}
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              borderRadius: 'var(--radius-md)',
              padding: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Hora favorita</span>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 4 }}>
                  {stats.highlights.favoriteHour}
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                  Es tu hora más activa
                </span>
              </div>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(214, 158, 46, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#D69E2E',
                flexShrink: 0
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </div>
            </div>

            {/* Highlights Card 3: Racha Más Larga */}
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              borderRadius: 'var(--radius-md)',
              padding: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>Racha más larga</span>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginTop: 4 }}>
                  {stats.highlights.longestStreak} días
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                  ¡Sigue así! 🔥
                </span>
              </div>
              <div style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(229, 62, 62, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#E53E3E',
                flexShrink: 0
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"></path>
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Right Box: Actividad reciente */}
        <div style={{
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          border: '1px solid rgba(255,255,255,0.05)',
        }} className="stats-card-responsive">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>Actividad reciente</h2>
            <a href="#all-activity" style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
              Ver todo
            </a>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {stats.recentActivity.slice(0, 3).map((act, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <img
                  src={act.image}
                  alt=""
                  style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', objectFit: 'cover', flexShrink: 0 }}
                />
                <div style={{ minWidth: 0 }}>
                  <p style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#fff',
                    lineHeight: 1.3,
                    margin: 0,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}>
                    {act.type === 'playlist_add' ? (
                      <>
                        Añadiste <span style={{ color: 'var(--accent)' }}>{act.text.split(' a tu playlist ')[0].replace('Añadiste ', '')}</span> a tu playlist <span style={{ fontWeight: 700 }}>{act.text.split(' a tu playlist ')[1]}</span>
                      </>
                    ) : (
                      act.text
                    )}
                  </p>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginTop: 2 }}>
                    {act.time}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* New Section: Comparte con tus amigos (Placeholder) */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(102, 126, 234, 0.15), rgba(159, 122, 234, 0.15))',
        border: '1px solid rgba(159, 122, 234, 0.3)',
        borderRadius: 'var(--radius-lg)',
        padding: '32px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 20
      }} className="stats-card-responsive">
        <div style={{ maxWidth: 500 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            Comparte tu música con tus amigos
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 8, lineHeight: 1.4 }}>
            Genera una tarjeta personalizada con tu perfil de géneros, canciones favoritas y estadísticas de escucha para compartirla directamente en tus redes sociales.
          </p>
        </div>

        <button
          onClick={() => {
            const params = new URLSearchParams(searchParams);
            params.set('share', 'true');
            setSearchParams(params);
          }}
          style={{
            background: '#fff',
            color: '#000',
            border: 'none',
            borderRadius: 'var(--radius-full)',
            padding: '12px 24px',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'transform var(--duration-fast)',
            boxShadow: '0 4px 12px rgba(255,255,255,0.1)'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.03)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1.0)')}
        >
          Crear tarjeta para compartir
        </button>
      </div>

      {/* Share Modal Overlay */}
      {showShare && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(8px)',
          animation: 'fade-in 0.25s ease'
        }} onClick={closeShareModal}>
          
          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--radius-lg)',
            width: '90%',
            maxWidth: 460,
            padding: 28,
            position: 'relative',
            boxShadow: '0 12px 48px rgba(0,0,0,0.6)'
          }} onClick={(e) => e.stopPropagation()}>
            
            {/* Close Button */}
            <button
              onClick={closeShareModal}
              style={{
                position: 'absolute',
                top: 16, right: 16,
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer'
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>

            <h3 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>Compartir estadísticas</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4, marginBottom: 24 }}>
              Elige cómo te gustaría compartir tu perfil de escucha
            </p>

            {/* Sharing Card Preview */}
            <div style={{
              background: 'linear-gradient(135deg, #1f1f1f, #0d0d0d)',
              border: '1px solid rgba(29, 185, 84, 0.4)',
              borderRadius: 'var(--radius-md)',
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              marginBottom: 24,
              boxShadow: '0 8px 24px rgba(29,185,84,0.15)',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div style={{
                position: 'absolute',
                top: -50, right: -50,
                width: 150, height: 150,
                background: '#1DB954',
                filter: 'blur(80px)',
                opacity: 0.15,
                borderRadius: '50%'
              }} />

              {/* Mock Brand Logo */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
                <span style={{ color: 'var(--accent)', fontWeight: 800, fontSize: 14 }}>Koko</span>
                <span style={{ color: '#fff', fontWeight: 500, fontSize: 14 }}>Music</span>
              </div>

              {/* User stats content summary */}
              <div style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', border: '3px solid var(--accent)', marginBottom: 12 }}>
                <img src={stats.mostPlayedTrackCover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>

              <h4 style={{ fontSize: 16, fontWeight: 800, color: '#fff', margin: 0 }}>Mis Estadísticas</h4>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>Periodo: {period === 'all' ? 'Siempre' : period === 'day' ? 'Hoy' : 'Este mes'}</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, width: '100%', marginTop: 20, background: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 'var(--radius-sm)' }}>
                <div>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>Canciones</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent)', marginTop: 2, display: 'block' }}>{stats.totalPlays}</span>
                </div>
                <div>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>Artistas</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 2, display: 'block' }}>{stats.uniqueArtists}</span>
                </div>
                <div>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>Top Género</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#5B86E5', marginTop: 4, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stats.topGenre}</span>
                </div>
              </div>
            </div>

            {/* Sharing Options (Placeholders) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href.split('?')[0]);
                  alert('Enlace copiado al portapapeles!');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  width: '100%',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background var(--duration-fast)'
                }}
                className="btn-share-option"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
                Copiar enlace de estadísticas
              </button>

              <button
                onClick={() => alert('Compartiendo en Instagram Stories (simulado)...')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  width: '100%',
                  background: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                </svg>
                Compartir en Instagram Stories
              </button>

              <button
                onClick={() => alert('Descargando imagen de perfil (simulado)...')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  width: '100%',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background var(--duration-fast)'
                }}
                className="btn-share-option"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Descargar imagen para compartir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
