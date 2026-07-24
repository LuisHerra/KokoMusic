import { useState } from 'react';
import { useThemeStore, ACCENT_COLORS, PRESET_WALLPAPERS, type AccentColorKey, type BgStyleKey, type DensityKey } from '../store/themeStore';

export default function ThemeModal() {
  const {
    accentColor,
    bgStyle,
    wallpaperUrl,
    density,
    isThemeModalOpen,
    setIsThemeModalOpen,
    setAccentColor,
    setBgStyle,
    setWallpaperUrl,
    setDensity,
  } = useThemeStore();

  const [customUrl, setCustomUrl] = useState('');

  if (!isThemeModalOpen) return null;

  return (
    <div
      className="bottom-sheet-overlay open"
      onClick={() => setIsThemeModalOpen(false)}
      style={{ zIndex: 9999, animation: 'fadeIn var(--duration-fast) ease-out' }}
    >
      <div
        className="bottom-sheet-content open custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '560px',
          margin: '0 auto',
          borderRadius: '20px 20px 0 0',
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: '24px',
          background: 'rgba(20, 20, 20, 0.95)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <div className="bottom-sheet-drag-handle" onClick={() => setIsThemeModalOpen(false)} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
                <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
                <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
                <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
                <path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10c1.38 0 2.5-1.12 2.5-2.5 0-.61-.23-1.21-.64-1.67-.42-.45-.64-1.04-.64-1.67 0-1.38 1.12-2.5 2.5-2.5H18c2.21 0 4-1.79 4-4 0-4.97-4.43-9.1-10-9.1z"/>
              </svg>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#fff' }}>Personalizar Diseño</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>Elige tus colores, fondo y disposición móvil</p>
            </div>
          </div>
          <button
            onClick={() => setIsThemeModalOpen(false)}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 4 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* 1. ACCENT COLORS */}
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Color de Acento</span>
            <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>({ACCENT_COLORS[accentColor]?.label})</span>
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
            {(Object.keys(ACCENT_COLORS) as AccentColorKey[]).map((key) => {
              const cfg = ACCENT_COLORS[key];
              const isSel = accentColor === key;
              return (
                <button
                  key={key}
                  onClick={() => setAccentColor(key)}
                  title={cfg.label}
                  style={{
                    height: 44,
                    borderRadius: 12,
                    background: cfg.accent,
                    border: isSel ? '3px solid #fff' : '2px solid transparent',
                    boxShadow: isSel ? `0 0 16px ${cfg.glow}` : 'none',
                    cursor: 'pointer',
                    transition: 'transform 0.15s ease, border 0.15s ease',
                    transform: isSel ? 'scale(1.1)' : 'scale(1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSel && (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. BACKGROUND STYLE */}
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Estilo de Fondo</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {[
              { key: 'dark', label: 'Oscuro Spotify', icon: '🌙' },
              { key: 'glass', label: 'Cristal Esmerilado', icon: '✨' },
              { key: 'ambient', label: 'Resplandor Ambiente', icon: '🎨' },
              { key: 'wallpaper', label: 'Imagen de Fondo', icon: '🖼️' },
            ].map((st) => {
              const isSel = bgStyle === st.key;
              return (
                <button
                  key={st.key}
                  onClick={() => setBgStyle(st.key as BgStyleKey)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: isSel ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                    border: isSel ? '1.5px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.08)',
                    color: isSel ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    transition: 'all 0.2s ease',
                  }}
                >
                  <span style={{ fontSize: 16 }}>{st.icon}</span>
                  <span>{st.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. PRESET WALLPAPERS (If Wallpaper mode selected) */}
        {bgStyle === 'wallpaper' && (
          <div style={{ marginBottom: 24, animation: 'fadeIn var(--duration-fast) ease-out' }}>
            <h4 style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Imágenes de Fondo</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
              {PRESET_WALLPAPERS.map((wp) => {
                const isSel = wallpaperUrl === wp.url;
                return (
                  <div
                    key={wp.id}
                    onClick={() => setWallpaperUrl(wp.url)}
                    style={{
                      height: 70,
                      borderRadius: 10,
                      backgroundImage: `url(${wp.url})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      border: isSel ? '2px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.1)',
                      cursor: 'pointer',
                      position: 'relative',
                      overflow: 'hidden',
                      transition: 'transform 0.15s ease',
                      transform: isSel ? 'scale(1.04)' : 'scale(1)',
                    }}
                  >
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', padding: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>{wp.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Custom URL Input */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Pegar URL de imagen personalizada..."
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                style={{
                  flex: 1,
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  color: '#fff',
                  fontSize: 12,
                }}
              />
              <button
                onClick={() => {
                  if (customUrl.trim()) {
                    setWallpaperUrl(customUrl.trim());
                    setCustomUrl('');
                  }
                }}
                style={{
                  background: 'var(--accent)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Aplicar
              </button>
            </div>
          </div>
        )}

        {/* 4. LAYOUT DENSITY (Mobile Optimized) */}
        <div style={{ marginBottom: 12 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Densidad para Móviles</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {[
              { key: 'comfortable', label: 'Cómoda (Estándar)', desc: 'Mayor separación táctil' },
              { key: 'compact', label: 'Compacta (Móvil Pro)', desc: 'Ver más canciones por pantalla' },
            ].map((d) => {
              const isSel = density === d.key;
              return (
                <button
                  key={d.key}
                  onClick={() => setDensity(d.key as DensityKey)}
                  style={{
                    padding: '12px',
                    borderRadius: 10,
                    background: isSel ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                    border: isSel ? '1.5px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.08)',
                    color: isSel ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: isSel ? 'var(--accent)' : '#fff', marginBottom: 2 }}>{d.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{d.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
