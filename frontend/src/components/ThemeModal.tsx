import { useState } from 'react';
import { useThemeStore, ACCENT_COLORS, PRESET_WALLPAPERS, type AccentColorKey, type BgStyleKey, type DensityKey, type FontStyleKey, type CornerRadiusKey } from '../store/themeStore';

export default function ThemeModal() {
  const {
    accentColor,
    customAccentHex,
    bgStyle,
    customBgHex,
    wallpaperUrl,
    wallpaperBlur,
    density,
    fontStyle,
    cornerRadius,
    cardStyle,
    cardHover,
    playerOpacity,
    customGreeting,
    isThemeModalOpen,
    setIsThemeModalOpen,
    setAccentColor,
    setCustomAccentHex,
    setBgStyle,
    setCustomBgHex,
    setWallpaperUrl,
    setWallpaperBlur,
    setDensity,
    setFontStyle,
    setCornerRadius,
    setCardStyle,
    setCardHover,
    setPlayerOpacity,
    setCustomGreeting,
  } = useThemeStore();

  const [wallpaperInput, setWallpaperInput] = useState('');

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
          width: '92%',
          margin: '0 auto',
          borderRadius: '24px 24px 0 0',
          maxHeight: '85vh',
          overflowY: 'auto',
          padding: '24px 20px',
          background: 'rgba(18, 18, 20, 0.98)',
          backdropFilter: 'blur(24px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.7)',
        }}
      >
        <div className="bottom-sheet-drag-handle" onClick={() => setIsThemeModalOpen(false)} />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
                <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
                <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
                <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
                <path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10c1.38 0 2.5-1.12 2.5-2.5 0-.61-.23-1.21-.64-1.67-.42-.45-.64-1.04-.64-1.67 0-1.38 1.12-2.5 2.5-2.5H18c2.21 0 4-1.79 4-4 0-4.97-4.43-9.1-10-9.1z"/>
              </svg>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#fff' }}>Personalización de Diseño</h3>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>Configura tu tema y estilo visual</p>
            </div>
          </div>
          <button
            onClick={() => setIsThemeModalOpen(false)}
            style={{ background: 'rgba(255,255,255,0.06)', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 8, borderRadius: '50%' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* 1. ACCENT COLOR */}
        <div style={{ marginBottom: 20, background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#fff' }}>Color de Acento</h4>
            <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, fontFamily: 'monospace' }}>
              {accentColor === 'custom' ? customAccentHex.toUpperCase() : ACCENT_COLORS[accentColor]?.label}
            </span>
          </div>

          {/* Preset Colors */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 14 }}>
            {(Object.keys(ACCENT_COLORS) as AccentColorKey[]).map((key) => {
              const cfg = ACCENT_COLORS[key];
              const isSel = accentColor === key;
              return (
                <button
                  key={key}
                  onClick={() => setAccentColor(key)}
                  title={cfg.label}
                  style={{
                    height: 38,
                    borderRadius: 10,
                    background: cfg.accent,
                    border: isSel ? '3px solid #fff' : '2px solid transparent',
                    boxShadow: isSel ? `0 0 12px ${cfg.glow}` : 'none',
                    cursor: 'pointer',
                    transition: 'transform 0.15s ease',
                    transform: isSel ? 'scale(1.06)' : 'scale(1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSel && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>

          {/* Custom Hex Color Picker */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'rgba(0,0,0,0.3)', padding: '8px 12px', borderRadius: 10, border: accentColor === 'custom' ? '1.5px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>Color personalizado</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color"
                value={customAccentHex}
                onChange={(e) => setCustomAccentHex(e.target.value)}
                style={{ width: 32, height: 32, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'none' }}
              />
              <input
                type="text"
                value={customAccentHex}
                onChange={(e) => {
                  if (e.target.value.startsWith('#') || e.target.value.length === 6) {
                    const val = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                    setCustomAccentHex(val);
                  }
                }}
                placeholder="#00F2FE"
                style={{
                  width: 85,
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 6,
                  padding: '5px 8px',
                  color: '#fff',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  textAlign: 'center',
                }}
              />
            </div>
          </div>
        </div>

        {/* 2. BACKGROUND STYLE & CUSTOM BG COLOR */}
        <div style={{ marginBottom: 20, background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700, color: '#fff' }}>Fondo Principal</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
            {[
              {
                key: 'dark', label: 'Oscuro Elegante',
                icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-5.4-5.4c0-1.81.89-3.42 2.26-4.4C12.92 3.04 12.46 3 12 3z"/></svg>
              },
              {
                key: 'glass', label: 'Cristal Esmerilado',
                icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L9.5 7.5 4 8.5l4 4.2L7 18l5-2.8L17 18l-1-5.3 4-4.2-5.5-1z"/></svg>
              },
              {
                key: 'ambient', label: 'Resplandor Neón',
                icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>
              },
              {
                key: 'wallpaper', label: 'Imagen HD',
                icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              },
            ].map((st) => {
              const isSel = bgStyle === st.key;
              return (
                <button
                  key={st.key}
                  onClick={() => setBgStyle(st.key as BgStyleKey)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: isSel ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                    border: isSel ? '1.5px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.08)',
                    color: isSel ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ display: 'flex', color: isSel ? 'var(--accent)' : 'inherit' }}>{st.icon}</span>
                  <span>{st.label}</span>
                </button>
              );
            })}
          </div>

          {/* Custom Bg Color */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'rgba(0,0,0,0.3)', padding: '8px 12px', borderRadius: 10, border: bgStyle === 'custom' ? '1.5px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>Tono de fondo personalizado</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="color"
                value={customBgHex}
                onChange={(e) => setCustomBgHex(e.target.value)}
                style={{ width: 32, height: 32, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'none' }}
              />
              <input
                type="text"
                value={customBgHex}
                onChange={(e) => {
                  const val = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
                  setCustomBgHex(val);
                }}
                placeholder="#0F172A"
                style={{
                  width: 85,
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 6,
                  padding: '5px 8px',
                  color: '#fff',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  textAlign: 'center',
                }}
              />
            </div>
          </div>

          {/* Wallpapers if selected */}
          {bgStyle === 'wallpaper' && (
            <div style={{ marginTop: 14, animation: 'fadeIn var(--duration-fast) ease-out' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
                {PRESET_WALLPAPERS.map((wp) => {
                  const isSel = wallpaperUrl === wp.url;
                  return (
                    <div
                      key={wp.id}
                      onClick={() => setWallpaperUrl(wp.url)}
                      style={{
                        height: 55,
                        borderRadius: 8,
                        backgroundImage: `url(${wp.url})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        border: isSel ? '2px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.1)',
                        cursor: 'pointer',
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                    >
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', padding: 4 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#fff' }}>{wp.label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  placeholder="URL de imagen..."
                  value={wallpaperInput}
                  onChange={(e) => setWallpaperInput(e.target.value)}
                  style={{
                    flex: 1,
                    background: 'rgba(0,0,0,0.4)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    color: '#fff',
                    fontSize: 12,
                  }}
                />
                <button
                  onClick={() => {
                    if (wallpaperInput.trim()) {
                      setWallpaperUrl(wallpaperInput.trim());
                      setWallpaperInput('');
                    }
                  }}
                  style={{ background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                >
                  Aplicar
                </button>
              </div>

              {/* Wallpaper Blur Level Control */}
              <div style={{ marginTop: 12, background: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>Desenfoque de imagen (Blur):</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace' }}>
                    {wallpaperBlur === 0 ? 'Sin Desenfoque (Foto Nítida)' : `${wallpaperBlur}px`}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="36"
                  step="2"
                  value={wallpaperBlur}
                  onChange={(e) => setWallpaperBlur(parseInt(e.target.value, 10))}
                  style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
                  <span onClick={() => setWallpaperBlur(0)} style={{ cursor: 'pointer', color: wallpaperBlur === 0 ? 'var(--accent)' : 'inherit' }}>0px (Nítida)</span>
                  <span onClick={() => setWallpaperBlur(12)} style={{ cursor: 'pointer', color: wallpaperBlur === 12 ? 'var(--accent)' : 'inherit' }}>12px (Suave)</span>
                  <span onClick={() => setWallpaperBlur(24)} style={{ cursor: 'pointer', color: wallpaperBlur === 24 ? 'var(--accent)' : 'inherit' }}>24px (Medio)</span>
                  <span onClick={() => setWallpaperBlur(36)} style={{ cursor: 'pointer', color: wallpaperBlur === 36 ? 'var(--accent)' : 'inherit' }}>36px (Intenso)</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 3. PERSONAL GREETING & TYPOGRAPHY */}
        <div style={{ marginBottom: 20, background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700, color: '#fff' }}>Experiencia Personal</h4>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Nombre o apodo en el saludo:</label>
            <input
              type="text"
              placeholder="Ej. Luis"
              value={customGreeting}
              onChange={(e) => setCustomGreeting(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {/* Font */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Tipografía:</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { key: 'dmsans', label: 'DM Sans (Moderna)' },
                  { key: 'outfit', label: 'Outfit (Futurista)' },
                  { key: 'inter', label: 'Inter (Limpia)' },
                ].map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFontStyle(f.key as FontStyleKey)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: fontStyle === f.key ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.3)',
                      border: fontStyle === f.key ? '1.5px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)',
                      color: fontStyle === f.key ? '#fff' : 'var(--text-secondary)',
                      fontSize: 11,
                      fontWeight: 600,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Corner Radius */}
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>Bordes:</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  { key: 'sharp', label: 'Rectangulares' },
                  { key: 'rounded', label: 'Redondeados' },
                  { key: 'soft', label: 'Suaves' },
                ].map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setCornerRadius(r.key as CornerRadiusKey)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 6,
                      background: cornerRadius === r.key ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.3)',
                      border: cornerRadius === r.key ? '1.5px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)',
                      color: cornerRadius === r.key ? '#fff' : 'var(--text-secondary)',
                      fontSize: 11,
                      fontWeight: 600,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 4. CARD CUSTOMIZATION */}
        <div style={{ marginBottom: 20, background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700, color: '#fff' }}>Estilo de Tarjetas y Portadas</h4>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>Superficie de Tarjeta:</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {[
                { key: 'dark', label: 'Oscura' },
                { key: 'glass', label: 'Cristal' },
                { key: 'tinted', label: 'Acento' },
                { key: 'outline', label: 'Borde' },
              ].map((st) => (
                <button
                  key={st.key}
                  onClick={() => setCardStyle(st.key as any)}
                  style={{
                    padding: '8px 4px',
                    borderRadius: 8,
                    background: cardStyle === st.key ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.3)',
                    border: cardStyle === st.key ? '1.5px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)',
                    color: cardStyle === st.key ? '#fff' : 'var(--text-secondary)',
                    fontSize: 11,
                    fontWeight: 600,
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>Efecto al Pasar el Cursor:</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {[
                { key: 'glow', label: 'Resplandor Neón' },
                { key: 'lift', label: 'Elevación Suave' },
              ].map((h) => (
                <button
                  key={h.key}
                  onClick={() => setCardHover(h.key as any)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: cardHover === h.key ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.3)',
                    border: cardHover === h.key ? '1.5px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)',
                    color: cardHover === h.key ? '#fff' : 'var(--text-secondary)',
                    fontSize: 11,
                    fontWeight: 600,
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Opacidad del Reproductor:</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace' }}>
                {Math.round(playerOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.2"
              max="1.0"
              step="0.05"
              value={playerOpacity}
              onChange={(e) => setPlayerOpacity(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
              <span onClick={() => setPlayerOpacity(0.35)} style={{ cursor: 'pointer' }}>35% (Cristal)</span>
              <span onClick={() => setPlayerOpacity(0.65)} style={{ cursor: 'pointer' }}>65% (Translúcido)</span>
              <span onClick={() => setPlayerOpacity(0.85)} style={{ cursor: 'pointer' }}>85% (Normal)</span>
              <span onClick={() => setPlayerOpacity(1.0)} style={{ cursor: 'pointer' }}>100% (Sólido)</span>
            </div>
          </div>
        </div>

        {/* 5. DENSITY */}
        <div>
          <h4 style={{ margin: '0 0 10px 0', fontSize: 14, fontWeight: 700, color: '#fff' }}>Densidad Móvil</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {[
              { key: 'comfortable', label: 'Cómoda', desc: 'Espaciado normal' },
              { key: 'compact', label: 'Compacta', desc: 'Más elementos por pantalla' },
            ].map((d) => {
              const isSel = density === d.key;
              return (
                <button
                  key={d.key}
                  onClick={() => setDensity(d.key as DensityKey)}
                  style={{
                    padding: '10px',
                    borderRadius: 10,
                    background: isSel ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                    border: isSel ? '1.5px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.08)',
                    color: isSel ? '#fff' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: isSel ? 'var(--accent)' : '#fff' }}>{d.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>{d.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
